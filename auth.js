/**
 * Authentication and Authorization Module (auth.js)
 * Implements strict separation of User Type vs Role, Campus Scope enforcement, and granular permission calculation.
 */
const bcrypt = require('bcryptjs');
const db = require('./db');

/**
 * Authenticate a user by email and password
 */
async function authenticate(email, password) {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const cleanEmail = email.trim().toLowerCase();

  // Find user by email
  let user;
  if (db.isMemoryFallback()) {
    user = db.getMemoryStore().users.find(u => u.email.toLowerCase() === cleanEmail);
  } else {
    const res = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [cleanEmail]);
    user = res.rows[0];
  }

  if (!user) {
    throw new Error('Invalid email or password');
  }

  if (user.status !== 'ACTIVE') {
    throw new Error(`Account is ${user.status.toLowerCase()}. Please contact your administrator.`);
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new Error('Invalid email or password');
  }

  // Update last_login_at
  const now = new Date();
  if (db.isMemoryFallback()) {
    user.last_login_at = now;
  } else {
    await db.query('UPDATE users SET last_login_at = $1 WHERE id = $2', [now, user.id]);
  }

  // Calculate effective permissions and authorized campuses
  const accessContext = await resolveUserAccessContext(user);

  return {
    ...sanitizeUser(user),
    ...accessContext
  };
}

/**
 * Resolve User Roles, Overrides, Effective Permissions, and Authorized Campuses
 */
async function resolveUserAccessContext(user) {
  if (user.user_type === 'SUPER_ADMIN') {
    // Super admin has all permissions and all active campuses
    let allCampuses = [];
    if (db.isMemoryFallback()) {
      allCampuses = db.getMemoryStore().campuses.filter(c => c.status === 'ACTIVE');
    } else {
      const res = await db.query('SELECT * FROM campuses WHERE status = $1 ORDER BY name ASC', ['ACTIVE']);
      allCampuses = res.rows;
    }

    return {
      isSuperAdmin: true,
      authorizedCampusIds: allCampuses.map(c => c.id),
      campuses: allCampuses,
      roles: ['Super Administrator'],
      permissions: { '*': true } // Wildcard super admin
    };
  }

  // Retrieve user access records
  let accessRows = [];
  if (db.isMemoryFallback()) {
    accessRows = db.getMemoryStore().user_access.filter(a => a.user_id === user.id);
  } else {
    const res = await db.query(`
      SELECT ua.*, r.name as role_name, r.permissions as role_permissions 
      FROM user_access ua
      JOIN roles r ON ua.role_id = r.id
      WHERE ua.user_id = $1 AND r.status = 'ACTIVE'
    `, [user.id]);
    accessRows = res.rows;
  }

  const authorizedCampusIdSet = new Set();
  const effectivePermissions = {};
  const roleNames = [];

  // For any user with campus attributes, include them
  let userCampusAttrs = [];
  if (db.isMemoryFallback()) {
    userCampusAttrs = db.getMemoryStore().user_attributes.filter(a => a.user_id === user.id);
  } else {
    const res = await db.query('SELECT DISTINCT campus_id FROM user_attributes WHERE user_id = $1', [user.id]);
    userCampusAttrs = res.rows;
  }
  userCampusAttrs.forEach(a => { if (a.campus_id) authorizedCampusIdSet.add(a.campus_id); });

  // Process access rows
  for (const acc of accessRows) {
    if (acc.campus_id) {
      authorizedCampusIdSet.add(acc.campus_id);
    } else {
      // Global campus access for this role
      let allActiveCampuses = [];
      if (db.isMemoryFallback()) {
        allActiveCampuses = db.getMemoryStore().campuses.filter(c => c.status === 'ACTIVE');
      } else {
        const res = await db.query('SELECT id FROM campuses WHERE status = $1', ['ACTIVE']);
        allActiveCampuses = res.rows;
      }
      allActiveCampuses.forEach(c => authorizedCampusIdSet.add(c.id));
    }

    let rolePerms = {};
    if (db.isMemoryFallback()) {
      const r = db.getMemoryStore().roles.find(role => role.id === acc.role_id);
      if (r) {
        rolePerms = r.permissions || {};
        if (!roleNames.includes(r.name)) roleNames.push(r.name);
      }
    } else {
      rolePerms = acc.role_permissions || {};
      if (acc.role_name && !roleNames.includes(acc.role_name)) roleNames.push(acc.role_name);
    }

    // Merge role permissions
    for (const [k, v] of Object.entries(rolePerms)) {
      if (v === true) effectivePermissions[k] = true;
    }

    // Apply explicit permission overrides
    if (acc.permission_overrides) {
      const overrides = typeof acc.permission_overrides === 'string' ? JSON.parse(acc.permission_overrides) : acc.permission_overrides;
      for (const [k, v] of Object.entries(overrides)) {
        if (v === true) effectivePermissions[k] = true;
        if (v === false) effectivePermissions[k] = false;
      }
    }
  }

  const authorizedCampusIds = Array.from(authorizedCampusIdSet);

  // Get campus entities
  let campuses = [];
  if (authorizedCampusIds.length > 0) {
    if (db.isMemoryFallback()) {
      campuses = db.getMemoryStore().campuses.filter(c => authorizedCampusIds.includes(c.id) && c.status === 'ACTIVE');
    } else {
      const res = await db.query('SELECT * FROM campuses WHERE id = ANY($1) AND status = $2 ORDER BY name ASC', [authorizedCampusIds, 'ACTIVE']);
      campuses = res.rows;
    }
  }

  return {
    isSuperAdmin: false,
    authorizedCampusIds,
    campuses,
    roles: roleNames,
    permissions: effectivePermissions
  };
}

/**
 * Remove sensitive data like password_hash from user object
 */
function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

/**
 * Check if user has specific permission key
 */
function hasPermission(userContext, permissionKey) {
  if (!userContext) return false;
  if (userContext.isSuperAdmin || userContext.user_type === 'SUPER_ADMIN') return true;
  if (userContext.permissions && userContext.permissions['*']) return true;
  return Boolean(userContext.permissions && userContext.permissions[permissionKey] === true);
}

/**
 * Check if user is authorized for specific campus ID(s)
 */
function isAuthorizedForCampus(userContext, campusId) {
  if (!userContext) return false;
  if (userContext.isSuperAdmin || userContext.user_type === 'SUPER_ADMIN') return true;
  if (!campusId) return true; // Global/null campus
  return (userContext.authorizedCampusIds || []).includes(campusId);
}

/**
 * Middleware: Require authenticated session
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = req.session.user;
  next();
}

/**
 * Middleware factory: Require specific permission key
 */
function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = req.session.user;
    if (!hasPermission(user, permissionKey)) {
      return res.status(403).json({ error: `Forbidden: Missing required permission [${permissionKey}]` });
    }
    req.user = user;
    next();
  };
}

/**
 * Middleware: Require SUPER_ADMIN user type
 */
function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const user = req.session.user;
  if (user.user_type !== 'SUPER_ADMIN' && !user.isSuperAdmin) {
    return res.status(403).json({ error: 'Forbidden: Super Administrator access required' });
  }
  req.user = user;
  next();
}

/**
 * Assert server-side campus access for one or more campus IDs
 */
function assertCampusAccess(userContext, campusIds) {
  if (userContext.isSuperAdmin || userContext.user_type === 'SUPER_ADMIN') return true;
  const ids = Array.isArray(campusIds) ? campusIds : [campusIds];
  for (const cid of ids) {
    if (cid && !userContext.authorizedCampusIds.includes(cid)) {
      throw new Error(`Unauthorized access attempt to campus [${cid}]`);
    }
  }
  return true;
}

module.exports = {
  authenticate,
  resolveUserAccessContext,
  sanitizeUser,
  hasPermission,
  isAuthorizedForCampus,
  assertCampusAccess,
  requireAuth,
  requirePermission,
  requireSuperAdmin
};
