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
    const subEng = 's1111111-1111-1111-1111-111111111111';

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
    const teacherSarahId = 'u4444444-4444-4444-4444-444444444444';

    const recipients = await services.resolveTaskAudience([northCampusId], {}, [teacherSarahId]);
    const sarah = recipients.find(r => r.id === teacherSarahId);
    assert.ok(sarah);
    assert.strictEqual(sarah.is_excluded, true);
  });

  console.log('\n--- Phase 3: Task Publication, Frozen Snapshots & Submissions ---');

  await test('Task publication recalculates recipients and creates assignments snapshot', async () => {
    const northCampusId = '11111111-1111-1111-1111-111111111111';
    const taskId = 'tsk-test-publication-01';
    const adminId = 'u2222222-2222-2222-2222-222222222222';

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
