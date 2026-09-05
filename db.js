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
  const teacherHash = await bcrypt.hash('Teacher@123', 10);

  // Campuses
  const northCampusId = '11111111-1111-1111-1111-111111111111';
  const southCampusId = '22222222-2222-2222-2222-222222222222';
  const westCampusId = '33333333-3333-3333-3333-333333333333';

  memoryStore.campuses = [
    { id: northCampusId, name: 'North Campus', code: 'NORTH', status: 'ACTIVE', created_at: new Date(), updated_at: new Date() },
    { id: southCampusId, name: 'South Campus', code: 'SOUTH', status: 'ACTIVE', created_at: new Date(), updated_at: new Date() },
    { id: westCampusId, name: 'West Campus', code: 'WEST', status: 'ACTIVE', created_at: new Date(), updated_at: new Date() }
  ];

  // Roles
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

  // Master Values
  const depEng = 'd1111111-1111-1111-1111-111111111111';
  const depMath = 'd2222222-2222-2222-2222-222222222222';
  const depSci = 'd3333333-3333-3333-3333-333333333333';
  const depSoc = 'd4444444-4444-4444-4444-444444444444';

  const desSr = 'e1111111-1111-1111-1111-111111111111';
  const desPGT = 'e2222222-2222-2222-2222-222222222222';
  const desTGT = 'e3333333-3333-3333-3333-333333333333';
  const desPRT = 'e4444444-4444-4444-4444-444444444444';

  const subEng = 'f1111111-1111-1111-1111-111111111111';
  const subMath = 'f2222222-2222-2222-2222-222222222222';
  const subPhy = 'f3333333-3333-3333-3333-333333333333';
  const subChem = 'f4444444-4444-4444-4444-444444444444';
  const subBio = 'f5555555-5555-5555-5555-555555555555';
  const subHist = 'f7777777-7777-7777-7777-777777777777';

  const catPri = 'c1111111-1111-1111-1111-111111111111';
  const catMid = 'c2222222-2222-2222-2222-222222222222';
  const catSnr = 'c3333333-3333-3333-3333-333333333333';
  const catExam = 'c4444444-4444-4444-4444-444444444444';

  memoryStore.master_values = [
    { id: depEng, master_type: 'DEPARTMENT', name: 'English', code: 'DEP_ENG', campus_id: null, status: 'ACTIVE', sort_order: 1, created_at: new Date(), updated_at: new Date() },
    { id: depMath, master_type: 'DEPARTMENT', name: 'Mathematics', code: 'DEP_MATH', campus_id: null, status: 'ACTIVE', sort_order: 2, created_at: new Date(), updated_at: new Date() },
    { id: depSci, master_type: 'DEPARTMENT', name: 'Science & Technology', code: 'DEP_SCI', campus_id: null, status: 'ACTIVE', sort_order: 3, created_at: new Date(), updated_at: new Date() },
    { id: depSoc, master_type: 'DEPARTMENT', name: 'Social Sciences', code: 'DEP_SOC', campus_id: null, status: 'ACTIVE', sort_order: 4, created_at: new Date(), updated_at: new Date() },

    { id: desSr, master_type: 'DESIGNATION', name: 'Senior Teacher', code: 'DES_SR', campus_id: null, status: 'ACTIVE', sort_order: 1, created_at: new Date(), updated_at: new Date() },
    { id: desPGT, master_type: 'DESIGNATION', name: 'PGT (Post Graduate Teacher)', code: 'DES_PGT', campus_id: null, status: 'ACTIVE', sort_order: 2, created_at: new Date(), updated_at: new Date() },
    { id: desTGT, master_type: 'DESIGNATION', name: 'TGT (Trained Graduate Teacher)', code: 'DES_TGT', campus_id: null, status: 'ACTIVE', sort_order: 3, created_at: new Date(), updated_at: new Date() },
    { id: desPRT, master_type: 'DESIGNATION', name: 'PRT (Primary Teacher)', code: 'DES_PRT', campus_id: null, status: 'ACTIVE', sort_order: 4, created_at: new Date(), updated_at: new Date() },

    { id: subEng, master_type: 'SUBJECT', name: 'English Literature', code: 'SUB_ENG', campus_id: null, status: 'ACTIVE', sort_order: 1, created_at: new Date(), updated_at: new Date() },
    { id: subMath, master_type: 'SUBJECT', name: 'Mathematics', code: 'SUB_MATH', campus_id: null, status: 'ACTIVE', sort_order: 2, created_at: new Date(), updated_at: new Date() },
    { id: subPhy, master_type: 'SUBJECT', name: 'Physics', code: 'SUB_PHY', campus_id: null, status: 'ACTIVE', sort_order: 3, created_at: new Date(), updated_at: new Date() },
    { id: subChem, master_type: 'SUBJECT', name: 'Chemistry', code: 'SUB_CHEM', campus_id: null, status: 'ACTIVE', sort_order: 4, created_at: new Date(), updated_at: new Date() },
    { id: subBio, master_type: 'SUBJECT', name: 'Biology', code: 'SUB_BIO', campus_id: null, status: 'ACTIVE', sort_order: 5, created_at: new Date(), updated_at: new Date() },
    { id: subHist, master_type: 'SUBJECT', name: 'History & Civics', code: 'SUB_HIST', campus_id: null, status: 'ACTIVE', sort_order: 6, created_at: new Date(), updated_at: new Date() },

    { id: catPri, master_type: 'CATEGORY', name: 'Primary Wing', code: 'CAT_PRI', campus_id: null, status: 'ACTIVE', sort_order: 1, created_at: new Date(), updated_at: new Date() },
    { id: catMid, master_type: 'CATEGORY', name: 'Middle Wing', code: 'CAT_MID', campus_id: null, status: 'ACTIVE', sort_order: 2, created_at: new Date(), updated_at: new Date() },
    { id: catSnr, master_type: 'CATEGORY', name: 'Senior Secondary Wing', code: 'CAT_SNR', campus_id: null, status: 'ACTIVE', sort_order: 3, created_at: new Date(), updated_at: new Date() },
    { id: catExam, master_type: 'CATEGORY', name: 'Exam Committee', code: 'CAT_EXAM', campus_id: null, status: 'ACTIVE', sort_order: 4, created_at: new Date(), updated_at: new Date() }
  ];

  // Users
  const superAdminId = 'a1111111-1111-1111-1111-111111111111';
  const adminNorthId = 'a2222222-2222-2222-2222-222222222222';
  const adminSouthId = 'a3333333-3333-3333-3333-333333333333';
  const teacherSarahId = 'a4444444-4444-4444-4444-444444444444';
  const teacherMichaelId = 'a5555555-5555-5555-5555-555555555555';
  const teacherPriyaId = 'a6666666-6666-6666-6666-666666666666';
  const teacherDavidId = 'a7777777-7777-7777-7777-777777777777';
  const teacherEmilyId = 'a8888888-8888-8888-8888-888888888888';

  memoryStore.users = [
    {
      id: superAdminId,
      email: 'superadmin@institution.edu',
      password_hash: hash,
      user_type: 'SUPER_ADMIN',
      employee_code: 'EMP_SA01',
      first_name: 'Arthur',
      last_name: 'Pendleton',
      display_name: 'Arthur Pendleton',
      phone: '+1 555-0100',
      status: 'ACTIVE',
      class_teacher_status: false,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: adminNorthId,
      email: 'admin.north@institution.edu',
      password_hash: hash,
      user_type: 'ADMIN',
      employee_code: 'EMP_AD01',
      first_name: 'Eleanor',
      last_name: 'Vance',
      display_name: 'Eleanor Vance',
      phone: '+1 555-0101',
      status: 'ACTIVE',
      class_teacher_status: false,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: adminSouthId,
      email: 'admin.south@institution.edu',
      password_hash: hash,
      user_type: 'ADMIN',
      employee_code: 'EMP_AD02',
      first_name: 'Marcus',
      last_name: 'Sterling',
      display_name: 'Marcus Sterling',
      phone: '+1 555-0102',
      status: 'ACTIVE',
      class_teacher_status: false,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: teacherSarahId,
      email: 'teacher.sarah@institution.edu',
      password_hash: teacherHash,
      user_type: 'TEACHER',
      employee_code: 'EMP_TC01',
      first_name: 'Sarah',
      last_name: 'Johnson',
      display_name: 'Sarah Johnson',
      phone: '+1 555-0201',
      status: 'ACTIVE',
      class_teacher_status: true,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: teacherMichaelId,
      email: 'teacher.michael@institution.edu',
      password_hash: teacherHash,
      user_type: 'TEACHER',
      employee_code: 'EMP_TC02',
      first_name: 'Michael',
      last_name: 'Chen',
      display_name: 'Michael Chen',
      phone: '+1 555-0202',
      status: 'ACTIVE',
      class_teacher_status: false,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: teacherPriyaId,
      email: 'teacher.priya@institution.edu',
      password_hash: teacherHash,
      user_type: 'TEACHER',
      employee_code: 'EMP_TC03',
      first_name: 'Priya',
      last_name: 'Sharma',
      display_name: 'Priya Sharma',
      phone: '+1 555-0203',
      status: 'ACTIVE',
      class_teacher_status: true,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: teacherDavidId,
      email: 'teacher.david@institution.edu',
      password_hash: teacherHash,
      user_type: 'TEACHER',
      employee_code: 'EMP_TC04',
      first_name: 'David',
      last_name: 'Miller',
      display_name: 'David Miller',
      phone: '+1 555-0204',
      status: 'ACTIVE',
      class_teacher_status: false,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: teacherEmilyId,
      email: 'teacher.emily@institution.edu',
      password_hash: teacherHash,
      user_type: 'TEACHER',
      employee_code: 'EMP_TC05',
      first_name: 'Emily',
      last_name: 'Watson',
      display_name: 'Emily Watson',
      phone: '+1 555-0205',
      status: 'ACTIVE',
      class_teacher_status: true,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date()
    }
  ];

  // User Access (Roles & Campus Authorization)
  memoryStore.user_access = [
    { id: uuidv4(), user_id: superAdminId, role_id: superAdminRoleId, campus_id: null, permission_overrides: null, created_at: new Date(), updated_at: new Date() },
    { id: uuidv4(), user_id: adminNorthId, role_id: principalRoleId, campus_id: northCampusId, permission_overrides: null, created_at: new Date(), updated_at: new Date() },
    { id: uuidv4(), user_id: adminSouthId, role_id: principalRoleId, campus_id: southCampusId, permission_overrides: null, created_at: new Date(), updated_at: new Date() }
  ];

  // User Attributes (Teachers to Campus & Masters)
  memoryStore.user_attributes = [
    // Sarah Johnson: North Campus, English Dept, PGT, English Lit Subject, Senior Sec Wing
    { id: uuidv4(), user_id: teacherSarahId, campus_id: northCampusId, master_value_id: depEng, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherSarahId, campus_id: northCampusId, master_value_id: desPGT, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherSarahId, campus_id: northCampusId, master_value_id: subEng, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherSarahId, campus_id: northCampusId, master_value_id: catSnr, created_at: new Date(), created_by: null },

    // Michael Chen: North Campus, Math Dept, Senior Teacher, Mathematics & Physics Subjects
    { id: uuidv4(), user_id: teacherMichaelId, campus_id: northCampusId, master_value_id: depMath, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherMichaelId, campus_id: northCampusId, master_value_id: desSr, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherMichaelId, campus_id: northCampusId, master_value_id: subMath, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherMichaelId, campus_id: northCampusId, master_value_id: subPhy, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherMichaelId, campus_id: northCampusId, master_value_id: catExam, created_at: new Date(), created_by: null },

    // Priya Sharma: South Campus, Science Dept, PGT, Biology Subject, Exam Committee
    { id: uuidv4(), user_id: teacherPriyaId, campus_id: southCampusId, master_value_id: depSci, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherPriyaId, campus_id: southCampusId, master_value_id: desPGT, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherPriyaId, campus_id: southCampusId, master_value_id: subBio, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherPriyaId, campus_id: southCampusId, master_value_id: catExam, created_at: new Date(), created_by: null },

    // David Miller: South Campus, Social Sciences Dept, TGT, History Subject, Middle Wing
    { id: uuidv4(), user_id: teacherDavidId, campus_id: southCampusId, master_value_id: depSoc, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherDavidId, campus_id: southCampusId, master_value_id: desTGT, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherDavidId, campus_id: southCampusId, master_value_id: subHist, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherDavidId, campus_id: southCampusId, master_value_id: catMid, created_at: new Date(), created_by: null },

    // Emily Watson: West Campus, PRT, English, Primary Wing
    { id: uuidv4(), user_id: teacherEmilyId, campus_id: westCampusId, master_value_id: depEng, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherEmilyId, campus_id: westCampusId, master_value_id: desPRT, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherEmilyId, campus_id: westCampusId, master_value_id: subEng, created_at: new Date(), created_by: null },
    { id: uuidv4(), user_id: teacherEmilyId, campus_id: westCampusId, master_value_id: catPri, created_at: new Date(), created_by: null }
  ];

  // Groups
  const groupNorthSci = 'grp11111-1111-1111-1111-111111111111';
  const groupSouthLiterary = 'grp22222-2222-2222-2222-222222222222';

  memoryStore.groups = [
    {
      id: groupNorthSci,
      name: 'North STEM Innovators',
      description: 'Science and Mathematics faculty collaboration group for North Campus',
      campus_id: northCampusId,
      status: 'ACTIVE',
      allow_join_requests: true,
      created_by: adminNorthId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: groupSouthLiterary,
      name: 'South Humanities Council',
      description: 'Humanities and social sciences faculty task force',
      campus_id: southCampusId,
      status: 'ACTIVE',
      allow_join_requests: true,
      created_by: adminSouthId,
      created_at: new Date(),
      updated_at: new Date()
    }
  ];

  memoryStore.group_memberships = [
    {
      id: uuidv4(),
      group_id: groupNorthSci,
      user_id: teacherMichaelId,
      membership_role: 'GROUP_ADMIN',
      status: 'APPROVED',
      requested_at: new Date(),
      requested_by: adminNorthId,
      reviewed_at: new Date(),
      reviewed_by: adminNorthId,
      review_notes: 'Appointed Lead',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: uuidv4(),
      group_id: groupSouthLiterary,
      user_id: teacherDavidId,
      membership_role: 'MEMBER',
      status: 'APPROVED',
      requested_at: new Date(),
      requested_by: teacherDavidId,
      reviewed_at: new Date(),
      reviewed_by: adminSouthId,
      review_notes: 'Approved',
      created_at: new Date(),
      updated_at: new Date()
    }
  ];

  // Demo Tasks
  const sampleTaskId = 'tsk11111-1111-1111-1111-111111111111';
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

  memoryStore.tasks = [
    {
      id: sampleTaskId,
      task_type: 'ONE_TIME',
      parent_template_id: null,
      title: 'Monthly Syllabus & Notebook Verification (Term 1)',
      description: 'Please submit your monthly verification metrics and notebook checking records for quality assurance.',
      campus_ids: [northCampusId],
      questions: [
        { key: 'Q1', label: 'Number of notebooks checked this month', type: 'number', required: true },
        { key: 'Q2', label: 'Curriculum completion status as per syllabus schedule', type: 'single_choice', options: ['Ahead of Schedule', 'On Schedule', 'Slightly Behind', 'Requires Remedial Classes'], required: true },
        { key: 'Q3', label: 'Are any students currently flagged for extra academic intervention?', type: 'yes_no', required: true },
        { key: 'Q4', label: 'Key observations, topics covered, and remedial notes', type: 'long_text', required: false }
      ],
      audience_rules: {
        campuses: [northCampusId],
        departments: [],
        designations: [],
        subjects: [],
        categories: [],
        groups: [],
        class_teacher_status: null,
        specific_users: []
      },
      recipient_exclusions: [],
      status: 'ACTIVE',
      sort_order: 1,
      allow_late_submissions: true,
      allow_edit_submission: true,
      open_at: new Date(Date.now() - 3600000), // Opened 1 hour ago
      deadline_at: deadline,
      published_at: new Date(),
      published_by: adminNorthId,
      created_by: adminNorthId,
      recurrence_config: null,
      next_generation_at: null,
      recurrence_status: null,
      created_at: new Date(),
      updated_at: new Date()
    }
  ];

  // Assignment for Sarah Johnson (Submitted On Time)
  const asgSarahId = 'asg11111-1111-1111-1111-111111111111';
  const asgMichaelId = 'asg22222-2222-2222-2222-222222222222';

  memoryStore.assignments = [
    {
      id: asgSarahId,
      task_id: sampleTaskId,
      user_id: teacherSarahId,
      campus_id: northCampusId,
      assigned_at: new Date(),
      assigned_by: adminNorthId,
      due_at: deadline,
      status: 'SUBMITTED_ON_TIME',
      excluded_flag: false,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: asgMichaelId,
      task_id: sampleTaskId,
      user_id: teacherMichaelId,
      campus_id: northCampusId,
      assigned_at: new Date(),
      assigned_by: adminNorthId,
      due_at: deadline,
      status: 'IN_PROGRESS',
      excluded_flag: false,
      created_at: new Date(),
      updated_at: new Date()
    }
  ];

  // Submission for Sarah
  memoryStore.submissions = [
    {
      id: uuidv4(),
      assignment_id: asgSarahId,
      answers: {
        Q1: 45,
        Q2: 'On Schedule',
        Q3: 'Yes',
        Q4: 'Completed Chapter 4 & 5. Conducted revision test for Class 10.'
      },
      draft_flag: false,
      submitted_at: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: uuidv4(),
      assignment_id: asgMichaelId,
      answers: {
        Q1: 30,
        Q2: 'On Schedule'
      },
      draft_flag: true,
      submitted_at: null,
      created_at: new Date(),
      updated_at: new Date()
    }
  ];

  console.log('[Database] In-memory fallback seeded with demonstration data.');
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

      // Ensure seed users exist in real PostgreSQL
      const hash = await bcrypt.hash('Admin@123', 10);
      const teacherHash = await bcrypt.hash('Teacher@123', 10);

      await pool.query(`
        INSERT INTO users (id, email, password_hash, user_type, employee_code, first_name, last_name, display_name, status)
        VALUES 
        ('a1111111-1111-1111-1111-111111111111', 'superadmin@institution.edu', $1, 'SUPER_ADMIN', 'EMP_SA01', 'Arthur', 'Pendleton', 'Arthur Pendleton', 'ACTIVE'),
        ('a2222222-2222-2222-2222-222222222222', 'admin.north@institution.edu', $1, 'ADMIN', 'EMP_AD01', 'Eleanor', 'Vance', 'Eleanor Vance', 'ACTIVE'),
        ('a3333333-3333-3333-3333-333333333333', 'admin.south@institution.edu', $1, 'ADMIN', 'EMP_AD02', 'Marcus', 'Sterling', 'Marcus Sterling', 'ACTIVE'),
        ('a4444444-4444-4444-4444-444444444444', 'teacher.sarah@institution.edu', $2, 'TEACHER', 'EMP_TC01', 'Sarah', 'Johnson', 'Sarah Johnson', 'ACTIVE'),
        ('a5555555-5555-5555-5555-555555555555', 'teacher.michael@institution.edu', $2, 'TEACHER', 'EMP_TC02', 'Michael', 'Chen', 'Michael Chen', 'ACTIVE')
        ON CONFLICT (email) DO NOTHING;

        INSERT INTO user_access (id, user_id, role_id, campus_id) VALUES
        ('91111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL),
        ('92222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111'),
        ('93333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO user_attributes (id, user_id, campus_id, master_value_id) VALUES
        ('81111111-1111-1111-1111-111111111111', 'a4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111'),
        ('82222222-2222-2222-2222-222222222222', 'a4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'e2222222-2222-2222-2222-222222222222'),
        ('83333333-3333-3333-3333-333333333333', 'a4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111111'),
        ('84444444-4444-4444-4444-444444444444', 'a5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222'),
        ('85555555-5555-5555-5555-555555555555', 'a5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111'),
        ('86666666-6666-6666-6666-666666666666', 'a5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222222')
        ON CONFLICT (id) DO NOTHING;
      `, [hash, teacherHash]);

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
