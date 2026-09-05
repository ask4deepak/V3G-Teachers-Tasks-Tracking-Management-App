-- Seed Data for Teacher Task, Workflow, Performance & Administration Web Application (Version 1)
-- Base System Roles with Granular Permissions

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
