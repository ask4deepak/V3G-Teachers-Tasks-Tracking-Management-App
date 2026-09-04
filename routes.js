/**
 * Application Routes Module (routes.js)
 * Implements REST APIs for Auth, Profiles, Masters, Users, Groups, Tasks, Teacher Portal, Reports, Reminders, Imports, Roles, and Audit.
 */
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const auth = require('./auth');
const services = require('./services');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ============================================================================
// 1. AUTHENTICATION & SESSION ROUTES
// ============================================================================

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await auth.authenticate(email, password);

    // Save session
    req.session.user = user;

    await services.logAudit({
      userId: user.id,
      campusId: user.authorizedCampusIds[0] || null,
      action: 'LOGIN',
      entityType: 'USER',
      entityId: user.id,
      description: `User ${user.display_name} (${user.email}) logged in successfully.`,
      ipAddress: req.ip
    });

    res.json({ success: true, user });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

router.post('/auth/logout', (req, res) => {
  if (req.session) {
    const user = req.session.user;
    if (user) {
      services.logAudit({
        userId: user.id,
        campusId: user.authorizedCampusIds[0] || null,
        action: 'LOGOUT',
        entityType: 'USER',
        entityId: user.id,
        description: `User ${user.display_name} logged out.`,
        ipAddress: req.ip
      });
    }
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: 'Failed to logout' });
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  } else {
    res.json({ success: true });
  }
});

router.get('/auth/me', auth.requireAuth, async (req, res) => {
  try {
    // Re-resolve access context on fresh load to reflect immediate role/campus updates
    let user;
    if (db.isMemoryFallback()) {
      user = db.getMemoryStore().users.find(u => u.id === req.user.id);
    } else {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
      user = result.rows[0];
    }

    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Session expired or user inactive' });
    }

    const accessContext = await auth.resolveUserAccessContext(user);
    const refreshed = { ...auth.sanitizeUser(user), ...accessContext };
    req.session.user = refreshed;

    res.json(refreshed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 2. MY PROFILE ROUTES (TEACHER SELF-SERVICE)
// ============================================================================

router.get('/profile', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    let user;
    let userAttributes = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      user = store.users.find(u => u.id === userId);
      userAttributes = store.user_attributes.filter(a => a.user_id === userId);
    } else {
      const uRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
      user = uRes.rows[0];

      const aRes = await db.query(`
        SELECT ua.*, mv.master_type, mv.name as master_name, c.name as campus_name
        FROM user_attributes ua
        JOIN master_values mv ON ua.master_value_id = mv.id
        JOIN campuses c ON ua.campus_id = c.id
        WHERE ua.user_id = $1
      `, [userId]);
      userAttributes = aRes.rows;
    }

    res.json({
      user: auth.sanitizeUser(user),
      attributes: userAttributes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/profile', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { phone, class_teacher_status, department_id, designation_id, subject_ids = [], category_ids = [], campus_id } = req.body;

    // Validate campus
    if (!campus_id) return res.status(400).json({ error: 'Campus is required' });

    // Validate master values server-side
    const allMasterIds = [department_id, designation_id, ...subject_ids, ...category_ids].filter(Boolean);
    
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      const u = store.users.find(x => x.id === userId);
      if (phone !== undefined) u.phone = phone;
      if (class_teacher_status !== undefined) u.class_teacher_status = Boolean(class_teacher_status);
      u.updated_at = new Date();

      // Clear existing attributes for this user
      store.user_attributes = store.user_attributes.filter(a => a.user_id !== userId);

      // Add updated attributes
      for (const mid of allMasterIds) {
        store.user_attributes.push({
          id: uuidv4(),
          user_id: userId,
          campus_id,
          master_value_id: mid,
          created_at: new Date(),
          created_by: userId
        });
      }
    } else {
      await db.transaction(async (client) => {
        await client.query(`
          UPDATE users SET phone = COALESCE($1, phone), class_teacher_status = $2, updated_at = NOW()
          WHERE id = $3
        `, [phone, Boolean(class_teacher_status), userId]);

        await client.query('DELETE FROM user_attributes WHERE user_id = $1', [userId]);

        for (const mid of allMasterIds) {
          await client.query(`
            INSERT INTO user_attributes (id, user_id, campus_id, master_value_id, created_by)
            VALUES ($1, $2, $3, $4, $2)
            ON CONFLICT (user_id, campus_id, master_value_id) DO NOTHING
          `, [uuidv4(), userId, campus_id, mid]);
        }
      });
    }

    await services.logAudit({
      userId,
      campusId: campus_id,
      action: 'PROFILE_UPDATED',
      entityType: 'USER',
      entityId: userId,
      description: `User ${req.user.display_name} updated their self-service profile attributes.`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 3. CAMPUSES & MASTER DATA ROUTES
// ============================================================================

router.get('/campuses', auth.requireAuth, async (req, res) => {
  try {
    let campuses = [];
    if (db.isMemoryFallback()) {
      campuses = db.getMemoryStore().campuses.filter(c => c.status === 'ACTIVE');
    } else {
      const q = req.user.isSuperAdmin
        ? 'SELECT * FROM campuses WHERE status = $1 ORDER BY name ASC'
        : 'SELECT * FROM campuses WHERE id = ANY($2) AND status = $1 ORDER BY name ASC';
      const p = req.user.isSuperAdmin ? ['ACTIVE'] : ['ACTIVE', req.user.authorizedCampusIds || []];
      const result = await db.query(q, p);
      campuses = result.rows;
    }

    if (!req.user.isSuperAdmin && req.user.authorizedCampusIds) {
      campuses = campuses.filter(c => req.user.authorizedCampusIds.includes(c.id));
    }

    res.json(campuses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/masters', auth.requireAuth, async (req, res) => {
  try {
    const { master_type, campus_id, status = 'ACTIVE' } = req.query;
    let list = [];

    if (db.isMemoryFallback()) {
      list = db.getMemoryStore().master_values.filter(m => {
        if (master_type && m.master_type !== master_type) return false;
        if (status && m.status !== status) return false;
        if (campus_id && m.campus_id && m.campus_id !== campus_id) return false;
        return true;
      });
    } else {
      let q = 'SELECT mv.*, c.name as campus_name FROM master_values mv LEFT JOIN campuses c ON mv.campus_id = c.id WHERE 1=1';
      const p = [];
      if (master_type) {
        p.push(master_type);
        q += ` AND mv.master_type = $${p.length}`;
      }
      if (status) {
        p.push(status);
        q += ` AND mv.status = $${p.length}`;
      }
      if (campus_id) {
        p.push(campus_id);
        q += ` AND (mv.campus_id IS NULL OR mv.campus_id = $${p.length})`;
      }
      q += ' ORDER BY mv.sort_order ASC, mv.name ASC';
      const result = await db.query(q, p);
      list = result.rows;
    }

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/masters', auth.requirePermission('masters.create'), async (req, res) => {
  try {
    const { master_type, name, code, campus_id, sort_order = 0 } = req.body;
    if (!master_type || !name) return res.status(400).json({ error: 'Master type and name are required' });

    if (campus_id) auth.assertCampusAccess(req.user, campus_id);

    const id = uuidv4();
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      store.master_values.push({
        id,
        master_type,
        name,
        code: code || name.toUpperCase().replace(/\s+/g, '_'),
        campus_id: campus_id || null,
        status: 'ACTIVE',
        sort_order: parseInt(sort_order, 10),
        created_at: new Date(),
        updated_at: new Date()
      });
    } else {
      await db.query(`
        INSERT INTO master_values (id, master_type, name, code, campus_id, status, sort_order)
        VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)
      `, [id, master_type, name, code || name.toUpperCase().replace(/\s+/g, '_'), campus_id || null, parseInt(sort_order, 10)]);
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: campus_id || null,
      action: 'MASTER_CREATED',
      entityType: 'MASTER_VALUE',
      entityId: id,
      description: `Created ${master_type} master: "${name}"`,
      ipAddress: req.ip
    });

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 4. USERS & TEACHERS MANAGEMENT ROUTES
// ============================================================================

router.get('/users', auth.requirePermission('users.view'), async (req, res) => {
  try {
    const { user_type = 'TEACHER', campus_id, department_id, designation_id, subject_id, category_id, status, search } = req.query;

    let users = [];
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      users = store.users.filter(u => {
        if (user_type && u.user_type !== user_type) return false;
        if (status && u.status !== status) return false;
        if (search) {
          const s = search.toLowerCase();
          const match = u.display_name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s) || (u.employee_code && u.employee_code.toLowerCase().includes(s));
          if (!match) return false;
        }
        return true;
      });

      // Filter by campus and attributes
      users = users.map(u => {
        const attrs = store.user_attributes.filter(a => a.user_id === u.id);
        const camp = attrs[0] ? store.campuses.find(c => c.id === attrs[0].campus_id) : null;
        return {
          ...auth.sanitizeUser(u),
          campus_name: camp ? camp.name : 'Unassigned',
          campus_id: camp ? camp.id : null,
          attributes: attrs
        };
      });

      if (!req.user.isSuperAdmin) {
        users = users.filter(u => !u.campus_id || req.user.authorizedCampusIds.includes(u.campus_id));
      }
      if (campus_id) {
        users = users.filter(u => u.campus_id === campus_id);
      }
    } else {
      let q = `
        SELECT DISTINCT u.id, u.email, u.user_type, u.employee_code, u.first_name, u.last_name, u.display_name, u.phone, u.status, u.class_teacher_status, u.created_at,
        c.id as campus_id, c.name as campus_name
        FROM users u
        LEFT JOIN user_attributes ua ON u.id = ua.user_id
        LEFT JOIN campuses c ON ua.campus_id = c.id
        WHERE 1=1
      `;
      const p = [];

      if (user_type) {
        p.push(user_type);
        q += ` AND u.user_type = $${p.length}`;
      }
      if (status) {
        p.push(status);
        q += ` AND u.status = $${p.length}`;
      }
      if (!req.user.isSuperAdmin) {
        p.push(req.user.authorizedCampusIds || []);
        q += ` AND (ua.campus_id = ANY($${p.length}) OR u.user_type = 'SUPER_ADMIN')`;
      }
      if (campus_id) {
        p.push(campus_id);
        q += ` AND ua.campus_id = $${p.length}`;
      }
      if (search) {
        p.push(`%${search}%`);
        q += ` AND (u.display_name ILIKE $${p.length} OR u.email ILIKE $${p.length} OR u.employee_code ILIKE $${p.length})`;
      }

      q += ' ORDER BY u.display_name ASC';
      const result = await db.query(q, p);
      users = result.rows;
    }

    // Default alphabetical sorting
    users.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', auth.requirePermission('users.create'), async (req, res) => {
  try {
    const { email, password = 'Password@123', first_name, last_name, employee_code, phone, user_type = 'TEACHER', campus_id, class_teacher_status, department_id, designation_id, subject_ids = [], category_ids = [] } = req.body;

    if (!email || !first_name || !last_name) {
      return res.status(400).json({ error: 'Email, First Name, and Last Name are required' });
    }

    if (campus_id) auth.assertCampusAccess(req.user, campus_id);

    const hash = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const displayName = `${first_name} ${last_name}`.trim();
    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      if (store.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        return res.status(400).json({ error: 'User with this email already exists' });
      }
      store.users.push({
        id: userId,
        email,
        password_hash: hash,
        user_type,
        employee_code: employee_code || null,
        first_name,
        last_name,
        display_name: displayName,
        phone: phone || null,
        status: 'ACTIVE',
        class_teacher_status: Boolean(class_teacher_status),
        last_login_at: null,
        created_at: now,
        updated_at: now
      });

      // Attributes
      if (campus_id) {
        const allMasterIds = [department_id, designation_id, ...subject_ids, ...category_ids].filter(Boolean);
        for (const mid of allMasterIds) {
          store.user_attributes.push({
            id: uuidv4(),
            user_id: userId,
            campus_id,
            master_value_id: mid,
            created_at: now,
            created_by: req.user.id
          });
        }
      }
    } else {
      await db.transaction(async (client) => {
        await client.query(`
          INSERT INTO users (id, email, password_hash, user_type, employee_code, first_name, last_name, display_name, phone, status, class_teacher_status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10)
        `, [userId, email, hash, user_type, employee_code || null, first_name, last_name, displayName, phone || null, Boolean(class_teacher_status)]);

        if (campus_id) {
          const allMasterIds = [department_id, designation_id, ...subject_ids, ...category_ids].filter(Boolean);
          for (const mid of allMasterIds) {
            await client.query(`
              INSERT INTO user_attributes (id, user_id, campus_id, master_value_id, created_by)
              VALUES ($1, $2, $3, $4, $5)
            `, [uuidv4(), userId, campus_id, mid, req.user.id]);
          }
        }
      });
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: campus_id || null,
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: userId,
      description: `Created user ${displayName} (${email}) as ${user_type}`,
      ipAddress: req.ip
    });

    res.json({ success: true, id: userId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 5. GROUP MANAGEMENT & JOINING REQUESTS ROUTES
// ============================================================================

router.get('/groups', auth.requireAuth, async (req, res) => {
  try {
    const { campus_id } = req.query;
    let groups = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      groups = store.groups.map(g => {
        const members = store.group_memberships.filter(m => m.group_id === g.id && m.status === 'APPROVED');
        const userMem = store.group_memberships.find(m => m.group_id === g.id && m.user_id === req.user.id);
        const camp = store.campuses.find(c => c.id === g.campus_id);
        return {
          ...g,
          campus_name: camp ? camp.name : 'Unknown',
          member_count: members.length,
          user_membership_status: userMem ? userMem.status : null,
          user_membership_role: userMem ? userMem.membership_role : null
        };
      });
      if (!req.user.isSuperAdmin) {
        groups = groups.filter(g => req.user.authorizedCampusIds.includes(g.campus_id));
      }
      if (campus_id) {
        groups = groups.filter(g => g.campus_id === campus_id);
      }
    } else {
      let q = `
        SELECT g.*, c.name as campus_name,
        (SELECT COUNT(*) FROM group_memberships gm WHERE gm.group_id = g.id AND gm.status = 'APPROVED') as member_count,
        (SELECT gm.status FROM group_memberships gm WHERE gm.group_id = g.id AND gm.user_id = $1) as user_membership_status,
        (SELECT gm.membership_role FROM group_memberships gm WHERE gm.group_id = g.id AND gm.user_id = $1) as user_membership_role
        FROM groups g
        JOIN campuses c ON g.campus_id = c.id
        WHERE 1=1
      `;
      const p = [req.user.id];

      if (!req.user.isSuperAdmin) {
        p.push(req.user.authorizedCampusIds || []);
        q += ` AND g.campus_id = ANY($${p.length})`;
      }
      if (campus_id) {
        p.push(campus_id);
        q += ` AND g.campus_id = $${p.length}`;
      }
      q += ' ORDER BY g.name ASC';
      const result = await db.query(q, p);
      groups = result.rows;
    }

    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups', auth.requirePermission('groups.create'), async (req, res) => {
  try {
    const { name, description, campus_id, allow_join_requests = true, member_ids = [] } = req.body;
    if (!name || !campus_id) return res.status(400).json({ error: 'Group name and campus are required' });

    auth.assertCampusAccess(req.user, campus_id);

    const groupId = uuidv4();
    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      store.groups.push({
        id: groupId,
        name,
        description,
        campus_id,
        status: 'ACTIVE',
        allow_join_requests: Boolean(allow_join_requests),
        created_by: req.user.id,
        created_at: now,
        updated_at: now
      });

      for (const uid of member_ids) {
        store.group_memberships.push({
          id: uuidv4(),
          group_id: groupId,
          user_id: uid,
          membership_role: 'MEMBER',
          status: 'APPROVED',
          requested_at: now,
          requested_by: req.user.id,
          reviewed_at: now,
          reviewed_by: req.user.id,
          review_notes: 'Initial Bulk Add',
          created_at: now,
          updated_at: now
        });
      }
    } else {
      await db.transaction(async (client) => {
        await client.query(`
          INSERT INTO groups (id, name, description, campus_id, status, allow_join_requests, created_by)
          VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6)
        `, [groupId, name, description, campus_id, Boolean(allow_join_requests), req.user.id]);

        for (const uid of member_ids) {
          await client.query(`
            INSERT INTO group_memberships (id, group_id, user_id, membership_role, status, requested_at, requested_by, reviewed_at, reviewed_by, review_notes)
            VALUES ($1, $2, $3, 'MEMBER', 'APPROVED', NOW(), $4, NOW(), $4, 'Initial Bulk Add')
            ON CONFLICT (group_id, user_id) DO NOTHING
          `, [uuidv4(), groupId, uid, req.user.id]);
        }
      });
    }

    await services.logAudit({
      userId: req.user.id,
      campusId,
      action: 'GROUP_CREATED',
      entityType: 'GROUP',
      entityId: groupId,
      description: `Created group "${name}" with ${member_ids.length} initial members.`,
      ipAddress: req.ip
    });

    res.json({ success: true, id: groupId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/join', auth.requireAuth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const userId = req.user.id;
    const now = new Date();

    let group;
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      group = store.groups.find(g => g.id === groupId);
      if (!group) return res.status(404).json({ error: 'Group not found' });
      if (!group.allow_join_requests) return res.status(400).json({ error: 'Group does not accept join requests' });

      const existing = store.group_memberships.find(m => m.group_id === groupId && m.user_id === userId);
      if (existing) {
        if (existing.status === 'APPROVED') return res.status(400).json({ error: 'You are already an approved member of this group' });
        if (existing.status === 'PENDING') return res.status(400).json({ error: 'You already have a pending request for this group' });
        existing.status = 'PENDING';
        existing.requested_at = now;
      } else {
        store.group_memberships.push({
          id: uuidv4(),
          group_id: groupId,
          user_id: userId,
          membership_role: 'MEMBER',
          status: 'PENDING',
          requested_at: now,
          requested_by: userId,
          reviewed_at: null,
          reviewed_by: null,
          review_notes: null,
          created_at: now,
          updated_at: now
        });
      }
    } else {
      const gRes = await db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
      group = gRes.rows[0];
      if (!group) return res.status(404).json({ error: 'Group not found' });
      if (!group.allow_join_requests) return res.status(400).json({ error: 'Group does not accept join requests' });

      await db.query(`
        INSERT INTO group_memberships (id, group_id, user_id, membership_role, status, requested_at, requested_by)
        VALUES ($1, $2, $3, 'MEMBER', 'PENDING', NOW(), $3)
        ON CONFLICT (group_id, user_id) 
        DO UPDATE SET status = 'PENDING', requested_at = NOW() WHERE group_memberships.status IN ('REJECTED', 'REMOVED')
      `, [uuidv4(), groupId, userId]);
    }

    await services.logAudit({
      userId,
      campusId: group.campus_id,
      action: 'GROUP_JOIN_REQUESTED',
      entityType: 'GROUP',
      entityId: groupId,
      description: `User ${req.user.display_name} requested to join group "${group.name}".`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Group join request submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/group-requests', auth.requirePermission('groups.approve_requests'), async (req, res) => {
  try {
    let requests = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      requests = store.group_memberships.filter(m => m.status === 'PENDING').map(m => {
        const u = store.users.find(usr => usr.id === m.user_id);
        const g = store.groups.find(grp => grp.id === m.group_id);
        const c = g ? store.campuses.find(cmp => cmp.id === g.campus_id) : null;
        return {
          id: m.id,
          group_id: m.group_id,
          group_name: g ? g.name : 'Unknown',
          user_id: m.user_id,
          teacher_name: u ? u.display_name : 'Unknown',
          teacher_email: u ? u.email : 'Unknown',
          campus_id: g ? g.campus_id : null,
          campus_name: c ? c.name : 'Unknown',
          status: m.status,
          requested_at: m.requested_at
        };
      });

      if (!req.user.isSuperAdmin) {
        requests = requests.filter(r => req.user.authorizedCampusIds.includes(r.campus_id));
      }
    } else {
      let q = `
        SELECT gm.id, gm.group_id, g.name as group_name, gm.user_id, u.display_name as teacher_name, u.email as teacher_email,
        g.campus_id, c.name as campus_name, gm.status, gm.requested_at
        FROM group_memberships gm
        JOIN groups g ON gm.group_id = g.id
        JOIN users u ON gm.user_id = u.id
        JOIN campuses c ON g.campus_id = c.id
        WHERE gm.status = 'PENDING'
      `;
      const p = [];
      if (!req.user.isSuperAdmin) {
        p.push(req.user.authorizedCampusIds || []);
        q += ` AND g.campus_id = ANY($${p.length})`;
      }
      q += ' ORDER BY gm.requested_at DESC';
      const result = await db.query(q, p);
      requests = result.rows;
    }

    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/group-requests/:id/review', auth.requirePermission('groups.approve_requests'), async (req, res) => {
  try {
    const membershipId = req.params.id;
    const { action, review_notes = '' } = req.body; // 'APPROVE' or 'REJECT'
    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const now = new Date();

    let record;
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      record = store.group_memberships.find(m => m.id === membershipId);
      if (!record) return res.status(404).json({ error: 'Request not found' });
      record.status = newStatus;
      record.reviewed_at = now;
      record.reviewed_by = req.user.id;
      record.review_notes = review_notes;
    } else {
      const result = await db.query(`
        UPDATE group_memberships 
        SET status = $1, reviewed_at = NOW(), reviewed_by = $2, review_notes = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `, [newStatus, req.user.id, review_notes, membershipId]);
      record = result.rows[0];
    }

    await services.logAudit({
      userId: req.user.id,
      action: newStatus === 'APPROVED' ? 'GROUP_JOIN_APPROVED' : 'GROUP_JOIN_REJECTED',
      entityType: 'GROUP_MEMBERSHIP',
      entityId: membershipId,
      description: `${newStatus === 'APPROVED' ? 'Approved' : 'Rejected'} group membership request. Notes: ${review_notes}`,
      ipAddress: req.ip
    });

    res.json({ success: true, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/group-requests/pending-count', auth.requireAuth, async (req, res) => {
  try {
    if (!auth.hasPermission(req.user, 'groups.approve_requests')) {
      return res.json({ count: 0 });
    }

    let count = 0;
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      const list = store.group_memberships.filter(m => {
        if (m.status !== 'PENDING') return false;
        const g = store.groups.find(grp => grp.id === m.group_id);
        if (!g) return false;
        if (!req.user.isSuperAdmin && !req.user.authorizedCampusIds.includes(g.campus_id)) return false;
        return true;
      });
      count = list.length;
    } else {
      const q = req.user.isSuperAdmin
        ? `SELECT COUNT(*) FROM group_memberships gm JOIN groups g ON gm.group_id = g.id WHERE gm.status = 'PENDING'`
        : `SELECT COUNT(*) FROM group_memberships gm JOIN groups g ON gm.group_id = g.id WHERE gm.status = 'PENDING' AND g.campus_id = ANY($1)`;
      const p = req.user.isSuperAdmin ? [] : [req.user.authorizedCampusIds || []];
      const result = await db.query(q, p);
      count = parseInt(result.rows[0].count, 10);
    }

    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 6. TASK ENGINE & BUILDER ROUTES
// ============================================================================

router.post('/tasks/preview-recipients', auth.requirePermission('tasks.create'), async (req, res) => {
  try {
    const { campus_ids = [], audience_rules = {}, recipient_exclusions = [] } = req.body;
    auth.assertCampusAccess(req.user, campus_ids);

    const recipients = await services.resolveTaskAudience(campus_ids, audience_rules, recipient_exclusions);
    res.json({
      total_count: recipients.length,
      active_count: recipients.filter(r => !r.is_excluded).length,
      excluded_count: recipients.filter(r => r.is_excluded).length,
      recipients
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tasks', auth.requireAuth, async (req, res) => {
  try {
    const { status, campus_id, search } = req.query;
    let tasks = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      tasks = store.tasks.filter(t => t.task_type !== 'RECURRING_TEMPLATE').map(t => {
        const asgs = store.assignments.filter(a => a.task_id === t.id);
        const subOnTime = asgs.filter(a => a.status === 'SUBMITTED_ON_TIME').length;
        const subLate = asgs.filter(a => a.status === 'SUBMITTED_LATE').length;
        const overdue = asgs.filter(a => a.status === 'OVERDUE').length;
        const inProgress = asgs.filter(a => a.status === 'IN_PROGRESS').length;
        const total = asgs.length;

        return {
          ...t,
          total_assigned: total,
          submitted_on_time: subOnTime,
          submitted_late: subLate,
          in_progress: inProgress,
          overdue: overdue,
          completion_rate: total > 0 ? Math.round(((subOnTime + subLate) / total) * 100) : 0
        };
      });

      if (status) tasks = tasks.filter(t => t.status === status);
      if (search) tasks = tasks.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
    } else {
      let q = `
        SELECT t.*,
        (SELECT COUNT(*) FROM assignments a WHERE a.task_id = t.id) as total_assigned,
        (SELECT COUNT(*) FROM assignments a WHERE a.task_id = t.id AND a.status = 'SUBMITTED_ON_TIME') as submitted_on_time,
        (SELECT COUNT(*) FROM assignments a WHERE a.task_id = t.id AND a.status = 'SUBMITTED_LATE') as submitted_late,
        (SELECT COUNT(*) FROM assignments a WHERE a.task_id = t.id AND a.status = 'OVERDUE') as overdue,
        (SELECT COUNT(*) FROM assignments a WHERE a.task_id = t.id AND a.status = 'IN_PROGRESS') as in_progress
        FROM tasks t
        WHERE t.task_type != 'RECURRING_TEMPLATE'
      `;
      const p = [];
      if (status) {
        p.push(status);
        q += ` AND t.status = $${p.length}`;
      }
      if (search) {
        p.push(`%${search}%`);
        q += ` AND t.title ILIKE $${p.length}`;
      }
      q += ' ORDER BY t.created_at DESC';
      const result = await db.query(q, p);
      tasks = result.rows.map(t => {
        const total = parseInt(t.total_assigned, 10) || 0;
        const comp = (parseInt(t.submitted_on_time, 10) || 0) + (parseInt(t.submitted_late, 10) || 0);
        return {
          ...t,
          completion_rate: total > 0 ? Math.round((comp / total) * 100) : 0
        };
      });
    }

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks', auth.requirePermission('tasks.create'), async (req, res) => {
  try {
    const {
      task_type = 'ONE_TIME',
      title,
      description,
      campus_ids = [],
      questions = [],
      audience_rules = {},
      recipient_exclusions = [],
      deadline_at,
      publish_now = false,
      recurrence_config = null
    } = req.body;

    if (!title || campus_ids.length === 0) {
      return res.status(400).json({ error: 'Title and at least one campus are required' });
    }

    auth.assertCampusAccess(req.user, campus_ids);

    const taskId = uuidv4();
    const now = new Date();
    const deadline = deadline_at ? new Date(deadline_at) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    let nextGen = null;
    if (task_type === 'RECURRING_TEMPLATE' && recurrence_config) {
      nextGen = services.calculateNextOccurrence(recurrence_config, now);
    }

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      store.tasks.push({
        id: taskId,
        task_type,
        parent_template_id: null,
        title,
        description,
        campus_ids,
        questions,
        audience_rules,
        recipient_exclusions,
        status: 'DRAFT',
        open_at: now,
        deadline_at: deadline,
        published_at: null,
        published_by: null,
        created_by: req.user.id,
        recurrence_config,
        next_generation_at: nextGen,
        recurrence_status: task_type === 'RECURRING_TEMPLATE' ? 'ACTIVE' : null,
        created_at: now,
        updated_at: now
      });
    } else {
      await db.query(`
        INSERT INTO tasks (id, task_type, title, description, campus_ids, questions, audience_rules, recipient_exclusions, status, open_at, deadline_at, created_by, recurrence_config, next_generation_at, recurrence_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, $10, $11, $12, $13, $14)
      `, [taskId, task_type, title, description, JSON.stringify(campus_ids), JSON.stringify(questions), JSON.stringify(audienceRules), JSON.stringify(recipient_exclusions), now, deadline, req.user.id, recurrence_config ? JSON.stringify(recurrence_config) : null, nextGen, task_type === 'RECURRING_TEMPLATE' ? 'ACTIVE' : null]);
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: campus_ids[0] || null,
      action: 'TASK_CREATED',
      entityType: 'TASK',
      entityId: taskId,
      description: `Created task "${title}" (${task_type})`,
      ipAddress: req.ip
    });

    // Handle immediate publication if requested
    if (publish_now && task_type === 'ONE_TIME') {
      const pubResult = await services.publishTask(taskId, req.user.id, req.ip);
      return res.json({ success: true, id: taskId, published: true, recipients: pubResult.recipientCount });
    }

    res.json({ success: true, id: taskId, published: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/:id/publish', auth.requirePermission('tasks.publish'), async (req, res) => {
  try {
    const taskId = req.params.id;
    const pubResult = await services.publishTask(taskId, req.user.id, req.ip);
    res.json(pubResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 7. TEACHER PORTAL & TASK SUBMISSION ROUTES
// ============================================================================

router.get('/teacher/tasks', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    let tasks = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      const asgs = store.assignments.filter(a => a.user_id === userId);
      tasks = asgs.map(a => {
        const t = store.tasks.find(tsk => tsk.id === a.task_id);
        const sub = store.submissions.find(s => s.assignment_id === a.id);
        const isOverdue = !sub && new Date(a.due_at) < now;
        const computedStatus = sub ? (sub.draft_flag ? 'IN_PROGRESS' : (new Date(sub.submitted_at) <= new Date(a.due_at) ? 'SUBMITTED_ON_TIME' : 'SUBMITTED_LATE')) : (isOverdue ? 'OVERDUE' : 'NOT_STARTED');

        return {
          assignment_id: a.id,
          task_id: a.task_id,
          title: t ? t.title : 'Task',
          description: t ? t.description : '',
          assigned_at: a.assigned_at,
          due_at: a.due_at,
          status: computedStatus,
          submitted_at: sub ? sub.submitted_at : null,
          draft_flag: sub ? sub.draft_flag : false,
          answers: sub ? sub.answers : {}
        };
      });
    } else {
      const q = `
        SELECT a.id as assignment_id, a.task_id, t.title, t.description, a.assigned_at, a.due_at, a.status,
        s.submitted_at, s.draft_flag, s.answers
        FROM assignments a
        JOIN tasks t ON a.task_id = t.id
        LEFT JOIN submissions s ON a.id = s.assignment_id
        WHERE a.user_id = $1
        ORDER BY a.due_at ASC
      `;
      const result = await db.query(q, [userId]);
      tasks = result.rows;
    }

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/teacher/tasks/:taskId', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.taskId;

    let task;
    let assignment;
    let submission;

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      task = store.tasks.find(t => t.id === taskId);
      assignment = store.assignments.find(a => a.task_id === taskId && a.user_id === userId);
      if (assignment) {
        submission = store.submissions.find(s => s.assignment_id === assignment.id);
      }
    } else {
      const tRes = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      task = tRes.rows[0];

      const aRes = await db.query('SELECT * FROM assignments WHERE task_id = $1 AND user_id = $2', [taskId, userId]);
      assignment = aRes.rows[0];

      if (assignment) {
        const sRes = await db.query('SELECT * FROM submissions WHERE assignment_id = $1', [assignment.id]);
        submission = sRes.rows[0];
      }
    }

    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!assignment) return res.status(403).json({ error: 'You are not assigned to this task' });

    res.json({
      task,
      assignment,
      submission: submission || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/teacher/tasks/:taskId/submit', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.taskId;
    const { answers = {}, is_draft = false } = req.body;
    const now = new Date();

    let assignment;
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      assignment = store.assignments.find(a => a.task_id === taskId && a.user_id === userId);
      if (!assignment) return res.status(403).json({ error: 'You are not assigned to this task' });

      const dueAt = new Date(assignment.due_at);
      const computedStatus = is_draft ? 'IN_PROGRESS' : (now <= dueAt ? 'SUBMITTED_ON_TIME' : 'SUBMITTED_LATE');

      let sub = store.submissions.find(s => s.assignment_id === assignment.id);
      if (sub) {
        sub.answers = answers;
        sub.draft_flag = Boolean(is_draft);
        sub.submitted_at = is_draft ? null : now;
        sub.updated_at = now;
      } else {
        sub = {
          id: uuidv4(),
          assignment_id: assignment.id,
          answers,
          draft_flag: Boolean(is_draft),
          submitted_at: is_draft ? null : now,
          created_at: now,
          updated_at: now
        };
        store.submissions.push(sub);
      }
      assignment.status = computedStatus;
      assignment.updated_at = now;
    } else {
      const aRes = await db.query('SELECT * FROM assignments WHERE task_id = $1 AND user_id = $2', [taskId, userId]);
      assignment = aRes.rows[0];
      if (!assignment) return res.status(403).json({ error: 'You are not assigned to this task' });

      const dueAt = new Date(assignment.due_at);
      const computedStatus = is_draft ? 'IN_PROGRESS' : (now <= dueAt ? 'SUBMITTED_ON_TIME' : 'SUBMITTED_LATE');

      await db.transaction(async (client) => {
        await client.query(`
          INSERT INTO submissions (id, assignment_id, answers, draft_flag, submitted_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (assignment_id)
          DO UPDATE SET answers = $3, draft_flag = $4, submitted_at = $5, updated_at = $6
        `, [uuidv4(), assignment.id, JSON.stringify(answers), Boolean(is_draft), is_draft ? null : now, now]);

        await client.query('UPDATE assignments SET status = $1, updated_at = $2 WHERE id = $3', [computedStatus, now, assignment.id]);
      });
    }

    res.json({
      success: true,
      status: is_draft ? 'IN_PROGRESS' : (now <= new Date(assignment.due_at) ? 'SUBMITTED_ON_TIME' : 'SUBMITTED_LATE'),
      message: is_draft ? 'Draft saved successfully' : 'Task response submitted successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher Personal Performance Summary
router.get('/teacher/performance', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    let assignments = [];

    if (db.isMemoryFallback()) {
      assignments = db.getMemoryStore().assignments.filter(a => a.user_id === userId);
    } else {
      const result = await db.query('SELECT * FROM assignments WHERE user_id = $1', [userId]);
      assignments = result.rows;
    }

    const total = assignments.length;
    const onTime = assignments.filter(a => a.status === 'SUBMITTED_ON_TIME').length;
    const late = assignments.filter(a => a.status === 'SUBMITTED_LATE').length;
    const overdue = assignments.filter(a => a.status === 'OVERDUE').length;
    const pending = assignments.filter(a => a.status === 'NOT_STARTED' || a.status === 'IN_PROGRESS').length;

    const completed = onTime + late;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const onTimeRate = total > 0 ? Math.round((onTime / total) * 100) : 0;

    res.json({
      total_assigned: total,
      submitted_on_time: onTime,
      submitted_late: late,
      pending,
      overdue,
      completed,
      completion_rate: completionRate,
      on_time_rate: onTimeRate
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 8. REPORTS & REMINDERS ROUTES
// ============================================================================

router.get('/reports/task-wise', auth.requirePermission('reports.task_wise.view'), async (req, res) => {
  try {
    const { task_id, campus_id, status, search } = req.query;
    if (!task_id) return res.status(400).json({ error: 'task_id is required' });

    let task;
    let rows = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      task = store.tasks.find(t => t.id === task_id);
      if (!task) return res.status(404).json({ error: 'Task not found' });

      rows = store.assignments.filter(a => a.task_id === task_id).map(a => {
        const u = store.users.find(usr => usr.id === a.user_id);
        const sub = store.submissions.find(s => s.assignment_id === a.id);
        const c = store.campuses.find(cmp => cmp.id === a.campus_id);
        return {
          assignment_id: a.id,
          user_id: a.user_id,
          display_name: u ? u.display_name : 'Unknown',
          email: u ? u.email : 'Unknown',
          employee_code: u ? u.employee_code : 'N/A',
          campus_id: a.campus_id,
          campus_name: c ? c.name : 'Unknown',
          assigned_at: a.assigned_at,
          due_at: a.due_at,
          submitted_at: sub ? sub.submitted_at : null,
          status: a.status,
          answers: sub ? sub.answers : {}
        };
      });

      if (!req.user.isSuperAdmin) {
        rows = rows.filter(r => req.user.authorizedCampusIds.includes(r.campus_id));
      }
      if (campus_id) rows = rows.filter(r => r.campus_id === campus_id);
      if (status) rows = rows.filter(r => r.status === status);
      if (search) rows = rows.filter(r => r.display_name.toLowerCase().includes(search.toLowerCase()));
    } else {
      const tRes = await db.query('SELECT * FROM tasks WHERE id = $1', [task_id]);
      task = tRes.rows[0];
      if (!task) return res.status(404).json({ error: 'Task not found' });

      let q = `
        SELECT a.id as assignment_id, a.user_id, u.display_name, u.email, u.employee_code,
        a.campus_id, c.name as campus_name, a.assigned_at, a.due_at, a.status,
        s.submitted_at, s.answers
        FROM assignments a
        JOIN users u ON a.user_id = u.id
        JOIN campuses c ON a.campus_id = c.id
        LEFT JOIN submissions s ON a.id = s.assignment_id
        WHERE a.task_id = $1
      `;
      const p = [task_id];

      if (!req.user.isSuperAdmin) {
        p.push(req.user.authorizedCampusIds || []);
        q += ` AND a.campus_id = ANY($${p.length})`;
      }
      if (campus_id) {
        p.push(campus_id);
        q += ` AND a.campus_id = $${p.length}`;
      }
      if (status) {
        p.push(status);
        q += ` AND a.status = $${p.length}`;
      }
      if (search) {
        p.push(`%${search}%`);
        q += ` AND (u.display_name ILIKE $${p.length} OR u.email ILIKE $${p.length})`;
      }

      q += ' ORDER BY u.display_name ASC';
      const result = await db.query(q, p);
      rows = result.rows;
    }

    const total = rows.length;
    const onTime = rows.filter(r => r.status === 'SUBMITTED_ON_TIME').length;
    const late = rows.filter(r => r.status === 'SUBMITTED_LATE').length;
    const overdue = rows.filter(r => r.status === 'OVERDUE').length;
    const pending = rows.filter(r => r.status === 'NOT_STARTED' || r.status === 'IN_PROGRESS').length;

    res.json({
      task,
      stats: {
        total,
        on_time: onTime,
        late,
        pending,
        overdue,
        completion_rate: total > 0 ? Math.round(((onTime + late) / total) * 100) : 0
      },
      rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/teacher-wise', auth.requirePermission('reports.teacher_wise.view'), async (req, res) => {
  try {
    const { teacher_id } = req.query;
    if (!teacher_id) return res.status(400).json({ error: 'teacher_id is required' });

    let teacher;
    let assignments = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      teacher = store.users.find(u => u.id === teacher_id);
      if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

      assignments = store.assignments.filter(a => a.user_id === teacher_id).map(a => {
        const t = store.tasks.find(tsk => tsk.id === a.task_id);
        const c = store.campuses.find(cmp => cmp.id === a.campus_id);
        const s = store.submissions.find(sub => sub.assignment_id === a.id);
        return {
          assignment_id: a.id,
          task_title: t ? t.title : 'Task',
          campus_name: c ? c.name : 'Unknown',
          assigned_at: a.assigned_at,
          due_at: a.due_at,
          submitted_at: s ? s.submitted_at : null,
          status: a.status
        };
      });
    } else {
      const uRes = await db.query('SELECT * FROM users WHERE id = $1', [teacher_id]);
      teacher = uRes.rows[0];
      if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

      const q = `
        SELECT a.id as assignment_id, t.title as task_title, c.name as campus_name, a.assigned_at, a.due_at, a.status, s.submitted_at
        FROM assignments a
        JOIN tasks t ON a.task_id = t.id
        JOIN campuses c ON a.campus_id = c.id
        LEFT JOIN submissions s ON a.id = s.assignment_id
        WHERE a.user_id = $1
        ORDER BY a.due_at DESC
      `;
      const result = await db.query(q, [teacher_id]);
      assignments = result.rows;
    }

    const total = assignments.length;
    const onTime = assignments.filter(a => a.status === 'SUBMITTED_ON_TIME').length;
    const late = assignments.filter(a => a.status === 'SUBMITTED_LATE').length;
    const overdue = assignments.filter(a => a.status === 'OVERDUE').length;
    const pending = assignments.filter(a => a.status === 'NOT_STARTED' || a.status === 'IN_PROGRESS').length;

    res.json({
      teacher: auth.sanitizeUser(teacher),
      stats: {
        total,
        on_time: onTime,
        late,
        pending,
        overdue,
        completion_rate: total > 0 ? Math.round(((onTime + late) / total) * 100) : 0,
        on_time_rate: total > 0 ? Math.round((onTime / total) * 100) : 0
      },
      assignments
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/:id/send-reminders', auth.requirePermission('tasks.send_reminder'), async (req, res) => {
  try {
    const taskId = req.params.id;
    const { user_ids = [] } = req.body;

    if (user_ids.length === 0) {
      return res.status(400).json({ error: 'No recipients selected for reminder' });
    }

    let task;
    let eligibleAssignments = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      task = store.tasks.find(t => t.id === taskId);
      eligibleAssignments = store.assignments.filter(a => 
        a.task_id === taskId && 
        user_ids.includes(a.user_id) && 
        (a.status === 'NOT_STARTED' || a.status === 'IN_PROGRESS' || a.status === 'OVERDUE')
      );
    } else {
      const tRes = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      task = tRes.rows[0];

      const aRes = await db.query(`
        SELECT a.*, u.display_name, u.email
        FROM assignments a
        JOIN users u ON a.user_id = u.id
        WHERE a.task_id = $1 AND a.user_id = ANY($2) AND a.status IN ('NOT_STARTED', 'IN_PROGRESS', 'OVERDUE')
      `, [taskId, user_ids]);
      eligibleAssignments = aRes.rows;
    }

    if (!task) return res.status(404).json({ error: 'Task not found' });

    let sentCount = 0;
    for (const asg of eligibleAssignments) {
      let recipientUser;
      if (db.isMemoryFallback()) {
        recipientUser = db.getMemoryStore().users.find(u => u.id === asg.user_id);
      } else {
        recipientUser = asg;
      }
      if (recipientUser) {
        await services.sendTaskReminderEmail(recipientUser, task, asg.due_at);
        sentCount++;
      }
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: task.campus_ids[0] || null,
      action: 'REMINDER_SENT',
      entityType: 'TASK',
      entityId: taskId,
      description: `Sent submission reminders to ${sentCount} teachers for task "${task.title}".`,
      metadata: { sentCount },
      ipAddress: req.ip
    });

    res.json({ success: true, sent_count: sentCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/export', auth.requirePermission('reports.task_wise.export'), async (req, res) => {
  try {
    const { task_id } = req.query;
    if (!task_id) return res.status(400).json({ error: 'task_id is required' });

    let task;
    let data = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      task = store.tasks.find(t => t.id === task_id);
      if (!task) return res.status(404).json({ error: 'Task not found' });

      data = store.assignments.filter(a => a.task_id === task_id).map(a => {
        const u = store.users.find(usr => usr.id === a.user_id);
        const sub = store.submissions.find(s => s.assignment_id === a.id);
        const c = store.campuses.find(cmp => cmp.id === a.campus_id);
        return {
          display_name: u ? u.display_name : 'Unknown',
          employee_code: u ? u.employee_code : '',
          campus_name: c ? c.name : 'Unknown',
          department_names: 'Department',
          designation_name: 'Teacher',
          subject_names: 'Subjects',
          category_names: 'Categories',
          assigned_at: a.assigned_at,
          due_at: a.due_at,
          submitted_at: sub ? sub.submitted_at : null,
          status: a.status,
          answers: sub ? sub.answers : {}
        };
      });
    } else {
      const tRes = await db.query('SELECT * FROM tasks WHERE id = $1', [task_id]);
      task = tRes.rows[0];
      if (!task) return res.status(404).json({ error: 'Task not found' });

      const q = `
        SELECT a.id, u.display_name, u.employee_code, c.name as campus_name, a.assigned_at, a.due_at, a.status,
        s.submitted_at, s.answers
        FROM assignments a
        JOIN users u ON a.user_id = u.id
        JOIN campuses c ON a.campus_id = c.id
        LEFT JOIN submissions s ON a.id = s.assignment_id
        WHERE a.task_id = $1
        ORDER BY u.display_name ASC
      `;
      const result = await db.query(q, [task_id]);
      data = result.rows;
    }

    const buffer = services.generateTaskResponseWorkbook(task, data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="task_responses_${task.id}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 9. IMPORT & EXPORT CENTRE ROUTES
// ============================================================================

router.get('/import/template', auth.requirePermission('imports.execute'), async (req, res) => {
  try {
    const { mode = 'NEW', dataset = 'users' } = req.query;
    const buffer = await services.generateImportTemplate(mode, dataset, req.user);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="template_${dataset}_${mode.toLowerCase()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import/preview', auth.requirePermission('imports.execute'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload an Excel or CSV file' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);

    const preview = {
      total_rows: rawRows.length,
      new_rows: 0,
      update_rows: 0,
      errors: [],
      warnings: [],
      sample_records: rawRows.slice(0, 5)
    };

    rawRows.forEach((row, i) => {
      const email = row['Email'] || row['Email (Key)'];
      if (!email) {
        preview.errors.push(`Row ${i + 1}: Missing mandatory field 'Email'`);
      } else {
        preview.new_rows++;
      }
    });

    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 10. ROLES & AUDIT LOGS ROUTES
// ============================================================================

router.get('/roles', auth.requireSuperAdmin, async (req, res) => {
  try {
    let roles = [];
    if (db.isMemoryFallback()) {
      roles = db.getMemoryStore().roles;
    } else {
      const result = await db.query('SELECT * FROM roles ORDER BY name ASC');
      roles = result.rows;
    }
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/audit-logs', auth.requirePermission('audit.view'), async (req, res) => {
  try {
    const { campus_id, action, search } = req.query;
    let logs = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      logs = store.audit_logs.map(l => {
        const u = store.users.find(usr => usr.id === l.user_id);
        const c = store.campuses.find(cmp => cmp.id === l.campus_id);
        return {
          ...l,
          user_display_name: u ? u.display_name : 'System',
          user_email: u ? u.email : '',
          campus_name: c ? c.name : 'Global'
        };
      });

      if (!req.user.isSuperAdmin) {
        logs = logs.filter(l => !l.campus_id || req.user.authorizedCampusIds.includes(l.campus_id));
      }
      if (campus_id) logs = logs.filter(l => l.campus_id === campus_id);
      if (action) logs = logs.filter(l => l.action === action);
      if (search) logs = logs.filter(l => l.description.toLowerCase().includes(search.toLowerCase()));
    } else {
      let q = `
        SELECT al.*, u.display_name as user_display_name, u.email as user_email, c.name as campus_name
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        LEFT JOIN campuses c ON al.campus_id = c.id
        WHERE 1=1
      `;
      const p = [];

      if (!req.user.isSuperAdmin) {
        p.push(req.user.authorizedCampusIds || []);
        q += ` AND (al.campus_id IS NULL OR al.campus_id = ANY($${p.length}))`;
      }
      if (campus_id) {
        p.push(campus_id);
        q += ` AND al.campus_id = $${p.length}`;
      }
      if (action) {
        p.push(action);
        q += ` AND al.action = $${p.length}`;
      }
      if (search) {
        p.push(`%${search}%`);
        q += ` AND al.description ILIKE $${p.length}`;
      }

      q += ' ORDER BY al.created_at DESC LIMIT 100';
      const result = await db.query(q, p);
      logs = result.rows;
    }

    logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
