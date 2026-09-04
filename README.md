# Teacher Task, Workflow, Performance & Administration Web Application (Version 1)

A robust, enterprise-grade teacher task management, response tracking, and performance analytics web application built with a simple, high-performance web architecture.

## 🚀 Technology Stack
- **Backend**: Node.js & Express
- **Database**: PostgreSQL (with JSONB support, connection pooling, transactions, and migration runner)
- **Frontend**: Vanilla HTML5, Vanilla CSS3 (Modern Glassmorphism, CSS variables, dark/light modes, responsive touch drawer), Vanilla JavaScript (ES6+)
- **Authentication**: Secure HttpOnly session-based auth with bcrypt password hashing and granular Role & Campus based access control
- **Import / Export**: SheetJS (`xlsx`) and CSV parser/generator with preview & validation lifecycle
- **Deployment**: Railway ready with zero client build steps

---

## 🏛️ Core Features

1. **Campus Isolation & Authorization**:
   - Multi-campus access control.
   - Separation of **User Type** (`TEACHER`, `ADMIN`, `SUPER_ADMIN`) from **Role** permissions (`Principal`, `Department Head`, `Coordinator`, etc.) and individual overrides.
   - Automatic server-side campus query scoping.

2. **Teacher Profile & Groups**:
   - Self-service teacher profile (Departments, Designations, Subjects, Categories, Class Teacher status).
   - Campus-specific Groups with joining requests, review workflow, and multi-member bulk management.

3. **Task Engine & Audience Resolution**:
   - 7-step guided task builder with live dynamic recipient preview and individual exclusions.
   - Structured JSONB question forms (Short text, Long text, Number, Date, Single choice, Multiple choice, Yes/No, Dropdown).
   - Strict `AND` logic across categories and `OR` logic within multi-select categories.
   - Transactional publication creating frozen assignments snapshot with automatic email alerts.

4. **Teacher Task Portal**:
   - Dashboard with performance stats (Assigned, Submitted On-Time, Submitted Late, Overdue, Completion %).
   - Draft auto-saving and full response submission.
   - Status tracking (`NOT_STARTED`, `IN_PROGRESS`, `SUBMITTED_ON_TIME`, `SUBMITTED_LATE`, `OVERDUE`).

5. **Recurring Task Automation**:
   - Idempotent recurring templates (Daily, Weekly, Monthly, Yearly) with deadline offsets.
   - In-process safe database scheduler that recalculates future recipient audiences dynamically.

6. **Reports & Reminders**:
   - **Task-Wise Report**: Completion rates, filterable submission table, and human-readable question response viewer.
   - **Teacher-Wise Performance Report**: Comprehensive breakdown by period with on-time percentage.
   - **Detailed Response Report**: Dynamic column selection mapping question labels to column headers.
   - **Send Reminders**: Server-validated bulk reminder system for pending/overdue recipients.
   - **Human-Readable Export**: Clean Excel / CSV export free of internal technical IDs or codes.

7. **Import & Export Centre**:
   - Multi-dataset workbook support (Users, Attributes, Groups, Members, Masters).
   - New Data & Edit Existing Data modes.
   - 5-step transactional pipeline: Upload ➔ Parse ➔ Validate ➔ Preview Warnings/Errors ➔ Commit.

8. **Audit Logging & Security**:
   - Immutable audit logs scoped by campus for all critical administrative actions.
   - Rate limiting, parameterized SQL queries, HttpOnly cookies, and strict input validation.

---

## 🛠️ Local Development & Setup

### 1. Prerequisites
- Node.js (v18+)
- PostgreSQL (or Railway PostgreSQL database)

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Run the Application
```bash
npm start
```
The application will automatically initialize the database schema and seed the default Super Admin user and demo master data.

### 5. Run Automated Tests
```bash
npm test
```

---

## 🔐 Default Credentials (Initial Seed)
- **Super Admin**: `superadmin@institution.edu` / `Admin@123`
- **Campus Admin**: `admin.north@institution.edu` / `Admin@123`
- **Teacher**: `teacher.sarah@institution.edu` / `Teacher@123`
