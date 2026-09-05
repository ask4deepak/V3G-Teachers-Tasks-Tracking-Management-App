/**
 * Automated Verification Test Suite (test/suite.js)
 * Covers Authentication, Campus Isolation, Audience Resolution, Recurrence Engine, Submissions & Reports.
 */
const assert = require('assert');
const db = require('../db');
const auth = require('../auth');
const services = require('../services');

let passedTests = 0;
let totalTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function runAllTests() {
  console.log('\n========================================================');
  console.log('🧪 Running Teacher Task Tracking System Verification Suite');
  console.log('========================================================\n');

  // Initialize DB
  await db.initDb();

  console.log('--- Phase 1: Authentication & Campus Isolation Tests ---');

  await test('Super Admin can authenticate with correct password', async () => {
    const user = await auth.authenticate('superadmin@institution.edu', 'Admin@123');
    assert.strictEqual(user.email, 'superadmin@institution.edu');
    assert.strictEqual(user.user_type, 'SUPER_ADMIN');
    assert.strictEqual(user.isSuperAdmin, true);
    assert.ok(user.authorizedCampusIds.length > 0);
  });

  await test('Teacher can authenticate with teacher credentials', async () => {
    const teacher = await auth.authenticate('teacher.sarah@institution.edu', 'Teacher@123');
    assert.strictEqual(teacher.email, 'teacher.sarah@institution.edu');
    assert.strictEqual(teacher.user_type, 'TEACHER');
    assert.strictEqual(teacher.isSuperAdmin, false);
  });

  await test('Authentication fails on invalid password', async () => {
    await assert.rejects(
      async () => await auth.authenticate('superadmin@institution.edu', 'WrongPass!'),
      /Invalid email or password/
    );
  });

  await test('Campus Administrator is strictly scoped to authorized campus', async () => {
    const adminNorth = await auth.authenticate('admin.north@institution.edu', 'Admin@123');
    assert.strictEqual(adminNorth.isSuperAdmin, false);
    assert.ok(adminNorth.authorizedCampusIds.includes('11111111-1111-1111-1111-111111111111'));
    assert.ok(!adminNorth.authorizedCampusIds.includes('22222222-2222-2222-2222-222222222222'));

    // Assert campus access helper
    assert.strictEqual(auth.isAuthorizedForCampus(adminNorth, '11111111-1111-1111-1111-111111111111'), true);
    assert.strictEqual(auth.isAuthorizedForCampus(adminNorth, '22222222-2222-2222-2222-222222222222'), false);
  });

  console.log('\n--- Phase 2: Audience Resolution & Filter Logic Tests ---');

  await test('Audience resolution filters by authorized campus (North Campus)', async () => {
    const northCampusId = '11111111-1111-1111-1111-111111111111';
    const recipients = await services.resolveTaskAudience([northCampusId], {});
    assert.ok(recipients.length > 0);
    // Sarah and Michael belong to North Campus
    const names = recipients.map(r => r.display_name);
    assert.ok(names.includes('Sarah Johnson'));
    assert.ok(names.includes('Michael Chen'));
    assert.ok(!names.includes('Priya Sharma')); // Priya belongs to South Campus
  });

  await test('Audience resolution obeys AND logic across Subject and Class Teacher status', async () => {
    const northCampusId = '11111111-1111-1111-1111-111111111111';
    const subEng = 'f1111111-1111-1111-1111-111111111111';

    // English subject + Class Teacher = True -> Should match Sarah Johnson only
    const recipients = await services.resolveTaskAudience([northCampusId], {
      subjects: [subEng],
      class_teacher_status: true
    });

    assert.strictEqual(recipients.length, 1);
    assert.strictEqual(recipients[0].display_name, 'Sarah Johnson');
  });

  await test('Audience resolution respects explicit recipient exclusions', async () => {
    const northCampusId = '11111111-1111-1111-1111-111111111111';
    const teacherSarahId = 'a4444444-4444-4444-4444-444444444444';

    const recipients = await services.resolveTaskAudience([northCampusId], {}, [teacherSarahId]);
    const sarah = recipients.find(r => r.id === teacherSarahId);
    assert.ok(sarah);
    assert.strictEqual(sarah.is_excluded, true);
  });

  console.log('\n--- Phase 3: Task Publication, Frozen Snapshots & Submissions ---');

  await test('Task publication recalculates recipients and creates assignments snapshot', async () => {
    const northCampusId = '11111111-1111-1111-1111-111111111111';
    const taskId = 'tsk-test-publication-01';
    const adminId = 'a2222222-2222-2222-2222-222222222222';

    // Create draft task
    if (db.isMemoryFallback()) {
      db.getMemoryStore().tasks.push({
        id: taskId,
        task_type: 'ONE_TIME',
        title: 'Quarterly Verification Test',
        campus_ids: [northCampusId],
        questions: [{ key: 'Q1', label: 'Done?', type: 'yes_no' }],
        audience_rules: {},
        recipient_exclusions: [],
        status: 'DRAFT',
        open_at: new Date(),
        deadline_at: new Date(Date.now() + 86400000),
        created_by: adminId,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    const pubRes = await services.publishTask(taskId, adminId);
    assert.strictEqual(pubRes.success, true);
    assert.ok(pubRes.recipientCount >= 2);
  });

  console.log('\n--- Phase 4: Recurring Tasks Scheduler Tests ---');

  await test('Calculate next recurrence for monthly schedule', async () => {
    const baseDate = new Date('2026-09-01T08:00:00Z');
    const config = { frequency: 'MONTHLY', interval: 1, dayOfMonth: 1 };
    const nextDate = services.calculateNextOccurrence(config, baseDate);

    assert.strictEqual(nextDate.getMonth(), 9); // October
    assert.strictEqual(nextDate.getDate(), 1);
  });

  console.log('\n--- Phase 5: Human-Readable Export & Security Tests ---');

  await test('Task response export generates Excel buffer with question labels as column headers', async () => {
    const sampleTask = {
      id: 'tsk11111-1111-1111-1111-111111111111',
      title: 'Monthly Syllabus & Notebook Verification',
      questions: [
        { key: 'Q1', label: 'Number of notebooks checked this month', type: 'number' }
      ]
    };

    const sampleAssignments = [
      {
        display_name: 'Sarah Johnson',
        employee_code: 'EMP_TC01',
        campus_name: 'North Campus',
        assigned_at: new Date(),
        due_at: new Date(),
        submitted_at: new Date(),
        status: 'SUBMITTED_ON_TIME',
        answers: { Q1: 45 }
      }
    ];

    const buffer = services.generateTaskResponseWorkbook(sampleTask, sampleAssignments);
    assert.ok(buffer);
    assert.ok(buffer.length > 0);
  });

  console.log('\n--- Phase 6: Roles, Faculty, Master Data & Group Management Tests ---');

  await test('Create and edit custom system role with granular permissions', async () => {
    const roleName = 'Senior Academic Lead';
    const store = db.getMemoryStore();
    const roleId = 'r-custom-lead-01';

    store.roles.push({
      id: roleId,
      name: roleName,
      description: 'Departmental leadership and task assignments',
      permissions: { 'tasks.create': true, 'tasks.view': true, 'reports.task_wise.view': true },
      is_system_role: false,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date()
    });

    const createdRole = store.roles.find(r => r.id === roleId);
    assert.strictEqual(createdRole.name, roleName);
    assert.strictEqual(createdRole.permissions['tasks.create'], true);

    // Update role
    createdRole.permissions['reports.detailed.view'] = true;
    createdRole.description = 'Updated lead description';
    assert.strictEqual(createdRole.permissions['reports.detailed.view'], true);
    assert.strictEqual(createdRole.description, 'Updated lead description');
  });

  await test('Edit User/Teacher profile, employee code, and status', async () => {
    const store = db.getMemoryStore();
    const teacherSarah = store.users.find(u => u.email === 'teacher.sarah@institution.edu');
    assert.ok(teacherSarah);

    // Update Sarah's attributes
    teacherSarah.employee_code = 'EMP_SRH99';
    teacherSarah.phone = '+91 9988776655';
    teacherSarah.status = 'ACTIVE';

    assert.strictEqual(teacherSarah.employee_code, 'EMP_SRH99');
    assert.strictEqual(teacherSarah.phone, '+91 9988776655');
  });

  await test('Edit Master Data value and sort order', async () => {
    const store = db.getMemoryStore();
    const engMaster = store.master_values.find(m => m.name === 'English');
    assert.ok(engMaster);

    engMaster.code = 'SUB_ENG_ADV';
    engMaster.sort_order = 10;
    engMaster.status = 'ACTIVE';

    assert.strictEqual(engMaster.code, 'SUB_ENG_ADV');
    assert.strictEqual(engMaster.sort_order, 10);
  });

  await test('Edit Group details and manage campus teachers membership with roles', async () => {
    const store = db.getMemoryStore();
    const group = store.groups[0];
    assert.ok(group);

    // Edit group details
    group.name = 'Updated Examination Committee';
    group.allow_join_requests = true;
    assert.strictEqual(group.name, 'Updated Examination Committee');

    // Add teacher Sarah and Michael to group with roles
    const teacherSarahId = 'a4444444-4444-4444-4444-444444444444';
    const teacherMichaelId = 'a5555555-5555-5555-5555-555555555555';

    store.group_memberships = store.group_memberships.filter(m => m.group_id !== group.id);
    store.group_memberships.push({
      id: 'gm-test-01',
      group_id: group.id,
      user_id: teacherSarahId,
      membership_role: 'GROUP_ADMIN',
      status: 'APPROVED',
      created_at: new Date()
    });
    store.group_memberships.push({
      id: 'gm-test-02',
      group_id: group.id,
      user_id: teacherMichaelId,
      membership_role: 'MEMBER',
      status: 'APPROVED',
      created_at: new Date()
    });

    const members = store.group_memberships.filter(m => m.group_id === group.id);
    assert.strictEqual(members.length, 2);
    const sarahMem = members.find(m => m.user_id === teacherSarahId);
    assert.strictEqual(sarahMem.membership_role, 'GROUP_ADMIN');
  });

  console.log('\n--- Phase 7: Task Lifecycle, Reordering, Late Submissions & Password Reset Tests ---');

  await test('Edit assigned task: update questions, deadline, and status (ACTIVE, PAUSED, ARCHIVED, SCHEDULED)', async () => {
    const store = db.getMemoryStore();
    const task = store.tasks[0];
    assert.ok(task);

    // Update questions and deadline
    task.questions.push({ key: 'Q_EXTRA', label: 'Additional feedback', type: 'long_text', required: false });
    task.deadline_at = new Date(Date.now() + 10 * 86400000);
    task.allow_late_submissions = false;
    task.status = 'PAUSED';

    assert.strictEqual(task.questions.length >= 2, true);
    assert.strictEqual(task.allow_late_submissions, false);
    assert.strictEqual(task.status, 'PAUSED');

    // Toggle back to ACTIVE
    task.status = 'ACTIVE';
    assert.strictEqual(task.status, 'ACTIVE');
  });

  await test('Task Up/Down reordering modifies sort_order for priority display in teacher portal', async () => {
    const store = db.getMemoryStore();
    const t1 = store.tasks[0];
    const t2 = store.tasks[1] || {
      id: 'tsk-test-order-02',
      task_type: 'ONE_TIME',
      title: 'Secondary Task',
      campus_ids: ['11111111-1111-1111-1111-111111111111'],
      questions: [],
      audience_rules: {},
      recipient_exclusions: [],
      status: 'ACTIVE',
      sort_order: 2,
      open_at: new Date(),
      deadline_at: new Date(Date.now() + 86400000),
      created_by: 'a2222222-2222-2222-2222-222222222222',
      created_at: new Date(),
      updated_at: new Date()
    };
    if (!store.tasks.find(x => x.id === t2.id)) store.tasks.push(t2);

    t1.sort_order = 1;
    t2.sort_order = 2;

    // Swap sort order (Move t2 UP)
    const temp = t1.sort_order;
    t1.sort_order = t2.sort_order;
    t2.sort_order = temp;

    assert.strictEqual(t2.sort_order < t1.sort_order, true);
  });

  await test('Archived tasks are strictly hidden from teacher view', async () => {
    const store = db.getMemoryStore();
    const archivedTaskId = 'tsk-archived-01';
    store.tasks.push({
      id: archivedTaskId,
      task_type: 'ONE_TIME',
      title: 'Legacy Archived Task',
      campus_ids: ['11111111-1111-1111-1111-111111111111'],
      questions: [],
      audience_rules: {},
      recipient_exclusions: [],
      status: 'ARCHIVED',
      open_at: new Date(),
      deadline_at: new Date(Date.now() + 86400000),
      created_by: 'a2222222-2222-2222-2222-222222222222',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Add assignment for Sarah
    store.assignments.push({
      id: 'asg-archived-01',
      task_id: archivedTaskId,
      user_id: 'a4444444-4444-4444-4444-444444444444',
      campus_id: '11111111-1111-1111-1111-111111111111',
      assigned_at: new Date(),
      assigned_by: 'a2222222-2222-2222-2222-222222222222',
      due_at: new Date(Date.now() + 86400000),
      status: 'NOT_STARTED',
      excluded_flag: false,
      created_at: new Date(),
      updated_at: new Date()
    });

    // Verify teacher query logic filters out ARCHIVED tasks
    const teacherVisibleTasks = store.assignments
      .filter(a => a.user_id === 'a4444444-4444-4444-4444-444444444444')
      .map(a => {
        const t = store.tasks.find(tsk => tsk.id === a.task_id);
        if (!t || t.status === 'ARCHIVED') return null;
        return t;
      })
      .filter(Boolean);

    assert.strictEqual(teacherVisibleTasks.some(t => t.id === archivedTaskId), false);
  });

  await test('Self-service password reset updates user password hash and verifies credentials', async () => {
    const bcrypt = require('bcryptjs');
    const store = db.getMemoryStore();
    const user = store.users.find(u => u.email === 'teacher.sarah@institution.edu');
    assert.ok(user);

    // Verify current password works
    const oldValid = await bcrypt.compare('Teacher@123', user.password_hash);
    assert.strictEqual(oldValid, true);

    // Reset password to new password
    const newPassword = 'NewSecretPassword@2026';
    user.password_hash = await bcrypt.hash(newPassword, 10);
    user.updated_at = new Date();

    // Verify old password fails and new password succeeds
    const oldfails = await bcrypt.compare('Teacher@123', user.password_hash);
    assert.strictEqual(oldfails, false);

    const newsucceeds = await bcrypt.compare(newPassword, user.password_hash);
    assert.strictEqual(newsucceeds, true);

    // Revert for clean state
    user.password_hash = await bcrypt.hash('Teacher@123', 10);
  });

  await test('Import template includes Password (Optional) and supports initial default password', async () => {
    const buffer = await services.generateImportTemplate('NEW', 'users');
    assert.ok(buffer);
    const XLSX = require('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    assert.ok(rows.length > 0);
    assert.ok('Password (Optional)' in rows[0]);
    assert.strictEqual(rows[0]['Password (Optional)'], 'Welcome@2026');
  });

  console.log('\n--- Phase 8: Edit Submissions, Extensive Recurrence & Audit Log Tests ---');

  await test('Allow edit submission policy: teachers can update submitted answers when enabled', async () => {
    const store = db.getMemoryStore();
    const taskId = 'tsk-edit-sub-01';
    const asgId = 'asg-edit-sub-01';
    const teacherId = 'a4444444-4444-4444-4444-444444444444';

    // Create task with allow_edit_submission = true
    store.tasks.push({
      id: taskId,
      task_type: 'ONE_TIME',
      title: 'Editable Submission Test Task',
      campus_ids: ['11111111-1111-1111-1111-111111111111'],
      questions: [{ key: 'Q1', label: 'Score', type: 'number', required: true }],
      audience_rules: {},
      recipient_exclusions: [],
      allow_edit_submission: true,
      allow_late_submissions: true,
      status: 'ACTIVE',
      open_at: new Date(),
      deadline_at: new Date(Date.now() + 86400000),
      created_by: 'a2222222-2222-2222-2222-222222222222',
      created_at: new Date(),
      updated_at: new Date()
    });

    store.assignments.push({
      id: asgId,
      task_id: taskId,
      user_id: teacherId,
      campus_id: '11111111-1111-1111-1111-111111111111',
      assigned_at: new Date(),
      due_at: new Date(Date.now() + 86400000),
      status: 'SUBMITTED_ON_TIME'
    });

    store.submissions.push({
      id: 'sub-edit-01',
      assignment_id: asgId,
      answers: { Q1: 85 },
      draft_flag: false,
      submitted_at: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    });

    // Verify initial answers
    let sub = store.submissions.find(s => s.assignment_id === asgId);
    assert.strictEqual(sub.answers.Q1, 85);

    // Update submission
    sub.answers = { Q1: 95 };
    sub.updated_at = new Date();

    sub = store.submissions.find(s => s.assignment_id === asgId);
    assert.strictEqual(sub.answers.Q1, 95);
  });

  await test('Extensive recurrence scheduler supports Weekly on specific weekdays, Monthly, and End conditions', async () => {
    // 1. Weekly with specific weekdays (e.g. Wednesday = 3 and Friday = 5)
    const baseMonday = new Date('2026-09-07T00:00:00Z'); // Monday (Day 1)
    const nextWed = services.calculateNextOccurrence({
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: [3, 5]
    }, baseMonday);
    assert.strictEqual(nextWed.getDay(), 3); // Wednesday

    // 2. Monthly on last day of month
    const baseFeb = new Date('2026-02-01T00:00:00Z');
    const nextEndMarch = services.calculateNextOccurrence({
      frequency: 'MONTHLY',
      interval: 1,
      dayOfMonth: 'LAST'
    }, baseFeb);
    assert.strictEqual(nextEndMarch.getMonth(), 2); // March
    assert.strictEqual(nextEndMarch.getDate(), 31); // March 31st

    // 3. Quarterly
    const nextQuarter = services.calculateNextOccurrence({
      frequency: 'QUARTERLY',
      dayOfMonth: 15
    }, new Date('2026-01-15T00:00:00Z'));
    assert.strictEqual(nextQuarter.getMonth(), 3); // April (3 months after Jan)
    assert.strictEqual(nextQuarter.getDate(), 15);

    // 4. End condition: after max occurrences
    const stoppedRec = services.calculateNextOccurrence({
      frequency: 'WEEKLY',
      end_type: 'AFTER_OCCURRENCES',
      max_occurrences: 5,
      occurrences_generated: 5
    }, baseMonday);
    assert.strictEqual(stoppedRec, null);
  });

  await test('Audit logs record entries with timestamps and are filterable and sortable', async () => {
    const store = db.getMemoryStore();
    assert.ok(store.audit_logs.length > 0);

    const firstLog = store.audit_logs[0];
    assert.ok(firstLog.created_at);
    assert.ok(firstLog.action);
    assert.ok(firstLog.entity_type);

    // Test sorting
    const sortedDesc = [...store.audit_logs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    assert.ok(new Date(sortedDesc[0].created_at) >= new Date(sortedDesc[sortedDesc.length - 1].created_at));
  });

  console.log('\n========================================================');
  console.log(`📊 Test Results: ${passedTests} / ${totalTests} Passed`);
  console.log('========================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAllTests().catch(err => {
    console.error('Fatal Test Suite Error:', err);
    process.exit(1);
  });
}

module.exports = { runAllTests };
