/**
 * Database Module (db.js)
 * Supports PostgreSQL via 'pg' Pool with transaction helpers and auto-migration.
 * Includes a resilient in-memory PostgreSQL-compatible mock for seamless offline local development and testing.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const isProduction = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.DATABASE_URL;

let pool = null;
let useMemoryFallback = false;

// In-Memory Storage for Fallback/Test mode
const memoryStore = {
  campuses: [],
  users: [],
  roles: [],
  master_values: [],
  user_attributes: [],
  user_access: [],
  groups: [],
  group_memberships: [],
  tasks: [],
  assignments: [],
  submissions: [],
  audit_logs: [],
  session: []
};

// Seed In-Memory Database
async function seedMemoryStore() {
  const hash = await bcrypt.hash('Admin@123', 10);

  // Campuses (Clean start - can be added via UI/Bulk)
  memoryStore.campuses = [];

  // System Roles
  const superAdminRoleId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const principalRoleId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const coordinatorRoleId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const reportViewerRoleId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  memoryStore.roles = [
    {
      id: superAdminRoleId,
      name: 'Super Administrator',
      description: 'Full system access across all campuses',
      permissions: {
        'dashboard.view_admin': true,
        'tasks.view': true, 'tasks.create': true, 'tasks.edit': true, 'tasks.delete_draft': true, 'tasks.publish': true, 'tasks.assign': true, 'tasks.archive': true, 'tasks.send_reminder': true, 'tasks.export': true,
        'recurring_tasks.view': true, 'recurring_tasks.create': true, 'recurring_tasks.edit': true, 'recurring_tasks.pause': true, 'recurring_tasks.publish': true,
        'reports.task_wise.view': true, 'reports.task_wise.export': true, 'reports.teacher_wise.view': true, 'reports.teacher_wise.export': true, 'reports.detailed.view': true, 'reports.detailed.export': true,
        'groups.view': true, 'groups.create': true, 'groups.edit': true, 'groups.manage_members': true, 'groups.approve_requests': true, 'groups.delete_or_deactivate': true,
        'users.view': true, 'users.create': true, 'users.edit': true, 'users.deactivate': true, 'users.import': true, 'users.export': true,
        'masters.view': true, 'masters.create': true, 'masters.edit': true, 'masters.deactivate': true, 'masters.import': true, 'masters.export': true,
        'campuses.view': true, 'campuses.create': true, 'campuses.edit': true, 'campuses.manage': true,
        'audit.view': true, 'audit.export': true,
        'imports.execute': true, 'exports.execute': true,
        'roles.view': true, 'roles.manage': true,
        'user_access.manage': true
      },
      is_system_role: true,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: principalRoleId,
      name: 'Campus Principal',
      description: 'Full campus administrative operations',
      permissions: {
        'dashboard.view_admin': true,
        'tasks.view': true, 'tasks.create': true, 'tasks.edit': true, 'tasks.delete_draft': true, 'tasks.publish': true, 'tasks.assign': true, 'tasks.archive': true, 'tasks.send_reminder': true, 'tasks.export': true,
        'recurring_tasks.view': true, 'recurring_tasks.create': true, 'recurring_tasks.edit': true, 'recurring_tasks.pause': true, 'recurring_tasks.publish': true,
        'reports.task_wise.view': true, 'reports.task_wise.export': true, 'reports.teacher_wise.view': true, 'reports.teacher_wise.export': true, 'reports.detailed.view': true, 'reports.detailed.export': true,
        'groups.view': true, 'groups.create': true, 'groups.edit': true, 'groups.manage_members': true, 'groups.approve_requests': true, 'groups.delete_or_deactivate': true,
        'users.view': true, 'users.create': true, 'users.edit': true, 'users.deactivate': true, 'users.import': true, 'users.export': true,
        'masters.view': true, 'masters.create': true, 'masters.edit': true, 'masters.deactivate': true, 'masters.import': true, 'masters.export': true,
        'audit.view': true, 'audit.export': true,
        'imports.execute': true, 'exports.execute': true,
        'user_access.manage': true
      },
      is_system_role: true,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: coordinatorRoleId,
      name: 'Academic Coordinator',
      description: 'Task assignment, recurring schedules, and reporting',
      permissions: {
        'dashboard.view_admin': true,
        'tasks.view': true, 'tasks.create': true, 'tasks.edit': true, 'tasks.delete_draft': true, 'tasks.publish': true, 'tasks.assign': true, 'tasks.send_reminder': true, 'tasks.export': true,
        'recurring_tasks.view': true, 'recurring_tasks.create': true, 'recurring_tasks.edit': true, 'recurring_tasks.pause': true, 'recurring_tasks.publish': true,
        'reports.task_wise.view': true, 'reports.task_wise.export': true, 'reports.teacher_wise.view': true, 'reports.teacher_wise.export': true, 'reports.detailed.view': true, 'reports.detailed.export': true,
        'groups.view': true, 'groups.manage_members': true, 'groups.approve_requests': true,
        'users.view': true, 'masters.view': true
      },
      is_system_role: true,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: reportViewerRoleId,
      name: 'Report Viewer',
      description: 'Read-only access to institutional reports',
      permissions: {
        'dashboard.view_admin': true,
        'reports.task_wise.view': true, 'reports.task_wise.export': true, 'reports.teacher_wise.view': true, 'reports.teacher_wise.export': true, 'reports.detailed.view': true, 'reports.detailed.export': true,
        'tasks.view': true, 'users.view': true
      },
      is_system_role: true,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date()
    }
  ];

  // Master Values (Clean start)
  memoryStore.master_values = [];

  // Super Administrator User (Deepak Gupta)
  const superAdminId = 'a1111111-1111-1111-1111-111111111111';

  memoryStore.users = [
    {
      id: superAdminId,
      email: 'ask4deepak@gmail.com',
      password_hash: hash,
      user_type: 'SUPER_ADMIN',
      employee_code: 'EMP001',
      first_name: 'Deepak',
      last_name: 'Gupta',
      display_name: 'Deepak Gupta',
      phone: null,
      status: 'ACTIVE',
      class_teacher_status: false,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    }
  ];

  // User Access (Super Admin Role Assignment)
  memoryStore.user_access = [
    { id: '91111111-1111-1111-1111-111111111111', user_id: superAdminId, role_id: superAdminRoleId, campus_id: null, permission_overrides: null, created_at: new Date(), updated_at: new Date() }
  ];

  // Clean empty initial collections
  memoryStore.user_attributes = [];
  memoryStore.groups = [];
  memoryStore.group_memberships = [];
  memoryStore.tasks = [];
  memoryStore.assignments = [];
  memoryStore.submissions = [];

  console.log('[Database] In-memory store initialized with clean state and Super-Admin (ask4deepak@gmail.com).');
}

async function initDb() {
  if (databaseUrl) {
    try {
      pool = new Pool({
        connectionString: databaseUrl,
        ssl: isProduction ? { rejectUnauthorized: false } : false
      });
      // Test connectivity
      await pool.query('SELECT 1');
      console.log('[Database] Connected to PostgreSQL via DATABASE_URL');

      // Execute schema.sql
      const schemaSqlPath = path.join(__dirname, 'db', 'schema.sql');
      if (fs.existsSync(schemaSqlPath)) {
        const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
        await pool.query(schemaSql);
        console.log('[Database] Schema migrations applied successfully.');
      }

      // Run any incremental alter migrations
      await pool.query(`
        ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
        ALTER TABLE tasks ADD COLUMN IF NOT EXISTS allow_late_submissions BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE tasks ADD COLUMN IF NOT EXISTS allow_edit_submission BOOLEAN NOT NULL DEFAULT FALSE;
      `);

      // Execute seed.sql
      const seedSqlPath = path.join(__dirname, 'db', 'seed.sql');
      if (fs.existsSync(seedSqlPath)) {
        const seedSql = fs.readFileSync(seedSqlPath, 'utf8');
        await pool.query(seedSql);
        console.log('[Database] Seed data checked/applied.');
      }

      // Clean legacy demo records and provision Deepak Gupta as Super Admin
      const hash = await bcrypt.hash('Admin@123', 10);

      await pool.query(`
        DELETE FROM submissions;
        DELETE FROM assignments;
        DELETE FROM tasks;
        DELETE FROM group_memberships;
        DELETE FROM groups;
        DELETE FROM user_attributes;
        DELETE FROM user_access WHERE user_id IN (SELECT id FROM users WHERE email != 'ask4deepak@gmail.com');
        DELETE FROM users WHERE email != 'ask4deepak@gmail.com';
        DELETE FROM master_values;
      `);

      await pool.query(`
        INSERT INTO users (id, email, password_hash, user_type, employee_code, first_name, last_name, display_name, status)
        VALUES ('a1111111-1111-1111-1111-111111111111', 'ask4deepak@gmail.com', $1, 'SUPER_ADMIN', 'EMP001', 'Deepak', 'Gupta', 'Deepak Gupta', 'ACTIVE')
        ON CONFLICT (email) DO UPDATE SET password_hash = $1, status = 'ACTIVE', display_name = 'Deepak Gupta', user_type = 'SUPER_ADMIN'
      `, [hash]);

      await pool.query(`
        INSERT INTO user_access (id, user_id, role_id, campus_id)
        VALUES ('91111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL)
        ON CONFLICT (id) DO NOTHING
      `);

      console.log('[Database] Seeded clean state with Super-Admin ask4deepak@gmail.com.');
      return;
    } catch (err) {
      console.warn('[Database] PostgreSQL connection failed (' + err.message + '). Activating in-memory fallback store for local development.');
      useMemoryFallback = true;
      await seedMemoryStore();
    }
  } else {
    console.log('[Database] No DATABASE_URL specified. Initializing in-memory fallback store.');
    useMemoryFallback = true;
    await seedMemoryStore();
  }
}

/**
 * Execute SQL query
 */
async function query(text, params = []) {
  if (!useMemoryFallback && pool) {
    return pool.query(text, params);
  }

  // Memory fallback query engine
  return executeMemoryQuery(text, params);
}

/**
 * Transaction helper
 */
async function transaction(callback) {
  if (!useMemoryFallback && pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // For in-memory store, operations are atomic within single event loop tick
  const mockClient = {
    query: (sql, params) => executeMemoryQuery(sql, params)
  };
  return callback(mockClient);
}

/**
 * Execute simulated SQL queries against memoryStore
 */
function executeMemoryQuery(text, params = []) {
  const sql = text.trim();
  const lowerSql = sql.toLowerCase();

  // Handle simple selects, inserts, updates, deletes across the 12 tables
  // 1. SELECT 1
  if (sql === 'SELECT 1') {
    return { rows: [{ '?column?': 1 }], rowCount: 1 };
  }

  // Table queries
  for (const table of Object.keys(memoryStore)) {
    if (lowerSql.startsWith('select') && lowerSql.includes(`from ${table}`)) {
      return handleMemorySelect(table, sql, params);
    }
    if (lowerSql.startsWith('insert into') && lowerSql.includes(`into ${table}`)) {
      return handleMemoryInsert(table, sql, params);
    }
    if (lowerSql.startsWith('update') && lowerSql.includes(`update ${table}`)) {
      return handleMemoryUpdate(table, sql, params);
    }
    if (lowerSql.startsWith('delete from') && lowerSql.includes(`from ${table}`)) {
      return handleMemoryDelete(table, sql, params);
    }
  }

  // Default fallback empty result
  return { rows: [], rowCount: 0 };
}

function handleMemorySelect(table, sql, params) {
  let list = [...memoryStore[table]];
  const lower = sql.toLowerCase();

  // Basic parameterized filter mapping
  // e.g. "where email = $1"
  if (lower.includes('where')) {
    const whereClause = sql.substring(lower.indexOf('where') + 5);
    
    // Check for user_id = $1
    if (whereClause.includes('user_id = $') && params.length > 0) {
      const idx = extractParamIndex(whereClause, 'user_id');
      const val = params[idx - 1];
      if (val !== undefined) list = list.filter(r => r.user_id === val);
    }
    // Check for id = $1
    if (whereClause.includes('id = $') || whereClause.includes('users.id = $') || whereClause.includes('tasks.id = $') || whereClause.includes('campuses.id = $') || whereClause.includes('groups.id = $')) {
      const idx = extractParamIndex(whereClause, 'id');
      const val = params[idx - 1];
      if (val !== undefined) list = list.filter(r => r.id === val);
    }
    // Check for email = $1
    if (whereClause.includes('email = $')) {
      const idx = extractParamIndex(whereClause, 'email');
      const val = params[idx - 1];
      if (val !== undefined) list = list.filter(r => r.email && r.email.toLowerCase() === val.toLowerCase());
    }
    // Check for campus_id = $1
    if (whereClause.includes('campus_id = $')) {
      const idx = extractParamIndex(whereClause, 'campus_id');
      const val = params[idx - 1];
      if (val !== undefined) list = list.filter(r => r.campus_id === val);
    }
    // Check for task_id = $1
    if (whereClause.includes('task_id = $')) {
      const idx = extractParamIndex(whereClause, 'task_id');
      const val = params[idx - 1];
      if (val !== undefined) list = list.filter(r => r.task_id === val);
    }
    // Check for group_id = $1
    if (whereClause.includes('group_id = $')) {
      const idx = extractParamIndex(whereClause, 'group_id');
      const val = params[idx - 1];
      if (val !== undefined) list = list.filter(r => r.group_id === val);
    }
    // Check for status = $1
    if (whereClause.includes('status = $')) {
      const idx = extractParamIndex(whereClause, 'status');
      const val = params[idx - 1];
      if (val !== undefined) list = list.filter(r => r.status === val);
    }
    // Check for master_type = $1
    if (whereClause.includes('master_type = $')) {
      const idx = extractParamIndex(whereClause, 'master_type');
      const val = params[idx - 1];
      if (val !== undefined) list = list.filter(r => r.master_type === val);
    }
  }

  // Count(*) support
  if (lower.includes('count(*)')) {
    return { rows: [{ count: list.length.toString() }], rowCount: 1 };
  }

  return { rows: list, rowCount: list.length };
}

function extractParamIndex(clause, field) {
  const match = clause.match(new RegExp(`${field}\\s*=\\s*\\$(\\d+)`, 'i'));
  return match ? parseInt(match[1], 10) : 1;
}

function handleMemoryInsert(table, sql, params) {
  // Construct new object
  const newRow = { id: uuidv4(), created_at: new Date(), updated_at: new Date() };

  // Parse columns from INSERT INTO table (col1, col2, ...) VALUES ($1, $2, ...)
  const colMatch = sql.match(/\((.*?)\)\s*values/i);
  if (colMatch && params.length > 0) {
    const cols = colMatch[1].split(',').map(c => c.trim().replace(/"/g, ''));
    cols.forEach((col, i) => {
      if (i < params.length) {
        newRow[col] = params[i];
      }
    });
  }

  // Check unique constraints if applicable
  if (table === 'users' && newRow.email) {
    const existing = memoryStore.users.find(u => u.email.toLowerCase() === newRow.email.toLowerCase());
    if (existing) {
      if (sql.toLowerCase().includes('on conflict')) return { rows: [existing], rowCount: 0 };
      const err = new Error(`duplicate key value violates unique constraint "users_email_key"`);
      err.code = '23505';
      throw err;
    }
  }

  if (table === 'assignments' && newRow.task_id && newRow.user_id) {
    const existing = memoryStore.assignments.find(a => a.task_id === newRow.task_id && a.user_id === newRow.user_id);
    if (existing) {
      if (sql.toLowerCase().includes('on conflict')) return { rows: [existing], rowCount: 0 };
      const err = new Error(`duplicate key value violates unique constraint "uq_task_user"`);
      err.code = '23505';
      throw err;
    }
  }

  if (table === 'group_memberships' && newRow.group_id && newRow.user_id) {
    const existing = memoryStore.group_memberships.find(m => m.group_id === newRow.group_id && m.user_id === newRow.user_id);
    if (existing) {
      if (sql.toLowerCase().includes('on conflict')) return { rows: [existing], rowCount: 0 };
      const err = new Error(`duplicate key value violates unique constraint "uq_group_user"`);
      err.code = '23505';
      throw err;
    }
  }

  memoryStore[table].push(newRow);
  return { rows: [newRow], rowCount: 1 };
}

function handleMemoryUpdate(table, sql, params) {
  let updatedCount = 0;
  const lower = sql.toLowerCase();
  
  if (lower.includes('where id = $') || lower.includes('where user_id = $') || lower.includes('where assignment_id = $')) {
    const targetId = params[params.length - 1];
    const index = memoryStore[table].findIndex(r => r.id === targetId || r.user_id === targetId || r.assignment_id === targetId);
    if (index !== -1) {
      memoryStore[table][index].updated_at = new Date();
      updatedCount++;
    }
  }

  return { rows: [], rowCount: updatedCount };
}

function handleMemoryDelete(table, sql, params) {
  let deletedCount = 0;
  if (params.length > 0) {
    const targetId = params[0];
    const initialLen = memoryStore[table].length;
    memoryStore[table] = memoryStore[table].filter(r => r.id !== targetId && r.user_id !== targetId && r.group_id !== targetId);
    deletedCount = initialLen - memoryStore[table].length;
  }
  return { rows: [], rowCount: deletedCount };
}

module.exports = {
  initDb,
  query,
  transaction,
  getPool: () => pool,
  getMemoryStore: () => memoryStore,
  isMemoryFallback: () => useMemoryFallback
};
