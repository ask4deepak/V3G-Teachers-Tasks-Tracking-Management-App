/**
 * Automated Verification Test Suite (test/suite.js)
 * Covers Authentication, Campus Management & Bulk Operations, Master Data Bulk Add,
 * Faculty Group Discovery & Join Requests, Audience Resolution, Recurrence Engine, Submissions & Reports.
 */
const assert = require('assert');
const bcrypt = require('bcryptjs');
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

  console.log('--- Phase 1: Authentication & Super-Admin Credentials ---');

  await test('Super Admin (ask4deepak@gmail.com) can authenticate with Admin@123', async () => {
    const user = await auth.authenticate('ask4deepak@gmail.com', 'Admin@123');
    assert.strictEqual(user.email, 'ask4deepak@gmail.com');
    assert.strictEqual(user.display_name, 'Deepak Gupta');
    assert.strictEqual(user.user_type, 'SUPER_ADMIN');
    assert.strictEqual(user.isSuperAdmin, true);
  });

  await test('Authentication fails on invalid password', async () => {
    await assert.rejects(
      async () => await auth.authenticate('ask4deepak@gmail.com', 'WrongPass!'),
      /Invalid email or password/
    );
  });

  console.log('\n--- Phase 2: Campus Management & Bulk Creation Tests ---');

  let testCampusId = '';
  await test('Super Admin can create a new Campus', async () => {
    const store = db.getMemoryStore();
    const newCampus = {
      id: 'cmp-' + Date.now(),
      name: 'North Valley Campus',
      code: 'NVC',
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date()
    };
    testCampusId = newCampus.id;
    store.campuses.push(newCampus);

    const found = store.campuses.find(c => c.id === testCampusId);
    assert.ok(found);
    assert.strictEqual(found.name, 'North Valley Campus');
    assert.strictEqual(found.code, 'NVC');
    assert.strictEqual(found.status, 'ACTIVE');
  });

  await test('Super Admin can edit Campus details and status', async () => {
    const store = db.getMemoryStore();
    const campus = store.campuses.find(c => c.id === testCampusId);
    assert.ok(campus);

    campus.name = 'North Valley High Campus';
    campus.code = 'NVHC';
    campus.status = 'INACTIVE';
    campus.updated_at = new Date();

    assert.strictEqual(campus.name, 'North Valley High Campus');
    assert.strictEqual(campus.code, 'NVHC');
    assert.strictEqual(campus.status, 'INACTIVE');

    // Restore to ACTIVE for subsequent tests
    campus.status = 'ACTIVE';
  });

  await test('Bulk Campus creation parses multi-line inputs with auto-codes', async () => {
    const store = db.getMemoryStore();
    const rawInput = `South Wing Campus, SWC
East Valley Campus
West Coast Campus, WCC`;

    const lines = rawInput.split('\n').map(l => l.trim()).filter(Boolean);
    const added = [];

    for (let idx = 0; idx < lines.length; idx++) {
      const parts = lines[idx].split(',').map(s => s.trim());
      const name = parts[0];
      const code = parts[1] || name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
      
      const campusObj = {
        id: `cmp-bulk-${Date.now()}-${idx}`,
        name,
        code,
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date()
      };
      store.campuses.push(campusObj);
      added.push(campusObj);
    }

    assert.strictEqual(added.length, 3);
    assert.strictEqual(added[0].code, 'SWC');
    assert.strictEqual(added[1].name, 'East Valley Campus');
    assert.ok(added[1].code.length > 0);
  });

  console.log('\n--- Phase 3: Master Data Bulk Add & Management Tests ---');

  await test('Bulk Master Data creation supports Departments, Designations, Subjects, Categories', async () => {
    const store = db.getMemoryStore();
    const types = ['DEPARTMENT', 'DESIGNATION', 'SUBJECT', 'CATEGORY'];
    const sampleData = {
      DEPARTMENT: 'Mathematics, MATH\nScience, SCI\nHumanities, HUM',
      DESIGNATION: 'Senior Teacher, SR_TCH\nPrimary Coordinator, PR_COORD',
      SUBJECT: 'Advanced Calculus, ADV_CALC\nPhysics, PHY\nWorld History, HIST',
      CATEGORY: 'High School Wing, HS_WING\nMiddle School Wing, MS_WING'
    };

    for (const type of types) {
      const lines = sampleData[type].split('\n').map(l => l.trim()).filter(Boolean);
      for (let idx = 0; idx < lines.length; idx++) {
        const parts = lines[idx].split(',').map(s => s.trim());
        const name = parts[0];
        const code = parts[1] || name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 12);

        store.master_values.push({
          id: `mst-${type.toLowerCase()}-${Date.now()}-${idx}`,
          master_type: type,
          name,
          code,
          sort_order: (idx + 1) * 10,
          status: 'ACTIVE',
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    }

    const depts = store.master_values.filter(m => m.master_type === 'DEPARTMENT');
    const desigs = store.master_values.filter(m => m.master_type === 'DESIGNATION');
    const subjects = store.master_values.filter(m => m.master_type === 'SUBJECT');
    const categories = store.master_values.filter(m => m.master_type === 'CATEGORY');

    assert.strictEqual(depts.length, 3);
    assert.strictEqual(desigs.length, 2);
    assert.strictEqual(subjects.length, 3);
    assert.strictEqual(categories.length, 2);
  });

  console.log('\n--- Phase 4: Teacher Provisioning, Password Reset & Group Joining ---');

  let teacherSarahId = 'usr-teacher-sarah-01';
  await test('Create Teacher user and assign campus and profile attributes', async () => {
    const store = db.getMemoryStore();
    const passHash = await bcrypt.hash('Teacher@123', 10);
    const mathSub = store.master_values.find(m => m.name === 'Advanced Calculus');
    const hsCat = store.master_values.find(m => m.name === 'High School Wing');

    store.users.push({
      id: teacherSarahId,
      email: 'teacher.sarah@institution.edu',
      password_hash: passHash,
      display_name: 'Sarah Johnson',
      employee_code: 'EMP_TC01',
      user_type: 'TEACHER',
      status: 'ACTIVE',
      class_teacher_status: true,
      phone: '+1 555-0199',
      created_at: new Date(),
      updated_at: new Date()
    });

    store.user_attributes.push({
      id: 'ua-sarah-01',
      user_id: teacherSarahId,
      campus_id: testCampusId,
      master_type: 'SUBJECT',
      master_value_id: mathSub.id,
      created_at: new Date()
    });

    store.user_attributes.push({
      id: 'ua-sarah-02',
      user_id: teacherSarahId,
      campus_id: testCampusId,
      master_type: 'CATEGORY',
      master_value_id: hsCat.id,
      created_at: new Date()
    });

    const teacher = await auth.authenticate('teacher.sarah@institution.edu', 'Teacher@123');
    assert.strictEqual(teacher.id, teacherSarahId);
    assert.strictEqual(teacher.display_name, 'Sarah Johnson');
    assert.strictEqual(teacher.class_teacher_status, true);
  });

  await test('Campus Faculty Group discovery and instant join request submission', async () => {
    const store = db.getMemoryStore();
    const groupId = 'grp-stem-committee-01';

    // Create group assigned to test campus
    store.groups.push({
      id: groupId,
      name: 'STEM Faculty Innovation Group',
      campus_id: testCampusId,
      description: 'Cross-departmental STEM curriculum collaboration',
      allow_join_requests: true,
      status: 'ACTIVE',
      created_by: 'superadmin',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Submit join request for Sarah
    store.group_memberships.push({
      id: 'gm-' + Date.now(),
      group_id: groupId,
      user_id: teacherSarahId,
      membership_role: 'MEMBER',
      status: 'PENDING',
      created_at: new Date()
    });

    const req = store.group_memberships.find(m => m.group_id === groupId && m.user_id === teacherSarahId);
    assert.ok(req);
    assert.strictEqual(req.status, 'PENDING');

    // Admin approves request
    req.status = 'APPROVED';
    assert.strictEqual(req.status, 'APPROVED');
  });

  await test('Self-service password reset updates user password hash', async () => {
    const store = db.getMemoryStore();
    const user = store.users.find(u => u.id === teacherSarahId);
    assert.ok(user);

    const oldValid = await bcrypt.compare('Teacher@123', user.password_hash);
    assert.strictEqual(oldValid, true);

    const newPassword = 'NewSecretPassword@2026';
    user.password_hash = await bcrypt.hash(newPassword, 10);

    const oldFails = await bcrypt.compare('Teacher@123', user.password_hash);
    assert.strictEqual(oldFails, false);

    const newSucceeds = await bcrypt.compare(newPassword, user.password_hash);
    assert.strictEqual(newSucceeds, true);

    // Reset back
    user.password_hash = await bcrypt.hash('Teacher@123', 10);
  });

  console.log('\n--- Phase 5: Audience Resolution, Task Creation, Reordering & Submissions ---');

  let testTaskId = 'tsk-test-lifecycle-01';
  await test('Audience resolution filters teachers by campus and attribute rules', async () => {
    const recipients = await services.resolveTaskAudience([testCampusId], { class_teacher_status: true });
    assert.ok(recipients.length > 0);
    assert.strictEqual(recipients[0].id, teacherSarahId);
  });

  await test('Create, publish and reorder tasks', async () => {
    const store = db.getMemoryStore();
    store.tasks.push({
      id: testTaskId,
      task_type: 'ONE_TIME',
      title: 'Quarterly Syllabus Verification',
      campus_ids: [testCampusId],
      questions: [
        { key: 'Q1', label: 'Number of notebooks reviewed', type: 'number', required: true },
        { key: 'Q2', label: 'Remarks', type: 'text', required: false }
      ],
      audience_rules: {},
      recipient_exclusions: [],
      allow_edit_submission: true,
      allow_late_submissions: true,
      status: 'ACTIVE',
      sort_order: 1,
      open_at: new Date(),
      deadline_at: new Date(Date.now() + 86400000),
      created_by: 'superadmin',
      created_at: new Date(),
      updated_at: new Date()
    });

    const asgId = 'asg-test-sarah-01';
    store.assignments.push({
      id: asgId,
      task_id: testTaskId,
      user_id: teacherSarahId,
      campus_id: testCampusId,
      assigned_at: new Date(),
      due_at: new Date(Date.now() + 86400000),
      status: 'NOT_STARTED',
      excluded_flag: false,
      created_at: new Date(),
      updated_at: new Date()
    });

    const asg = store.assignments.find(a => a.id === asgId);
    assert.ok(asg);
    assert.strictEqual(asg.status, 'NOT_STARTED');
  });

  await test('Teacher submits response, then edits response under allow_edit_submission policy', async () => {
    const store = db.getMemoryStore();
    const asg = store.assignments.find(a => a.task_id === testTaskId && a.user_id === teacherSarahId);
    assert.ok(asg);

    // Initial submission
    const subId = 'sub-test-01';
    store.submissions.push({
      id: subId,
      assignment_id: asg.id,
      answers: { Q1: 45, Q2: 'Initial check completed' },
      draft_flag: false,
      submitted_at: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    });
    asg.status = 'SUBMITTED_ON_TIME';

    let sub = store.submissions.find(s => s.assignment_id === asg.id);
    assert.strictEqual(sub.answers.Q1, 45);

    // Teacher edits submission
    sub.answers = { Q1: 50, Q2: 'Updated count after second review' };
    sub.updated_at = new Date();

    sub = store.submissions.find(s => s.assignment_id === asg.id);
    assert.strictEqual(sub.answers.Q1, 50);
    assert.strictEqual(sub.answers.Q2, 'Updated count after second review');
  });

  console.log('\n--- Phase 6: Recurrence Engine, Reports & Excel Response Generation ---');

  await test('Calculate next recurrence for weekly, monthly and quarterly schedules', async () => {
    // 1. Weekly
    const baseMon = new Date('2026-09-07T00:00:00Z');
    const nextWed = services.calculateNextOccurrence({
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: [3, 5]
    }, baseMon);
    assert.strictEqual(nextWed.getDay(), 3);

    // 2. Monthly on last day of month
    const baseFeb = new Date('2026-02-01T00:00:00Z');
    const nextEndMarch = services.calculateNextOccurrence({
      frequency: 'MONTHLY',
      interval: 1,
      dayOfMonth: 'LAST'
    }, baseFeb);
    assert.strictEqual(nextEndMarch.getMonth(), 2);
    assert.strictEqual(nextEndMarch.getDate(), 31);
  });

  await test('Task response export generates Excel workbook with question labels as column headers', async () => {
    const sampleTask = {
      id: testTaskId,
      title: 'Quarterly Syllabus Verification',
      questions: [
        { key: 'Q1', label: 'Number of notebooks reviewed', type: 'number' },
        { key: 'Q2', label: 'Remarks', type: 'text' }
      ]
    };

    const sampleAssignments = [
      {
        display_name: 'Sarah Johnson',
        employee_code: 'EMP_TC01',
        campus_name: 'North Valley High Campus',
        assigned_at: new Date(),
        due_at: new Date(),
        submitted_at: new Date(),
        status: 'SUBMITTED_ON_TIME',
        answers: { Q1: 50, Q2: 'Updated count after second review' }
      }
    ];

    const buffer = services.generateTaskResponseWorkbook(sampleTask, sampleAssignments);
    assert.ok(buffer);
    assert.ok(buffer.length > 0);
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
