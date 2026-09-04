-- Seed Data for Teacher Task, Workflow, Performance & Administration Web Application (Version 1)
-- Default Password for all seed users: Admin@123 (bcrypt hash: $2a$10$fV05m8.n13m6t1Z/e0hX2eqF8K1D6wH51G6p7N7iQ7R6Yw.K71Haa or seeded programmatically)

-- Default Campuses
INSERT INTO campuses (id, name, code, status) VALUES
('11111111-1111-1111-1111-111111111111', 'North Campus', 'NORTH', 'ACTIVE'),
('22222222-2222-2222-2222-222222222222', 'South Campus', 'SOUTH', 'ACTIVE'),
('33333333-3333-3333-3333-333333333333', 'West Campus', 'WEST', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

-- Default System Roles with Granular Permissions
INSERT INTO roles (id, name, description, permissions, is_system_role, status) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Super Administrator', 'Full system access across all campuses', '{
    "dashboard.view_admin": true,
    "tasks.view": true, "tasks.create": true, "tasks.edit": true, "tasks.delete_draft": true, "tasks.publish": true, "tasks.assign": true, "tasks.archive": true, "tasks.send_reminder": true, "tasks.export": true,
    "recurring_tasks.view": true, "recurring_tasks.create": true, "recurring_tasks.edit": true, "recurring_tasks.pause": true, "recurring_tasks.publish": true,
    "reports.task_wise.view": true, "reports.task_wise.export": true, "reports.teacher_wise.view": true, "reports.teacher_wise.export": true, "reports.detailed.view": true, "reports.detailed.export": true,
    "groups.view": true, "groups.create": true, "groups.edit": true, "groups.manage_members": true, "groups.approve_requests": true, "groups.delete_or_deactivate": true,
    "users.view": true, "users.create": true, "users.edit": true, "users.deactivate": true, "users.import": true, "users.export": true,
    "masters.view": true, "masters.create": true, "masters.edit": true, "masters.deactivate": true, "masters.import": true, "masters.export": true,
    "audit.view": true, "audit.export": true,
    "imports.execute": true, "exports.execute": true,
    "roles.view": true, "roles.manage": true,
    "user_access.manage": true
}'::jsonb, true, 'ACTIVE'),

('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Campus Principal', 'Full campus administrative operations', '{
    "dashboard.view_admin": true,
    "tasks.view": true, "tasks.create": true, "tasks.edit": true, "tasks.delete_draft": true, "tasks.publish": true, "tasks.assign": true, "tasks.archive": true, "tasks.send_reminder": true, "tasks.export": true,
    "recurring_tasks.view": true, "recurring_tasks.create": true, "recurring_tasks.edit": true, "recurring_tasks.pause": true, "recurring_tasks.publish": true,
    "reports.task_wise.view": true, "reports.task_wise.export": true, "reports.teacher_wise.view": true, "reports.teacher_wise.export": true, "reports.detailed.view": true, "reports.detailed.export": true,
    "groups.view": true, "groups.create": true, "groups.edit": true, "groups.manage_members": true, "groups.approve_requests": true, "groups.delete_or_deactivate": true,
    "users.view": true, "users.create": true, "users.edit": true, "users.deactivate": true, "users.import": true, "users.export": true,
    "masters.view": true, "masters.create": true, "masters.edit": true, "masters.deactivate": true, "masters.import": true, "masters.export": true,
    "audit.view": true, "audit.export": true,
    "imports.execute": true, "exports.execute": true,
    "user_access.manage": true
}'::jsonb, true, 'ACTIVE'),

('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Academic Coordinator', 'Task assignment, recurring schedules, and reporting', '{
    "dashboard.view_admin": true,
    "tasks.view": true, "tasks.create": true, "tasks.edit": true, "tasks.delete_draft": true, "tasks.publish": true, "tasks.assign": true, "tasks.send_reminder": true, "tasks.export": true,
    "recurring_tasks.view": true, "recurring_tasks.create": true, "recurring_tasks.edit": true, "recurring_tasks.pause": true, "recurring_tasks.publish": true,
    "reports.task_wise.view": true, "reports.task_wise.export": true, "reports.teacher_wise.view": true, "reports.teacher_wise.export": true, "reports.detailed.view": true, "reports.detailed.export": true,
    "groups.view": true, "groups.manage_members": true, "groups.approve_requests": true,
    "users.view": true, "masters.view": true
}'::jsonb, true, 'ACTIVE'),

('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Report Viewer', 'Read-only access to institutional reports', '{
    "dashboard.view_admin": true,
    "reports.task_wise.view": true, "reports.task_wise.export": true, "reports.teacher_wise.view": true, "reports.teacher_wise.export": true, "reports.detailed.view": true, "reports.detailed.export": true,
    "tasks.view": true, "users.view": true
}'::jsonb, true, 'ACTIVE')
ON CONFLICT (name) DO NOTHING;

-- Default Master Values (Global and Campus-specific)
-- Departments
INSERT INTO master_values (id, master_type, name, code, status, sort_order) VALUES
('d1111111-1111-1111-1111-111111111111', 'DEPARTMENT', 'English', 'DEP_ENG', 'ACTIVE', 1),
('d2222222-2222-2222-2222-222222222222', 'DEPARTMENT', 'Mathematics', 'DEP_MATH', 'ACTIVE', 2),
('d3333333-3333-3333-3333-333333333333', 'DEPARTMENT', 'Science & Technology', 'DEP_SCI', 'ACTIVE', 3),
('d4444444-4444-4444-4444-444444444444', 'DEPARTMENT', 'Social Sciences', 'DEP_SOC', 'ACTIVE', 4),
('d5555555-5555-5555-5555-555555555555', 'DEPARTMENT', 'Humanities & Arts', 'DEP_ART', 'ACTIVE', 5),

-- Designations
('g1111111-1111-1111-1111-111111111111', 'DESIGNATION', 'Senior Teacher', 'DES_SR', 'ACTIVE', 1),
('g2222222-2222-2222-2222-222222222222', 'DESIGNATION', 'PGT (Post Graduate Teacher)', 'DES_PGT', 'ACTIVE', 2),
('g3333333-3333-3333-3333-333333333333', 'DESIGNATION', 'TGT (Trained Graduate Teacher)', 'DES_TGT', 'ACTIVE', 3),
('g4444444-4444-4444-4444-444444444444', 'DESIGNATION', 'PRT (Primary Teacher)', 'DES_PRT', 'ACTIVE', 4),
('g5555555-5555-5555-5555-555555555555', 'DESIGNATION', 'Head of Department', 'DES_HOD', 'ACTIVE', 5),

-- Subjects
('s1111111-1111-1111-1111-111111111111', 'SUBJECT', 'English Literature', 'SUB_ENG', 'ACTIVE', 1),
('s2222222-2222-2222-2222-222222222222', 'SUBJECT', 'Mathematics', 'SUB_MATH', 'ACTIVE', 2),
('s3333333-3333-3333-3333-333333333333', 'SUBJECT', 'Physics', 'SUB_PHY', 'ACTIVE', 3),
('s4444444-4444-4444-4444-444444444444', 'SUBJECT', 'Chemistry', 'SUB_CHEM', 'ACTIVE', 4),
('s5555555-5555-5555-5555-555555555555', 'SUBJECT', 'Biology', 'SUB_BIO', 'ACTIVE', 5),
('s6666666-6666-6666-6666-666666666666', 'SUBJECT', 'Computer Science', 'SUB_CS', 'ACTIVE', 6),
('s7777777-7777-7777-7777-777777777777', 'SUBJECT', 'History & Civics', 'SUB_HIST', 'ACTIVE', 7),

-- Categories
('c1111111-1111-1111-1111-111111111111', 'CATEGORY', 'Primary Wing', 'CAT_PRI', 'ACTIVE', 1),
('c2222222-2222-2222-2222-222222222222', 'CATEGORY', 'Middle Wing', 'CAT_MID', 'ACTIVE', 2),
('c3333333-3333-3333-3333-333333333333', 'CATEGORY', 'Senior Secondary Wing', 'CAT_SNR', 'ACTIVE', 3),
('c4444444-4444-4444-4444-444444444444', 'CATEGORY', 'Exam Committee', 'CAT_EXAM', 'ACTIVE', 4),
('c5555555-5555-5555-5555-555555555555', 'CATEGORY', 'Curriculum Committee', 'CAT_CURR', 'ACTIVE', 5)
ON CONFLICT (id) DO NOTHING;
