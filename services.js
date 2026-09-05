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
    specific_users = []
  } = audienceRules;

  const exclusionsSet = new Set(recipientExclusions || []);

  let allTeachers = [];
  let userAttributes = [];
  let groupMemberships = [];

  if (db.isMemoryFallback()) {
    const store = db.getMemoryStore();
    const campusTeacherIds = store.user_attributes.filter(a => campusIds.includes(a.campus_id)).map(a => a.user_id);
    allTeachers = store.users.filter(u => u.status === 'ACTIVE' && (campusTeacherIds.includes(u.id) || (u.campus_id && campusIds.includes(u.campus_id))));
    userAttributes = store.user_attributes;
    groupMemberships = store.group_memberships.filter(m => m.status === 'APPROVED');
  } else {
    const teachersRes = await db.query(`
      SELECT DISTINCT u.id, u.email, u.employee_code, u.first_name, u.last_name, u.display_name, u.class_teacher_status, u.status
      FROM users u
      JOIN user_attributes ua ON u.id = ua.user_id
      WHERE u.status = 'ACTIVE' AND ua.campus_id = ANY($1)
      ORDER BY u.display_name ASC
    `, [campusIds]);
    allTeachers = teachersRes.rows;

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
  const userDeptMap = new Map();
  const userDesigMap = new Map();
  const userSubjMap = new Map();
  const userCatMap = new Map();
  const userCampusMap = new Map();
  const userGroupMap = new Map();

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

    // Filter Category checks (AND across categories, OR within each category)
    let matchesFilters = true;

    // 1. Department
    if (departments.length > 0) {
      const userDepts = userDeptMap.get(userId) || new Set();
      const hasMatch = departments.some(d => userDepts.has(d));
      if (!hasMatch) matchesFilters = false;
    }

    // 2. Designation
    if (matchesFilters && designations.length > 0) {
      const userDesigs = userDesigMap.get(userId) || new Set();
      const hasMatch = designations.some(d => userDesigs.has(d));
      if (!hasMatch) matchesFilters = false;
    }

    // 3. Subject
    if (matchesFilters && subjects.length > 0) {
      const userSubs = userSubjMap.get(userId) || new Set();
      const hasMatch = subjects.some(s => userSubs.has(s));
      if (!hasMatch) matchesFilters = false;
    }

    // 4. Category
    if (matchesFilters && categories.length > 0) {
      const userCats = userCatMap.get(userId) || new Set();
      const hasMatch = categories.some(c => userCats.has(c));
      if (!hasMatch) matchesFilters = false;
    }

    // 5. Group
    if (matchesFilters && groups.length > 0) {
      const userGrps = userGroupMap.get(userId) || new Set();
      const hasMatch = groups.some(g => userGrps.has(g));
      if (!hasMatch) matchesFilters = false;
    }

    // 6. Class Teacher Status
    if (matchesFilters && class_teacher_status !== null && class_teacher_status !== undefined && class_teacher_status !== '') {
      const reqBool = class_teacher_status === true || class_teacher_status === 'true' || class_teacher_status === 'yes';
      if (Boolean(teacher.class_teacher_status) !== reqBool) {
        matchesFilters = false;
      }
    }

    // Combine rule matching or explicit selection
    const isEligible = matchesFilters || isExplicitlySelected;

    if (isEligible) {
      const isExcluded = exclusionsSet.has(userId);
      // Primary campus for assignment
      const primaryCampusId = [...userCampuses][0];

      // Retrieve display details
      let campusName = 'North Campus';
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
  eligibleTeachers.sort((a, b) => a.display_name.localeCompare(b.display_name));
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

function getEmailTransporter() {
  if (!emailTransporter) {
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      emailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    } else {
      // Development mock transporter
      emailTransporter = {
        sendMail: async (options) => {
          console.log(`[Email Mock Sent] TO: ${options.to} | SUBJECT: ${options.subject}`);
          return { messageId: `mock-${Date.now()}` };
        }
      };
    }
  }
  return emailTransporter;
}

async function sendTaskAssignedEmail(teacher, task, deadline) {
  const transporter = getEmailTransporter();
  const from = process.env.EMAIL_FROM || 'tasks@institution.edu';
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  const deadlineStr = new Date(deadline).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return transporter.sendMail({
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
  const transporter = getEmailTransporter();
  const from = process.env.EMAIL_FROM || 'tasks@institution.edu';
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  const deadlineStr = new Date(deadline).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return transporter.sendMail({
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
  const transporter = getEmailTransporter();
  const from = process.env.EMAIL_FROM || 'tasks@institution.edu';
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';

  for (const approver of approvers) {
    if (!approver.email) continue;
    try {
      await transporter.sendMail({
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
  const transporter = getEmailTransporter();
  const from = process.env.EMAIL_FROM || 'tasks@institution.edu';
  const isApproved = status === 'APPROVED';

  return transporter.sendMail({
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
      // Populate with existing users in scope
      let teachers = [];
      if (db.isMemoryFallback()) {
        teachers = db.getMemoryStore().users.filter(u => u.user_type === 'TEACHER');
      } else {
        const res = await db.query('SELECT * FROM users WHERE user_type = $1 ORDER BY display_name ASC', ['TEACHER']);
        teachers = res.rows;
      }
      data = teachers.map(t => ({
        'Email (Key)': t.email,
        'Employee Code': t.employee_code || '',
        'First Name': t.first_name,
        'Last Name': t.last_name,
        'Phone': t.phone || '',
        'Campus': 'North Campus',
        'Department': 'English',
        'Designation': 'Senior Teacher',
        'Subjects (Comma separated)': 'English Literature',
        'Categories (Comma separated)': 'Senior Secondary Wing',
        'Class Teacher (Yes/No)': t.class_teacher_status ? 'Yes' : 'No',
        'Status (ACTIVE/INACTIVE)': t.status
      }));
    } else {
      // Empty sample template with helpful instructions
      data = [
        {
          'Email': 'teacher.sample@institution.edu',
          'Employee Code': 'EMP_1001',
          'First Name': 'John',
          'Last Name': 'Doe',
          'Phone': '+1 555-0199',
          'Password (Optional)': 'Welcome@2026',
          'Campus': 'North Campus',
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
  logAudit,
  generateTaskResponseWorkbook,
  generateImportTemplate,
  formatStatusLabel
};
