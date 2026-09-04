-- Database Schema for Teacher Task, Workflow, Performance & Administration Web Application (Version 1)
-- Requires PostgreSQL 13+ (or gen_random_uuid extension)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Campuses
CREATE TABLE IF NOT EXISTS campuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    user_type VARCHAR(50) NOT NULL DEFAULT 'TEACHER', -- 'TEACHER', 'ADMIN', 'SUPER_ADMIN'
    employee_code VARCHAR(100) UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'INACTIVE', 'SUSPENDED'
    class_teacher_status BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Roles
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Master Values
CREATE TABLE IF NOT EXISTS master_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_type VARCHAR(50) NOT NULL, -- 'DEPARTMENT', 'DESIGNATION', 'SUBJECT', 'CATEGORY'
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100),
    campus_id UUID REFERENCES campuses(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. User Attributes (Multi-value mapping to Masters)
CREATE TABLE IF NOT EXISTS user_attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    master_value_id UUID NOT NULL REFERENCES master_values(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_user_campus_master UNIQUE (user_id, campus_id, master_value_id)
);

-- 6. User Access (Roles, Campus Scopes & Overrides)
CREATE TABLE IF NOT EXISTS user_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    campus_id UUID REFERENCES campuses(id) ON DELETE CASCADE,
    permission_overrides JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_role_campus UNIQUE (user_id, role_id, campus_id)
);

-- 7. Groups
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    allow_join_requests BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Group Memberships
CREATE TABLE IF NOT EXISTS group_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    membership_role VARCHAR(50) NOT NULL DEFAULT 'MEMBER', -- 'MEMBER', 'GROUP_ADMIN'
    status VARCHAR(50) NOT NULL DEFAULT 'APPROVED', -- 'PENDING', 'APPROVED', 'REJECTED', 'REMOVED'
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_group_user UNIQUE (group_id, user_id)
);

-- 9. Tasks (One-time, recurring templates, and generated instances)
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type VARCHAR(50) NOT NULL DEFAULT 'ONE_TIME', -- 'ONE_TIME', 'RECURRING_TEMPLATE', 'RECURRING_INSTANCE'
    parent_template_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    campus_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    audience_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    recipient_exclusions JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'
    open_at TIMESTAMPTZ,
    deadline_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    recurrence_config JSONB DEFAULT NULL,
    next_generation_at TIMESTAMPTZ,
    recurrence_status VARCHAR(50) DEFAULT 'ACTIVE', -- 'ACTIVE', 'PAUSED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Assignments
CREATE TABLE IF NOT EXISTS assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    due_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'NOT_STARTED', -- 'NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED_ON_TIME', 'SUBMITTED_LATE', 'OVERDUE'
    excluded_flag BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_task_user UNIQUE (task_id, user_id)
);

-- 11. Submissions
CREATE TABLE IF NOT EXISTS submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL UNIQUE REFERENCES assignments(id) ON DELETE CASCADE,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    draft_flag BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    campus_id UUID REFERENCES campuses(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255),
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Session Store Table (for connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
    sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

-- Key Indexes for Fast Querying and Campus Isolation
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);

CREATE INDEX IF NOT EXISTS idx_master_values_type ON master_values(master_type);
CREATE INDEX IF NOT EXISTS idx_master_values_campus ON master_values(campus_id);

CREATE INDEX IF NOT EXISTS idx_user_attributes_user ON user_attributes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_attributes_campus ON user_attributes(campus_id);
CREATE INDEX IF NOT EXISTS idx_user_attributes_master ON user_attributes(master_value_id);

CREATE INDEX IF NOT EXISTS idx_user_access_user ON user_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_access_campus ON user_access(campus_id);

CREATE INDEX IF NOT EXISTS idx_group_memberships_group ON group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_group_memberships_user ON group_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_group_memberships_status ON group_memberships(status);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_template ON tasks(parent_template_id);
CREATE INDEX IF NOT EXISTS idx_tasks_next_generation ON tasks(next_generation_at);

CREATE INDEX IF NOT EXISTS idx_assignments_task ON assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_campus ON assignments(campus_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);

CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_campus ON audit_logs(campus_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
