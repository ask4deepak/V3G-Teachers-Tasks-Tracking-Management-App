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

router.put('/profile/password', auth.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }
    if (confirm_password && new_password !== confirm_password) {
      return res.status(400).json({ error: 'New passwords do not match' });
    }

    let user;
    if (db.isMemoryFallback()) {
      user = db.getMemoryStore().users.find(u => u.id === userId);
    } else {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
      user = result.rows[0];
    }

    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(new_password, 10);

    if (db.isMemoryFallback()) {
      user.password_hash = newHash;
      user.updated_at = new Date();
    } else {
      await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, userId]);
    }

    await services.logAudit({
      userId,
      campusId: req.user.authorizedCampusIds ? req.user.authorizedCampusIds[0] : null,
      action: 'PASSWORD_RESET',
      entityType: 'USER',
      entityId: userId,
      description: `User ${user.display_name} (${user.email}) successfully reset their password.`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 3. CAMPUSES & MASTER DATA ROUTES
// ============================================================================

router.get('/campuses', auth.requireAuth, async (req, res) => {
  try {
    const { include_inactive } = req.query;
    let campuses = [];
    if (db.isMemoryFallback()) {
      campuses = db.getMemoryStore().campuses;
      if (!include_inactive) {
        campuses = campuses.filter(c => c.status === 'ACTIVE');
      }
    } else {
      if (req.user.isSuperAdmin) {
        const q = include_inactive
          ? 'SELECT * FROM campuses ORDER BY name ASC'
          : 'SELECT * FROM campuses WHERE status = $1 ORDER BY name ASC';
        const p = include_inactive ? [] : ['ACTIVE'];
        const result = await db.query(q, p);
        campuses = result.rows;
      } else {
        const q = include_inactive
          ? 'SELECT * FROM campuses WHERE id = ANY($1) ORDER BY name ASC'
          : 'SELECT * FROM campuses WHERE id = ANY($1) AND status = $2 ORDER BY name ASC';
        const p = include_inactive ? [req.user.authorizedCampusIds || []] : [req.user.authorizedCampusIds || [], 'ACTIVE'];
        const result = await db.query(q, p);
        campuses = result.rows;
      }
    }

    if (!req.user.isSuperAdmin && req.user.authorizedCampusIds) {
      campuses = campuses.filter(c => req.user.authorizedCampusIds.includes(c.id));
    }

    res.json(campuses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campuses', auth.requireSuperAdmin, async (req, res) => {
  try {
    const { name, code, status = 'ACTIVE' } = req.body;
    if (!name) return res.status(400).json({ error: 'Campus name is required' });

    const cleanCode = (code || name).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').substring(0, 50);
    const id = uuidv4();
    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      if (store.campuses.some(c => c.code === cleanCode)) {
        return res.status(400).json({ error: `A campus with code "${cleanCode}" already exists.` });
      }
      store.campuses.push({
        id,
        name: name.trim(),
        code: cleanCode,
        status: status || 'ACTIVE',
        created_at: now,
        updated_at: now
      });
    } else {
      const existing = await db.query('SELECT id FROM campuses WHERE code = $1', [cleanCode]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: `A campus with code "${cleanCode}" already exists.` });
      }
      await db.query(`
        INSERT INTO campuses (id, name, code, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, NOW(), NOW())
      `, [id, name.trim(), cleanCode, status || 'ACTIVE']);
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: id,
      action: 'CAMPUS_CREATED',
      entityType: 'CAMPUS',
      entityId: id,
      description: `Created campus "${name}" with code "${cleanCode}".`,
      ipAddress: req.ip
    });

    res.json({ success: true, id, name: name.trim(), code: cleanCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/campuses/:id', auth.requireSuperAdmin, async (req, res) => {
  try {
    const campusId = req.params.id;
    const { name, code, status = 'ACTIVE' } = req.body;
    if (!name) return res.status(400).json({ error: 'Campus name is required' });

    const cleanCode = (code || name).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').substring(0, 50);
    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      const campus = store.campuses.find(c => c.id === campusId);
      if (!campus) return res.status(404).json({ error: 'Campus not found' });
      if (store.campuses.some(c => c.code === cleanCode && c.id !== campusId)) {
        return res.status(400).json({ error: `Another campus already uses code "${cleanCode}".` });
      }
      campus.name = name.trim();
      campus.code = cleanCode;
      campus.status = status;
      campus.updated_at = now;
    } else {
      const existing = await db.query('SELECT id FROM campuses WHERE code = $1 AND id != $2', [cleanCode, campusId]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: `Another campus already uses code "${cleanCode}".` });
      }
      await db.query(`
        UPDATE campuses
        SET name = $1, code = $2, status = $3, updated_at = NOW()
        WHERE id = $4
      `, [name.trim(), cleanCode, status, campusId]);
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: campusId,
      action: 'CAMPUS_UPDATED',
      entityType: 'CAMPUS',
      entityId: campusId,
      description: `Updated campus "${name}" (code: ${cleanCode}, status: ${status}).`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Campus updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campuses/bulk', auth.requireSuperAdmin, async (req, res) => {
  try {
    let { items = [], text = '' } = req.body;

    // Parse multi-line text input if provided
    if (text && typeof text === 'string') {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const parts = line.split(/[,;\t|]/).map(p => p.trim());
        const name = parts[0];
        const code = parts[1] || name;
        const status = parts[2] ? parts[2].toUpperCase() : 'ACTIVE';
        if (name) {
          items.push({ name, code, status });
        }
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one campus to add.' });
    }

    const createdCampuses = [];
    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      for (const item of items) {
        const name = (item.name || '').trim();
        if (!name) continue;
        let cleanCode = (item.code || name).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').substring(0, 50);
        
        // Ensure unique code
        let suffix = 1;
        const originalCode = cleanCode;
        while (store.campuses.some(c => c.code === cleanCode)) {
          cleanCode = `${originalCode}_${suffix++}`;
        }

        const id = uuidv4();
        const campusObj = {
          id,
          name,
          code: cleanCode,
          status: item.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
          created_at: now,
          updated_at: now
        };
        store.campuses.push(campusObj);
        createdCampuses.push(campusObj);
      }
    } else {
      await db.transaction(async (client) => {
        for (const item of items) {
          const name = (item.name || '').trim();
          if (!name) continue;
          let cleanCode = (item.code || name).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').substring(0, 50);
          
          // Ensure unique code
          let suffix = 1;
          const originalCode = cleanCode;
          while (true) {
            const check = await client.query('SELECT id FROM campuses WHERE code = $1', [cleanCode]);
            if (check.rows.length === 0) break;
            cleanCode = `${originalCode}_${suffix++}`;
          }

          const id = uuidv4();
          const status = item.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
          await client.query(`
            INSERT INTO campuses (id, name, code, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
          `, [id, name, cleanCode, status]);

          createdCampuses.push({ id, name, code: cleanCode, status });
        }
      });
    }

    await services.logAudit({
      userId: req.user.id,
      action: 'CAMPUS_CREATED',
      entityType: 'CAMPUS',
      entityId: req.user.id,
      description: `Bulk added ${createdCampuses.length} campuses.`,
      ipAddress: req.ip
    });

    res.json({ success: true, count: createdCampuses.length, campuses: createdCampuses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/masters/bulk', auth.requirePermission('masters.create'), async (req, res) => {
  try {
    const { master_type, campus_id, items = [], text = '' } = req.body;
    if (!master_type) return res.status(400).json({ error: 'Master type is required' });

    if (campus_id) auth.assertCampusAccess(req.user, campus_id);

    const parsedItems = [...items];
    if (text && typeof text === 'string') {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const parts = line.split(/[,;\t|]/).map(p => p.trim());
        const name = parts[0];
        const code = parts[1] || name;
        if (name) {
          parsedItems.push({ name, code });
        }
      }
    }

    if (parsedItems.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one item to add.' });
    }

    const createdItems = [];
    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      let maxSort = store.master_values
        .filter(m => m.master_type === master_type)
        .reduce((max, cur) => Math.max(max, cur.sort_order || 0), 0);

      for (const item of parsedItems) {
        const name = (item.name || '').trim();
        if (!name) continue;
        maxSort++;
        const code = (item.code || name).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').substring(0, 50);
        const id = uuidv4();
        const obj = {
          id,
          master_type,
          name,
          code,
          campus_id: campus_id || null,
          status: 'ACTIVE',
          sort_order: item.sort_order ? parseInt(item.sort_order, 10) : maxSort,
          created_at: now,
          updated_at: now
        };
        store.master_values.push(obj);
        createdItems.push(obj);
      }
    } else {
      await db.transaction(async (client) => {
        const sortRes = await client.query('SELECT COALESCE(MAX(sort_order), 0) as max_sort FROM master_values WHERE master_type = $1', [master_type]);
        let maxSort = parseInt(sortRes.rows[0].max_sort, 10) || 0;

        for (const item of parsedItems) {
          const name = (item.name || '').trim();
          if (!name) continue;
          maxSort++;
          const code = (item.code || name).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').substring(0, 50);
          const id = uuidv4();
          const sortOrder = item.sort_order ? parseInt(item.sort_order, 10) : maxSort;

          await client.query(`
            INSERT INTO master_values (id, master_type, name, code, campus_id, status, sort_order, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, NOW(), NOW())
          `, [id, master_type, name, code, campus_id || null, sortOrder]);

          createdItems.push({ id, master_type, name, code, sort_order: sortOrder });
        }
      });
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: campus_id || null,
      action: 'MASTER_CREATED',
      entityType: 'MASTER_VALUE',
      entityId: req.user.id,
      description: `Bulk added ${createdItems.length} ${master_type} master items.`,
      ipAddress: req.ip
    });

    res.json({ success: true, count: createdItems.length, items: createdItems });
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

router.put('/masters/:id', auth.requirePermission('masters.edit'), async (req, res) => {
  try {
    const masterId = req.params.id;
    const { name, code, campus_id, sort_order = 0, status = 'ACTIVE' } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    if (campus_id) auth.assertCampusAccess(req.user, campus_id);

    const now = new Date();
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      const mv = store.master_values.find(m => m.id === masterId);
      if (!mv) return res.status(404).json({ error: 'Master value not found' });
      mv.name = name;
      mv.code = code || mv.code;
      mv.campus_id = campus_id || null;
      mv.sort_order = parseInt(sort_order, 10);
      mv.status = status;
      mv.updated_at = now;
    } else {
      await db.query(`
        UPDATE master_values
        SET name = $1, code = $2, campus_id = $3, sort_order = $4, status = $5, updated_at = NOW()
        WHERE id = $6
      `, [name, code, campus_id || null, parseInt(sort_order, 10), status, masterId]);
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: campus_id || null,
      action: 'MASTER_UPDATED',
      entityType: 'MASTER_VALUE',
      entityId: masterId,
      description: `Updated master value "${name}"`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Master value updated successfully' });
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

router.get('/users/:id', auth.requirePermission('users.view'), async (req, res) => {
  try {
    const userId = req.params.id;
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
        SELECT ua.*, mv.master_type, mv.name as master_name
        FROM user_attributes ua
        JOIN master_values mv ON ua.master_value_id = mv.id
        WHERE ua.user_id = $1
      `, [userId]);
      userAttributes = aRes.rows;
    }

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      user: auth.sanitizeUser(user),
      attributes: userAttributes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id', auth.requirePermission('users.edit'), async (req, res) => {
  try {
    const userId = req.params.id;
    const { first_name, last_name, employee_code, phone, status = 'ACTIVE', campus_id, class_teacher_status, department_id, designation_id, subject_ids = [], category_ids = [], password } = req.body;

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'First Name and Last Name are required' });
    }

    if (campus_id) auth.assertCampusAccess(req.user, campus_id);

    const displayName = `${first_name} ${last_name}`.trim();
    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      const user = store.users.find(u => u.id === userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      user.first_name = first_name;
      user.last_name = last_name;
      user.display_name = displayName;
      user.employee_code = employee_code || user.employee_code;
      user.phone = phone || null;
      user.status = status;
      user.class_teacher_status = Boolean(class_teacher_status);
      user.updated_at = now;

      if (password) {
        user.password_hash = await bcrypt.hash(password, 10);
      }

      if (campus_id) {
        store.user_attributes = store.user_attributes.filter(a => a.user_id !== userId);
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
        if (password) {
          const hash = await bcrypt.hash(password, 10);
          await client.query(`
            UPDATE users SET first_name = $1, last_name = $2, display_name = $3, employee_code = $4, phone = $5, status = $6, class_teacher_status = $7, password_hash = $8, updated_at = NOW()
            WHERE id = $9
          `, [first_name, last_name, displayName, employee_code || null, phone || null, status, Boolean(class_teacher_status), hash, userId]);
        } else {
          await client.query(`
            UPDATE users SET first_name = $1, last_name = $2, display_name = $3, employee_code = $4, phone = $5, status = $6, class_teacher_status = $7, updated_at = NOW()
            WHERE id = $8
          `, [first_name, last_name, displayName, employee_code || null, phone || null, status, Boolean(class_teacher_status), userId]);
        }

        if (campus_id) {
          await client.query('DELETE FROM user_attributes WHERE user_id = $1', [userId]);
          const allMasterIds = [department_id, designation_id, ...subject_ids, ...category_ids].filter(Boolean);
          for (const mid of allMasterIds) {
            await client.query(`
              INSERT INTO user_attributes (id, user_id, campus_id, master_value_id, created_by)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (user_id, campus_id, master_value_id) DO NOTHING
            `, [uuidv4(), userId, campus_id, mid, req.user.id]);
          }
        }
      });
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: campus_id || null,
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: userId,
      description: `Updated faculty user details for ${displayName}`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'User updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users/:id/access', auth.requireSuperAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    let accessList = [];
    let user;

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      user = store.users.find(u => u.id === userId);
      accessList = store.user_access.filter(a => a.user_id === userId).map(a => {
        const role = store.roles.find(r => r.id === a.role_id);
        const campus = store.campuses.find(c => c.id === a.campus_id);
        return {
          ...a,
          role_name: role ? role.name : 'Unknown',
          campus_name: campus ? campus.name : 'All Campuses (Global)'
        };
      });
    } else {
      const uRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
      user = uRes.rows[0];

      const q = `
        SELECT ua.*, r.name as role_name, c.name as campus_name
        FROM user_access ua
        JOIN roles r ON ua.role_id = r.id
        LEFT JOIN campuses c ON ua.campus_id = c.id
        WHERE ua.user_id = $1
      `;
      const result = await db.query(q, [userId]);
      accessList = result.rows;
    }

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      user: auth.sanitizeUser(user),
      access: accessList
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id/access', auth.requireSuperAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { user_type, assignments = [] } = req.body; // assignments: [{ role_id, campus_id, permission_overrides }]
    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      const user = store.users.find(u => u.id === userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user_type) {
        user.user_type = user_type;
        user.updated_at = now;
      }

      // Replace user_access rows
      store.user_access = store.user_access.filter(a => a.user_id !== userId);

      for (const item of assignments) {
        store.user_access.push({
          id: uuidv4(),
          user_id: userId,
          role_id: item.role_id,
          campus_id: item.campus_id || null,
          permission_overrides: item.permission_overrides || null,
          created_at: now,
          updated_at: now
        });
      }
    } else {
      await db.transaction(async (client) => {
        if (user_type) {
          await client.query('UPDATE users SET user_type = $1, updated_at = NOW() WHERE id = $2', [user_type, userId]);
        }

        await client.query('DELETE FROM user_access WHERE user_id = $1', [userId]);

        for (const item of assignments) {
          await client.query(`
            INSERT INTO user_access (id, user_id, role_id, campus_id, permission_overrides)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, role_id, campus_id) DO NOTHING
          `, [uuidv4(), userId, item.role_id, item.campus_id || null, item.permission_overrides ? JSON.stringify(item.permission_overrides) : null]);
        }
      });
    }

    await services.logAudit({
      userId: req.user.id,
      action: 'PERMISSION_CHANGED',
      entityType: 'USER_ACCESS',
      entityId: userId,
      description: `Updated roles, user type (${user_type}), and campus authorizations for user ID ${userId}.`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'User roles and campus authorizations updated successfully' });
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

router.put('/groups/:id', auth.requirePermission('groups.edit'), async (req, res) => {
  try {
    const groupId = req.params.id;
    const { name, description, campus_id, allow_join_requests = true, status = 'ACTIVE' } = req.body;
    if (!name || !campus_id) return res.status(400).json({ error: 'Group name and campus are required' });

    auth.assertCampusAccess(req.user, campus_id);
    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      const group = store.groups.find(g => g.id === groupId);
      if (!group) return res.status(404).json({ error: 'Group not found' });
      group.name = name;
      group.description = description;
      group.campus_id = campus_id;
      group.allow_join_requests = Boolean(allow_join_requests);
      group.status = status;
      group.updated_at = now;
    } else {
      await db.query(`
        UPDATE groups
        SET name = $1, description = $2, campus_id = $3, allow_join_requests = $4, status = $5, updated_at = NOW()
        WHERE id = $6
      `, [name, description, campus_id, Boolean(allow_join_requests), status, groupId]);
    }

    await services.logAudit({
      userId: req.user.id,
      campusId,
      action: 'GROUP_UPDATED',
      entityType: 'GROUP',
      entityId: groupId,
      description: `Updated group "${name}".`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Group updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/groups/:id/members', auth.requireAuth, async (req, res) => {
  try {
    const groupId = req.params.id;
    let group;
    let campusTeachers = [];
    let memberships = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      group = store.groups.find(g => g.id === groupId);
      if (!group) return res.status(404).json({ error: 'Group not found' });

      memberships = store.group_memberships.filter(m => m.group_id === groupId);
      const teacherIdsInCampus = store.user_attributes.filter(a => a.campus_id === group.campus_id).map(a => a.user_id);
      campusTeachers = store.users.filter(u => u.status === 'ACTIVE' && (teacherIdsInCampus.includes(u.id) || (u.campus_id === group.campus_id)));
    } else {
      const gRes = await db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
      group = gRes.rows[0];
      if (!group) return res.status(404).json({ error: 'Group not found' });

      const mRes = await db.query('SELECT * FROM group_memberships WHERE group_id = $1', [groupId]);
      memberships = mRes.rows;

      const tRes = await db.query(`
        SELECT DISTINCT u.id, u.display_name, u.email, u.employee_code
        FROM users u
        JOIN user_attributes ua ON u.id = ua.user_id
        WHERE u.status = 'ACTIVE' AND ua.campus_id = $1
        ORDER BY u.display_name ASC
      `, [group.campus_id]);
      campusTeachers = tRes.rows;
    }

    const membershipMap = new Map();
    memberships.forEach(m => membershipMap.set(m.user_id, m));

    const result = campusTeachers.map(t => {
      const m = membershipMap.get(t.id);
      return {
        id: t.id,
        display_name: t.display_name,
        email: t.email,
        employee_code: t.employee_code,
        status: m ? m.status : 'NOT_MEMBER',
        membership_role: m ? m.membership_role : 'MEMBER',
        is_member: m ? m.status === 'APPROVED' : false
      };
    });

    result.sort((a, b) => a.display_name.localeCompare(b.display_name));
    res.json({ group, teachers: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/groups/:id/members', auth.requirePermission('groups.manage_members'), async (req, res) => {
  try {
    const groupId = req.params.id;
    const { members = [] } = req.body; // members: [{ user_id, membership_role: 'MEMBER'|'GROUP_ADMIN' }]
    const now = new Date();

    let group;
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      group = store.groups.find(g => g.id === groupId);
      if (!group) return res.status(404).json({ error: 'Group not found' });

      // Keep only memberships that are in the new members list or maintain pending requests not touched
      store.group_memberships = store.group_memberships.filter(m => m.group_id !== groupId || m.status === 'PENDING');

      for (const m of members) {
        store.group_memberships.push({
          id: uuidv4(),
          group_id: groupId,
          user_id: m.user_id,
          membership_role: m.membership_role || 'MEMBER',
          status: 'APPROVED',
          requested_at: now,
          requested_by: req.user.id,
          reviewed_at: now,
          reviewed_by: req.user.id,
          review_notes: 'Manager Assignment',
          created_at: now,
          updated_at: now
        });
      }
    } else {
      const gRes = await db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
      group = gRes.rows[0];
      if (!group) return res.status(404).json({ error: 'Group not found' });

      await db.transaction(async (client) => {
        await client.query(`DELETE FROM group_memberships WHERE group_id = $1 AND status != 'PENDING'`, [groupId]);

        for (const m of members) {
          await client.query(`
            INSERT INTO group_memberships (id, group_id, user_id, membership_role, status, requested_at, requested_by, reviewed_at, reviewed_by, review_notes)
            VALUES ($1, $2, $3, $4, 'APPROVED', NOW(), $5, NOW(), $5, 'Manager Assignment')
            ON CONFLICT (group_id, user_id)
            DO UPDATE SET membership_role = $4, status = 'APPROVED', reviewed_at = NOW(), reviewed_by = $5
          `, [uuidv4(), groupId, m.user_id, m.membership_role || 'MEMBER', req.user.id]);
        }
      });
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: group.campus_id,
      action: 'GROUP_UPDATED',
      entityType: 'GROUP',
      entityId: groupId,
      description: `Updated member roster for group "${group.name}" (${members.length} members).`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Group membership roster updated successfully' });
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
    const now = new Date();
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
        const isOpenFuture = t.open_at && new Date(t.open_at) > now;
        const displayStatus = (t.status === 'ACTIVE' || t.status === 'PUBLISHED') && isOpenFuture ? 'SCHEDULED' : t.status;

        return {
          ...t,
          status: displayStatus,
          raw_status: t.status,
          is_scheduled: isOpenFuture,
          sort_order: t.sort_order || 0,
          allow_late_submissions: t.allow_late_submissions !== false,
          allow_edit_submission: t.allow_edit_submission === true,
          total_assigned: total,
          submitted_on_time: subOnTime,
          submitted_late: subLate,
          in_progress: inProgress,
          overdue: overdue,
          completion_rate: total > 0 ? Math.round(((subOnTime + subLate) / total) * 100) : 0
        };
      });

      if (status) tasks = tasks.filter(t => t.status === status || t.raw_status === status);
      if (search) tasks = tasks.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
      tasks.sort((a, b) => (a.sort_order - b.sort_order) || (new Date(b.created_at) - new Date(a.created_at)));
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
      q += ' ORDER BY t.sort_order ASC, t.created_at DESC';
      const result = await db.query(q, p);
      tasks = result.rows.map(t => {
        const total = parseInt(t.total_assigned, 10) || 0;
        const comp = (parseInt(t.submitted_on_time, 10) || 0) + (parseInt(t.submitted_late, 10) || 0);
        const isOpenFuture = t.open_at && new Date(t.open_at) > now;
        const displayStatus = (t.status === 'ACTIVE' || t.status === 'PUBLISHED') && isOpenFuture ? 'SCHEDULED' : t.status;
        return {
          ...t,
          status: displayStatus,
          raw_status: t.status,
          is_scheduled: isOpenFuture,
          sort_order: t.sort_order || 0,
          allow_late_submissions: t.allow_late_submissions !== false,
          allow_edit_submission: t.allow_edit_submission === true,
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
      open_at,
      deadline_at,
      allow_late_submissions = true,
      allow_edit_submission = false,
      sort_order = 0,
      publish_now = false,
      recurrence_config = null
    } = req.body;

    if (!title || campus_ids.length === 0) {
      return res.status(400).json({ error: 'Title and at least one campus are required' });
    }

    auth.assertCampusAccess(req.user, campus_ids);

    const taskId = uuidv4();
    const now = new Date();
    const openDate = open_at ? new Date(open_at) : now;
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
        open_at: openDate,
        deadline_at: deadline,
        allow_late_submissions: Boolean(allow_late_submissions),
        allow_edit_submission: Boolean(allow_edit_submission),
        sort_order: Number(sort_order) || 0,
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
        INSERT INTO tasks (id, task_type, title, description, campus_ids, questions, audience_rules, recipient_exclusions, status, open_at, deadline_at, allow_late_submissions, allow_edit_submission, sort_order, created_by, recurrence_config, next_generation_at, recurrence_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [taskId, task_type, title, description, JSON.stringify(campus_ids), JSON.stringify(questions), JSON.stringify(audience_rules), JSON.stringify(recipient_exclusions), openDate, deadline, Boolean(allow_late_submissions), Boolean(allow_edit_submission), Number(sort_order) || 0, req.user.id, recurrence_config ? JSON.stringify(recurrence_config) : null, nextGen, task_type === 'RECURRING_TEMPLATE' ? 'ACTIVE' : null]);
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

router.put('/tasks/:id', auth.requirePermission('tasks.create'), async (req, res) => {
  try {
    const taskId = req.params.id;
    const {
      title,
      description,
      campus_ids,
      questions,
      audience_rules,
      recipient_exclusions,
      open_at,
      deadline_at,
      allow_late_submissions,
      allow_edit_submission,
      status,
      sort_order
    } = req.body;

    let task;
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      task = store.tasks.find(t => t.id === taskId);
    } else {
      const result = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      task = result.rows[0];
    }

    if (!task) return res.status(404).json({ error: 'Task not found' });

    const currentCampuses = typeof task.campus_ids === 'string' ? JSON.parse(task.campus_ids) : task.campus_ids;
    auth.assertCampusAccess(req.user, campus_ids || currentCampuses);

    const now = new Date();
    const updatedCampusIds = campus_ids !== undefined ? campus_ids : currentCampuses;
    const updatedQuestions = questions !== undefined ? questions : (typeof task.questions === 'string' ? JSON.parse(task.questions) : task.questions);
    const updatedAudienceRules = audience_rules !== undefined ? audience_rules : (typeof task.audience_rules === 'string' ? JSON.parse(task.audience_rules) : task.audience_rules);
    const updatedExclusions = recipient_exclusions !== undefined ? recipient_exclusions : (typeof task.recipient_exclusions === 'string' ? JSON.parse(task.recipient_exclusions) : task.recipient_exclusions);
    const updatedOpenAt = open_at ? new Date(open_at) : task.open_at;
    const updatedDeadlineAt = deadline_at ? new Date(deadline_at) : task.deadline_at;
    const updatedAllowLate = allow_late_submissions !== undefined ? Boolean(allow_late_submissions) : (task.allow_late_submissions !== false);
    const updatedAllowEdit = allow_edit_submission !== undefined ? Boolean(allow_edit_submission) : (task.allow_edit_submission === true);
    const updatedSortOrder = sort_order !== undefined ? Number(sort_order) : (task.sort_order || 0);
    const updatedStatus = status || task.status;

    if (db.isMemoryFallback()) {
      task.title = title || task.title;
      task.description = description !== undefined ? description : task.description;
      task.campus_ids = updatedCampusIds;
      task.questions = updatedQuestions;
      task.audience_rules = updatedAudienceRules;
      task.recipient_exclusions = updatedExclusions;
      task.open_at = updatedOpenAt;
      task.deadline_at = updatedDeadlineAt;
      task.allow_late_submissions = updatedAllowLate;
      task.allow_edit_submission = updatedAllowEdit;
      task.sort_order = updatedSortOrder;
      task.status = updatedStatus;
      task.updated_at = now;
    } else {
      await db.query(`
        UPDATE tasks
        SET title = COALESCE($1, title),
            description = COALESCE($2, description),
            campus_ids = $3,
            questions = $4,
            audience_rules = $5,
            recipient_exclusions = $6,
            open_at = $7,
            deadline_at = $8,
            allow_late_submissions = $9,
            allow_edit_submission = $10,
            sort_order = $11,
            status = $12,
            updated_at = NOW()
        WHERE id = $13
      `, [
        title || null,
        description !== undefined ? description : null,
        JSON.stringify(updatedCampusIds),
        JSON.stringify(updatedQuestions),
        JSON.stringify(updatedAudienceRules),
        JSON.stringify(updatedExclusions),
        updatedOpenAt,
        updatedDeadlineAt,
        updatedAllowLate,
        updatedAllowEdit,
        updatedSortOrder,
        updatedStatus,
        taskId
      ]);
    }

    // If task was already published/active and audience rules were updated, add newly matching recipients
    if (task.status !== 'DRAFT') {
      try {
        const resolvedTeachers = await services.resolveTaskAudience(updatedCampusIds, updatedAudienceRules, updatedExclusions);
        const activeRecipients = resolvedTeachers.filter(t => !t.is_excluded);

        for (const recipient of activeRecipients) {
          const assignmentId = uuidv4();
          if (db.isMemoryFallback()) {
            const store = db.getMemoryStore();
            if (!store.assignments.some(a => a.task_id === taskId && a.user_id === recipient.id)) {
              store.assignments.push({
                id: assignmentId,
                task_id: taskId,
                user_id: recipient.id,
                campus_id: recipient.campus_id,
                assigned_at: now,
                assigned_by: req.user.id,
                due_at: updatedDeadlineAt,
                status: 'NOT_STARTED',
                excluded_flag: false,
                created_at: now,
                updated_at: now
              });
            }
          } else {
            await db.query(`
              INSERT INTO assignments (id, task_id, user_id, campus_id, assigned_at, assigned_by, due_at, status, excluded_flag)
              VALUES ($1, $2, $3, $4, $5, $6, $7, 'NOT_STARTED', FALSE)
              ON CONFLICT (task_id, user_id) DO NOTHING
            `, [assignmentId, taskId, recipient.id, recipient.campus_id, now, req.user.id, updatedDeadlineAt]);
          }
        }
      } catch (e) {
        console.warn(`[Task Update Audience Sync Warning]: ${e.message}`);
      }
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: updatedCampusIds[0] || null,
      action: 'TASK_UPDATED',
      entityType: 'TASK',
      entityId: taskId,
      description: `Updated task "${title || task.title}" properties, status (${updatedStatus}), and questions/recipients.`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Task updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tasks/:id/status', auth.requirePermission('tasks.create'), async (req, res) => {
  try {
    const taskId = req.params.id;
    const { status } = req.body;
    if (!['ACTIVE', 'PAUSED', 'ARCHIVED', 'DRAFT'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Allowed values: ACTIVE, PAUSED, ARCHIVED, DRAFT' });
    }

    let task;
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      task = store.tasks.find(t => t.id === taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      task.status = status;
      task.updated_at = new Date();
    } else {
      const result = await db.query('UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [status, taskId]);
      task = result.rows[0];
      if (!task) return res.status(404).json({ error: 'Task not found' });
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: (typeof task.campus_ids === 'string' ? JSON.parse(task.campus_ids) : task.campus_ids)[0] || null,
      action: 'TASK_STATUS_CHANGED',
      entityType: 'TASK',
      entityId: taskId,
      description: `Changed status of task "${task.title}" to ${status}.`,
      ipAddress: req.ip
    });

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tasks/:id/reorder', auth.requirePermission('tasks.create'), async (req, res) => {
  try {
    const taskId = req.params.id;
    const { direction, sort_order } = req.body; // direction: 'UP' | 'DOWN'

    let tasks = [];
    if (db.isMemoryFallback()) {
      tasks = [...db.getMemoryStore().tasks.filter(t => t.task_type !== 'RECURRING_TEMPLATE')];
    } else {
      const resTasks = await db.query('SELECT id, sort_order, created_at FROM tasks WHERE task_type != $1 ORDER BY sort_order ASC, created_at DESC', ['RECURRING_TEMPLATE']);
      tasks = resTasks.rows;
    }

    const currentIndex = tasks.findIndex(t => t.id === taskId);
    if (currentIndex === -1) return res.status(404).json({ error: 'Task not found' });

    if (sort_order !== undefined) {
      if (db.isMemoryFallback()) {
        const t = db.getMemoryStore().tasks.find(x => x.id === taskId);
        if (t) t.sort_order = Number(sort_order);
      } else {
        await db.query('UPDATE tasks SET sort_order = $1, updated_at = NOW() WHERE id = $2', [Number(sort_order), taskId]);
      }
      return res.json({ success: true, message: 'Sort order updated' });
    }

    if (direction === 'UP') {
      if (currentIndex === 0) return res.json({ success: true, message: 'Already at the top' });
      const prevTask = tasks[currentIndex - 1];
      const currentSort = tasks[currentIndex].sort_order || 0;
      const prevSort = prevTask.sort_order || 0;
      const newCurrentSort = prevSort > 0 ? prevSort - 1 : 0;
      const newPrevSort = currentSort >= prevSort ? currentSort + 1 : prevSort + 1;

      if (db.isMemoryFallback()) {
        const store = db.getMemoryStore();
        const t1 = store.tasks.find(x => x.id === taskId);
        const t2 = store.tasks.find(x => x.id === prevTask.id);
        if (t1 && t2) {
          const temp = t1.sort_order || 0;
          t1.sort_order = (t2.sort_order || 0) - 1;
        }
      } else {
        await db.transaction(async (client) => {
          await client.query('UPDATE tasks SET sort_order = sort_order - 1 WHERE id = $1', [taskId]);
          await client.query('UPDATE tasks SET sort_order = sort_order + 1 WHERE id = $1', [prevTask.id]);
        });
      }
    } else if (direction === 'DOWN') {
      if (currentIndex === tasks.length - 1) return res.json({ success: true, message: 'Already at the bottom' });
      const nextTask = tasks[currentIndex + 1];

      if (db.isMemoryFallback()) {
        const store = db.getMemoryStore();
        const t1 = store.tasks.find(x => x.id === taskId);
        const t2 = store.tasks.find(x => x.id === nextTask.id);
        if (t1 && t2) {
          const temp = t1.sort_order || 0;
          t1.sort_order = (t2.sort_order || 0) + 1;
        }
      } else {
        await db.transaction(async (client) => {
          await client.query('UPDATE tasks SET sort_order = sort_order + 1 WHERE id = $1', [taskId]);
          await client.query('UPDATE tasks SET sort_order = sort_order - 1 WHERE id = $1', [nextTask.id]);
        });
      }
    }

    res.json({ success: true, message: 'Task reordered successfully' });
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
        if (!t || t.status === 'ARCHIVED') return null; // Rule: Archived tasks not visible to teachers

        const sub = store.submissions.find(s => s.assignment_id === a.id);
        const isOverdue = !sub && new Date(a.due_at) < now;
        const computedStatus = sub ? (sub.draft_flag ? 'IN_PROGRESS' : (new Date(sub.submitted_at) <= new Date(a.due_at) ? 'SUBMITTED_ON_TIME' : 'SUBMITTED_LATE')) : (isOverdue ? 'OVERDUE' : 'NOT_STARTED');
        const isScheduled = t.open_at && new Date(t.open_at) > now;

        return {
          assignment_id: a.id,
          task_id: a.task_id,
          title: t ? t.title : 'Task',
          description: t ? t.description : '',
          task_status: t.status,
          open_at: t.open_at,
          is_scheduled: isScheduled,
          allow_late_submissions: t.allow_late_submissions !== false,
          allow_edit_submission: t.allow_edit_submission === true,
          sort_order: t.sort_order || 0,
          assigned_at: a.assigned_at,
          due_at: a.due_at,
          status: computedStatus,
          submitted_at: sub ? sub.submitted_at : null,
          draft_flag: sub ? sub.draft_flag : false,
          answers: sub ? sub.answers : {}
        };
      }).filter(Boolean);

      tasks.sort((a, b) => (a.sort_order - b.sort_order) || (new Date(a.due_at) - new Date(b.due_at)));
    } else {
      const q = `
        SELECT a.id as assignment_id, a.task_id, t.title, t.description, t.status as task_status,
        t.open_at, t.allow_late_submissions, t.allow_edit_submission, t.sort_order, a.assigned_at, a.due_at, a.status,
        s.submitted_at, s.draft_flag, s.answers
        FROM assignments a
        JOIN tasks t ON a.task_id = t.id
        LEFT JOIN submissions s ON a.id = s.assignment_id
        WHERE a.user_id = $1 AND t.status != 'ARCHIVED'
        ORDER BY t.sort_order ASC, a.due_at ASC
      `;
      const result = await db.query(q, [userId]);
      tasks = result.rows.map(r => ({
        ...r,
        allow_late_submissions: r.allow_late_submissions !== false,
        allow_edit_submission: r.allow_edit_submission === true,
        is_scheduled: r.open_at && new Date(r.open_at) > now
      }));
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
    const now = new Date();

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
    if (task.status === 'ARCHIVED') return res.status(404).json({ error: 'This task has been archived' });
    if (!assignment) return res.status(403).json({ error: 'You are not assigned to this task' });

    const isScheduled = task.open_at && new Date(task.open_at) > now;

    res.json({
      task: {
        ...task,
        allow_late_submissions: task.allow_late_submissions !== false,
        allow_edit_submission: task.allow_edit_submission === true,
        is_scheduled: isScheduled,
        questions: typeof task.questions === 'string' ? JSON.parse(task.questions) : task.questions
      },
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

    let task;
    let assignment;
    let existingSubmission;
    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      task = store.tasks.find(t => t.id === taskId);
      assignment = store.assignments.find(a => a.task_id === taskId && a.user_id === userId);
      if (assignment) {
        existingSubmission = store.submissions.find(s => s.assignment_id === assignment.id);
      }
    } else {
      const tRes = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      task = tRes.rows[0];
      const aRes = await db.query('SELECT * FROM assignments WHERE task_id = $1 AND user_id = $2', [taskId, userId]);
      assignment = aRes.rows[0];
      if (assignment) {
        const sRes = await db.query('SELECT * FROM submissions WHERE assignment_id = $1', [assignment.id]);
        existingSubmission = sRes.rows[0];
      }
    }

    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!assignment) return res.status(403).json({ error: 'You are not assigned to this task' });

    // Validate lifecycle restrictions
    if (task.status === 'ARCHIVED' || task.status === 'PAUSED') {
      return res.status(400).json({ error: `This task is currently ${task.status.toLowerCase()} and is not accepting submissions.` });
    }

    if (task.open_at && new Date(task.open_at) > now) {
      return res.status(400).json({ error: `This task is scheduled to open on ${new Date(task.open_at).toLocaleString()}. Submissions are not open yet.` });
    }

    // Check if task was already submitted and editing is not permitted
    const wasAlreadySubmitted = existingSubmission && !existingSubmission.draft_flag;
    if (wasAlreadySubmitted && task.allow_edit_submission !== true) {
      return res.status(400).json({ error: 'Responses cannot be edited after final submission for this task.' });
    }

    const dueAt = new Date(assignment.due_at);
    if (!is_draft && task.allow_late_submissions === false && now > dueAt && !wasAlreadySubmitted) {
      return res.status(400).json({ error: 'The deadline for this task has passed and late submissions are not allowed by the assignor.' });
    }

    const computedStatus = is_draft ? 'IN_PROGRESS' : (now <= dueAt ? 'SUBMITTED_ON_TIME' : 'SUBMITTED_LATE');

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      let sub = store.submissions.find(s => s.assignment_id === assignment.id);
      if (sub) {
        sub.answers = answers;
        sub.draft_flag = Boolean(is_draft);
        sub.submitted_at = is_draft ? null : (wasAlreadySubmitted ? sub.submitted_at : now);
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
      await db.transaction(async (client) => {
        const subTime = is_draft ? null : (wasAlreadySubmitted && existingSubmission.submitted_at ? existingSubmission.submitted_at : now);
        await client.query(`
          INSERT INTO submissions (id, assignment_id, answers, draft_flag, submitted_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (assignment_id)
          DO UPDATE SET answers = $3, draft_flag = $4, submitted_at = COALESCE(submissions.submitted_at, $5), updated_at = $6
        `, [uuidv4(), assignment.id, JSON.stringify(answers), Boolean(is_draft), subTime, now]);

        await client.query('UPDATE assignments SET status = $1, updated_at = $2 WHERE id = $3', [computedStatus, now, assignment.id]);
      });
    }

    res.json({
      success: true,
      status: computedStatus,
      message: is_draft ? 'Draft saved successfully' : (wasAlreadySubmitted ? 'Task response updated successfully' : 'Task response submitted successfully')
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

router.post('/import/commit', auth.requirePermission('imports.execute'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload an Excel or CSV file' });
    const defaultPassword = req.body.default_password || 'Welcome@2026';

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);

    let createdCount = 0;
    let updatedCount = 0;
    const errors = [];

    // Fetch master references
    let campuses = [];
    let masterValues = [];
    let teacherRole = null;

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      campuses = store.campuses;
      masterValues = store.master_values;
      teacherRole = store.roles.find(r => r.name.toUpperCase().includes('TEACHER')) || store.roles[0];
    } else {
      const cRes = await db.query('SELECT * FROM campuses');
      campuses = cRes.rows;
      const mRes = await db.query('SELECT * FROM master_values');
      masterValues = mRes.rows;
      const rRes = await db.query("SELECT * FROM roles WHERE name ILIKE '%Teacher%' LIMIT 1");
      teacherRole = rRes.rows[0];
    }

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const email = (row['Email'] || row['Email (Key)'] || '').trim().toLowerCase();
      if (!email) {
        errors.push(`Row ${i + 1}: Skipped due to missing Email.`);
        continue;
      }

      const firstName = (row['First Name'] || '').trim() || email.split('@')[0];
      const lastName = (row['Last Name'] || '').trim();
      const displayName = `${firstName} ${lastName}`.trim();
      const employeeCode = (row['Employee Code'] || '').toString().trim() || null;
      const phone = (row['Phone'] || '').toString().trim() || null;
      const status = (row['Status (ACTIVE/INACTIVE)'] || 'ACTIVE').trim().toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
      const classTeacherStr = (row['Class Teacher (Yes/No)'] || '').toString().trim().toLowerCase();
      const classTeacher = classTeacherStr === 'yes' || classTeacherStr === 'true';
      const rawPassword = (row['Password (Optional)'] || row['Password'] || defaultPassword).toString().trim();
      const campusName = (row['Campus'] || '').toString().trim();

      // Resolve Campus
      let campus = campuses.find(c => c.name.toLowerCase() === campusName.toLowerCase());
      if (!campus) {
        campus = campuses[0];
      }

      const now = new Date();
      const passwordHash = await bcrypt.hash(rawPassword || 'Welcome@2026', 10);

      // Collect master attributes to assign
      const deptName = (row['Department'] || '').toString().trim();
      const desigName = (row['Designation'] || '').toString().trim();
      const subjsStr = (row['Subjects (Comma separated)'] || '').toString().trim();
      const catsStr = (row['Categories (Comma separated)'] || '').toString().trim();

      const matchedMasterIds = [];
      if (deptName) {
        const mv = masterValues.find(m => m.master_type === 'DEPARTMENT' && m.name.toLowerCase() === deptName.toLowerCase());
        if (mv) matchedMasterIds.push(mv.id);
      }
      if (desigName) {
        const mv = masterValues.find(m => m.master_type === 'DESIGNATION' && m.name.toLowerCase() === desigName.toLowerCase());
        if (mv) matchedMasterIds.push(mv.id);
      }
      if (subjsStr) {
        subjsStr.split(',').map(s => s.trim()).forEach(sName => {
          const mv = masterValues.find(m => m.master_type === 'SUBJECT' && m.name.toLowerCase() === sName.toLowerCase());
          if (mv) matchedMasterIds.push(mv.id);
        });
      }
      if (catsStr) {
        catsStr.split(',').map(c => c.trim()).forEach(cName => {
          const mv = masterValues.find(m => m.master_type === 'CATEGORY' && m.name.toLowerCase() === cName.toLowerCase());
          if (mv) matchedMasterIds.push(mv.id);
        });
      }

      if (db.isMemoryFallback()) {
        const store = db.getMemoryStore();
        let existingUser = store.users.find(u => u.email.toLowerCase() === email);
        if (existingUser) {
          existingUser.first_name = firstName;
          existingUser.last_name = lastName;
          existingUser.display_name = displayName;
          if (employeeCode) existingUser.employee_code = employeeCode;
          if (phone) existingUser.phone = phone;
          existingUser.status = status;
          existingUser.class_teacher_status = classTeacher;
          if (row['Password (Optional)'] || row['Password']) {
            existingUser.password_hash = passwordHash;
          }
          existingUser.updated_at = now;

          // Replace attributes
          if (campus) {
            store.user_attributes = store.user_attributes.filter(a => a.user_id !== existingUser.id);
            for (const mid of matchedMasterIds) {
              store.user_attributes.push({
                id: uuidv4(),
                user_id: existingUser.id,
                campus_id: campus.id,
                master_value_id: mid,
                created_at: now,
                created_by: req.user.id
              });
            }
          }
          updatedCount++;
        } else {
          const newUserId = uuidv4();
          const newUser = {
            id: newUserId,
            user_type: 'TEACHER',
            email,
            password_hash: passwordHash,
            first_name: firstName,
            last_name: lastName,
            display_name: displayName,
            employee_code: employeeCode,
            phone,
            status,
            class_teacher_status: classTeacher,
            created_at: now,
            updated_at: now
          };
          store.users.push(newUser);

          if (campus && teacherRole) {
            store.user_access.push({
              id: uuidv4(),
              user_id: newUserId,
              role_id: teacherRole.id,
              campus_id: campus.id,
              permission_overrides: null,
              created_at: now,
              updated_at: now
            });
          }

          if (campus) {
            for (const mid of matchedMasterIds) {
              store.user_attributes.push({
                id: uuidv4(),
                user_id: newUserId,
                campus_id: campus.id,
                master_value_id: mid,
                created_at: now,
                created_by: req.user.id
              });
            }
          }
          createdCount++;
        }
      } else {
        await db.transaction(async (client) => {
          const uRes = await client.query('SELECT * FROM users WHERE email = $1', [email]);
          let userId;
          if (uRes.rows.length > 0) {
            userId = uRes.rows[0].id;
            if (row['Password (Optional)'] || row['Password']) {
              await client.query(`
                UPDATE users SET first_name = $1, last_name = $2, display_name = $3, employee_code = COALESCE($4, employee_code), phone = COALESCE($5, phone), status = $6, class_teacher_status = $7, password_hash = $8, updated_at = NOW()
                WHERE id = $9
              `, [firstName, lastName, displayName, employeeCode, phone, status, classTeacher, passwordHash, userId]);
            } else {
              await client.query(`
                UPDATE users SET first_name = $1, last_name = $2, display_name = $3, employee_code = COALESCE($4, employee_code), phone = COALESCE($5, phone), status = $6, class_teacher_status = $7, updated_at = NOW()
                WHERE id = $8
              `, [firstName, lastName, displayName, employeeCode, phone, status, classTeacher, userId]);
            }
            updatedCount++;
          } else {
            userId = uuidv4();
            await client.query(`
              INSERT INTO users (id, user_type, email, password_hash, first_name, last_name, display_name, employee_code, phone, status, class_teacher_status, created_at, updated_at)
              VALUES ($1, 'TEACHER', $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
            `, [userId, email, passwordHash, firstName, lastName, displayName, employeeCode, phone, status, classTeacher]);

            if (campus && teacherRole) {
              await client.query(`
                INSERT INTO user_access (id, user_id, role_id, campus_id, created_at, updated_at)
                VALUES ($1, $2, $3, $4, NOW(), NOW())
                ON CONFLICT (user_id, role_id, campus_id) DO NOTHING
              `, [uuidv4(), userId, teacherRole.id, campus.id]);
            }
            createdCount++;
          }

          if (campus) {
            await client.query('DELETE FROM user_attributes WHERE user_id = $1', [userId]);
            for (const mid of matchedMasterIds) {
              await client.query(`
                INSERT INTO user_attributes (id, user_id, campus_id, master_value_id, created_by)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (user_id, campus_id, master_value_id) DO NOTHING
              `, [uuidv4(), userId, campus.id, mid, req.user.id]);
            }
          }
        });
      }
    }

    await services.logAudit({
      userId: req.user.id,
      campusId: campuses[0] ? campuses[0].id : null,
      action: 'IMPORT_COMMITTED',
      entityType: 'IMPORT',
      entityId: null,
      description: `Committed bulk teacher import. Created: ${createdCount}, Updated: ${updatedCount}.`,
      metadata: { createdCount, updatedCount, total: rawRows.length },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      created_count: createdCount,
      updated_count: updatedCount,
      total_processed: rawRows.length,
      errors
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 10. ROLES & AUDIT LOGS ROUTES
// ============================================================================

router.get('/reports/detailed-response', auth.requirePermission('reports.detailed.view'), async (req, res) => {
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
        const uAttrs = store.user_attributes.filter(attr => attr.user_id === a.user_id);
        const depts = uAttrs.map(attr => store.master_values.find(mv => mv.id === attr.master_value_id && mv.master_type === 'DEPARTMENT')?.name).filter(Boolean);
        const desigs = uAttrs.map(attr => store.master_values.find(mv => mv.id === attr.master_value_id && mv.master_type === 'DESIGNATION')?.name).filter(Boolean);
        const subjs = uAttrs.map(attr => store.master_values.find(mv => mv.id === attr.master_value_id && mv.master_type === 'SUBJECT')?.name).filter(Boolean);
        const cats = uAttrs.map(attr => store.master_values.find(mv => mv.id === attr.master_value_id && mv.master_type === 'CATEGORY')?.name).filter(Boolean);

        return {
          assignment_id: a.id,
          user_id: a.user_id,
          display_name: u ? u.display_name : 'Unknown',
          email: u ? u.email : 'Unknown',
          employee_code: u ? u.employee_code : 'N/A',
          campus_id: a.campus_id,
          campus_name: c ? c.name : 'Unknown',
          department_names: depts.join(', ') || 'N/A',
          designation_name: desigs[0] || 'Teacher',
          subject_names: subjs.join(', ') || 'N/A',
          category_names: cats.join(', ') || 'N/A',
          class_teacher_status: u ? (u.class_teacher_status ? 'Yes' : 'No') : 'No',
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
      if (search) rows = rows.filter(r => r.display_name.toLowerCase().includes(search.toLowerCase()) || r.email.toLowerCase().includes(search.toLowerCase()));
    } else {
      const tRes = await db.query('SELECT * FROM tasks WHERE id = $1', [task_id]);
      task = tRes.rows[0];
      if (!task) return res.status(404).json({ error: 'Task not found' });

      let q = `
        SELECT a.id as assignment_id, a.user_id, u.display_name, u.email, u.employee_code, u.class_teacher_status,
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
      rows = result.rows.map(r => ({
        ...r,
        class_teacher_status: r.class_teacher_status ? 'Yes' : 'No',
        department_names: 'Department',
        designation_name: 'Teacher',
        subject_names: 'Subjects',
        category_names: 'Categories',
        answers: r.answers || {}
      }));
    }

    res.json({
      task,
      questions: typeof task.questions === 'string' ? JSON.parse(task.questions) : (task.questions || []),
      rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.post('/roles', auth.requireSuperAdmin, async (req, res) => {
  try {
    const { name, description, permissions = {}, status = 'ACTIVE' } = req.body;
    if (!name) return res.status(400).json({ error: 'Role name is required' });

    const roleId = uuidv4();
    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      if (store.roles.some(r => r.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ error: 'Role with this name already exists' });
      }
      store.roles.push({
        id: roleId,
        name,
        description,
        permissions,
        is_system_role: false,
        status,
        created_at: now,
        updated_at: now
      });
    } else {
      await db.query(`
        INSERT INTO roles (id, name, description, permissions, is_system_role, status)
        VALUES ($1, $2, $3, $4, FALSE, $5)
      `, [roleId, name, description, JSON.stringify(permissions), status]);
    }

    await services.logAudit({
      userId: req.user.id,
      action: 'ROLE_CREATED',
      entityType: 'ROLE',
      entityId: roleId,
      description: `Created role "${name}" with ${Object.keys(permissions).length} permission keys.`,
      ipAddress: req.ip
    });

    res.json({ success: true, id: roleId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/roles/:id', auth.requireSuperAdmin, async (req, res) => {
  try {
    const roleId = req.params.id;
    const { name, description, permissions = {}, status = 'ACTIVE' } = req.body;
    if (!name) return res.status(400).json({ error: 'Role name is required' });

    const now = new Date();

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      const role = store.roles.find(r => r.id === roleId);
      if (!role) return res.status(404).json({ error: 'Role not found' });
      role.name = name;
      role.description = description;
      role.permissions = permissions;
      role.status = status;
      role.updated_at = now;
    } else {
      await db.query(`
        UPDATE roles
        SET name = $1, description = $2, permissions = $3, status = $4, updated_at = NOW()
        WHERE id = $5
      `, [name, description, JSON.stringify(permissions), status, roleId]);
    }

    await services.logAudit({
      userId: req.user.id,
      action: 'ROLE_UPDATED',
      entityType: 'ROLE',
      entityId: roleId,
      description: `Updated role "${name}" permissions configuration.`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Role updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/audit-logs', auth.requirePermission('audit.view'), async (req, res) => {
  try {
    const { campus_id, action, entity_type, search, from_date, to_date, sort_by = 'created_at', sort_dir = 'desc', limit = 200 } = req.query;
    let logs = [];

    if (db.isMemoryFallback()) {
      const store = db.getMemoryStore();
      logs = store.audit_logs.map(l => {
        const u = store.users.find(usr => usr.id === l.user_id);
        const c = store.campuses.find(cmp => cmp.id === l.campus_id);
        return {
          ...l,
          user_display_name: u ? u.display_name : (l.user_id ? 'User' : 'System'),
          user_email: u ? u.email : '',
          campus_name: c ? c.name : 'Global / Multi-Campus'
        };
      });

      if (!req.user.isSuperAdmin) {
        logs = logs.filter(l => !l.campus_id || req.user.authorizedCampusIds.includes(l.campus_id));
      }
      if (campus_id) logs = logs.filter(l => l.campus_id === campus_id);
      if (action) logs = logs.filter(l => l.action === action);
      if (entity_type) logs = logs.filter(l => l.entity_type === entity_type);
      if (from_date) {
        const fromT = new Date(from_date).getTime();
        logs = logs.filter(l => new Date(l.created_at).getTime() >= fromT);
      }
      if (to_date) {
        const toT = new Date(to_date).getTime() + 86400000;
        logs = logs.filter(l => new Date(l.created_at).getTime() <= toT);
      }
      if (search) {
        const qLower = search.toLowerCase();
        logs = logs.filter(l =>
          (l.description && l.description.toLowerCase().includes(qLower)) ||
          (l.action && l.action.toLowerCase().includes(qLower)) ||
          (l.user_display_name && l.user_display_name.toLowerCase().includes(qLower)) ||
          (l.entity_type && l.entity_type.toLowerCase().includes(qLower))
        );
      }

      // Sort
      logs.sort((a, b) => {
        let valA = a[sort_by] !== undefined ? a[sort_by] : '';
        let valB = b[sort_by] !== undefined ? b[sort_by] : '';
        if (sort_by === 'created_at') {
          valA = new Date(valA).getTime();
          valB = new Date(valB).getTime();
          return sort_dir === 'asc' ? valA - valB : valB - valA;
        }
        const cmp = String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
        return sort_dir === 'asc' ? cmp : -cmp;
      });

      logs = logs.slice(0, Number(limit) || 200);
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
      if (entity_type) {
        p.push(entity_type);
        q += ` AND al.entity_type = $${p.length}`;
      }
      if (from_date) {
        p.push(new Date(from_date));
        q += ` AND al.created_at >= $${p.length}`;
      }
      if (to_date) {
        p.push(new Date(new Date(to_date).getTime() + 86400000));
        q += ` AND al.created_at <= $${p.length}`;
      }
      if (search) {
        p.push(`%${search}%`);
        q += ` AND (al.description ILIKE $${p.length} OR al.action ILIKE $${p.length} OR u.display_name ILIKE $${p.length})`;
      }

      const validSortCols = {
        created_at: 'al.created_at',
        action: 'al.action',
        user_display_name: 'u.display_name',
        campus_name: 'c.name',
        entity_type: 'al.entity_type'
      };
      const sortColumn = validSortCols[sort_by] || 'al.created_at';
      const orderDirection = sort_dir === 'asc' ? 'ASC' : 'DESC';

      p.push(Number(limit) || 200);
      q += ` ORDER BY ${sortColumn} ${orderDirection} LIMIT $${p.length}`;
      const result = await db.query(q, p);
      logs = result.rows;
    }

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 12. DIAGNOSTIC / SYSTEM EMAIL TEST ROUTE
// ============================================================================

router.post('/admin/test-email', auth.requireAuth, async (req, res) => {
  try {
    if (!req.user.isSuperAdmin && req.user.user_type !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Only Super Administrators can perform SMTP verification.' });
    }

    const targetEmail = req.body.to_email || req.user.email;
    if (!targetEmail) {
      return res.status(400).json({ error: 'Target email address is required.' });
    }

    const info = await services.sendTestEmail(targetEmail);

    await services.logAudit({
      userId: req.user.id,
      campusId: null,
      action: 'TEST_EMAIL_SENT',
      entityType: 'SYSTEM',
      entityId: req.user.id,
      description: `Dispatched SMTP test verification email to ${targetEmail}.`,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Test email successfully sent to ${targetEmail}`,
      details: {
        messageId: info.messageId,
        smtp_user: process.env.SMTP_USER || '(Not configured - mock used)',
        smtp_host: process.env.SMTP_HOST || '(Not configured - mock used)'
      }
    });
  } catch (err) {
    console.error('[SMTP Test Error]:', err);
    res.status(500).json({
      error: `Failed to send test email: ${err.message}`,
      hint: 'For Gmail/Google Workspace: Ensure 2-Step Verification is ON, use an App Password (not your normal password), and verify SMTP_USER matches your account.'
    });
  }
});

module.exports = router;
