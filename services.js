/**
 * Services Module (services.js)
 * Implements Audience Resolution, Task Publication, Recurring Scheduler, Transactional Emailing, Audit Logging, and Import/Export.
 */
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const auth = require('./auth');

// ============================================================================
// 1. AUDIENCE RESOLUTION ENGINE
// ============================================================================

/**
 * Resolve eligible teachers for a task given campus list and audience rules
 * Strict AND across categories, OR within category selections
 */
async function resolveTaskAudience(campusIds, audienceRules = {}, recipientExclusions = []) {
  if (!campusIds || campusIds.length === 0) {
    return [];
  }

  const {
    departments = [],
    designations = [],
    subjects = [],
    categories = [],
    groups = [],
    class_teacher_status = null,
    specific_users = [],
    operator = 'AND'
  } = (audienceRules || {});

  const exclusionsSet = new Set(recipientExclusions || []);

  let allTeachers = [];
  let userAttributes = [];
  let groupMemberships = [];

  const userCampusMap = new Map();
  const userDeptMap = new Map();
  const userDesigMap = new Map();
  const userSubjMap = new Map();
  const userCatMap = new Map();
  const userGroupMap = new Map();

  if (db.isMemoryFallback()) {
    const store = db.getMemoryStore();
    const campusTeacherIds = store.user_attributes.filter(a => campusIds.includes(a.campus_id)).map(a => a.user_id);
    const accessTeacherIds = (store.user_access || []).filter(a => campusIds.includes(a.campus_id)).map(a => a.user_id);
    
    allTeachers = store.users.filter(u => u.status === 'ACTIVE' && (
      (u.campus_id && campusIds.includes(u.campus_id)) ||
      campusTeacherIds.includes(u.id) ||
      accessTeacherIds.includes(u.id)
    ));
    userAttributes = store.user_attributes || [];
    groupMemberships = (store.group_memberships || []).filter(m => m.status === 'APPROVED');

    for (const u of allTeachers) {
      if (!userCampusMap.has(u.id)) userCampusMap.set(u.id, new Set());
      if (u.campus_id) userCampusMap.get(u.id).add(u.campus_id);
      (store.user_access || []).filter(a => a.user_id === u.id).forEach(a => userCampusMap.get(u.id).add(a.campus_id));
      (store.user_attributes || []).filter(a => a.user_id === u.id).forEach(a => userCampusMap.get(u.id).add(a.campus_id));
    }
  } else {
    const teachersRes = await db.query(`
      SELECT DISTINCT u.id, u.email, u.employee_code, u.first_name, u.last_name, u.display_name, u.class_teacher_status, u.status,
             COALESCE(u.campus_id, ua.campus_id, acc.campus_id) as primary_campus_id,
             COALESCE(c.name, 'Default Campus') as campus_name
      FROM users u
      LEFT JOIN user_attributes ua ON u.id = ua.user_id
      LEFT JOIN user_access acc ON u.id = acc.user_id
      LEFT JOIN campuses c ON c.id = COALESCE(u.campus_id, ua.campus_id, acc.campus_id)
      WHERE u.status = 'ACTIVE' 
        AND (u.campus_id = ANY($1) OR ua.campus_id = ANY($1) OR acc.campus_id = ANY($1))
      ORDER BY u.display_name ASC
    `, [campusIds]);
    allTeachers = teachersRes.rows;

    for (const t of allTeachers) {
      if (!userCampusMap.has(t.id)) userCampusMap.set(t.id, new Set());
      if (t.primary_campus_id) userCampusMap.get(t.id).add(t.primary_campus_id);
    }

    const attrsRes = await db.query(`
      SELECT ua.user_id, ua.campus_id, ua.master_value_id, mv.master_type, mv.name as master_name
      FROM user_attributes ua
      JOIN master_values mv ON ua.master_value_id = mv.id
      WHERE ua.campus_id = ANY($1)
    `, [campusIds]);
    userAttributes = attrsRes.rows;

    const gmRes = await db.query(`
      SELECT gm.group_id, gm.user_id
      FROM group_memberships gm
      JOIN groups g ON gm.group_id = g.id
      WHERE gm.status = 'APPROVED' AND g.campus_id = ANY($1)
    `, [campusIds]);
    groupMemberships = gmRes.rows;
  }

  // Pre-index user attributes and groups for fast lookup
  for (const attr of userAttributes) {
    if (!campusIds.includes(attr.campus_id)) continue;

    if (!userCampusMap.has(attr.user_id)) userCampusMap.set(attr.user_id, new Set());
    userCampusMap.get(attr.user_id).add(attr.campus_id);

    if (db.isMemoryFallback()) {
      const mv = db.getMemoryStore().master_values.find(m => m.id === attr.master_value_id);
      if (mv) {
        if (mv.master_type === 'DEPARTMENT') {
          if (!userDeptMap.has(attr.user_id)) userDeptMap.set(attr.user_id, new Set());
          userDeptMap.get(attr.user_id).add(mv.id);
        } else if (mv.master_type === 'DESIGNATION') {
          if (!userDesigMap.has(attr.user_id)) userDesigMap.set(attr.user_id, new Set());
          userDesigMap.get(attr.user_id).add(mv.id);
        } else if (mv.master_type === 'SUBJECT') {
          if (!userSubjMap.has(attr.user_id)) userSubjMap.set(attr.user_id, new Set());
          userSubjMap.get(attr.user_id).add(mv.id);
        } else if (mv.master_type === 'CATEGORY') {
          if (!userCatMap.has(attr.user_id)) userCatMap.set(attr.user_id, new Set());
          userCatMap.get(attr.user_id).add(mv.id);
        }
      }
    } else {
      if (attr.master_type === 'DEPARTMENT') {
        if (!userDeptMap.has(attr.user_id)) userDeptMap.set(attr.user_id, new Set());
        userDeptMap.get(attr.user_id).add(attr.master_value_id);
      } else if (attr.master_type === 'DESIGNATION') {
        if (!userDesigMap.has(attr.user_id)) userDesigMap.set(attr.user_id, new Set());
        userDesigMap.get(attr.user_id).add(attr.master_value_id);
      } else if (attr.master_type === 'SUBJECT') {
        if (!userSubjMap.has(attr.user_id)) userSubjMap.set(attr.user_id, new Set());
        userSubjMap.get(attr.user_id).add(attr.master_value_id);
      } else if (attr.master_type === 'CATEGORY') {
        if (!userCatMap.has(attr.user_id)) userCatMap.set(attr.user_id, new Set());
        userCatMap.get(attr.user_id).add(attr.master_value_id);
      }
    }
  }

  for (const gm of groupMemberships) {
    if (!userGroupMap.has(gm.user_id)) userGroupMap.set(gm.user_id, new Set());
    userGroupMap.get(gm.user_id).add(gm.group_id);
  }

  const eligibleTeachers = [];

  for (const teacher of allTeachers) {
    const userId = teacher.id;

    // Must belong to at least one selected campus
    const userCampuses = userCampusMap.get(userId);
    if (!userCampuses || ![...userCampuses].some(c => campusIds.includes(c))) {
      continue;
    }

    // Specific user inclusion check
    const isExplicitlySelected = specific_users && specific_users.includes(userId);

    // Filter Category checks (AND or OR across categories, OR within each category)
    const activeFilters = [];

    // 1. Department
    if (departments && departments.length > 0) {
      const userDepts = userDeptMap.get(userId) || new Set();
      activeFilters.push(departments.some(d => userDepts.has(d)));
    }

    // 2. Designation
    if (designations && designations.length > 0) {
      const userDesigs = userDesigMap.get(userId) || new Set();
      activeFilters.push(designations.some(d => userDesigs.has(d)));
    }

    // 3. Subject
    if (subjects && subjects.length > 0) {
      const userSubs = userSubjMap.get(userId) || new Set();
      activeFilters.push(subjects.some(s => userSubs.has(s)));
    }

    // 4. Category
    if (categories && categories.length > 0) {
      const userCats = userCatMap.get(userId) || new Set();
      activeFilters.push(categories.some(c => userCats.has(c)));
    }

    // 5. Group
    if (groups && groups.length > 0) {
      const userGrps = userGroupMap.get(userId) || new Set();
      activeFilters.push(groups.some(g => userGrps.has(g)));
    }

    // 6. Class Teacher Status
    if (class_teacher_status !== null && class_teacher_status !== undefined && class_teacher_status !== '') {
      const reqBool = class_teacher_status === true || class_teacher_status === 'true' || class_teacher_status === 'yes';
      activeFilters.push(Boolean(teacher.class_teacher_status) === reqBool);
    }

    let matchesFilters = true;
    if (activeFilters.length > 0) {
      if (operator === 'OR') {
        matchesFilters = activeFilters.some(Boolean);
      } else {
        matchesFilters = activeFilters.every(Boolean);
      }
    }

    const isEligible = matchesFilters || isExplicitlySelected;

    if (isEligible) {
      const isExcluded = exclusionsSet.has(userId);
      const primaryCampusId = teacher.primary_campus_id || [...userCampuses][0];

      let campusName = teacher.campus_name || 'Main Campus';
      if (db.isMemoryFallback()) {
        const c = db.getMemoryStore().campuses.find(cp => cp.id === primaryCampusId);
        if (c) campusName = c.name;
      }

      eligibleTeachers.push({
        id: teacher.id,
        email: teacher.email,
        employee_code: teacher.employee_code,
        first_name: teacher.first_name,
        last_name: teacher.last_name,
        display_name: teacher.display_name,
        campus_id: primaryCampusId,
        campus_name: campusName,
        class_teacher_status: teacher.class_teacher_status,
        is_excluded: isExcluded
      });
    }
  }

  // Always sort alphabetically by display_name
  eligibleTeachers.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
  return eligibleTeachers;
}

// ============================================================================
// 2. TASK PUBLICATION & TRANSACTION ENGINE
// ============================================================================

/**
 * Publish a task, freeze assignments, and trigger email alerts
 */
async function publishTask(taskId, publishingUserId, reqIp = null) {
  // Fetch task
  let task;
  if (db.isMemoryFallback()) {
    task = db.getMemoryStore().tasks.find(t => t.id === taskId);
  } else {
    const res = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    task = res.rows[0];
  }

  if (!task) throw new Error('Task not found');
  if (task.status === 'PUBLISHED') throw new Error('Task is already published');

  const campusIds = typeof task.campus_ids === 'string' ? JSON.parse(task.campus_ids) : task.campus_ids;
  const audienceRules = typeof task.audience_rules === 'string' ? JSON.parse(task.audience_rules) : task.audience_rules;
  const recipientExclusions = typeof task.recipient_exclusions === 'string' ? JSON.parse(task.recipient_exclusions) : task.recipient_exclusions;

  // Server-side audience resolution
  const resolvedTeachers = await resolveTaskAudience(campusIds, audienceRules, recipientExclusions);
  const activeRecipients = resolvedTeachers.filter(t => !t.is_excluded);

  if (activeRecipients.length === 0) {
    throw new Error('Task cannot be published because no eligible recipients match the audience rules.');
  }

  const now = new Date();
  const deadline = task.deadline_at ? new Date(task.deadline_at) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Execute in a transaction
  await db.transaction(async (client) => {
    // 1. Update task status
    if (db.isMemoryFallback()) {
      task.status = 'PUBLISHED';
      task.published_at = now;
      task.published_by = publishingUserId;
      task.updated_at = now;
    } else {
      await client.query(`
        UPDATE tasks 
        SET status = 'PUBLISHED', published_at = $1, published_by = $2, updated_at = $1 
        WHERE id = $3
      `, [now, publishingUserId, taskId]);
    }

    // 2. Insert assignments (frozen snapshot)
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
            assigned_by: publishingUserId,
            due_at: deadline,
            status: 'NOT_STARTED',
            excluded_flag: false,
            created_at: now,
            updated_at: now
          });
        }
      } else {
        await client.query(`
          INSERT INTO assignments (id, task_id, user_id, campus_id, assigned_at, assigned_by, due_at, status, excluded_flag)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'NOT_STARTED', FALSE)
          ON CONFLICT (task_id, user_id) DO NOTHING
        `, [assignmentId, taskId, recipient.id, recipient.campus_id, now, publishingUserId, deadline]);
      }
    }
  });

  // Audit log
  await logAudit({
    userId: publishingUserId,
    campusId: campusIds[0] || null,
    action: 'TASK_PUBLISHED',
    entityType: 'TASK',
    entityId: taskId,
    description: `Task "${task.title}" published with ${activeRecipients.length} recipients assigned.`,
    metadata: { recipientCount: activeRecipients.length },
    ipAddress: reqIp
  });

  // Trigger notification emails asynchronously
  setImmediate(async () => {
    for (const recipient of activeRecipients) {
      try {
        await sendTaskAssignedEmail(recipient, task, deadline);
      } catch (e) {
        console.warn(`[Email Notification Failed] for ${recipient.email}: ${e.message}`);
      }
    }
  });

  return { success: true, recipientCount: activeRecipients.length };
}

// ============================================================================
// 3. RECURRING TASK SCHEDULER ENGINE
// ============================================================================

/**
 * Calculate next generation timestamp from recurrence config
 * Supports DAILY, WEEKLY (with weekdays array), BIWEEKLY, MONTHLY (with day of month or last day),
 * QUARTERLY, YEARLY, and CUSTOM_DAYS.
 * Also checks end conditions: 'NEVER', 'ON_DATE', 'AFTER_OCCURRENCES'.
 */
function calculateNextOccurrence(config = {}, fromDate = new Date()) {
  const {
    frequency = 'MONTHLY',
    interval = 1,
    weekdays = [],
    dayOfMonth = 1,
    monthOfYear = 1,
    end_type = 'NEVER',
    end_date = null,
    max_occurrences = null,
    occurrences_generated = 0
  } = config;

  // Check occurrence cap
  if (end_type === 'AFTER_OCCURRENCES' && max_occurrences && occurrences_generated >= Number(max_occurrences)) {
    return null;
  }

  const next = new Date(fromDate.getTime());
  const stepInterval = Math.max(1, Number(interval) || 1);

  if (frequency === 'DAILY') {
    next.setDate(next.getDate() + stepInterval);
  } else if (frequency === 'WEEKLY' || frequency === 'BIWEEKLY') {
    const weekStep = frequency === 'BIWEEKLY' ? 2 : stepInterval;
    if (Array.isArray(weekdays) && weekdays.length > 0) {
      // Find the next upcoming weekday from the selected list
      const sortedDays = weekdays.map(Number).sort((a, b) => a - b);
      let found = false;
      const curDay = fromDate.getDay();
      for (const d of sortedDays) {
        if (d > curDay) {
          next.setDate(fromDate.getDate() + (d - curDay));
          found = true;
          break;
        }
      }
      if (!found) {
        // Wrap to the first weekday of next cycle
        const firstDay = sortedDays[0];
        const daysToAdd = (7 * weekStep) - curDay + firstDay;
        next.setDate(fromDate.getDate() + daysToAdd);
      }
    } else {
      next.setDate(next.getDate() + 7 * weekStep);
    }
  } else if (frequency === 'MONTHLY') {
    next.setMonth(next.getMonth() + stepInterval);
    if (dayOfMonth === 'LAST') {
      // Set to last day of next month
      const y = next.getFullYear();
      const m = next.getMonth();
      const lastDay = new Date(y, m + 1, 0).getDate();
      next.setDate(lastDay);
    } else {
      const targetDay = Math.min(Math.max(1, Number(dayOfMonth) || 1), 28);
      next.setDate(targetDay);
    }
  } else if (frequency === 'QUARTERLY') {
    next.setMonth(next.getMonth() + 3);
    const targetDay = Math.min(Math.max(1, Number(dayOfMonth) || 1), 28);
    next.setDate(targetDay);
  } else if (frequency === 'YEARLY') {
    next.setFullYear(next.getFullYear() + stepInterval);
    next.setMonth((Number(monthOfYear) || 1) - 1);
    const targetDay = Math.min(Math.max(1, Number(dayOfMonth) || 1), 28);
    next.setDate(targetDay);
  } else if (frequency === 'CUSTOM_DAYS') {
    next.setDate(next.getDate() + stepInterval);
  } else {
    // Default fallback monthly
    next.setMonth(next.getMonth() + 1);
  }

  // Check end date condition
  if (end_type === 'ON_DATE' && end_date) {
    const endDateObj = new Date(end_date);
    if (next > endDateObj) {
      return null;
    }
  }

  return next;
}

/**
 * Check and generate recurring task instances idempotently
 */
async function processRecurringTasks() {
  const now = new Date();
  let templates = [];

  if (db.isMemoryFallback()) {
    templates = db.getMemoryStore().tasks.filter(t => 
      t.task_type === 'RECURRING_TEMPLATE' && 
      t.recurrence_status === 'ACTIVE' && 
      t.next_generation_at && 
      new Date(t.next_generation_at) <= now
    );
  } else {
    const res = await db.query(`
      SELECT * FROM tasks
      WHERE task_type = 'RECURRING_TEMPLATE' 
        AND recurrence_status = 'ACTIVE' 
        AND next_generation_at <= $1
    `, [now]);
    templates = res.rows;
  }

  for (const tmpl of templates) {
    try {
      const config = typeof tmpl.recurrence_config === 'string' ? JSON.parse(tmpl.recurrence_config) : (tmpl.recurrence_config || {});
      const offsetDays = config.deadline_offset_days || 7;
      const instanceDeadline = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);

      const periodLabel = now.toLocaleString('default', { month: 'short', year: 'numeric' });
      const instanceTitle = `${tmpl.title} - ${periodLabel}`;

      const campusIds = typeof tmpl.campus_ids === 'string' ? JSON.parse(tmpl.campus_ids) : tmpl.campus_ids;
      const questions = typeof tmpl.questions === 'string' ? JSON.parse(tmpl.questions) : tmpl.questions;
      const audienceRules = typeof tmpl.audience_rules === 'string' ? JSON.parse(tmpl.audience_rules) : tmpl.audience_rules;

      const occurrencesGen = (config.occurrences_generated || 0) + 1;
      config.occurrences_generated = occurrencesGen;
      const nextGenDate = calculateNextOccurrence(config, new Date(tmpl.next_generation_at || now));
      const nextRecurrenceStatus = nextGenDate ? 'ACTIVE' : 'COMPLETED';

      if (db.isMemoryFallback()) {
        const store = db.getMemoryStore();
        store.tasks.push({
          id: instanceId,
          task_type: 'RECURRING_INSTANCE',
          parent_template_id: tmpl.id,
          title: instanceTitle,
          description: tmpl.description,
          campus_ids: campusIds,
          questions: questions,
          audience_rules: audienceRules,
          recipient_exclusions: [],
          status: 'DRAFT',
          open_at: now,
          deadline_at: instanceDeadline,
          published_at: null,
          published_by: null,
          created_by: tmpl.created_by,
          created_at: now,
          updated_at: now
        });
        tmpl.recurrence_config = config;
        tmpl.next_generation_at = nextGenDate;
        tmpl.recurrence_status = nextRecurrenceStatus;
        tmpl.updated_at = now;
      } else {
        await db.transaction(async (client) => {
          await client.query(`
            INSERT INTO tasks (id, task_type, parent_template_id, title, description, campus_ids, questions, audience_rules, recipient_exclusions, status, open_at, deadline_at, created_by)
            VALUES ($1, 'RECURRING_INSTANCE', $2, $3, $4, $5, $6, $7, '[]'::jsonb, 'DRAFT', $8, $9, $10)
          `, [instanceId, tmpl.id, instanceTitle, tmpl.description, JSON.stringify(campusIds), JSON.stringify(questions), JSON.stringify(audienceRules), now, instanceDeadline, tmpl.created_by]);

          await client.query(`
            UPDATE tasks SET recurrence_config = $1, next_generation_at = $2, recurrence_status = $3, updated_at = $4 WHERE id = $5
          `, [JSON.stringify(config), nextGenDate, nextRecurrenceStatus, now, tmpl.id]);
        });
      }

      // Automatically publish the generated instance
      await publishTask(instanceId, tmpl.created_by);
      console.log(`[Recurring Scheduler] Successfully generated and published instance: ${instanceTitle}`);
    } catch (err) {
      console.error(`[Recurring Scheduler Error] for template ${tmpl.id}:`, err.message);
    }
  }
}

// ============================================================================
// 4. TRANSACTIONAL EMAIL ADAPTER
// ============================================================================

let emailTransporter = null;
let lastTransporterConfigKey = null;

function resetEmailTransporter() {
  emailTransporter = null;
  lastTransporterConfigKey = null;
}

function getEmailTransporter() {
  const smtpHost = (process.env.SMTP_HOST || '').trim();
  let smtpUser = (process.env.SMTP_USER || '').trim();
  let smtpPass = (process.env.SMTP_PASS || '').trim();

  // Strip surrounding quotes if present in .env
  if ((smtpUser.startsWith('"') && smtpUser.endsWith('"')) || (smtpUser.startsWith("'") && smtpUser.endsWith("'"))) {
    smtpUser = smtpUser.substring(1, smtpUser.length - 1).trim();
  }
  if ((smtpPass.startsWith('"') && smtpPass.endsWith('"')) || (smtpPass.startsWith("'") && smtpPass.endsWith("'"))) {
    smtpPass = smtpPass.substring(1, smtpPass.length - 1).trim();
  }

  // Strip spaces in Google App Passwords (e.g. "abcd efgh ijkl mnop" -> "abcdefghijklmnop")
  smtpPass = smtpPass.replace(/\s+/g, '');

  const rawPort = process.env.SMTP_PORT;
  const smtpPort = parseInt(rawPort || '587', 10);

  let smtpSecure;
  if (process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== '') {
    smtpSecure = process.env.SMTP_SECURE === 'true';
  } else {
    smtpSecure = (smtpPort === 465);
  }

  // Port 587 uses STARTTLS (secure: false). If someone passed secure=true on 587, fix it to prevent TLS socket hang
  if (smtpPort === 587 && smtpSecure === true) {
    smtpSecure = false;
  }
  // Port 465 requires SSL (secure: true).
  if (smtpPort === 465 && smtpSecure === false) {
    smtpSecure = true;
  }

  const isGmailService = (process.env.SMTP_SERVICE || '').toLowerCase() === 'gmail';
  const currentConfigKey = `${smtpHost}:${smtpUser}:${smtpPass}:${smtpPort}:${smtpSecure}:${isGmailService}`;

  if (!emailTransporter || lastTransporterConfigKey !== currentConfigKey) {
    if ((smtpHost || isGmailService) && smtpUser && smtpPass) {
      let transportOptions;

      if (isGmailService) {
        transportOptions = {
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: smtpPass
          },
          tls: {
            rejectUnauthorized: false
          },
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 20000
        };
      } else {
        transportOptions = {
          host: smtpHost || 'smtp.gmail.com',
          port: smtpPort,
          secure: smtpSecure,
          auth: {
            user: smtpUser,
            pass: smtpPass
          },
          tls: {
            rejectUnauthorized: false
          },
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 20000
        };
      }

      emailTransporter = nodemailer.createTransport(transportOptions);
      emailTransporter.isMock = false;
      lastTransporterConfigKey = currentConfigKey;
      console.log(`[Email Service] Configured SMTP Transport for ${smtpUser} via ${transportOptions.host || 'gmail-service'}:${smtpPort || 465}`);
    } else {
      // Mock transporter for development/unconfigured states
      emailTransporter = {
        sendMail: async (options) => {
          console.log(`[Email Mock Dispatch] TO: ${options.to} | SUBJECT: ${options.subject}`);
          return { messageId: `mock-${Date.now()}` };
        },
        isMock: true
      };
      lastTransporterConfigKey = currentConfigKey;
      console.log(`[Email Service] SMTP credentials not set or incomplete; using local console mock.`);
    }
  }
  return emailTransporter;
}

async function dispatchMail(mailOptions) {
  const transporter = getEmailTransporter();
  if (transporter.isMock) {
    const res = await transporter.sendMail(mailOptions);
    return { ...res, isMock: true };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    return { ...info, isMock: false };
  } catch (err) {
    const smtpHost = (process.env.SMTP_HOST || '').trim();
    let smtpUser = (process.env.SMTP_USER || '').trim();
    let smtpPass = (process.env.SMTP_PASS || '').trim();

    if ((smtpPass.startsWith('"') && smtpPass.endsWith('"')) || (smtpPass.startsWith("'") && smtpPass.endsWith("'"))) {
      smtpPass = smtpPass.substring(1, smtpPass.length - 1).trim();
    }
    smtpPass = smtpPass.replace(/\s+/g, '');

    const errStr = (err.message || '') + ' ' + (err.code || '');
    const isTimeout = err.code === 'ETIMEDOUT' || err.code === 'ESOCKET' || errStr.toLowerCase().includes('timeout');
    const isGmail = smtpHost.includes('gmail') || smtpUser.endsWith('@gmail.com') || smtpHost === 'smtp.gmail.com';

    if (isTimeout && isGmail) {
      console.warn(`[Email Service] Primary transport timed out (${err.message}). Attempting fallback to STARTTLS smtp.gmail.com:587...`);
      try {
        const fallbackTransporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 587,
          secure: false, // STARTTLS
          auth: {
            user: smtpUser,
            pass: smtpPass
          },
          tls: {
            rejectUnauthorized: false
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 12000
        });
        const info = await fallbackTransporter.sendMail(mailOptions);
        return { ...info, isMock: false };
      } catch (fallbackErr) {
        console.error(`[Email Service] Fallback STARTTLS transport failed:`, fallbackErr.message);
        throw fallbackErr;
      }
    }
    throw err;
  }
}

async function sendTestEmail(toEmail) {
  const smtpHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  let smtpUser = (process.env.SMTP_USER || '').trim();
  let smtpPass = (process.env.SMTP_PASS || '').trim();

  if ((smtpUser.startsWith('"') && smtpUser.endsWith('"')) || (smtpUser.startsWith("'") && smtpUser.endsWith("'"))) {
    smtpUser = smtpUser.substring(1, smtpUser.length - 1).trim();
  }
  if ((smtpPass.startsWith('"') && smtpPass.endsWith('"')) || (smtpPass.startsWith("'") && smtpPass.endsWith("'"))) {
    smtpPass = smtpPass.substring(1, smtpPass.length - 1).trim();
  }
  smtpPass = smtpPass.replace(/\s+/g, '');

  if (!smtpUser || !smtpPass) {
    return { isMock: true };
  }

  const from = process.env.EMAIL_FROM || smtpUser || 'tasks@institution.edu';
  const timestamp = new Date().toLocaleString();

  const strategies = [
    { name: 'smtp.gmail.com:587 (STARTTLS)', options: { host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true, auth: { user: smtpUser, pass: smtpPass }, tls: { rejectUnauthorized: false }, connectionTimeout: 3500, greetingTimeout: 3500, socketTimeout: 5000 } },
    { name: 'Gmail Native Service', options: { service: 'gmail', auth: { user: smtpUser, pass: smtpPass }, tls: { rejectUnauthorized: false }, connectionTimeout: 3500, greetingTimeout: 3500, socketTimeout: 5000 } },
    { name: 'smtp.gmail.com:465 (SSL)', options: { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: smtpUser, pass: smtpPass }, tls: { rejectUnauthorized: false }, connectionTimeout: 3500, greetingTimeout: 3500, socketTimeout: 5000 } },
    { name: 'smtp-relay.gmail.com:587', options: { host: 'smtp-relay.gmail.com', port: 587, secure: false, auth: { user: smtpUser, pass: smtpPass }, tls: { rejectUnauthorized: false }, connectionTimeout: 3500, greetingTimeout: 3500, socketTimeout: 5000 } }
  ];

  let lastErr = null;
  for (const strat of strategies) {
    try {
      console.log(`[SMTP Test Diagnostic] Attempting ${strat.name} for ${smtpUser}...`);
      const testTransporter = nodemailer.createTransport(strat.options);
      const info = await testTransporter.sendMail({
        from,
        to: toEmail,
        subject: 'TaskTrack Pro: Gmail / Workspace SMTP Configuration Verified',
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #22c55e; border-radius: 8px;">
            <h2 style="color: #16a34a; margin-top: 0;">🎉 SMTP Email Configuration Verified!</h2>
            <p>Congratulations! Your Google Workspace SMTP credentials have been verified via <strong>${strat.name}</strong> and are working successfully.</p>
            <div style="background: #f0fdf4; padding: 15px; border-left: 4px solid #16a34a; margin: 15px 0; border-radius: 4px;">
              <p style="margin: 0 0 5px 0;"><strong>Sender (FROM):</strong> ${from}</p>
              <p style="margin: 0 0 5px 0;"><strong>Recipient (TO):</strong> ${toEmail}</p>
              <p style="margin: 0;"><strong>Verified At:</strong> ${timestamp}</p>
            </div>
            <p>Your institutional system is now fully configured to deliver instant task assignments, submission reminders, and faculty group notifications.</p>
          </div>
        `
      });

      emailTransporter = testTransporter;
      emailTransporter.isMock = false;
      lastTransporterConfigKey = `verified-${strat.name}`;
      console.log(`[SMTP Test Diagnostic] SUCCESS via ${strat.name}!`);
      return { ...info, strategy: strat.name, isMock: false };
    } catch (err) {
      console.warn(`[SMTP Test Diagnostic] ${strat.name} failed:`, err.message);
      lastErr = err;
    }
  }

  throw lastErr || new Error('All Google SMTP connection strategies failed or timed out.');
}

async function sendTaskAssignedEmail(teacher, task, deadline) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'tasks@institution.edu';
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  const deadlineStr = new Date(deadline).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return dispatchMail({
    from,
    to: teacher.email,
    subject: `New Task Assigned: ${task.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2563eb; margin-top: 0;">Task Assignment Notification</h2>
        <p>Dear <strong>${teacher.display_name}</strong>,</p>
        <p>A new institutional task has been assigned to you:</p>
        <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #2563eb; margin: 15px 0;">
          <h3 style="margin: 0 0 8px 0; color: #1e293b;">${task.title}</h3>
          <p style="margin: 0 0 8px 0; color: #64748b;">${task.description || 'No additional description provided.'}</p>
          <p style="margin: 0; font-weight: bold; color: #dc2626;">Deadline: ${deadlineStr}</p>
        </div>
        <p>Please log in to your portal to review and submit your response before the deadline.</p>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${baseUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Open Teacher Portal</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">This is an automated notification from the Teacher Task Tracking System.</p>
      </div>
    `
  });
}

async function sendTaskReminderEmail(teacher, task, deadline) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'tasks@institution.edu';
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  const deadlineStr = new Date(deadline).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return dispatchMail({
    from,
    to: teacher.email,
    subject: `REMINDER: Pending Task - ${task.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #fed7aa; border-radius: 8px;">
        <h2 style="color: #ea580c; margin-top: 0;">Task Submission Reminder</h2>
        <p>Dear <strong>${teacher.display_name}</strong>,</p>
        <p>This is a reminder that you have a pending submission for the following task:</p>
        <div style="background-color: #fff7ed; padding: 15px; border-left: 4px solid #ea580c; margin: 15px 0;">
          <h3 style="margin: 0 0 8px 0; color: #9a3412;">${task.title}</h3>
          <p style="margin: 0; font-weight: bold; color: #c2410c;">Due: ${deadlineStr}</p>
        </div>
        <p>Please complete and submit your response promptly.</p>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${baseUrl}" style="background-color: #ea580c; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Complete Task Now</a>
        </div>
      </div>
    `
  });
}

async function sendGroupJoinRequestEmail(approvers, applicant, group, campusName) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'tasks@institution.edu';
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';

  for (const approver of approvers) {
    if (!approver.email) continue;
    try {
      await dispatchMail({
        from,
        to: approver.email,
        subject: `Group Joining Request: ${group.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h3>New Group Membership Request</h3>
            <p><strong>${applicant.display_name}</strong> (${applicant.email}) has requested to join the group <strong>${group.name}</strong> at <strong>${campusName}</strong>.</p>
            <p><a href="${baseUrl}">Review Requests in Admin Portal</a></p>
          </div>
        `
      });
    } catch (e) {
      console.warn(`[Group Request Email Failed]: ${e.message}`);
    }
  }
}

async function sendGroupDecisionEmail(applicant, group, status, reviewNotes = '') {
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'tasks@institution.edu';
  const isApproved = status === 'APPROVED';

  return dispatchMail({
    from,
    to: applicant.email,
    subject: `Group Request ${isApproved ? 'Approved' : 'Declined'}: ${group.name}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h3>Group Membership Request Update</h3>
        <p>Dear ${applicant.display_name},</p>
        <p>Your request to join <strong>${group.name}</strong> has been <strong>${status.toLowerCase()}</strong>.</p>
        ${reviewNotes ? `<p><strong>Notes:</strong> ${reviewNotes}</p>` : ''}
      </div>
    `
  });
}

// ============================================================================
// 5. AUDIT LOGGING ENGINE
// ============================================================================

async function logAudit({ userId, campusId = null, action, entityType, entityId, description, metadata = {}, ipAddress = null }) {
  try {
    const id = uuidv4();
    const now = new Date();

    if (db.isMemoryFallback()) {
      db.getMemoryStore().audit_logs.push({
        id,
        user_id: userId,
        campus_id: campusId,
        action,
        entity_type: entityType,
        entity_id: entityId ? entityId.toString() : null,
        description,
        metadata,
        ip_address: ipAddress,
        created_at: now
      });
    } else {
      await db.query(`
        INSERT INTO audit_logs (id, user_id, campus_id, action, entity_type, entity_id, description, metadata, ip_address, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [id, userId, campusId, action, entityType, entityId ? entityId.toString() : null, description, JSON.stringify(metadata), ipAddress, now]);
    }
  } catch (err) {
    console.error('[Audit Log Error]:', err.message);
  }
}

// ============================================================================
// 6. IMPORT / EXPORT PROCESSING ENGINE
// ============================================================================

/**
 * Generate human-readable Excel workbook for task responses
 */
function generateTaskResponseWorkbook(task, assignmentsData) {
  const questions = typeof task.questions === 'string' ? JSON.parse(task.questions) : (task.questions || []);

  const rows = assignmentsData.map(item => {
    const row = {
      'Teacher Name': item.display_name,
      'Employee Code': item.employee_code || 'N/A',
      'Campus': item.campus_name,
      'Department': item.department_names || 'N/A',
      'Designation': item.designation_name || 'N/A',
      'Subjects': item.subject_names || 'N/A',
      'Categories': item.category_names || 'N/A',
      'Task Title': task.title,
      'Assigned On': item.assigned_at ? new Date(item.assigned_at).toISOString().split('T')[0] : 'N/A',
      'Deadline': item.due_at ? new Date(item.due_at).toISOString().split('T')[0] : 'N/A',
      'Submission Date': item.submitted_at ? new Date(item.submitted_at).toISOString().split('T')[0] : 'Not Submitted',
      'Status': formatStatusLabel(item.status)
    };

    // Append human-readable question labels as headers
    const answers = item.answers || {};
    questions.forEach(q => {
      let val = answers[q.key];
      if (Array.isArray(val)) val = val.join(', ');
      row[q.label] = val !== undefined && val !== null ? val.toString() : '';
    });

    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Responses');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function formatStatusLabel(status) {
  switch (status) {
    case 'SUBMITTED_ON_TIME': return 'Submitted On Time';
    case 'SUBMITTED_LATE': return 'Submitted Late';
    case 'IN_PROGRESS': return 'In Progress (Draft)';
    case 'OVERDUE': return 'Overdue';
    case 'NOT_STARTED': return 'Not Started';
    default: return status;
  }
}

/**
 * Generate Import Template (New Data or Edit Existing)
 */
async function generateImportTemplate(mode = 'NEW', dataset = 'users', userContext = null) {
  const wb = XLSX.utils.book_new();

  if (dataset === 'users') {
    let data = [];
    if (mode === 'EDIT') {
      if (db.isMemoryFallback()) {
        const store = db.getMemoryStore();
        let teachers = store.users.filter(u => u.user_type === 'TEACHER' || u.user_type === 'ADMIN');
        
        data = teachers.map(t => {
          const userAttrs = store.user_attributes.filter(a => a.user_id === t.id);
          let campusName = '';
          const attrWithCamp = userAttrs.find(a => a.campus_id);
          if (attrWithCamp) {
            const camp = store.campuses.find(c => c.id === attrWithCamp.campus_id);
            if (camp) campusName = camp.name;
          }
          if (!campusName) {
            const acc = store.user_access.find(a => a.user_id === t.id && a.campus_id);
            if (acc) {
              const camp = store.campuses.find(c => c.id === acc.campus_id);
              if (camp) campusName = camp.name;
            }
          }

          const getAttrNames = (type) => {
            return userAttrs
              .map(a => store.master_values.find(m => m.id === a.master_value_id && m.master_type === type))
              .filter(Boolean)
              .map(m => m.name);
          };

          const deptNames = getAttrNames('DEPARTMENT');
          const desigNames = getAttrNames('DESIGNATION');
          const subjNames = getAttrNames('SUBJECT');
          const catNames = getAttrNames('CATEGORY');

          return {
            'Email (Key)': t.email,
            'Employee Code': t.employee_code || '',
            'First Name': t.first_name || '',
            'Last Name': t.last_name || '',
            'Phone': t.phone || '',
            'Campus': campusName,
            'Department': deptNames[0] || '',
            'Designation': desigNames[0] || '',
            'Subjects (Comma separated)': subjNames.join(', '),
            'Categories (Comma separated)': catNames.join(', '),
            'Class Teacher (Yes/No)': t.class_teacher_status ? 'Yes' : 'No',
            'Status (ACTIVE/INACTIVE)': t.status || 'ACTIVE'
          };
        });

        if (userContext && !userContext.isSuperAdmin && userContext.authorizedCampusIds) {
          data = data.filter(row => {
            const camp = store.campuses.find(c => c.name.toLowerCase() === (row.Campus || '').toLowerCase());
            return camp && userContext.authorizedCampusIds.includes(camp.id);
          });
        }
      } else {
        let q = `
          SELECT DISTINCT ON (u.id)
            u.id, u.email, u.employee_code, u.first_name, u.last_name, u.phone, u.class_teacher_status, u.status,
            COALESCE(c.name, ca.name, '') as campus_name,
            (SELECT mv.name FROM user_attributes ua JOIN master_values mv ON ua.master_value_id = mv.id WHERE ua.user_id = u.id AND mv.master_type = 'DEPARTMENT' LIMIT 1) as department_name,
            (SELECT mv.name FROM user_attributes ua JOIN master_values mv ON ua.master_value_id = mv.id WHERE ua.user_id = u.id AND mv.master_type = 'DESIGNATION' LIMIT 1) as designation_name,
            (SELECT string_agg(mv.name, ', ') FROM user_attributes ua JOIN master_values mv ON ua.master_value_id = mv.id WHERE ua.user_id = u.id AND mv.master_type = 'SUBJECT') as subjects,
            (SELECT string_agg(mv.name, ', ') FROM user_attributes ua JOIN master_values mv ON ua.master_value_id = mv.id WHERE ua.user_id = u.id AND mv.master_type = 'CATEGORY') as categories
          FROM users u
          LEFT JOIN LATERAL (
            SELECT c1.name, ua1.campus_id FROM user_attributes ua1 JOIN campuses c1 ON ua1.campus_id = c1.id WHERE ua1.user_id = u.id AND ua1.campus_id IS NOT NULL LIMIT 1
          ) c ON true
          LEFT JOIN LATERAL (
            SELECT c2.name, acc2.campus_id FROM user_access acc2 JOIN campuses c2 ON acc2.campus_id = c2.id WHERE acc2.user_id = u.id AND acc2.campus_id IS NOT NULL LIMIT 1
          ) ca ON true
          WHERE u.user_type IN ('TEACHER', 'ADMIN')
        `;
        const params = [];
        if (userContext && !userContext.isSuperAdmin && userContext.authorizedCampusIds && userContext.authorizedCampusIds.length > 0) {
          params.push(userContext.authorizedCampusIds);
          q += ` AND (c.campus_id = ANY($1) OR ca.campus_id = ANY($1))`;
        }
        q += ` ORDER BY u.id, u.display_name ASC`;

        const res = await db.query(q, params);
        data = res.rows.map(t => ({
          'Email (Key)': t.email,
          'Employee Code': t.employee_code || '',
          'First Name': t.first_name || '',
          'Last Name': t.last_name || '',
          'Phone': t.phone || '',
          'Campus': t.campus_name || '',
          'Department': t.department_name || '',
          'Designation': t.designation_name || '',
          'Subjects (Comma separated)': t.subjects || '',
          'Categories (Comma separated)': t.categories || '',
          'Class Teacher (Yes/No)': t.class_teacher_status ? 'Yes' : 'No',
          'Status (ACTIVE/INACTIVE)': t.status || 'ACTIVE'
        }));
      }
    } else {
      // Empty sample template with helpful instructions
      let sampleCampus = 'Main Campus';
      if (db.isMemoryFallback()) {
        const store = db.getMemoryStore();
        if (store.campuses.length > 0) sampleCampus = store.campuses[0].name;
      } else {
        const cRes = await db.query('SELECT name FROM campuses WHERE status = $1 ORDER BY name ASC LIMIT 1', ['ACTIVE']);
        if (cRes.rows.length > 0) sampleCampus = cRes.rows[0].name;
      }

      data = [
        {
          'Email': 'teacher.sample@institution.edu',
          'Employee Code': 'EMP_1001',
          'First Name': 'John',
          'Last Name': 'Doe',
          'Phone': '+1 555-0199',
          'Password (Optional)': 'Welcome@2026',
          'Campus': sampleCampus,
          'Department': 'Mathematics',
          'Designation': 'PGT (Post Graduate Teacher)',
          'Subjects (Comma separated)': 'Mathematics, Physics',
          'Categories (Comma separated)': 'Middle Wing, Exam Committee',
          'Class Teacher (Yes/No)': 'Yes',
          'Status (ACTIVE/INACTIVE)': 'ACTIVE'
        }
      ];
    }
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Teachers');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  resolveTaskAudience,
  publishTask,
  processRecurringTasks,
  calculateNextOccurrence,
  sendTaskAssignedEmail,
  sendTaskReminderEmail,
  sendGroupJoinRequestEmail,
  sendGroupDecisionEmail,
  sendTestEmail,
  resetEmailTransporter,
  logAudit,
  generateTaskResponseWorkbook,
  generateImportTemplate,
  formatStatusLabel
};
