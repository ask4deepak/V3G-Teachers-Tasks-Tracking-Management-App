/**
 * Frontend Application Engine (app.js)
 * Teacher Task, Workflow, Performance & Administration Web Application (Version 1)
 */

// ============================================================================
// 1. STATE & INITIALIZATION
// ============================================================================

const state = {
  user: null,
  currentRoute: 'dashboard',
  campuses: [],
  masters: [],
  filters: {},
  pendingGroupRequestsCount: 0,
  taskBuilder: null // Transient task builder state
};

// Global DOM references
const elements = {
  viewLogin: document.getElementById('view-login'),
  appShell: document.getElementById('app-shell'),
  formLogin: document.getElementById('form-login'),
  loginEmail: document.getElementById('login-email'),
  loginPassword: document.getElementById('login-password'),
  btnLogin: document.getElementById('btn-login'),
  sidebar: document.getElementById('sidebar'),
  sidebarOverlay: document.getElementById('sidebar-overlay'),
  sidebarNav: document.getElementById('sidebar-nav'),
  navUserName: document.getElementById('nav-user-name'),
  navUserRole: document.getElementById('nav-user-role'),
  navUserAvatar: document.getElementById('nav-user-avatar'),
  pageTitle: document.getElementById('page-title'),
  pageCampusScope: document.getElementById('page-campus-scope'),
  mainContent: document.getElementById('main-content'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
  btnCloseSidebar: document.getElementById('btn-close-sidebar'),
  btnLogout: document.getElementById('btn-logout'),
  themeToggle: document.getElementById('theme-toggle'),
  modalContainer: document.getElementById('modal-container'),
  modalContent: document.getElementById('modal-content'),
  toastContainer: document.getElementById('toast-container')
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  setupGlobalEvents();
  await checkAuthSession();
});

// ============================================================================
// 2. API CLIENT & TOAST HELPERS
// ============================================================================

async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    options.body = JSON.stringify(options.body);
  }
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  try {
    const res = await fetch(`/api${endpoint}`, { credentials: 'same-origin', headers, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed with status ${res.status}`);
    }
    return data;
  } catch (err) {
    showToast(err.message, 'danger');
    throw err;
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const iconMap = {
    success: 'fa-circle-check',
    danger: 'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };
  toast.innerHTML = `
    <i class="fa-solid ${iconMap[type] || iconMap.info}"></i>
    <div style="flex:1; font-size: 0.9rem;">${escapeHtml(message)}</div>
  `;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openModal(htmlContent) {
  elements.modalContent.innerHTML = htmlContent;
  elements.modalContainer.classList.remove('hidden');
}

function closeModal() {
  elements.modalContainer.classList.add('hidden');
  elements.modalContent.innerHTML = '';
}

// ============================================================================
// 3. AUTHENTICATION & SESSION MANAGEMENT
// ============================================================================

async function checkAuthSession() {
  try {
    const user = await api('/auth/me');
    state.user = user;
    renderAuthenticatedApp();
  } catch {
    renderLoginView();
  }
}

function renderLoginView() {
  state.user = null;
  elements.appShell.classList.add('hidden');
  elements.viewLogin.classList.remove('hidden');
}

function renderAuthenticatedApp() {
  elements.viewLogin.classList.add('hidden');
  elements.appShell.classList.remove('hidden');

  // Set Profile Display
  elements.navUserName.textContent = state.user.display_name;
  elements.navUserRole.textContent = state.user.roles[0] || state.user.user_type;
  elements.navUserAvatar.textContent = (state.user.first_name || 'U').charAt(0).toUpperCase();

  // Set Campus Badge
  const campusNames = state.user.campuses && state.user.campuses.length > 0 
    ? state.user.campuses.map(c => c.name).join(', ') 
    : 'All Campuses';
  elements.pageCampusScope.textContent = campusNames;

  buildSidebarNav();
  navigateTo(state.user.user_type === 'TEACHER' ? 'teacher-dashboard' : 'admin-dashboard');
  fetchPendingGroupRequestsCount();
}

function demoLogin(email, password) {
  elements.loginEmail.value = email;
  elements.loginPassword.value = password;
  elements.btnLogin.click();
}

async function fetchPendingGroupRequestsCount() {
  if (hasPermission('groups.approve_requests')) {
    try {
      const res = await api('/group-requests/pending-count');
      state.pendingGroupRequestsCount = res.count;
      updatePendingBadge();
    } catch {
      // Ignored
    }
  }
}

function updatePendingBadge() {
  const badge = document.getElementById('badge-pending-group-requests');
  if (badge) {
    badge.textContent = state.pendingGroupRequestsCount;
    badge.style.display = state.pendingGroupRequestsCount > 0 ? 'inline-block' : 'none';
  }
}

function hasPermission(permissionKey) {
  if (!state.user) return false;
  if (state.user.isSuperAdmin || state.user.user_type === 'SUPER_ADMIN') return true;
  if (state.user.permissions && state.user.permissions['*']) return true;
  return Boolean(state.user.permissions && state.user.permissions[permissionKey]);
}

// ============================================================================
// 4. NAVIGATION & ROUTING
// ============================================================================

function buildSidebarNav() {
  const nav = elements.sidebarNav;
  nav.innerHTML = '';

  const isTeacherOnly = state.user.user_type === 'TEACHER';

  if (isTeacherOnly) {
    // TEACHER NAVIGATION
    addNavItem(nav, 'teacher-dashboard', 'fa-gauge-high', 'Dashboard');
    addNavItem(nav, 'teacher-tasks', 'fa-list-check', 'My Tasks');
    addNavItem(nav, 'teacher-history', 'fa-clock-rotate-left', 'Task History');
    addNavItem(nav, 'teacher-performance', 'fa-chart-line', 'My Performance');
    addNavItem(nav, 'teacher-groups', 'fa-users-rectangle', 'Groups');
    addNavItem(nav, 'my-profile', 'fa-id-badge', 'My Profile');
  } else {
    // ADMIN NAVIGATION (Subject to granular permissions)
    addNavSectionTitle(nav, 'Administration');
    addNavItem(nav, 'admin-dashboard', 'fa-gauge-high', 'Dashboard');

    if (hasPermission('tasks.view')) {
      addNavItem(nav, 'tasks', 'fa-list-check', 'Tasks');
    }
    if (hasPermission('recurring_tasks.view')) {
      addNavItem(nav, 'recurring-tasks', 'fa-repeat', 'Recurring Tasks');
    }
    if (hasPermission('reports.task_wise.view') || hasPermission('reports.teacher_wise.view') || hasPermission('reports.detailed.view')) {
      addNavItem(nav, 'reports-task-wise', 'fa-chart-pie', 'Task-Wise Reports');
      addNavItem(nav, 'reports-detailed', 'fa-table-columns', 'Detailed Responses');
      addNavItem(nav, 'reports-teacher-wise', 'fa-chart-line', 'Teacher Performance');
    }
    if (hasPermission('users.view')) {
      addNavItem(nav, 'users', 'fa-chalkboard-user', 'Users / Teachers');
    }
    if (hasPermission('groups.view')) {
      addNavItem(nav, 'groups', 'fa-users-rectangle', 'Groups');
    }
    if (hasPermission('groups.approve_requests')) {
      addNavItem(nav, 'group-requests', 'fa-user-check', 'Group Requests', true);
    }
    if (hasPermission('masters.view')) {
      addNavItem(nav, 'masters', 'fa-layer-group', 'Master Data');
    }
    if (hasPermission('imports.execute') || hasPermission('exports.execute')) {
      addNavItem(nav, 'import-export', 'fa-file-excel', 'Import & Export');
    }
    if (hasPermission('audit.view')) {
      addNavItem(nav, 'audit-logs', 'fa-shield-halved', 'Audit Log');
    }
    if (state.user.user_type === 'SUPER_ADMIN' || state.user.isSuperAdmin) {
      addNavItem(nav, 'roles', 'fa-key', 'Roles & Access');
    }

    // HYBRID / DUAL-ROLE: Teacher Workspace for Admins, Principals & Academic Coordinators
    addNavSectionTitle(nav, 'My Teacher Workspace');
    addNavItem(nav, 'teacher-tasks', 'fa-list-check', 'My Assigned Tasks');
    addNavItem(nav, 'teacher-history', 'fa-clock-rotate-left', 'Submission History');
    addNavItem(nav, 'teacher-performance', 'fa-chart-line', 'My Performance');
    addNavItem(nav, 'my-profile', 'fa-id-badge', 'My Profile');
  }
}

function addNavSectionTitle(container, title) {
  const el = document.createElement('div');
  el.className = 'nav-section-title';
  el.innerHTML = `<span>${title}</span>`;
  container.appendChild(el);
}

function addNavItem(container, route, icon, label, hasBadge = false) {
  const btn = document.createElement('button');
  btn.className = `nav-item ${state.currentRoute === route ? 'active' : ''}`;
  btn.onclick = () => {
    navigateTo(route);
    closeMobileSidebar();
  };
  btn.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${label}</span>
    ${hasBadge ? `<span id="badge-pending-group-requests" class="nav-badge" style="display:none">0</span>` : ''}
  `;
  container.appendChild(btn);
}

function navigateTo(route) {
  state.currentRoute = route;

  // Update active state in nav
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const currentNav = Array.from(document.querySelectorAll('.nav-item')).find(el => el.textContent.trim().toLowerCase().includes(route.replace('-', ' ')));
  if (currentNav) currentNav.classList.add('active');

  loadCurrentView();
}

function loadCurrentView() {
  elements.btnRefresh.disabled = true;
  elements.btnRefresh.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span class="hide-sm">Refreshing...</span>`;

  renderCurrentView().finally(() => {
    elements.btnRefresh.disabled = false;
    elements.btnRefresh.innerHTML = `<i class="fa-solid fa-rotate"></i> <span class="hide-sm">Refresh</span>`;
  });
}

async function renderCurrentView() {
  const route = state.currentRoute;
  const container = elements.mainContent;

  switch (route) {
    // Teacher Views
    case 'teacher-dashboard':
      elements.pageTitle.textContent = 'Teacher Dashboard';
      await renderTeacherDashboard(container);
      break;
    case 'teacher-tasks':
      elements.pageTitle.textContent = 'My Assigned Tasks';
      await renderTeacherTasks(container);
      break;
    case 'teacher-history':
      elements.pageTitle.textContent = 'Submission History';
      await renderTeacherHistory(container);
      break;
    case 'teacher-performance':
      elements.pageTitle.textContent = 'My Performance';
      await renderTeacherPerformance(container);
      break;
    case 'teacher-groups':
      elements.pageTitle.textContent = 'Faculty Groups';
      await renderTeacherGroups(container);
      break;
    case 'my-profile':
      elements.pageTitle.textContent = 'My Profile';
      await renderMyProfile(container);
      break;

    // Admin Views
    case 'admin-dashboard':
      elements.pageTitle.textContent = 'Institutional Dashboard';
      await renderAdminDashboard(container);
      break;
    case 'tasks':
      elements.pageTitle.textContent = 'Task Management';
      await renderAdminTasks(container);
      break;
    case 'task-builder':
      elements.pageTitle.textContent = 'Guided Task Builder';
      await renderTaskBuilder(container);
      break;
    case 'recurring-tasks':
      elements.pageTitle.textContent = 'Recurring Task Templates';
      await renderRecurringTasks(container);
      break;
    case 'reports-task-wise':
      elements.pageTitle.textContent = 'Task-Wise Reports';
      await renderTaskWiseReport(container);
      break;
    case 'reports-teacher-wise':
      elements.pageTitle.textContent = 'Teacher Performance Report';
      await renderTeacherWiseReport(container);
      break;
    case 'reports-detailed':
      elements.pageTitle.textContent = 'Detailed Response Report';
      await renderDetailedResponseReport(container);
      break;
    case 'users':
      elements.pageTitle.textContent = 'Faculty & User Directory';
      await renderUsersDirectory(container);
      break;
    case 'groups':
      elements.pageTitle.textContent = 'Group Management';
      await renderAdminGroups(container);
      break;
    case 'group-requests':
      elements.pageTitle.textContent = 'Group Joining Requests';
      await renderGroupRequests(container);
      break;
    case 'masters':
      elements.pageTitle.textContent = 'Master Data Management';
      await renderMasterData(container);
      break;
    case 'import-export':
      elements.pageTitle.textContent = 'Import & Export Centre';
      await renderImportExport(container);
      break;
    case 'audit-logs':
      elements.pageTitle.textContent = 'Audit Log Timeline';
      await renderAuditLogs(container);
      break;
    case 'roles':
      elements.pageTitle.textContent = 'Roles & Permissions';
      await renderRolesManagement(container);
      break;

    default:
      container.innerHTML = `<div class="empty-state"><h3>View not found</h3></div>`;
  }
}

// ============================================================================
// 5. TEACHER PORTAL VIEWS
// ============================================================================

async function renderTeacherDashboard(container) {
  const [tasks, perf] = await Promise.all([
    api('/teacher/tasks'),
    api('/teacher/performance')
  ]);

  const dueSoon = tasks.filter(t => t.status === 'NOT_STARTED' || t.status === 'IN_PROGRESS').slice(0, 3);
  const overdue = tasks.filter(t => t.status === 'OVERDUE');

  container.innerHTML = `
    <!-- Performance Summary Cards -->
    <div class="kpi-grid">
      <div class="kpi-card" onclick="navigateTo('teacher-tasks')">
        <div class="kpi-icon blue"><i class="fa-solid fa-list-check"></i></div>
        <div>
          <div class="kpi-value">${perf.total_assigned}</div>
          <div class="kpi-label">Total Assigned</div>
        </div>
      </div>
      <div class="kpi-card" onclick="navigateTo('teacher-tasks')">
        <div class="kpi-icon green"><i class="fa-solid fa-circle-check"></i></div>
        <div>
          <div class="kpi-value">${perf.submitted_on_time}</div>
          <div class="kpi-label">Submitted On Time</div>
        </div>
      </div>
      <div class="kpi-card" onclick="navigateTo('teacher-tasks')">
        <div class="kpi-icon yellow"><i class="fa-solid fa-clock"></i></div>
        <div>
          <div class="kpi-value">${perf.submitted_late}</div>
          <div class="kpi-label">Submitted Late</div>
        </div>
      </div>
      <div class="kpi-card" onclick="navigateTo('teacher-tasks')">
        <div class="kpi-icon red"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div>
          <div class="kpi-value">${perf.overdue}</div>
          <div class="kpi-label">Overdue</div>
        </div>
      </div>
      <div class="kpi-card" onclick="navigateTo('teacher-performance')">
        <div class="kpi-icon purple"><i class="fa-solid fa-percent"></i></div>
        <div>
          <div class="kpi-value">${perf.completion_rate}%</div>
          <div class="kpi-label">Completion Rate</div>
        </div>
      </div>
    </div>

    <!-- Due Soon / Pending Section -->
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-fire text-warning"></i> Tasks Due Soon & Action Items</h2>
        <button class="btn btn-secondary btn-sm" onclick="navigateTo('teacher-tasks')">View All Tasks</button>
      </div>
      <div class="card-body">
        ${dueSoon.length === 0 ? `
          <div class="empty-state">
            <i class="fa-solid fa-circle-check text-success"></i>
            <h3>You are all caught up!</h3>
            <p>No pending tasks currently require your attention.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Task Title</th>
                  <th>Assigned Date</th>
                  <th>Deadline</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${dueSoon.map(t => `
                  <tr>
                    <td><strong>${escapeHtml(t.title)}</strong></td>
                    <td>${formatDate(t.assigned_at)}</td>
                    <td><strong class="text-danger">${formatDateTime(t.due_at)}</strong></td>
                    <td><span class="badge badge-${t.status.toLowerCase().replace(/_/g, '-')}">${formatStatus(t.status)}</span></td>
                    <td>
                      <button class="btn btn-primary btn-sm" onclick="openTaskSubmissionModal('${t.task_id}')">
                        <i class="fa-solid fa-pen-to-square"></i> Fill Response
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

async function renderTeacherTasks(container) {
  const tasks = await api('/teacher/tasks');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-list-check"></i> Assigned Institutional Tasks</h2>
      </div>
      <div class="card-body">
        ${tasks.length === 0 ? `
          <div class="empty-state">
            <i class="fa-solid fa-inbox"></i>
            <h3>No Tasks Assigned</h3>
            <p>You do not have any active or past task assignments.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Task Title</th>
                  <th>Assigned On</th>
                  <th>Deadline</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${tasks.map(t => {
                  const now = new Date();
                  const isScheduled = t.is_scheduled || (t.open_at && new Date(t.open_at) > now);
                  const isPaused = t.task_status === 'PAUSED';
                  const isPastDue = new Date(t.due_at) < now;
                  const isSubmitted = t.status === 'SUBMITTED_ON_TIME' || t.status === 'SUBMITTED_LATE';
                  const isLateBlocked = !t.allow_late_submissions && isPastDue && !isSubmitted;
                  const canEditSubmitted = isSubmitted && t.allow_edit_submission && !isPaused && !isScheduled && (!isPastDue || t.allow_late_submissions !== false);

                  let statusBadge = `<span class="badge badge-${t.status.toLowerCase().replace(/_/g, '-')}">${formatStatus(t.status)}</span>`;
                  if (isScheduled) {
                    statusBadge = `<span class="badge badge-scheduled"><i class="fa-solid fa-calendar-clock"></i> Scheduled (${formatDateTime(t.open_at)})</span>`;
                  } else if (isPaused) {
                    statusBadge = `<span class="badge badge-paused"><i class="fa-solid fa-pause"></i> Paused by Admin</span>`;
                  } else if (isLateBlocked) {
                    statusBadge = `<span class="badge badge-overdue"><i class="fa-solid fa-ban"></i> Closed (No Late Submissions)</span>`;
                  } else if (canEditSubmitted) {
                    statusBadge += ` <span class="badge badge-in-progress" style="margin-left:4px;" title="Editing allowed by assignor"><i class="fa-solid fa-pen-to-square"></i> Editable</span>`;
                  }

                  let actionBtn = '';
                  if (canEditSubmitted) {
                    actionBtn = `
                      <button class="btn btn-outline btn-sm" onclick="openTaskSubmissionModal('${t.task_id}')" title="Edit and update your previous submission">
                        <i class="fa-solid fa-pen-to-square"></i> Edit Response
                      </button>
                    `;
                  } else if (isSubmitted) {
                    actionBtn = `
                      <button class="btn btn-secondary btn-sm" onclick="openTaskSubmissionModal('${t.task_id}')">
                        <i class="fa-solid fa-eye"></i> View Response
                      </button>
                    `;
                  } else {
                    actionBtn = `
                      <button class="btn btn-primary btn-sm" onclick="openTaskSubmissionModal('${t.task_id}')">
                        <i class="fa-solid ${t.draft_flag ? 'fa-pen-to-square' : (isScheduled ? 'fa-eye' : 'fa-paper-plane')}"></i> ${t.draft_flag ? 'Resume Draft' : (isScheduled ? 'View Details' : 'Complete Task')}
                      </button>
                    `;
                  }

                  return `
                    <tr>
                      <td>
                        <strong>${escapeHtml(t.title)}</strong>
                        ${t.description ? `<p style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">${escapeHtml(t.description)}</p>` : ''}
                      </td>
                      <td>${formatDate(t.assigned_at)}</td>
                      <td>
                        <strong>${formatDateTime(t.due_at)}</strong>
                        ${!t.allow_late_submissions ? `<div style="font-size:0.75rem; color:var(--danger); margin-top:2px;"><i class="fa-solid fa-lock"></i> Strict Deadline</div>` : ''}
                      </td>
                      <td>${statusBadge}</td>
                      <td>${actionBtn}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

async function renderTeacherHistory(container) {
  const tasks = await api('/teacher/tasks');
  const submitted = tasks.filter(t => t.submitted_at);

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-clock-rotate-left"></i> Submission History & Archives</h2>
      </div>
      <div class="card-body">
        ${submitted.length === 0 ? `
          <div class="empty-state">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <h3>No Submissions Found</h3>
            <p>You have not submitted any task responses yet.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Task Title</th>
                  <th>Assigned Date</th>
                  <th>Deadline</th>
                  <th>Submitted At</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${submitted.map(t => `
                  <tr>
                    <td><strong>${escapeHtml(t.title)}</strong></td>
                    <td>${formatDate(t.assigned_at)}</td>
                    <td>${formatDateTime(t.due_at)}</td>
                    <td>${formatDateTime(t.submitted_at)}</td>
                    <td><span class="badge badge-${t.status.toLowerCase().replace(/_/g, '-')}">${formatStatus(t.status)}</span></td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="openTaskSubmissionModal('${t.task_id}')">
                        <i class="fa-solid fa-eye"></i> View Answers
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

async function renderTeacherPerformance(container) {
  const perf = await api('/teacher/performance');

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon blue"><i class="fa-solid fa-list-check"></i></div>
        <div>
          <div class="kpi-value">${perf.total_assigned}</div>
          <div class="kpi-label">Total Assigned</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon green"><i class="fa-solid fa-circle-check"></i></div>
        <div>
          <div class="kpi-value">${perf.submitted_on_time}</div>
          <div class="kpi-label">On-Time Submissions</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon yellow"><i class="fa-solid fa-clock"></i></div>
        <div>
          <div class="kpi-value">${perf.submitted_late}</div>
          <div class="kpi-label">Late Submissions</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon purple"><i class="fa-solid fa-percent"></i></div>
        <div>
          <div class="kpi-value">${perf.on_time_rate}%</div>
          <div class="kpi-label">On-Time Reliability</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-chart-pie"></i> Performance Reliability Metrics</h2>
      </div>
      <div class="card-body">
        <div style="display: flex; flex-direction: column; gap: 20px;">
          <div>
            <div style="display:flex; justify-content:space-between; margin-bottom: 6px; font-weight: 600;">
              <span>Overall Task Completion Rate</span>
              <span>${perf.completion_rate}% (${perf.completed} / ${perf.total_assigned})</span>
            </div>
            <div style="height: 12px; background-color: var(--border-color); border-radius: 6px; overflow: hidden;">
              <div style="height: 100%; width: ${perf.completion_rate}%; background-color: var(--primary);"></div>
            </div>
          </div>

          <div>
            <div style="display:flex; justify-content:space-between; margin-bottom: 6px; font-weight: 600;">
              <span>On-Time Punctuality Rate</span>
              <span>${perf.on_time_rate}% (${perf.submitted_on_time} / ${perf.total_assigned})</span>
            </div>
            <div style="height: 12px; background-color: var(--border-color); border-radius: 6px; overflow: hidden;">
              <div style="height: 100%; width: ${perf.on_time_rate}%; background-color: var(--success);"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Teacher Dynamic Task Submission Modal
async function openTaskSubmissionModal(taskId) {
  const data = await api(`/teacher/tasks/${taskId}`);
  const { task, assignment, submission } = data;
  const questions = typeof task.questions === 'string' ? JSON.parse(task.questions) : (task.questions || []);
  const answers = submission ? submission.answers : {};
  const isSubmitted = submission && !submission.draft_flag;
  const now = new Date();
  const isScheduled = task.is_scheduled || (task.open_at && new Date(task.open_at) > now);
  const isPaused = task.status === 'PAUSED';
  const isPastDue = new Date(assignment.due_at) < now;
  const isLateBlocked = !task.allow_late_submissions && isPastDue && !isSubmitted;
  const canEdit = !isScheduled && !isPaused && (!isSubmitted || task.allow_edit_submission) && !isLateBlocked;

  const html = `
    <div class="card-header">
      <div>
        <h3>${escapeHtml(task.title)}</h3>
        <span style="font-size:0.8rem; color:var(--text-muted);">Due: ${formatDateTime(assignment.due_at)}</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      ${isScheduled ? `
        <div style="background:rgba(59,130,246,0.1); border-left:4px solid var(--primary); padding:12px; margin-bottom:16px; border-radius:4px;">
          <strong style="color:var(--primary);"><i class="fa-solid fa-clock"></i> Scheduled Task</strong>
          <p style="margin:4px 0 0 0; font-size:0.88rem; color:var(--text-muted);">This task is scheduled to open on <strong>${formatDateTime(task.open_at)}</strong>. Responses cannot be submitted until then.</p>
        </div>
      ` : ''}

      ${isPaused ? `
        <div style="background:rgba(234,179,8,0.1); border-left:4px solid #ca8a04; padding:12px; margin-bottom:16px; border-radius:4px;">
          <strong style="color:#ca8a04;"><i class="fa-solid fa-pause"></i> Task Paused</strong>
          <p style="margin:4px 0 0 0; font-size:0.88rem; color:var(--text-muted);">This task has been temporarily paused by administration. Submissions are suspended.</p>
        </div>
      ` : ''}

      ${isLateBlocked ? `
        <div style="background:rgba(239,68,68,0.1); border-left:4px solid var(--danger); padding:12px; margin-bottom:16px; border-radius:4px;">
          <strong style="color:var(--danger);"><i class="fa-solid fa-lock"></i> Late Submissions Closed</strong>
          <p style="margin:4px 0 0 0; font-size:0.88rem; color:var(--text-muted);">The deadline has expired and late submissions are not allowed for this task.</p>
        </div>
      ` : ''}

      ${(isSubmitted && task.allow_edit_submission && canEdit) ? `
        <div style="background:rgba(16,185,129,0.1); border-left:4px solid var(--success); padding:12px; margin-bottom:16px; border-radius:4px;">
          <strong style="color:var(--success);"><i class="fa-solid fa-circle-check"></i> Response Previously Submitted (${formatDateTime(submission.submitted_at)})</strong>
          <p style="margin:4px 0 0 0; font-size:0.88rem; color:var(--text-muted);">The assignor allows editing responses. You can modify your answers below and click <strong>Update Response</strong> to resubmit.</p>
        </div>
      ` : (isSubmitted && !task.allow_edit_submission ? `
        <div style="background:rgba(59,130,246,0.1); border-left:4px solid var(--primary); padding:12px; margin-bottom:16px; border-radius:4px;">
          <strong style="color:var(--primary);"><i class="fa-solid fa-circle-check"></i> Response Submitted (${formatDateTime(submission.submitted_at)})</strong>
          <p style="margin:4px 0 0 0; font-size:0.88rem; color:var(--text-muted);">Your response has been finalized and recorded. Editing after submission is not enabled for this task.</p>
        </div>
      ` : '')}

      ${task.description ? `<p style="margin-bottom: 20px; color:var(--text-muted);">${escapeHtml(task.description)}</p>` : ''}
      
      <form id="form-task-submission">
        ${questions.map((q, idx) => `
          <div class="form-group question-block">
            <label>
              <strong>${idx + 1}. ${escapeHtml(q.label)}</strong>
              ${q.required ? `<span class="text-danger">*</span>` : ''}
            </label>
            ${renderQuestionInput(q, answers[q.key], !canEdit)}
          </div>
        `).join('')}

        ${canEdit ? `
          <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
            <button type="button" class="btn btn-secondary" onclick="submitTaskResponse('${taskId}', true)">
              <i class="fa-regular fa-floppy-disk"></i> Save Draft
            </button>
            <button type="button" class="btn btn-primary" onclick="submitTaskResponse('${taskId}', false)">
              <i class="fa-solid ${isSubmitted ? 'fa-floppy-disk' : 'fa-paper-plane'}"></i> ${isSubmitted ? 'Update Response' : 'Submit Final Response'}
            </button>
          </div>
        ` : `
          <div style="display:flex; justify-content:flex-end; margin-top:20px;">
            <button type="button" class="btn btn-secondary" onclick="closeModal()">Close</button>
          </div>
        `}
      </form>
    </div>
  `;

  openModal(html);
}

function renderQuestionInput(q, value, disabled = false) {
  const dis = disabled ? 'disabled' : '';
  const key = escapeHtml(q.key);

  if (q.type === 'number') {
    return `<input type="number" name="q_${key}" class="form-input" value="${value || ''}" ${q.required ? 'required' : ''} ${dis} />`;
  }
  if (q.type === 'long_text') {
    return `<textarea name="q_${key}" class="form-textarea" ${q.required ? 'required' : ''} ${dis}>${escapeHtml(value || '')}</textarea>`;
  }
  if (q.type === 'date') {
    return `<input type="date" name="q_${key}" class="form-input" value="${value || ''}" ${q.required ? 'required' : ''} ${dis} />`;
  }
  if (q.type === 'single_choice' && q.options) {
    return q.options.map(opt => `
      <label class="checkbox-label" style="margin-top:6px;">
        <input type="radio" name="q_${key}" value="${escapeHtml(opt)}" ${value === opt ? 'checked' : ''} ${dis} />
        ${escapeHtml(opt)}
      </label>
    `).join('');
  }
  if (q.type === 'multiple_choice' && q.options) {
    const arr = Array.isArray(value) ? value : [];
    return q.options.map(opt => `
      <label class="checkbox-label" style="margin-top:6px;">
        <input type="checkbox" name="q_${key}" value="${escapeHtml(opt)}" ${arr.includes(opt) ? 'checked' : ''} ${dis} />
        ${escapeHtml(opt)}
      </label>
    `).join('');
  }
  if (q.type === 'yes_no') {
    return `
      <div style="display:flex; gap:20px; margin-top:6px;">
        <label class="checkbox-label">
          <input type="radio" name="q_${key}" value="Yes" ${value === 'Yes' ? 'checked' : ''} ${dis} /> Yes
        </label>
        <label class="checkbox-label">
          <input type="radio" name="q_${key}" value="No" ${value === 'No' ? 'checked' : ''} ${dis} /> No
        </label>
      </div>
    `;
  }
  if (q.type === 'dropdown' && q.options) {
    return `
      <select name="q_${key}" class="form-select" ${dis}>
        <option value="">-- Select Option --</option>
        ${q.options.map(opt => `<option value="${escapeHtml(opt)}" ${value === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}
      </select>
    `;
  }
  // Default short_text
  return `<input type="text" name="q_${key}" class="form-input" value="${escapeHtml(value || '')}" ${q.required ? 'required' : ''} ${dis} />`;
}

async function submitTaskResponse(taskId, isDraft = false) {
  const form = document.getElementById('form-task-submission');
  if (!form) return;

  const formData = new FormData(form);
  const answers = {};

  for (const [name, val] of formData.entries()) {
    if (name.startsWith('q_')) {
      const key = name.substring(2);
      if (answers[key]) {
        if (Array.isArray(answers[key])) {
          answers[key].push(val);
        } else {
          answers[key] = [answers[key], val];
        }
      } else {
        answers[key] = val;
      }
    }
  }

  try {
    const res = await api(`/teacher/tasks/${taskId}/submit`, {
      method: 'POST',
      body: { answers, is_draft: isDraft }
    });
    showToast(res.message, 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Ignored (handled in api helper)
  }
}

// Teacher Groups View
async function renderTeacherGroups(container) {
  const groups = await api('/groups');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-users-rectangle"></i> Campus Faculty Groups & Communities</h2>
      </div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Group Name</th>
                <th>Campus</th>
                <th>Description</th>
                <th>Members</th>
                <th>Your Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${groups.map(g => `
                <tr>
                  <td><strong>${escapeHtml(g.name)}</strong></td>
                  <td>${escapeHtml(g.campus_name)}</td>
                  <td>${escapeHtml(g.description || 'N/A')}</td>
                  <td><span class="badge badge-in-progress">${g.member_count} Members</span></td>
                  <td>
                    ${g.user_membership_status === 'APPROVED' ? `<span class="badge badge-active"><i class="fa-solid fa-check"></i> Member</span>` : (g.user_membership_status === 'PENDING' ? `<span class="badge badge-pending"><i class="fa-solid fa-clock"></i> Pending Approval</span>` : `<span class="badge badge-not-started">Not Joined</span>`)}
                  </td>
                  <td>
                    ${!g.user_membership_status ? `
                      <button class="btn btn-primary btn-sm" onclick="requestGroupJoin('${g.id}', '${escapeHtml(g.name)}')">
                        <i class="fa-solid fa-user-plus"></i> Request to Join
                      </button>
                    ` : (g.user_membership_status === 'PENDING' ? `<span style="font-size:0.8rem; color:var(--text-muted);">Request in Review</span>` : `<span style="font-size:0.8rem; color:var(--success); font-weight:600;">Enrolled</span>`)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function requestGroupJoin(groupId, groupName) {
  try {
    await api(`/groups/${groupId}/join`, { method: 'POST' });
    showToast(`Membership request submitted for "${groupName}"`, 'success');
    loadCurrentView();
  } catch {
    // Ignored
  }
}

// Teacher My Profile
async function renderMyProfile(container) {
  const [profileData, campuses, depts, desigs, subjs, cats] = await Promise.all([
    api('/profile'),
    api('/campuses'),
    api('/masters?master_type=DEPARTMENT'),
    api('/masters?master_type=DESIGNATION'),
    api('/masters?master_type=SUBJECT'),
    api('/masters?master_type=CATEGORY')
  ]);

  const { user, attributes } = profileData;
  const userDeptId = attributes.find(a => a.master_type === 'DEPARTMENT')?.master_value_id;
  const userDesigId = attributes.find(a => a.master_type === 'DESIGNATION')?.master_value_id;
  const userSubjectIds = attributes.filter(a => a.master_type === 'SUBJECT').map(a => a.master_value_id);
  const userCategoryIds = attributes.filter(a => a.master_type === 'CATEGORY').map(a => a.master_value_id);
  const currentCampusId = attributes[0]?.campus_id || (campuses[0] ? campuses[0].id : '');

  container.innerHTML = `
    <div class="card" style="max-width: 800px; margin: 0 auto;">
      <div class="card-header">
        <h2><i class="fa-solid fa-id-badge"></i> Edit Permitted Profile Attributes</h2>
      </div>
      <div class="card-body">
        <form id="form-my-profile" onsubmit="handleProfileSubmit(event)">
          <div class="form-group">
            <label>Display Name</label>
            <input type="text" class="form-input" value="${escapeHtml(user.display_name)}" disabled />
          </div>
          <div class="form-group">
            <label>Institutional Email</label>
            <input type="email" class="form-input" value="${escapeHtml(user.email)}" disabled />
          </div>
          <div class="form-group">
            <label>Employee Code</label>
            <input type="text" class="form-input" value="${escapeHtml(user.employee_code || 'N/A')}" disabled />
          </div>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid var(--border-color);" />

          <div class="form-group">
            <label>Primary Campus <span class="text-danger">*</span></label>
            <select name="campus_id" id="profile-campus" class="form-select" required>
              ${campuses.map(c => `<option value="${c.id}" ${c.id === currentCampusId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Department</label>
            <select name="department_id" class="form-select">
              <option value="">-- Select Department --</option>
              ${depts.map(d => `<option value="${d.id}" ${d.id === userDeptId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Designation</label>
            <select name="designation_id" class="form-select">
              <option value="">-- Select Designation --</option>
              ${desigs.map(d => `<option value="${d.id}" ${d.id === userDesigId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Subjects Taught (Multi-Select)</label>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; margin-top: 6px;">
              ${subjs.map(s => `
                <label class="checkbox-label">
                  <input type="checkbox" name="subject_ids" value="${s.id}" ${userSubjectIds.includes(s.id) ? 'checked' : ''} />
                  ${escapeHtml(s.name)}
                </label>
              `).join('')}
            </div>
          </div>

          <div class="form-group">
            <label>Faculty Categories / Wings (Multi-Select)</label>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; margin-top: 6px;">
              ${cats.map(c => `
                <label class="checkbox-label">
                  <input type="checkbox" name="category_ids" value="${c.id}" ${userCategoryIds.includes(c.id) ? 'checked' : ''} />
                  ${escapeHtml(c.name)}
                </label>
              `).join('')}
            </div>
          </div>

          <div class="form-group">
            <label class="checkbox-label" style="margin-top: 10px;">
              <input type="checkbox" name="class_teacher_status" value="true" ${user.class_teacher_status ? 'checked' : ''} />
              <strong>Currently Appointed as Class Teacher</strong>
            </label>
          </div>

          <div class="form-group">
            <label>Contact Phone Number</label>
            <input type="text" name="phone" class="form-input" value="${escapeHtml(user.phone || '')}" placeholder="+1 555-0100" />
          </div>

          <div style="margin-top: 24px;">
            <button type="submit" class="btn btn-primary">
              <i class="fa-solid fa-floppy-disk"></i> Save Profile Attributes
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Self-Service Password Reset Card -->
    <div class="card" style="max-width: 800px; margin: 24px auto 0;">
      <div class="card-header">
        <h2><i class="fa-solid fa-key text-primary"></i> Change Account Password</h2>
      </div>
      <div class="card-body">
        <form id="form-change-password" onsubmit="handlePasswordReset(event)">
          <div class="form-group">
            <label>Current Password <span class="text-danger">*</span></label>
            <input type="password" name="current_password" class="form-input" required placeholder="Enter current password" />
          </div>
          <div class="form-group">
            <label>New Password <span class="text-danger">*</span></label>
            <input type="password" name="new_password" class="form-input" required minlength="6" placeholder="Enter new password (min 6 characters)" />
          </div>
          <div class="form-group">
            <label>Confirm New Password <span class="text-danger">*</span></label>
            <input type="password" name="confirm_password" class="form-input" required minlength="6" placeholder="Confirm new password" />
          </div>

          <div style="margin-top: 24px;">
            <button type="submit" class="btn btn-primary">
              <i class="fa-solid fa-lock"></i> Update Password
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);

  const payload = {
    campus_id: formData.get('campus_id'),
    department_id: formData.get('department_id') || null,
    designation_id: formData.get('designation_id') || null,
    subject_ids: formData.getAll('subject_ids'),
    category_ids: formData.getAll('category_ids'),
    class_teacher_status: formData.get('class_teacher_status') === 'true',
    phone: formData.get('phone')
  };

  try {
    const res = await api('/profile', { method: 'PUT', body: payload });
    showToast(res.message, 'success');
    loadCurrentView();
  } catch {
    // Ignored
  }
}

async function handlePasswordReset(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);

  const current_password = formData.get('current_password');
  const new_password = formData.get('new_password');
  const confirm_password = formData.get('confirm_password');

  if (new_password !== confirm_password) {
    return showToast('New passwords do not match', 'warning');
  }

  try {
    const res = await api('/profile/password', {
      method: 'PUT',
      body: { current_password, new_password, confirm_password }
    });
    showToast(res.message || 'Password updated successfully!', 'success');
    form.reset();
  } catch {}
}

// ============================================================================
// 6. ADMIN & MANAGEMENT VIEWS
// ============================================================================

async function renderAdminDashboard(container) {
  const [tasks, teachers, requests] = await Promise.all([
    api('/tasks'),
    api('/users?user_type=TEACHER'),
    hasPermission('groups.approve_requests') ? api('/group-requests/pending-count') : Promise.resolve({ count: 0 })
  ]);

  const activeTasks = tasks.filter(t => t.status === 'PUBLISHED');
  const totalOverdue = activeTasks.reduce((acc, t) => acc + (t.overdue || 0), 0);
  const totalAssigned = activeTasks.reduce((acc, t) => acc + (t.total_assigned || 0), 0);

  container.innerHTML = `
    <!-- Top Action Toolbar -->
    <div style="display:flex; justify-content:flex-end; gap:12px; margin-bottom: 24px;">
      ${hasPermission('tasks.create') ? `
        <button class="btn btn-primary" onclick="navigateTo('task-builder')">
          <i class="fa-solid fa-plus"></i> Create New Task
        </button>
      ` : ''}
    </div>

    <!-- Admin KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi-card" onclick="navigateTo('tasks')">
        <div class="kpi-icon blue"><i class="fa-solid fa-list-check"></i></div>
        <div>
          <div class="kpi-value">${activeTasks.length}</div>
          <div class="kpi-label">Active Tasks</div>
        </div>
      </div>
      <div class="kpi-card" onclick="navigateTo('reports-task-wise')">
        <div class="kpi-icon red"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div>
          <div class="kpi-value">${totalOverdue}</div>
          <div class="kpi-label">Overdue Responses</div>
        </div>
      </div>
      <div class="kpi-card" onclick="navigateTo('group-requests')">
        <div class="kpi-icon yellow"><i class="fa-solid fa-user-clock"></i></div>
        <div>
          <div class="kpi-value">${requests.count}</div>
          <div class="kpi-label">Pending Group Requests</div>
        </div>
      </div>
      <div class="kpi-card" onclick="navigateTo('users')">
        <div class="kpi-icon green"><i class="fa-solid fa-chalkboard-user"></i></div>
        <div>
          <div class="kpi-value">${teachers.length}</div>
          <div class="kpi-label">Active Teachers</div>
        </div>
      </div>
    </div>

    <!-- Published Tasks Overview -->
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-chart-column"></i> Active Institutional Tasks Status</h2>
        <button class="btn btn-secondary btn-sm" onclick="navigateTo('tasks')">View All</button>
      </div>
      <div class="card-body">
        ${activeTasks.length === 0 ? `
          <div class="empty-state">
            <i class="fa-solid fa-list-check"></i>
            <h3>No Active Tasks</h3>
            <p>Create and publish a task to begin monitoring submissions.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Task Title</th>
                  <th>Assigned</th>
                  <th>On Time</th>
                  <th>Late</th>
                  <th>Overdue</th>
                  <th>Completion %</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${activeTasks.map(t => `
                  <tr>
                    <td><strong>${escapeHtml(t.title)}</strong></td>
                    <td><span class="badge badge-in-progress">${t.total_assigned} Teachers</span></td>
                    <td><span class="badge badge-submitted-on-time">${t.submitted_on_time}</span></td>
                    <td><span class="badge badge-submitted-late">${t.submitted_late}</span></td>
                    <td><span class="badge badge-overdue">${t.overdue}</span></td>
                    <td>
                      <div style="display:flex; align-items:center; gap:8px;">
                        <div style="flex:1; height:8px; background:var(--border-color); border-radius:4px; overflow:hidden;">
                          <div style="height:100%; width:${t.completion_rate}%; background:var(--primary);"></div>
                        </div>
                        <span style="font-weight:600; font-size:0.8rem;">${t.completion_rate}%</span>
                      </div>
                    </td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="openTaskReport('${t.id}')">
                        <i class="fa-solid fa-chart-pie"></i> Report
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

// Admin Tasks Management
async function renderAdminTasks(container) {
  const tasks = await api('/tasks');

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
      <h2><i class="fa-solid fa-list-check"></i> Tasks Directory</h2>
      ${hasPermission('tasks.create') ? `
        <button class="btn btn-primary" onclick="state.taskBuilder = null; navigateTo('task-builder')">
          <i class="fa-solid fa-plus"></i> Create Task
        </button>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 70px; text-align:center;">Priority</th>
                <th>Title & Info</th>
                <th>Type</th>
                <th>Status</th>
                <th>Assigned</th>
                <th>Schedule & Deadline</th>
                <th>Completion Rate</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.length === 0 ? `
                <tr><td colspan="8" class="empty-state">No tasks created yet. Click "Create Task" to begin.</td></tr>
              ` : tasks.map((t, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === tasks.length - 1;

                let statusBadge = `<span class="badge badge-${t.status.toLowerCase()}">${t.status}</span>`;
                if (t.status === 'SCHEDULED') {
                  statusBadge = `<span class="badge badge-scheduled"><i class="fa-solid fa-calendar-clock"></i> Scheduled</span>`;
                } else if (t.status === 'PAUSED') {
                  statusBadge = `<span class="badge badge-paused"><i class="fa-solid fa-pause"></i> Paused</span>`;
                } else if (t.status === 'ARCHIVED') {
                  statusBadge = `<span class="badge badge-archived"><i class="fa-solid fa-box-archive"></i> Archived</span>`;
                } else if (t.status === 'ACTIVE' || t.status === 'PUBLISHED') {
                  statusBadge = `<span class="badge badge-active"><i class="fa-solid fa-circle-check"></i> Active</span>`;
                }

                return `
                  <tr>
                    <td style="text-align:center;">
                      <div style="display:flex; flex-direction:column; gap:2px; align-items:center;">
                        <button class="btn btn-outline btn-sm" style="padding:2px 6px; font-size:0.75rem;" ${isFirst ? 'disabled' : ''} onclick="reorderTask('${t.id}', 'UP')" title="Move Up (Higher in Teacher Portal)">
                          <i class="fa-solid fa-arrow-up"></i>
                        </button>
                        <button class="btn btn-outline btn-sm" style="padding:2px 6px; font-size:0.75rem;" ${isLast ? 'disabled' : ''} onclick="reorderTask('${t.id}', 'DOWN')" title="Move Down">
                          <i class="fa-solid fa-arrow-down"></i>
                        </button>
                      </div>
                    </td>
                    <td>
                      <strong>${escapeHtml(t.title)}</strong>
                      ${t.description ? `<p style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(t.description)}</p>` : ''}
                    </td>
                    <td><span class="badge badge-not-started">${t.task_type}</span></td>
                    <td>
                      <div style="display:flex; flex-direction:column; gap:4px;">
                        ${statusBadge}
                        <select class="form-select form-select-sm" style="font-size:0.75rem; padding:2px 4px; width:100px;" onchange="changeTaskStatus('${t.id}', this.value)" title="Quick Status Switch">
                          <option value="ACTIVE" ${t.raw_status === 'ACTIVE' || t.raw_status === 'PUBLISHED' ? 'selected' : ''}>Active</option>
                          <option value="PAUSED" ${t.raw_status === 'PAUSED' ? 'selected' : ''}>Paused</option>
                          <option value="ARCHIVED" ${t.raw_status === 'ARCHIVED' ? 'selected' : ''}>Archived</option>
                          ${t.raw_status === 'DRAFT' ? '<option value="DRAFT" selected>Draft</option>' : ''}
                        </select>
                      </div>
                    </td>
                    <td><span class="badge badge-in-progress">${t.total_assigned || 0}</span></td>
                    <td>
                      <div><i class="fa-regular fa-clock text-danger"></i> Due: <strong>${formatDateTime(t.deadline_at)}</strong></div>
                      ${t.open_at ? `<div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">Opens: ${formatDateTime(t.open_at)}</div>` : ''}
                      ${!t.allow_late_submissions ? `<div style="font-size:0.75rem; color:var(--danger); font-weight:600;"><i class="fa-solid fa-lock"></i> Late Closed</div>` : `<div style="font-size:0.75rem; color:var(--success);"><i class="fa-solid fa-lock-open"></i> Late Allowed</div>`}
                    </td>
                    <td>
                      <div style="display:flex; align-items:center; gap:6px;">
                        <div style="width:50px; height:6px; background:var(--border-color); border-radius:3px; overflow:hidden;">
                          <div style="height:100%; width:${t.completion_rate || 0}%; background:var(--primary);"></div>
                        </div>
                        <strong>${t.completion_rate || 0}%</strong>
                      </div>
                    </td>
                    <td>
                      <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button class="btn btn-primary btn-sm" onclick="openTaskEditor('${t.id}')" title="Edit Task Questions, Audience & Rules">
                          <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="openTaskReport('${t.id}')" title="View Response Dashboard">
                          <i class="fa-solid fa-chart-pie"></i> Report
                        </button>
                        ${t.status === 'DRAFT' && hasPermission('tasks.publish') ? `
                          <button class="btn btn-success btn-sm" onclick="publishTaskDirectly('${t.id}')">
                            <i class="fa-solid fa-upload"></i> Publish
                          </button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function reorderTask(taskId, direction) {
  try {
    await api(`/tasks/${taskId}/reorder`, {
      method: 'PUT',
      body: { direction }
    });
    showToast(`Task moved ${direction.toLowerCase()}`, 'success');
    loadCurrentView();
  } catch {}
}

async function changeTaskStatus(taskId, status) {
  try {
    await api(`/tasks/${taskId}/status`, {
      method: 'PUT',
      body: { status }
    });
    showToast(`Task status changed to ${status}`, 'success');
    loadCurrentView();
  } catch {}
}

async function openTaskEditor(taskId) {
  try {
    const tasks = await api('/tasks');
    const task = tasks.find(t => t.id === taskId);
    if (!task) return showToast('Task not found', 'danger');

    const campuses = typeof task.campus_ids === 'string' ? JSON.parse(task.campus_ids) : (task.campus_ids || []);
    const questions = typeof task.questions === 'string' ? JSON.parse(task.questions) : (task.questions || []);
    const audienceRules = typeof task.audience_rules === 'string' ? JSON.parse(task.audience_rules) : (task.audience_rules || {});
    const exclusions = typeof task.recipient_exclusions === 'string' ? JSON.parse(task.recipient_exclusions) : (task.recipient_exclusions || []);

    state.taskBuilder = {
      editingTaskId: task.id,
      step: 1,
      title: task.title,
      description: task.description || '',
      task_type: task.task_type || 'ONE_TIME',
      open_at: task.open_at ? new Date(task.open_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
      deadline_at: task.deadline_at ? new Date(task.deadline_at).toISOString().slice(0, 16) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
      allow_late_submissions: task.allow_late_submissions !== false,
      allow_edit_submission: task.allow_edit_submission === true,
      status: task.status || 'ACTIVE',
      sort_order: task.sort_order || 0,
      recurrence_config: task.recurrence_config ? (typeof task.recurrence_config === 'string' ? JSON.parse(task.recurrence_config) : task.recurrence_config) : { frequency: 'MONTHLY', interval: 1, weekdays: [1], dayOfMonth: 1, monthOfYear: 1, deadline_offset_days: 7, end_type: 'NEVER', end_date: '', max_occurrences: '' },
      questions: questions.length > 0 ? questions : [{ key: 'Q1', label: '', type: 'short_text', required: true }],
      campus_ids: campuses,
      audience_rules: {
        departments: audienceRules.departments || [],
        designations: audienceRules.designations || [],
        subjects: audienceRules.subjects || [],
        categories: audienceRules.categories || [],
        groups: audienceRules.groups || [],
        class_teacher_status: audienceRules.class_teacher_status !== undefined ? audienceRules.class_teacher_status : null
      },
      recipient_exclusions: exclusions,
      previewRecipients: []
    };

    navigateTo('task-builder');
  } catch (err) {
    showToast('Failed to load task details', 'danger');
  }
}

async function publishTaskDirectly(taskId) {
  if (!confirm('Are you sure you want to publish this task? Actual recipients will be calculated from database rules and frozen as historical assignments.')) return;
  try {
    const res = await api(`/tasks/${taskId}/publish`, { method: 'POST' });
    showToast(`Task published successfully with ${res.recipientCount} assignments created!`, 'success');
    loadCurrentView();
  } catch {
    // Ignored
  }
}

// ============================================================================
// 7. GUIDED 7-STEP TASK BUILDER
// ============================================================================

async function renderTaskBuilder(container) {
  if (!state.taskBuilder) {
    state.taskBuilder = {
      step: 1,
      title: '',
      description: '',
      task_type: 'ONE_TIME',
      open_at: new Date().toISOString().slice(0, 16),
      deadline_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
      allow_late_submissions: true,
      questions: [
        { key: 'Q1', label: 'Sample question text', type: 'short_text', required: true }
      ],
      campus_ids: state.user.authorizedCampusIds && state.user.authorizedCampusIds.length > 0 ? [state.user.authorizedCampusIds[0]] : [],
      audience_rules: {
        departments: [],
        designations: [],
        subjects: [],
        categories: [],
        groups: [],
        class_teacher_status: null
      },
      recipient_exclusions: [],
      previewRecipients: []
    };
  }

  const tb = state.taskBuilder;
  const campuses = await api('/campuses');

  container.innerHTML = `
    <!-- Header title for Edit vs New -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <h2><i class="fa-solid ${tb.editingTaskId ? 'fa-pen-to-square' : 'fa-wand-magic-sparkles'}"></i> ${tb.editingTaskId ? 'Edit Assigned Task' : 'Guided Task Builder'}</h2>
      <button class="btn btn-secondary btn-sm" onclick="state.taskBuilder = null; navigateTo('tasks');">
        <i class="fa-solid fa-arrow-left"></i> Back to Tasks
      </button>
    </div>

    <!-- Stepper Indicator -->
    <div class="stepper-header">
      ${[
        { num: 1, label: 'Details' },
        { num: 2, label: 'Form Builder' },
        { num: 3, label: 'Campuses' },
        { num: 4, label: 'Audience Rules' },
        { num: 5, label: 'Recipient Preview' },
        { num: 6, label: 'Review' },
        { num: 7, label: tb.editingTaskId ? 'Save Changes' : 'Publish' }
      ].map(s => `
        <div class="step-item ${tb.step === s.num ? 'active' : (tb.step > s.num ? 'completed' : '')}">
          <div class="step-circle">${tb.step > s.num ? '<i class="fa-solid fa-check"></i>' : s.num}</div>
          <div class="step-label">${s.label}</div>
        </div>
      `).join('')}
    </div>

    <!-- Step Container -->
    <div class="card" style="max-width: 900px; margin: 0 auto;">
      <div class="card-body">
        ${await renderTaskBuilderStepContent(tb, campuses)}
      </div>
    </div>
  `;
}

async function renderTaskBuilderStepContent(tb, campuses) {
  switch (tb.step) {
    case 1:
      return `
        <h3>Step 1: Basic Task Details</h3>
        <p style="color:var(--text-muted); margin-bottom: 20px;">Provide the title, start schedule, and deadline for the task.</p>
        <div class="form-group">
          <label>Task Title <span class="text-danger">*</span></label>
          <input type="text" id="tb-title" class="form-input" value="${escapeHtml(tb.title)}" placeholder="e.g. Term 1 Syllabus Verification" />
        </div>
        <div class="form-group">
          <label>Description & Teacher Instructions</label>
          <textarea id="tb-desc" class="form-textarea" placeholder="Provide context and instructions for teachers...">${escapeHtml(tb.description)}</textarea>
        </div>
        <div class="form-group">
          <label>Task Type & Repetition Schedule</label>
          <select id="tb-type" class="form-select" onchange="state.taskBuilder.task_type = this.value; loadCurrentView();">
            <option value="ONE_TIME" ${tb.task_type === 'ONE_TIME' ? 'selected' : ''}>One-Time Task</option>
            <option value="RECURRING_TEMPLATE" ${tb.task_type === 'RECURRING_TEMPLATE' ? 'selected' : ''}>Recurring Template (Auto-Repeating Task)</option>
          </select>
        </div>

        ${tb.task_type === 'RECURRING_TEMPLATE' ? `
          <div style="background:var(--bg-surface); border:1px solid var(--primary); border-radius:var(--radius-md); padding:16px; margin-bottom:16px;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; color:var(--primary); font-weight:600;">
              <i class="fa-solid fa-repeat"></i> Extensive Recurrence Configuration
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
              <div class="form-group">
                <label>Repeat Frequency</label>
                <select id="tb-rec-freq" class="form-select" onchange="state.taskBuilder.recurrence_config = state.taskBuilder.recurrence_config || {}; state.taskBuilder.recurrence_config.frequency = this.value; loadCurrentView();">
                  <option value="DAILY" ${tb.recurrence_config && tb.recurrence_config.frequency === 'DAILY' ? 'selected' : ''}>Daily (Every N Days)</option>
                  <option value="WEEKLY" ${!tb.recurrence_config || tb.recurrence_config.frequency === 'WEEKLY' ? 'selected' : ''}>Weekly (Specific Days)</option>
                  <option value="BIWEEKLY" ${tb.recurrence_config && tb.recurrence_config.frequency === 'BIWEEKLY' ? 'selected' : ''}>Bi-Weekly (Every 2 Weeks)</option>
                  <option value="MONTHLY" ${tb.recurrence_config && tb.recurrence_config.frequency === 'MONTHLY' ? 'selected' : ''}>Monthly</option>
                  <option value="QUARTERLY" ${tb.recurrence_config && tb.recurrence_config.frequency === 'QUARTERLY' ? 'selected' : ''}>Quarterly (Every 3 Months)</option>
                  <option value="YEARLY" ${tb.recurrence_config && tb.recurrence_config.frequency === 'YEARLY' ? 'selected' : ''}>Yearly (Annual)</option>
                  <option value="CUSTOM_DAYS" ${tb.recurrence_config && tb.recurrence_config.frequency === 'CUSTOM_DAYS' ? 'selected' : ''}>Custom Day Interval</option>
                </select>
              </div>

              <div class="form-group">
                <label>Repeat Every (Interval)</label>
                <input type="number" id="tb-rec-interval" class="form-input" min="1" max="365" value="${(tb.recurrence_config && tb.recurrence_config.interval) || 1}" />
              </div>
            </div>

            ${(!tb.recurrence_config || tb.recurrence_config.frequency === 'WEEKLY' || tb.recurrence_config.frequency === 'BIWEEKLY') ? `
              <div class="form-group">
                <label>Repeat on Weekdays</label>
                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">
                  ${[
                    { val: 1, label: 'Mon' },
                    { val: 2, label: 'Tue' },
                    { val: 3, label: 'Wed' },
                    { val: 4, label: 'Thu' },
                    { val: 5, label: 'Fri' },
                    { val: 6, label: 'Sat' },
                    { val: 0, label: 'Sun' }
                  ].map(day => {
                    const activeDays = (tb.recurrence_config && tb.recurrence_config.weekdays) || [1];
                    const isChecked = activeDays.includes(day.val);
                    return `
                      <label class="checkbox-label" style="background:var(--border-subtle); padding:6px 12px; border-radius:4px; cursor:pointer;">
                        <input type="checkbox" name="tb_weekdays" value="${day.val}" ${isChecked ? 'checked' : ''} />
                        ${day.label}
                      </label>
                    `;
                  }).join('')}
                </div>
              </div>
            ` : ''}

            ${(tb.recurrence_config && (tb.recurrence_config.frequency === 'MONTHLY' || tb.recurrence_config.frequency === 'QUARTERLY')) ? `
              <div class="form-group">
                <label>Day of Month</label>
                <select id="tb-rec-day-of-month" class="form-select">
                  ${Array.from({length: 28}, (_, i) => i + 1).map(d => `
                    <option value="${d}" ${tb.recurrence_config && tb.recurrence_config.dayOfMonth == d ? 'selected' : ''}>Day ${d} of the month</option>
                  `).join('')}
                  <option value="LAST" ${tb.recurrence_config && tb.recurrence_config.dayOfMonth === 'LAST' ? 'selected' : ''}>Last day of the month</option>
                </select>
              </div>
            ` : ''}

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
              <div class="form-group">
                <label>Instance Deadline (Days from generation)</label>
                <input type="number" id="tb-rec-deadline-offset" class="form-input" min="1" max="90" value="${(tb.recurrence_config && tb.recurrence_config.deadline_offset_days) || 7}" />
                <span style="font-size:0.75rem; color:var(--text-muted);">Each generated task instance will be due this many days after creation.</span>
              </div>

              <div class="form-group">
                <label>Recurrence End Condition</label>
                <select id="tb-rec-end-type" class="form-select" onchange="state.taskBuilder.recurrence_config = state.taskBuilder.recurrence_config || {}; state.taskBuilder.recurrence_config.end_type = this.value; loadCurrentView();">
                  <option value="NEVER" ${!tb.recurrence_config || tb.recurrence_config.end_type === 'NEVER' ? 'selected' : ''}>Never (Repeats indefinitely)</option>
                  <option value="ON_DATE" ${tb.recurrence_config && tb.recurrence_config.end_type === 'ON_DATE' ? 'selected' : ''}>End on specific date</option>
                  <option value="AFTER_OCCURRENCES" ${tb.recurrence_config && tb.recurrence_config.end_type === 'AFTER_OCCURRENCES' ? 'selected' : ''}>End after N occurrences</option>
                </select>
              </div>
            </div>

            ${tb.recurrence_config && tb.recurrence_config.end_type === 'ON_DATE' ? `
              <div class="form-group">
                <label>End Date</label>
                <input type="date" id="tb-rec-end-date" class="form-input" value="${tb.recurrence_config.end_date || ''}" />
              </div>
            ` : ''}

            ${tb.recurrence_config && tb.recurrence_config.end_type === 'AFTER_OCCURRENCES' ? `
              <div class="form-group">
                <label>Max Occurrences (e.g. 12)</label>
                <input type="number" id="tb-rec-max-occurrences" class="form-input" min="1" max="500" value="${tb.recurrence_config.max_occurrences || 12}" />
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label>Start / Open Date & Time</label>
            <input type="datetime-local" id="tb-open-at" class="form-input" value="${tb.open_at || new Date().toISOString().slice(0, 16)}" />
            <span style="font-size:0.75rem; color:var(--text-muted);">Future date sets status as <strong>Scheduled</strong>.</span>
          </div>
          <div class="form-group">
            <label>Submission Deadline <span class="text-danger">*</span></label>
            <input type="datetime-local" id="tb-deadline" class="form-input" value="${tb.deadline_at}" />
          </div>
        </div>

        <div style="background:var(--border-subtle); padding:14px; border-radius:var(--radius-md); margin-bottom:16px;">
          <label style="font-weight:600; margin-bottom:8px; display:block;"><i class="fa-solid fa-sliders"></i> Submission Policies</label>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <label class="checkbox-label">
              <input type="checkbox" id="tb-allow-late" ${tb.allow_late_submissions !== false ? 'checked' : ''} />
              <span><strong>Allow Late Submissions:</strong> Teachers can submit responses after the deadline has passed.</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" id="tb-allow-edit" ${tb.allow_edit_submission === true ? 'checked' : ''} />
              <span><strong>Allow Response Editing:</strong> Teachers can edit and resubmit their responses even after initial submission.</span>
            </label>
          </div>
        </div>

        ${tb.editingTaskId ? `
          <div class="form-group">
            <label>Task Status</label>
            <select id="tb-status" class="form-select">
              <option value="ACTIVE" ${tb.status === 'ACTIVE' || tb.status === 'PUBLISHED' ? 'selected' : ''}>ACTIVE</option>
              <option value="PAUSED" ${tb.status === 'PAUSED' ? 'selected' : ''}>PAUSED</option>
              <option value="ARCHIVED" ${tb.status === 'ARCHIVED' ? 'selected' : ''}>ARCHIVED (Hidden from Teachers)</option>
              <option value="DRAFT" ${tb.status === 'DRAFT' ? 'selected' : ''}>DRAFT</option>
            </select>
          </div>
        ` : ''}

        <div style="display:flex; justify-content:flex-end; margin-top:24px;">
          <button class="btn btn-primary" onclick="saveTaskBuilderStep(1, 2)">Next: Form Builder <i class="fa-solid fa-arrow-right"></i></button>
        </div>
      `;

    case 2:
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
          <h3>Step 2: Response Form Questions</h3>
          <button class="btn btn-secondary btn-sm" onclick="addTaskQuestion()"><i class="fa-solid fa-plus"></i> Add Question</button>
        </div>
        <div id="questions-list">
          ${tb.questions.map((q, idx) => `
            <div class="question-block" id="q-block-${idx}">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
                <strong>Question #${idx + 1}</strong>
                <button type="button" class="btn-icon text-danger" onclick="removeTaskQuestion(${idx})"><i class="fa-solid fa-trash"></i></button>
              </div>
              <div class="form-group">
                <label>Question Label</label>
                <input type="text" class="form-input q-label" value="${escapeHtml(q.label)}" placeholder="Enter question..." />
              </div>
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group">
                  <label>Type</label>
                  <select class="form-select q-type" onchange="updateQuestionType(${idx}, this.value)">
                    <option value="short_text" ${q.type === 'short_text' ? 'selected' : ''}>Short Text</option>
                    <option value="long_text" ${q.type === 'long_text' ? 'selected' : ''}>Long Text</option>
                    <option value="number" ${q.type === 'number' ? 'selected' : ''}>Number</option>
                    <option value="date" ${q.type === 'date' ? 'selected' : ''}>Date</option>
                    <option value="yes_no" ${q.type === 'yes_no' ? 'selected' : ''}>Yes / No</option>
                    <option value="single_choice" ${q.type === 'single_choice' ? 'selected' : ''}>Single Choice</option>
                    <option value="multiple_choice" ${q.type === 'multiple_choice' ? 'selected' : ''}>Multiple Choice</option>
                    <option value="dropdown" ${q.type === 'dropdown' ? 'selected' : ''}>Dropdown</option>
                  </select>
                </div>
                <div class="form-group" style="display:flex; align-items:flex-end;">
                  <label class="checkbox-label" style="margin-bottom:12px;">
                    <input type="checkbox" class="q-required" ${q.required ? 'checked' : ''} /> Mandatory Field
                  </label>
                </div>
              </div>
              ${['single_choice', 'multiple_choice', 'dropdown'].includes(q.type) ? `
                <div class="form-group">
                  <label>Options (Comma separated)</label>
                  <input type="text" class="form-input q-options" value="${(q.options || []).join(', ')}" placeholder="Option 1, Option 2, Option 3" />
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:24px;">
          <button class="btn btn-secondary" onclick="state.taskBuilder.step = 1; loadCurrentView();"><i class="fa-solid fa-arrow-left"></i> Back</button>
          <button class="btn btn-primary" onclick="saveTaskBuilderQuestions()">Next: Campuses <i class="fa-solid fa-arrow-right"></i></button>
        </div>
      `;

    case 3:
      return `
        <h3>Step 3: Select Authorized Campuses</h3>
        <p style="color:var(--text-muted); margin-bottom: 20px;">Choose which campuses this task applies to.</p>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${campuses.map(c => `
            <label class="checkbox-label" style="padding: 12px; background:var(--border-subtle); border-radius:var(--radius-md);">
              <input type="checkbox" name="tb_campuses" value="${c.id}" ${tb.campus_ids.includes(c.id) ? 'checked' : ''} />
              <div>
                <strong>${escapeHtml(c.name)}</strong>
                <span style="font-size:0.8rem; color:var(--text-muted); margin-left:8px;">(${c.code})</span>
              </div>
            </label>
          `).join('')}
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:24px;">
          <button class="btn btn-secondary" onclick="state.taskBuilder.step = 2; loadCurrentView();"><i class="fa-solid fa-arrow-left"></i> Back</button>
          <button class="btn btn-primary" onclick="saveTaskBuilderCampuses()">Next: Audience Rules <i class="fa-solid fa-arrow-right"></i></button>
        </div>
      `;

    case 4:
      const [depts, desigs, subjs, cats, groups] = await Promise.all([
        api('/masters?master_type=DEPARTMENT'),
        api('/masters?master_type=DESIGNATION'),
        api('/masters?master_type=SUBJECT'),
        api('/masters?master_type=CATEGORY'),
        api('/groups')
      ]);

      const ar = tb.audience_rules;

      return `
        <h3>Step 4: Target Audience Rules</h3>
        <p style="color:var(--text-muted); margin-bottom: 20px;">
          Filter rules combine using <strong>AND</strong> logic across categories and <strong>OR</strong> within each category.
        </p>

        <div class="form-group">
          <label>Departments</label>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:6px;">
            ${depts.map(d => `
              <label class="checkbox-label">
                <input type="checkbox" name="tb_depts" value="${d.id}" ${ar.departments.includes(d.id) ? 'checked' : ''} />
                ${escapeHtml(d.name)}
              </label>
            `).join('')}
          </div>
        </div>

        <div class="form-group">
          <label>Designations</label>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:6px;">
            ${desigs.map(d => `
              <label class="checkbox-label">
                <input type="checkbox" name="tb_desigs" value="${d.id}" ${ar.designations.includes(d.id) ? 'checked' : ''} />
                ${escapeHtml(d.name)}
              </label>
            `).join('')}
          </div>
        </div>

        <div class="form-group">
          <label>Subjects</label>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:6px;">
            ${subjs.map(s => `
              <label class="checkbox-label">
                <input type="checkbox" name="tb_subjs" value="${s.id}" ${ar.subjects.includes(s.id) ? 'checked' : ''} />
                ${escapeHtml(s.name)}
              </label>
            `).join('')}
          </div>
        </div>

        <div class="form-group">
          <label>Faculty Groups</label>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:6px;">
            ${groups.map(g => `
              <label class="checkbox-label">
                <input type="checkbox" name="tb_groups" value="${g.id}" ${ar.groups.includes(g.id) ? 'checked' : ''} />
                ${escapeHtml(g.name)}
              </label>
            `).join('')}
          </div>
        </div>

        <div class="form-group">
          <label>Class Teacher Status</label>
          <select id="tb-class-teacher" class="form-select">
            <option value="">All Teachers (Ignore Class Teacher Status)</option>
            <option value="true" ${ar.class_teacher_status === true ? 'selected' : ''}>Class Teachers Only</option>
            <option value="false" ${ar.class_teacher_status === false ? 'selected' : ''}>Non-Class Teachers Only</option>
          </select>
        </div>

        <div style="display:flex; justify-content:space-between; margin-top:24px;">
          <button class="btn btn-secondary" onclick="state.taskBuilder.step = 3; loadCurrentView();"><i class="fa-solid fa-arrow-left"></i> Back</button>
          <button class="btn btn-primary" onclick="saveTaskBuilderAudience()">Next: Recipient Preview <i class="fa-solid fa-arrow-right"></i></button>
        </div>
      `;

    case 5:
      const previewRes = await api('/tasks/preview-recipients', {
        method: 'POST',
        body: {
          campus_ids: tb.campus_ids,
          audience_rules: tb.audience_rules,
          recipient_exclusions: tb.recipient_exclusions
        }
      });
      tb.previewRecipients = previewRes.recipients;

      return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
          <div>
            <h3>Step 5: Dynamic Recipient Preview</h3>
            <span class="badge badge-in-progress">${previewRes.active_count} of ${previewRes.total_count} Teachers Selected</span>
          </div>
        </div>
        <p style="color:var(--text-muted); font-size:0.88rem; margin-bottom: 16px;">
          All matching teachers are selected by default. Uncheck individual teachers to exclude them from this task.
        </p>

        <div class="table-responsive" style="max-height: 350px; overflow-y: auto;">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 40px;">Select</th>
                <th>Teacher Name</th>
                <th>Email</th>
                <th>Campus</th>
                <th>Class Teacher</th>
              </tr>
            </thead>
            <tbody>
              ${tb.previewRecipients.map(r => `
                <tr>
                  <td>
                    <input type="checkbox" class="recipient-toggle" value="${r.id}" ${!r.is_excluded ? 'checked' : ''} onchange="toggleRecipientExclusion('${r.id}', this.checked)" />
                  </td>
                  <td><strong>${escapeHtml(r.display_name)}</strong></td>
                  <td>${escapeHtml(r.email)}</td>
                  <td>${escapeHtml(r.campus_name)}</td>
                  <td>${r.class_teacher_status ? '<span class="badge badge-active">Yes</span>' : '<span class="badge badge-not-started">No</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div style="display:flex; justify-content:space-between; margin-top:24px;">
          <button class="btn btn-secondary" onclick="state.taskBuilder.step = 4; loadCurrentView();"><i class="fa-solid fa-arrow-left"></i> Back</button>
          <button class="btn btn-primary" onclick="state.taskBuilder.step = 6; loadCurrentView();">Next: Review <i class="fa-solid fa-arrow-right"></i></button>
        </div>
      `;

    case 6:
      const activeCount = tb.previewRecipients.filter(r => !tb.recipient_exclusions.includes(r.id)).length;
      let recurrenceSummary = 'None (One-time assignment)';
      if (tb.task_type === 'RECURRING_TEMPLATE' && tb.recurrence_config) {
        const rc = tb.recurrence_config;
        const freqLabel = rc.frequency || 'MONTHLY';
        const interval = rc.interval || 1;
        recurrenceSummary = `${freqLabel} (Every ${interval} ${freqLabel.toLowerCase().replace('_', ' ')})`;
        if (rc.weekdays && rc.weekdays.length > 0) {
          const dayNames = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
          recurrenceSummary += ` on ${rc.weekdays.map(d => dayNames[d] || d).join(', ')}`;
        }
        if (rc.dayOfMonth) recurrenceSummary += ` (Day ${rc.dayOfMonth})`;
        if (rc.end_type === 'ON_DATE') recurrenceSummary += ` until ${rc.end_date}`;
        if (rc.end_type === 'AFTER_OCCURRENCES') recurrenceSummary += ` (Ends after ${rc.max_occurrences} runs)`;
      }

      return `
        <h3>Step 6: Review Task Configuration</h3>
        <div style="background:var(--border-subtle); padding: 16px; border-radius:var(--radius-md); margin: 20px 0; display:flex; flex-direction:column; gap:10px;">
          <div><strong>Title:</strong> ${escapeHtml(tb.title)}</div>
          <div><strong>Task Type:</strong> ${tb.task_type === 'RECURRING_TEMPLATE' ? '<span class="badge badge-active"><i class="fa-solid fa-repeat"></i> Recurring Template</span>' : '<span class="badge badge-not-started">One-Time Task</span>'}</div>
          ${tb.task_type === 'RECURRING_TEMPLATE' ? `<div><strong>Recurrence Schedule:</strong> ${escapeHtml(recurrenceSummary)}</div>` : ''}
          <div><strong>Start / Open Date:</strong> ${formatDateTime(tb.open_at)}</div>
          <div><strong>Deadline:</strong> ${formatDateTime(tb.deadline_at)}</div>
          <div><strong>Late Submissions Allowed:</strong> ${tb.allow_late_submissions !== false ? '<span class="text-success">Yes</span>' : '<span class="text-danger">No</span>'}</div>
          <div><strong>Response Editing Allowed:</strong> ${tb.allow_edit_submission === true ? '<span class="text-success">Yes</span>' : '<span class="text-danger">No</span>'}</div>
          <div><strong>Questions:</strong> ${tb.questions.length} Fields Configured</div>
          <div><strong>Campuses:</strong> ${tb.campus_ids.length} Campuses Selected</div>
          <div><strong>Final Recipient Count:</strong> <strong class="text-primary">${activeCount} Teachers</strong></div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:24px;">
          <button class="btn btn-secondary" onclick="state.taskBuilder.step = 5; loadCurrentView();"><i class="fa-solid fa-arrow-left"></i> Back</button>
          <button class="btn btn-primary" onclick="state.taskBuilder.step = 7; loadCurrentView();">Proceed to ${tb.editingTaskId ? 'Save Changes' : 'Publish'} <i class="fa-solid fa-arrow-right"></i></button>
        </div>
      `;

    case 7:
      return `
        <div style="text-align:center; padding: 24px 0;">
          <div class="brand-badge" style="background:linear-gradient(135deg, var(--success), #059669);"><i class="fa-solid ${tb.editingTaskId ? 'fa-floppy-disk' : 'fa-rocket'}"></i></div>
          <h3>${tb.editingTaskId ? 'Save Task Modifications' : 'Ready to Publish Task'}</h3>
          <p style="color:var(--text-muted); max-width: 500px; margin: 12px auto 24px;">
            ${tb.editingTaskId ? 'Saving will update task questions, audience rules, submission flags, and assign newly matching teachers.' : 'Publishing will recalculate eligible recipients on the server, freeze immutable assignments, and dispatch assignment notification emails to teachers.'}
          </p>

          <div style="display:flex; justify-content:center; gap: 16px;">
            ${tb.editingTaskId ? `
              <button class="btn btn-primary" onclick="commitUpdateTask()">
                <i class="fa-solid fa-floppy-disk"></i> Save & Update Task
              </button>
            ` : `
              <button class="btn btn-outline" onclick="saveTaskDraft()">
                <i class="fa-regular fa-floppy-disk"></i> Save as Draft Only
              </button>
              <button class="btn btn-success" onclick="commitPublishTask()">
                <i class="fa-solid fa-upload"></i> Confirm & Publish Now
              </button>
            `}
          </div>
        </div>
      `;
  }
}

function saveTaskBuilderStep(curr, next) {
  const tb = state.taskBuilder;
  if (curr === 1) {
    const title = document.getElementById('tb-title').value.trim();
    if (!title) return showToast('Please enter a task title', 'warning');
    tb.title = title;
    tb.description = document.getElementById('tb-desc').value.trim();
    tb.task_type = document.getElementById('tb-type').value;
    tb.open_at = document.getElementById('tb-open-at') ? document.getElementById('tb-open-at').value : tb.open_at;
    tb.deadline_at = document.getElementById('tb-deadline').value;
    tb.allow_late_submissions = document.getElementById('tb-allow-late') ? document.getElementById('tb-allow-late').checked : true;
    tb.allow_edit_submission = document.getElementById('tb-allow-edit') ? document.getElementById('tb-allow-edit').checked : false;
    if (document.getElementById('tb-status')) {
      tb.status = document.getElementById('tb-status').value;
    }

    if (tb.task_type === 'RECURRING_TEMPLATE') {
      const weekdays = Array.from(document.querySelectorAll('input[name="tb_weekdays"]:checked')).map(el => parseInt(el.value, 10));
      const freq = document.getElementById('tb-rec-freq') ? document.getElementById('tb-rec-freq').value : 'MONTHLY';
      const interval = document.getElementById('tb-rec-interval') ? parseInt(document.getElementById('tb-rec-interval').value, 10) : 1;
      const dayOfMonth = document.getElementById('tb-rec-day-of-month') ? document.getElementById('tb-rec-day-of-month').value : 1;
      const deadlineOffset = document.getElementById('tb-rec-deadline-offset') ? parseInt(document.getElementById('tb-rec-deadline-offset').value, 10) : 7;
      const endType = document.getElementById('tb-rec-end-type') ? document.getElementById('tb-rec-end-type').value : 'NEVER';
      const endDate = document.getElementById('tb-rec-end-date') ? document.getElementById('tb-rec-end-date').value : null;
      const maxOccurrences = document.getElementById('tb-rec-max-occurrences') ? parseInt(document.getElementById('tb-rec-max-occurrences').value, 10) : null;

      tb.recurrence_config = {
        frequency: freq,
        interval: interval || 1,
        weekdays: weekdays.length > 0 ? weekdays : [1],
        dayOfMonth: dayOfMonth === 'LAST' ? 'LAST' : (parseInt(dayOfMonth, 10) || 1),
        deadline_offset_days: deadlineOffset || 7,
        end_type: endType,
        end_date: endDate,
        max_occurrences: maxOccurrences
      };
    }
  }
  tb.step = next;
  loadCurrentView();
}

function addTaskQuestion() {
  state.taskBuilder.questions.push({
    key: `Q${state.taskBuilder.questions.length + 1}`,
    label: '',
    type: 'short_text',
    required: false
  });
  loadCurrentView();
}

function removeTaskQuestion(idx) {
  state.taskBuilder.questions.splice(idx, 1);
  loadCurrentView();
}

function updateQuestionType(idx, val) {
  state.taskBuilder.questions[idx].type = val;
  loadCurrentView();
}

function saveTaskBuilderQuestions() {
  const blocks = document.querySelectorAll('.question-block');
  const questions = [];

  blocks.forEach((b, i) => {
    const label = b.querySelector('.q-label').value.trim();
    const type = b.querySelector('.q-type').value;
    const required = b.querySelector('.q-required').checked;
    const optInput = b.querySelector('.q-options');
    const options = optInput ? optInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];

    questions.push({
      key: `Q${i + 1}`,
      label: label || `Question ${i + 1}`,
      type,
      required,
      options
    });
  });

  state.taskBuilder.questions = questions;
  state.taskBuilder.step = 3;
  loadCurrentView();
}

function saveTaskBuilderCampuses() {
  const checked = Array.from(document.querySelectorAll('input[name="tb_campuses"]:checked')).map(el => el.value);
  if (checked.length === 0) return showToast('Please select at least one campus', 'warning');
  state.taskBuilder.campus_ids = checked;
  state.taskBuilder.step = 4;
  loadCurrentView();
}

function saveTaskBuilderAudience() {
  state.taskBuilder.audience_rules.departments = Array.from(document.querySelectorAll('input[name="tb_depts"]:checked')).map(el => el.value);
  state.taskBuilder.audience_rules.designations = Array.from(document.querySelectorAll('input[name="tb_desigs"]:checked')).map(el => el.value);
  state.taskBuilder.audience_rules.subjects = Array.from(document.querySelectorAll('input[name="tb_subjs"]:checked')).map(el => el.value);
  state.taskBuilder.audience_rules.groups = Array.from(document.querySelectorAll('input[name="tb_groups"]:checked')).map(el => el.value);

  const ct = document.getElementById('tb-class-teacher').value;
  state.taskBuilder.audience_rules.class_teacher_status = ct === '' ? null : (ct === 'true');

  state.taskBuilder.step = 5;
  loadCurrentView();
}

function toggleRecipientExclusion(userId, isChecked) {
  const tb = state.taskBuilder;
  if (!isChecked) {
    if (!tb.recipient_exclusions.includes(userId)) tb.recipient_exclusions.push(userId);
  } else {
    tb.recipient_exclusions = tb.recipient_exclusions.filter(id => id !== userId);
  }
}

async function saveTaskDraft() {
  const tb = state.taskBuilder;
  try {
    const res = await api('/tasks', {
      method: 'POST',
      body: {
        task_type: tb.task_type,
        title: tb.title,
        description: tb.description,
        campus_ids: tb.campus_ids,
        questions: tb.questions,
        audience_rules: tb.audience_rules,
        recipient_exclusions: tb.recipient_exclusions,
        open_at: tb.open_at,
        deadline_at: tb.deadline_at,
        allow_late_submissions: tb.allow_late_submissions,
        allow_edit_submission: tb.allow_edit_submission,
        recurrence_config: tb.recurrence_config || null,
        publish_now: false
      }
    });
    showToast('Task draft saved successfully!', 'success');
    state.taskBuilder = null;
    navigateTo('tasks');
  } catch {
    // Ignored
  }
}

async function commitPublishTask() {
  const tb = state.taskBuilder;
  try {
    const res = await api('/tasks', {
      method: 'POST',
      body: {
        task_type: tb.task_type,
        title: tb.title,
        description: tb.description,
        campus_ids: tb.campus_ids,
        questions: tb.questions,
        audience_rules: tb.audience_rules,
        recipient_exclusions: tb.recipient_exclusions,
        open_at: tb.open_at,
        deadline_at: tb.deadline_at,
        allow_late_submissions: tb.allow_late_submissions,
        allow_edit_submission: tb.allow_edit_submission,
        recurrence_config: tb.recurrence_config || null,
        publish_now: true
      }
    });
    showToast(`Task published successfully with ${res.recipients} assignments created!`, 'success');
    state.taskBuilder = null;
    navigateTo('tasks');
  } catch {
    // Ignored
  }
}

async function commitUpdateTask() {
  const tb = state.taskBuilder;
  try {
    const res = await api(`/tasks/${tb.editingTaskId}`, {
      method: 'PUT',
      body: {
        title: tb.title,
        description: tb.description,
        task_type: tb.task_type,
        campus_ids: tb.campus_ids,
        questions: tb.questions,
        audience_rules: tb.audience_rules,
        recipient_exclusions: tb.recipient_exclusions,
        open_at: tb.open_at,
        deadline_at: tb.deadline_at,
        allow_late_submissions: tb.allow_late_submissions,
        allow_edit_submission: tb.allow_edit_submission,
        status: tb.status
      }
    });
    showToast(res.message || 'Task updated successfully!', 'success');
    state.taskBuilder = null;
    navigateTo('tasks');
  } catch {}
}

// ============================================================================
// 8. REPORTS & REMINDERS
// ============================================================================

function renderReportTabs(activeTab) {
  return `
    <div class="reports-nav-tabs">
      <button class="btn ${activeTab === 'task-wise' ? 'btn-primary' : 'btn-outline'}" onclick="navigateTo('reports-task-wise')">
        <i class="fa-solid fa-chart-pie"></i> Task-Wise Summary
      </button>
      <button class="btn ${activeTab === 'detailed' ? 'btn-primary' : 'btn-outline'}" onclick="navigateTo('reports-detailed')">
        <i class="fa-solid fa-table-columns"></i> Detailed Responses (Questions Grid)
      </button>
      <button class="btn ${activeTab === 'teacher-wise' ? 'btn-primary' : 'btn-outline'}" onclick="navigateTo('reports-teacher-wise')">
        <i class="fa-solid fa-chart-line"></i> Teacher Performance
      </button>
    </div>
  `;
}

async function renderTaskWiseReport(container) {
  const tasks = await api('/tasks');
  const selectedTaskId = state.filters.reportTaskId || (tasks[0] ? tasks[0].id : null);

  if (!selectedTaskId) {
    container.innerHTML = `
      ${renderReportTabs('task-wise')}
      <div class="empty-state"><h3>No tasks available for reporting</h3></div>
    `;
    return;
  }

  const report = await api(`/reports/task-wise?task_id=${selectedTaskId}`);
  const { task, stats, rows } = report;

  container.innerHTML = `
    ${renderReportTabs('task-wise')}

    <!-- Top Filter Bar -->
    <div class="filter-bar">
      <div style="display:flex; align-items:center; gap:8px;">
        <label><strong>Select Task:</strong></label>
        <select class="form-select" onchange="state.filters.reportTaskId = this.value; loadCurrentView();">
          ${tasks.map(t => `<option value="${t.id}" ${t.id === selectedTaskId ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}
        </select>
      </div>

      <div style="margin-left:auto; display:flex; gap:8px;">
        ${hasPermission('tasks.send_reminder') ? `
          <button class="btn btn-warning btn-sm" onclick="openSendRemindersModal('${task.id}')">
            <i class="fa-solid fa-bell"></i> Send Reminders
          </button>
        ` : ''}
        <button class="btn btn-secondary btn-sm" onclick="exportTaskResponses('${task.id}')">
          <i class="fa-solid fa-file-excel"></i> Export Excel
        </button>
      </div>
    </div>

    <!-- Summary KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon blue"><i class="fa-solid fa-users"></i></div>
        <div>
          <div class="kpi-value">${stats.total}</div>
          <div class="kpi-label">Assigned Recipients</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon green"><i class="fa-solid fa-check"></i></div>
        <div>
          <div class="kpi-value">${stats.on_time}</div>
          <div class="kpi-label">Submitted On Time</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon yellow"><i class="fa-solid fa-clock"></i></div>
        <div>
          <div class="kpi-value">${stats.late}</div>
          <div class="kpi-label">Submitted Late</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon red"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div>
          <div class="kpi-value">${stats.overdue}</div>
          <div class="kpi-label">Overdue</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon purple"><i class="fa-solid fa-percent"></i></div>
        <div>
          <div class="kpi-value">${stats.completion_rate}%</div>
          <div class="kpi-label">Completion %</div>
        </div>
      </div>
    </div>

    <!-- Submissions Table -->
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-table"></i> Teacher Submissions Breakdown</h2>
      </div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Campus</th>
                <th>Assigned Date</th>
                <th>Deadline</th>
                <th>Submission Date</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>
                    <strong>${escapeHtml(r.display_name)}</strong>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(r.email)}</div>
                  </td>
                  <td>${escapeHtml(r.campus_name)}</td>
                  <td>${formatDate(r.assigned_at)}</td>
                  <td>${formatDateTime(r.due_at)}</td>
                  <td>${r.submitted_at ? formatDateTime(r.submitted_at) : '<span class="text-muted">Not Submitted</span>'}</td>
                  <td><span class="badge badge-${r.status.toLowerCase().replace(/_/g, '-')}">${formatStatus(r.status)}</span></td>
                  <td>
                    ${r.submitted_at ? `
                      <button class="btn btn-secondary btn-sm" onclick="openResponseViewerModal('${task.id}', '${r.user_id}', '${escapeHtml(r.display_name)}')">
                        <i class="fa-solid fa-eye"></i> View Answers
                      </button>
                    ` : '<span style="font-size:0.8rem; color:var(--text-muted);">No Response</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function openTaskReport(taskId) {
  state.filters.reportTaskId = taskId;
  navigateTo('reports-task-wise');
}

function exportTaskResponses(taskId) {
  window.open(`/api/reports/export?task_id=${taskId}`, '_blank');
}

async function openResponseViewerModal(taskId, userId, teacherName) {
  const data = await api(`/reports/task-wise?task_id=${taskId}`);
  const row = data.rows.find(r => r.user_id === userId);
  const questions = typeof data.task.questions === 'string' ? JSON.parse(data.task.questions) : data.task.questions;
  const answers = row ? row.answers : {};

  const html = `
    <div class="card-header">
      <div>
        <h3>${escapeHtml(teacherName)} - Response</h3>
        <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(data.task.title)}</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      ${questions.map((q, idx) => `
        <div class="question-block">
          <label><strong>${idx + 1}. ${escapeHtml(q.label)}</strong></label>
          <div style="background:var(--bg-surface); padding:10px 14px; border-radius:var(--radius-md); border:1px solid var(--border-color); margin-top:6px;">
            ${escapeHtml(answers[q.key] !== undefined && answers[q.key] !== null ? String(answers[q.key]) : 'No Answer Provided')}
          </div>
        </div>
      `).join('')}
      <div style="display:flex; justify-content:flex-end; margin-top:20px;">
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
      </div>
    </div>
  `;
  openModal(html);
}

async function openSendRemindersModal(taskId) {
  const data = await api(`/reports/task-wise?task_id=${taskId}`);
  const pendingRows = data.rows.filter(r => r.status === 'NOT_STARTED' || r.status === 'IN_PROGRESS' || r.status === 'OVERDUE');

  if (pendingRows.length === 0) {
    return showToast('All assigned teachers have already submitted their responses!', 'info');
  }

  const html = `
    <div class="card-header">
      <div>
        <h3>Send Submission Reminders</h3>
        <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(data.task.title)}</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <p style="font-size:0.88rem; color:var(--text-muted); margin-bottom:16px;">
        Select pending or overdue teachers to dispatch automated reminder emails.
      </p>

      <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
        <button class="btn btn-secondary btn-sm" onclick="toggleAllReminders(true)">Select All</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleAllReminders(false)">Clear All</button>
      </div>

      <div class="table-responsive" style="max-height: 300px; overflow-y:auto;">
        <table class="table">
          <thead>
            <tr>
              <th style="width:40px;">Select</th>
              <th>Teacher</th>
              <th>Campus</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${pendingRows.map(r => `
              <tr>
                <td><input type="checkbox" class="reminder-recipient" value="${r.user_id}" checked /></td>
                <td><strong>${escapeHtml(r.display_name)}</strong></td>
                <td>${escapeHtml(r.campus_name)}</td>
                <td><span class="badge badge-${r.status.toLowerCase().replace(/_/g, '-')}">${formatStatus(r.status)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-warning" onclick="commitSendReminders('${taskId}')">
          <i class="fa-solid fa-paper-plane"></i> Send Selected Reminders
        </button>
      </div>
    </div>
  `;
  openModal(html);
}

function toggleAllReminders(select) {
  document.querySelectorAll('.reminder-recipient').forEach(cb => cb.checked = select);
}

async function commitSendReminders(taskId) {
  const userIds = Array.from(document.querySelectorAll('.reminder-recipient:checked')).map(cb => cb.value);
  if (userIds.length === 0) return showToast('Please select at least one recipient', 'warning');

  try {
    const res = await api(`/tasks/${taskId}/send-reminders`, {
      method: 'POST',
      body: { user_ids: userIds }
    });
    showToast(`Reminders sent successfully to ${res.sent_count} teachers!`, 'success');
    closeModal();
  } catch {
    // Ignored
  }
}

// Teacher-Wise Performance Report
async function renderTeacherWiseReport(container) {
  const teachers = await api('/users?user_type=');
  const selectedTeacherId = state.filters.teacherId || (teachers[0] ? teachers[0].id : null);

  if (!selectedTeacherId) {
    container.innerHTML = `
      ${renderReportTabs('teacher-wise')}
      <div class="empty-state"><h3>No faculty members found</h3></div>
    `;
    return;
  }

  const data = await api(`/reports/teacher-wise?teacher_id=${selectedTeacherId}`);
  const { teacher, stats, assignments } = data;

  container.innerHTML = `
    ${renderReportTabs('teacher-wise')}

    <div class="filter-bar">
      <div style="display:flex; align-items:center; gap:8px;">
        <label><strong>Select Faculty Member:</strong></label>
        <select class="form-select" onchange="state.filters.teacherId = this.value; loadCurrentView();">
          ${teachers.map(t => `<option value="${t.id}" ${t.id === selectedTeacherId ? 'selected' : ''}>${escapeHtml(t.display_name)} (${escapeHtml(t.email)})</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon blue"><i class="fa-solid fa-list-check"></i></div>
        <div>
          <div class="kpi-value">${stats.total}</div>
          <div class="kpi-label">Total Assigned</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon green"><i class="fa-solid fa-check"></i></div>
        <div>
          <div class="kpi-value">${stats.on_time}</div>
          <div class="kpi-label">Submitted On Time</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon yellow"><i class="fa-solid fa-clock"></i></div>
        <div>
          <div class="kpi-value">${stats.late}</div>
          <div class="kpi-label">Submitted Late</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon red"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div>
          <div class="kpi-value">${stats.overdue}</div>
          <div class="kpi-label">Overdue</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon purple"><i class="fa-solid fa-percent"></i></div>
        <div>
          <div class="kpi-value">${stats.on_time_rate}%</div>
          <div class="kpi-label">On-Time %</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-clock-rotate-left"></i> Historical Assignments Log</h2>
      </div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Task Title</th>
                <th>Campus</th>
                <th>Assigned Date</th>
                <th>Deadline</th>
                <th>Submitted Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${assignments.map(a => `
                <tr>
                  <td><strong>${escapeHtml(a.task_title)}</strong></td>
                  <td>${escapeHtml(a.campus_name)}</td>
                  <td>${formatDate(a.assigned_at)}</td>
                  <td>${formatDateTime(a.due_at)}</td>
                  <td>${a.submitted_at ? formatDateTime(a.submitted_at) : '<span class="text-muted">Not Submitted</span>'}</td>
                  <td><span class="badge badge-${a.status.toLowerCase().replace(/_/g, '-')}">${formatStatus(a.status)}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// Detailed Response Report with Sorting, Filtering, and Dynamic Question Columns
async function renderDetailedResponseReport(container) {
  const tasks = await api('/tasks');
  const selectedTaskId = state.filters.detailedTaskId || (tasks[0] ? tasks[0].id : null);

  if (!selectedTaskId) {
    container.innerHTML = `
      ${renderReportTabs('detailed')}
      <div class="empty-state"><h3>No tasks available</h3></div>
    `;
    return;
  }

  const campuses = await api('/campuses');
  const reportData = await api(`/reports/detailed-response?task_id=${selectedTaskId}`);
  const { task, questions, rows } = reportData;

  // Initialize selected columns in state if not present
  if (!state.filters.detailedColumns) {
    state.filters.detailedColumns = {
      display_name: true,
      employee_code: true,
      campus_name: true,
      department_names: true,
      designation_name: true,
      class_teacher_status: true,
      due_at: true,
      submitted_at: true,
      status: true
    };
    questions.forEach(q => { state.filters.detailedColumns[`q_${q.key}`] = true; });
  }

  // Filter rows by campus, status, search
  const campusFilter = state.filters.detailedCampus || '';
  const statusFilter = state.filters.detailedStatus || '';
  const searchFilter = (state.filters.detailedSearch || '').toLowerCase();

  let filteredRows = rows.filter(r => {
    if (campusFilter && r.campus_id !== campusFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (searchFilter) {
      const match = (r.display_name || '').toLowerCase().includes(searchFilter) ||
                    (r.email || '').toLowerCase().includes(searchFilter) ||
                    (r.employee_code || '').toLowerCase().includes(searchFilter);
      if (!match) return false;
    }
    return true;
  });

  // Sort rows
  const sortBy = state.filters.detailedSortBy || 'display_name';
  const sortDir = state.filters.detailedSortDir || 'asc';

  filteredRows.sort((a, b) => {
    let valA, valB;
    if (sortBy.startsWith('q_')) {
      const qKey = sortBy.substring(2);
      valA = a.answers && a.answers[qKey] !== undefined ? String(a.answers[qKey]) : '';
      valB = b.answers && b.answers[qKey] !== undefined ? String(b.answers[qKey]) : '';
    } else {
      valA = a[sortBy] !== undefined && a[sortBy] !== null ? String(a[sortBy]) : '';
      valB = b[sortBy] !== undefined && b[sortBy] !== null ? String(b[sortBy]) : '';
    }
    const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  container.innerHTML = `
    ${renderReportTabs('detailed')}

    <!-- Top Filter & Task Selection Bar -->
    <div class="filter-bar">
      <div style="display:flex; align-items:center; gap:8px;">
        <label><strong>Task:</strong></label>
        <select class="form-select" onchange="state.filters.detailedTaskId = this.value; state.filters.detailedColumns = null; loadCurrentView();">
          ${tasks.map(t => `<option value="${t.id}" ${t.id === selectedTaskId ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex; align-items:center; gap:8px;">
        <select class="form-select" onchange="state.filters.detailedCampus = this.value; loadCurrentView();">
          <option value="">All Campuses</option>
          ${campuses.map(c => `<option value="${c.id}" ${c.id === campusFilter ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex; align-items:center; gap:8px;">
        <select class="form-select" onchange="state.filters.detailedStatus = this.value; loadCurrentView();">
          <option value="">All Statuses</option>
          <option value="SUBMITTED_ON_TIME" ${statusFilter === 'SUBMITTED_ON_TIME' ? 'selected' : ''}>Submitted On Time</option>
          <option value="SUBMITTED_LATE" ${statusFilter === 'SUBMITTED_LATE' ? 'selected' : ''}>Submitted Late</option>
          <option value="IN_PROGRESS" ${statusFilter === 'IN_PROGRESS' ? 'selected' : ''}>In Progress (Draft)</option>
          <option value="OVERDUE" ${statusFilter === 'OVERDUE' ? 'selected' : ''}>Overdue</option>
          <option value="NOT_STARTED" ${statusFilter === 'NOT_STARTED' ? 'selected' : ''}>Not Started</option>
        </select>
      </div>

      <div class="search-input-wrapper">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" class="form-input" placeholder="Search teacher, email, code..." value="${escapeHtml(state.filters.detailedSearch || '')}" oninput="state.filters.detailedSearch = this.value; loadCurrentView();" />
      </div>

      <div style="margin-left:auto; display:flex; gap:8px;">
        <button class="btn btn-secondary btn-sm" onclick="toggleColumnCustomizer()">
          <i class="fa-solid fa-sliders"></i> Customize Columns
        </button>
        <button class="btn btn-primary btn-sm" onclick="exportTaskResponses('${task.id}')">
          <i class="fa-solid fa-file-excel"></i> Download Excel
        </button>
      </div>
    </div>

    <!-- Column Customizer Dropdown Drawer (Collapsible) -->
    <div id="column-customizer-panel" style="display:${state.filters.isColumnCustomizerOpen ? 'block' : 'none'}; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
        <h4 style="margin:0;"><i class="fa-solid fa-table-columns text-primary"></i> Toggle Report Columns</h4>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn btn-outline btn-sm" onclick="bulkToggleDetailedCols(true)">
            <i class="fa-solid fa-check-double"></i> Select All
          </button>
          <button type="button" class="btn btn-outline btn-sm" onclick="bulkToggleDetailedCols(false)">
            <i class="fa-solid fa-square"></i> Deselect All
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="resetDefaultDetailedCols()">
            <i class="fa-solid fa-rotate-left"></i> Reset Defaults
          </button>
        </div>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:8px;">
        <label class="checkbox-label"><input type="checkbox" onchange="toggleDetailedCol('display_name', this.checked)" ${state.filters.detailedColumns.display_name ? 'checked' : ''} /> Teacher Name</label>
        <label class="checkbox-label"><input type="checkbox" onchange="toggleDetailedCol('employee_code', this.checked)" ${state.filters.detailedColumns.employee_code ? 'checked' : ''} /> Employee Code</label>
        <label class="checkbox-label"><input type="checkbox" onchange="toggleDetailedCol('campus_name', this.checked)" ${state.filters.detailedColumns.campus_name ? 'checked' : ''} /> Campus</label>
        <label class="checkbox-label"><input type="checkbox" onchange="toggleDetailedCol('department_names', this.checked)" ${state.filters.detailedColumns.department_names ? 'checked' : ''} /> Department</label>
        <label class="checkbox-label"><input type="checkbox" onchange="toggleDetailedCol('designation_name', this.checked)" ${state.filters.detailedColumns.designation_name ? 'checked' : ''} /> Designation</label>
        <label class="checkbox-label"><input type="checkbox" onchange="toggleDetailedCol('class_teacher_status', this.checked)" ${state.filters.detailedColumns.class_teacher_status ? 'checked' : ''} /> Class Teacher</label>
        <label class="checkbox-label"><input type="checkbox" onchange="toggleDetailedCol('due_at', this.checked)" ${state.filters.detailedColumns.due_at ? 'checked' : ''} /> Deadline</label>
        <label class="checkbox-label"><input type="checkbox" onchange="toggleDetailedCol('submitted_at', this.checked)" ${state.filters.detailedColumns.submitted_at ? 'checked' : ''} /> Submitted Date</label>
        <label class="checkbox-label"><input type="checkbox" onchange="toggleDetailedCol('status', this.checked)" ${state.filters.detailedColumns.status ? 'checked' : ''} /> Status</label>
        ${questions.map(q => `
          <label class="checkbox-label" title="${escapeHtml(q.label)}">
            <input type="checkbox" onchange="toggleDetailedCol('q_${q.key}', this.checked)" ${state.filters.detailedColumns[`q_${q.key}`] ? 'checked' : ''} />
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">[Q] ${escapeHtml(q.label)}</span>
          </label>
        `).join('')}
      </div>
    </div>

    <!-- Data Grid with Interactive Sorting Headers -->
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-table-columns"></i> Task Response Report (${filteredRows.length} Records)</h2>
        <span style="font-size:0.8rem; color:var(--text-muted);"><i class="fa-solid fa-arrow-down-a-z"></i> Click any column header to sort</span>
      </div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                ${state.filters.detailedColumns.display_name ? renderSortableHeader('display_name', 'Teacher Name', sortBy, sortDir) : ''}
                ${state.filters.detailedColumns.employee_code ? renderSortableHeader('employee_code', 'Emp Code', sortBy, sortDir) : ''}
                ${state.filters.detailedColumns.campus_name ? renderSortableHeader('campus_name', 'Campus', sortBy, sortDir) : ''}
                ${state.filters.detailedColumns.department_names ? renderSortableHeader('department_names', 'Department', sortBy, sortDir) : ''}
                ${state.filters.detailedColumns.designation_name ? renderSortableHeader('designation_name', 'Designation', sortBy, sortDir) : ''}
                ${state.filters.detailedColumns.class_teacher_status ? renderSortableHeader('class_teacher_status', 'Class Teacher', sortBy, sortDir) : ''}
                ${state.filters.detailedColumns.due_at ? renderSortableHeader('due_at', 'Deadline', sortBy, sortDir) : ''}
                ${state.filters.detailedColumns.submitted_at ? renderSortableHeader('submitted_at', 'Submitted Date', sortBy, sortDir) : ''}
                ${state.filters.detailedColumns.status ? renderSortableHeader('status', 'Status', sortBy, sortDir) : ''}
                ${questions.map(q => state.filters.detailedColumns[`q_${q.key}`] ? renderSortableHeader(`q_${q.key}`, q.label, sortBy, sortDir) : '').join('')}
              </tr>
            </thead>
            <tbody>
              ${filteredRows.length === 0 ? `
                <tr><td colspan="15" class="empty-state">No response records match your active filters.</td></tr>
              ` : filteredRows.map(r => `
                <tr>
                  ${state.filters.detailedColumns.display_name ? `<td><strong>${escapeHtml(r.display_name)}</strong><div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(r.email)}</div></td>` : ''}
                  ${state.filters.detailedColumns.employee_code ? `<td>${escapeHtml(r.employee_code || 'N/A')}</td>` : ''}
                  ${state.filters.detailedColumns.campus_name ? `<td>${escapeHtml(r.campus_name)}</td>` : ''}
                  ${state.filters.detailedColumns.department_names ? `<td>${escapeHtml(r.department_names || 'N/A')}</td>` : ''}
                  ${state.filters.detailedColumns.designation_name ? `<td>${escapeHtml(r.designation_name || 'Teacher')}</td>` : ''}
                  ${state.filters.detailedColumns.class_teacher_status ? `<td>${r.class_teacher_status === 'Yes' ? '<span class="badge badge-active">Yes</span>' : '<span class="badge badge-not-started">No</span>'}</td>` : ''}
                  ${state.filters.detailedColumns.due_at ? `<td>${formatDateTime(r.due_at)}</td>` : ''}
                  ${state.filters.detailedColumns.submitted_at ? `<td>${r.submitted_at ? formatDateTime(r.submitted_at) : '<span class="text-muted">Not Submitted</span>'}</td>` : ''}
                  ${state.filters.detailedColumns.status ? `<td><span class="badge badge-${r.status.toLowerCase().replace(/_/g, '-')}">${formatStatus(r.status)}</span></td>` : ''}
                  ${questions.map(q => {
                    if (!state.filters.detailedColumns[`q_${q.key}`]) return '';
                    let ans = r.answers && r.answers[q.key] !== undefined && r.answers[q.key] !== null ? r.answers[q.key] : '';
                    if (Array.isArray(ans)) ans = ans.join(', ');
                    return `<td>${ans ? escapeHtml(String(ans)) : '<span class="text-muted">-</span>'}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderSortableHeader(key, label, currentSort, currentDir) {
  const isSorted = currentSort === key;
  const icon = isSorted ? (currentDir === 'asc' ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short') : 'fa-sort';
  const newDir = isSorted && currentDir === 'asc' ? 'desc' : 'asc';
  return `
    <th style="cursor:pointer; user-select:none;" onclick="state.filters.detailedSortBy = '${key}'; state.filters.detailedSortDir = '${newDir}'; loadCurrentView();">
      <div style="display:flex; align-items:center; gap:6px;">
        <span>${escapeHtml(label)}</span>
        <i class="fa-solid ${icon}" style="font-size:0.75rem; color:${isSorted ? 'var(--primary)' : 'var(--text-subtle)'};"></i>
      </div>
    </th>
  `;
}

function toggleColumnCustomizer() {
  state.filters.isColumnCustomizerOpen = !state.filters.isColumnCustomizerOpen;
  const p = document.getElementById('column-customizer-panel');
  if (p) p.style.display = state.filters.isColumnCustomizerOpen ? 'block' : 'none';
}

function toggleDetailedCol(colKey, isChecked) {
  if (!state.filters.detailedColumns) state.filters.detailedColumns = {};
  state.filters.detailedColumns[colKey] = isChecked;
  state.filters.isColumnCustomizerOpen = true;
  loadCurrentView();
}

function bulkToggleDetailedCols(checkAll) {
  if (!state.filters.detailedColumns) state.filters.detailedColumns = {};
  for (const k of Object.keys(state.filters.detailedColumns)) {
    state.filters.detailedColumns[k] = Boolean(checkAll);
  }
  state.filters.isColumnCustomizerOpen = true;
  loadCurrentView();
}

function resetDefaultDetailedCols() {
  state.filters.detailedColumns = null;
  state.filters.isColumnCustomizerOpen = true;
  loadCurrentView();
}

// ============================================================================
// 9. FACULTY, GROUPS, MASTERS & RECURRING TASKS
// ============================================================================

async function renderUsersDirectory(container) {
  const [users, campuses] = await Promise.all([
    api('/users?user_type='), // all users
    api('/campuses')
  ]);

  const canManageAccess = state.user.isSuperAdmin || state.user.user_type === 'SUPER_ADMIN';
  const canEditUsers = hasPermission('users.edit') || canManageAccess;

  // Filters state
  const search = (state.filters.userSearch || '').toLowerCase();
  const campusFilter = state.filters.userCampus || '';
  const typeFilter = state.filters.userType || '';
  const statusFilter = state.filters.userStatus || '';
  const sortBy = state.filters.userSortBy || 'display_name';
  const sortDir = state.filters.userSortDir || 'asc';

  let filteredUsers = users.filter(u => {
    if (campusFilter && u.campus_id !== campusFilter) return false;
    if (typeFilter && u.user_type !== typeFilter) return false;
    if (statusFilter && (u.status || 'ACTIVE') !== statusFilter) return false;
    if (search) {
      const match = (u.display_name || '').toLowerCase().includes(search) ||
                    (u.email || '').toLowerCase().includes(search) ||
                    (u.employee_code || '').toLowerCase().includes(search) ||
                    (u.campus_name || '').toLowerCase().includes(search);
      if (!match) return false;
    }
    return true;
  });

  filteredUsers.sort((a, b) => {
    const valA = a[sortBy] !== undefined && a[sortBy] !== null ? String(a[sortBy]) : '';
    const valB = b[sortBy] !== undefined && b[sortBy] !== null ? String(b[sortBy]) : '';
    const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function renderUserSortHeader(key, label) {
    const isSorted = sortBy === key;
    const icon = isSorted ? (sortDir === 'asc' ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short') : 'fa-sort';
    const newDir = isSorted && sortDir === 'asc' ? 'desc' : 'asc';
    return `
      <th style="cursor:pointer; user-select:none;" onclick="state.filters.userSortBy = '${key}'; state.filters.userSortDir = '${newDir}'; loadCurrentView();">
        <div style="display:flex; align-items:center; gap:6px;">
          <span>${escapeHtml(label)}</span>
          <i class="fa-solid ${icon}" style="font-size:0.75rem; color:${isSorted ? 'var(--primary)' : 'var(--text-subtle)'};"></i>
        </div>
      </th>
    `;
  }

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
      <div>
        <h2><i class="fa-solid fa-chalkboard-user"></i> Faculty & Staff Directory</h2>
        <span style="font-size:0.85rem; color:var(--text-muted);">Showing ${filteredUsers.length} of ${users.length} members</span>
      </div>
      ${hasPermission('users.create') ? `
        <button class="btn btn-primary" onclick="openCreateUserModal()">
          <i class="fa-solid fa-user-plus"></i> Add User
        </button>
      ` : ''}
    </div>

    <!-- Search & Filter Bar -->
    <div class="filter-bar" style="margin-bottom:16px;">
      <div class="search-input-wrapper" style="flex:1; min-width:220px;">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" class="form-input" placeholder="Search by name, email, employee code..." value="${escapeHtml(state.filters.userSearch || '')}" oninput="state.filters.userSearch = this.value; loadCurrentView();" />
      </div>

      <div style="display:flex; align-items:center; gap:8px;">
        <select class="form-select" onchange="state.filters.userCampus = this.value; loadCurrentView();">
          <option value="">All Campuses</option>
          ${campuses.map(c => `<option value="${c.id}" ${c.id === campusFilter ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex; align-items:center; gap:8px;">
        <select class="form-select" onchange="state.filters.userType = this.value; loadCurrentView();">
          <option value="">All Roles / Types</option>
          <option value="TEACHER" ${typeFilter === 'TEACHER' ? 'selected' : ''}>Teacher</option>
          <option value="ADMIN" ${typeFilter === 'ADMIN' ? 'selected' : ''}>Admin</option>
          <option value="SUPER_ADMIN" ${typeFilter === 'SUPER_ADMIN' ? 'selected' : ''}>Super Admin</option>
        </select>
      </div>

      <div style="display:flex; align-items:center; gap:8px;">
        <select class="form-select" onchange="state.filters.userStatus = this.value; loadCurrentView();">
          <option value="">All Statuses</option>
          <option value="ACTIVE" ${statusFilter === 'ACTIVE' ? 'selected' : ''}>Active</option>
          <option value="INACTIVE" ${statusFilter === 'INACTIVE' ? 'selected' : ''}>Inactive</option>
        </select>
      </div>

      ${(search || campusFilter || typeFilter || statusFilter) ? `
        <button class="btn btn-secondary btn-sm" onclick="state.filters.userSearch = ''; state.filters.userCampus = ''; state.filters.userType = ''; state.filters.userStatus = ''; loadCurrentView();">
          <i class="fa-solid fa-xmark"></i> Clear Filters
        </button>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                ${renderUserSortHeader('display_name', 'Name')}
                ${renderUserSortHeader('email', 'Email')}
                ${renderUserSortHeader('employee_code', 'Employee Code')}
                ${renderUserSortHeader('user_type', 'User Type')}
                ${renderUserSortHeader('campus_name', 'Campus')}
                <th>Class Teacher</th>
                ${renderUserSortHeader('status', 'Status')}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredUsers.length === 0 ? `
                <tr><td colspan="8" class="empty-state">No faculty members found matching your search or filters.</td></tr>
              ` : filteredUsers.map(u => `
                <tr>
                  <td><strong>${escapeHtml(u.display_name)}</strong></td>
                  <td>${escapeHtml(u.email)}</td>
                  <td><code>${escapeHtml(u.employee_code || 'N/A')}</code></td>
                  <td><span class="badge ${u.user_type === 'SUPER_ADMIN' ? 'badge-overdue' : (u.user_type === 'ADMIN' ? 'badge-in-progress' : 'badge-not-started')}">${u.user_type}</span></td>
                  <td>${escapeHtml(u.campus_name)}</td>
                  <td>${u.class_teacher_status ? '<span class="badge badge-active">Yes</span>' : '<span class="badge badge-not-started">No</span>'}</td>
                  <td><span class="badge badge-${(u.status || 'ACTIVE').toLowerCase()}">${u.status || 'ACTIVE'}</span></td>
                  <td>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                      ${canEditUsers ? `
                        <button class="btn btn-outline btn-sm" onclick="openEditUserModal('${u.id}')" title="Edit Teacher Details">
                          <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>
                      ` : ''}
                      ${canManageAccess ? `
                        <button class="btn btn-secondary btn-sm" onclick="openManageUserAccessModal('${u.id}')" title="Assign Role & Campus Scope">
                          <i class="fa-solid fa-key"></i> Role & Campus
                        </button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function openEditUserModal(userId) {
  const [userData, campuses, departments, designations, subjects, categories] = await Promise.all([
    api(`/users/${userId}`),
    api('/campuses'),
    api('/masters?master_type=DEPARTMENT'),
    api('/masters?master_type=DESIGNATION'),
    api('/masters?master_type=SUBJECT'),
    api('/masters?master_type=CATEGORY')
  ]);

  const { user, attributes } = userData;
  const userAttrIds = new Set(attributes.map(a => a.master_value_id));

  // Extract department, designation, subjects, categories
  const currentDept = attributes.find(a => a.master_type === 'DEPARTMENT');
  const currentDesig = attributes.find(a => a.master_type === 'DESIGNATION');
  const currentDeptId = currentDept ? currentDept.master_value_id : '';
  const currentDesigId = currentDesig ? currentDesig.master_value_id : '';

  const html = `
    <div class="card-header">
      <div>
        <h3>Edit Faculty Member</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">${escapeHtml(user.display_name)} (${escapeHtml(user.email)})</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-edit-user" onsubmit="handleSaveUser(event, '${userId}')">
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="form-group">
            <label>First Name <span class="text-danger">*</span></label>
            <input type="text" name="first_name" class="form-input" value="${escapeHtml(user.first_name || '')}" required />
          </div>
          <div class="form-group">
            <label>Last Name <span class="text-danger">*</span></label>
            <input type="text" name="last_name" class="form-input" value="${escapeHtml(user.last_name || '')}" required />
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" name="email" class="form-input" value="${escapeHtml(user.email || '')}" disabled title="Email is managed via system administration" />
          </div>
          <div class="form-group">
            <label>Phone Number</label>
            <input type="text" name="phone" class="form-input" value="${escapeHtml(user.phone || '')}" placeholder="+91 9876543210" />
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="form-group">
            <label>Employee Code</label>
            <input type="text" name="employee_code" class="form-input" value="${escapeHtml(user.employee_code || '')}" placeholder="e.g. EMP_TC10" />
          </div>
          <div class="form-group">
            <label>Account Status <span class="text-danger">*</span></label>
            <select name="status" class="form-select" required>
              <option value="ACTIVE" ${user.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
              <option value="INACTIVE" ${user.status === 'INACTIVE' ? 'selected' : ''}>INACTIVE</option>
              <option value="SUSPENDED" ${user.status === 'SUSPENDED' ? 'selected' : ''}>SUSPENDED</option>
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="form-group">
            <label>Primary Campus <span class="text-danger">*</span></label>
            <select name="campus_id" class="form-select" required>
              ${campuses.map(c => `<option value="${c.id}" ${c.id === user.campus_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Designation</label>
            <select name="designation_id" class="form-select">
              <option value="">Select Designation...</option>
              ${designations.map(d => `<option value="${d.id}" ${d.id === currentDesigId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label>Department</label>
          <select name="department_id" class="form-select">
            <option value="">Select Primary Department...</option>
            ${departments.map(d => `<option value="${d.id}" ${d.id === currentDeptId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" name="class_teacher_status" value="true" ${user.class_teacher_status ? 'checked' : ''} />
            <strong>Class Teacher Appointment</strong>
          </label>
        </div>

        <!-- Subjects -->
        <div class="form-group">
          <label><strong>Assigned Subjects</strong></label>
          <div style="max-height: 120px; overflow-y:auto; background:var(--border-subtle); padding:10px; border-radius:var(--radius-md); display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:6px;">
            ${subjects.map(s => `
              <label class="checkbox-label">
                <input type="checkbox" name="subject_ids" value="${s.id}" ${userAttrIds.has(s.id) ? 'checked' : ''} />
                ${escapeHtml(s.name)}
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Categories -->
        <div class="form-group">
          <label><strong>Faculty Categories (e.g. Senior Wing, Primary Wing)</strong></label>
          <div style="max-height: 100px; overflow-y:auto; background:var(--border-subtle); padding:10px; border-radius:var(--radius-md); display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:6px;">
            ${categories.map(c => `
              <label class="checkbox-label">
                <input type="checkbox" name="category_ids" value="${c.id}" ${userAttrIds.has(c.id) ? 'checked' : ''} />
                ${escapeHtml(c.name)}
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Password Reset -->
        <div class="form-group">
          <label>Reset Password (Optional - leave blank to keep existing password)</label>
          <input type="password" name="password" class="form-input" placeholder="New Password..." />
        </div>

        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i class="fa-solid fa-floppy-disk"></i> Save Teacher Changes
          </button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

async function handleSaveUser(event, userId) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    phone: formData.get('phone'),
    employee_code: formData.get('employee_code'),
    status: formData.get('status'),
    campus_id: formData.get('campus_id'),
    designation_id: formData.get('designation_id') || null,
    department_id: formData.get('department_id') || null,
    class_teacher_status: formData.get('class_teacher_status') === 'true',
    subject_ids: formData.getAll('subject_ids'),
    category_ids: formData.getAll('category_ids')
  };

  const password = formData.get('password');
  if (password) {
    payload.password = password;
  }

  try {
    const res = await api(`/users/${userId}`, { method: 'PUT', body: payload });
    showToast(res.message || 'User updated successfully!', 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Ignored
  }
}

async function openManageUserAccessModal(userId) {
  const [userData, roles, campuses] = await Promise.all([
    api(`/users/${userId}/access`),
    api('/roles'),
    api('/campuses')
  ]);

  const { user, access } = userData;
  const currentAccess = access[0] || {};
  const currentRoleId = currentAccess.role_id || (roles[1] ? roles[1].id : '');
  const currentAssignedCampusIds = new Set(access.map(a => a.campus_id).filter(Boolean));
  const isCurrentlyGlobal = access.some(a => a.campus_id === null) || (access.length === 0 && user.user_type === 'SUPER_ADMIN');

  const html = `
    <div class="card-header">
      <div>
        <h3>Manage Role & Campus Scope</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">${escapeHtml(user.display_name)} (${escapeHtml(user.email)})</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-manage-access" onsubmit="handleSaveUserAccess(event, '${userId}')">
        
        <div class="form-group">
          <label><strong>1. User Type (Portal Experience) <span class="text-danger">*</span></strong></label>
          <select name="user_type" class="form-select" required>
            <option value="TEACHER" ${user.user_type === 'TEACHER' ? 'selected' : ''}>TEACHER (Teacher Portal Only - My Tasks, Submissions, My Performance)</option>
            <option value="ADMIN" ${user.user_type === 'ADMIN' ? 'selected' : ''}>ADMIN (Admin Portal + Integrated Teacher Workspace for Assigned Tasks)</option>
            <option value="SUPER_ADMIN" ${user.user_type === 'SUPER_ADMIN' ? 'selected' : ''}>SUPER_ADMIN (Full System Access Across All Campuses)</option>
          </select>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">
            Admins & Principals get both full administrative management and a personal Teacher Workspace.
          </p>
        </div>

        <div class="form-group">
          <label><strong>2. Assign Role (Permissions) <span class="text-danger">*</span></strong></label>
          <select name="role_id" class="form-select" required>
            ${roles.map(r => `
              <option value="${r.id}" ${r.id === currentRoleId ? 'selected' : ''}>
                ${escapeHtml(r.name)} - ${escapeHtml(r.description || '')}
              </option>
            `).join('')}
          </select>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">
            e.g., "Campus Principal" or "Academic Coordinator".
          </p>
        </div>

        <div class="form-group">
          <label><strong>3. Assigned Managed Campuses (Multi-Select) <span class="text-danger">*</span></strong></label>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">
            Principals and Coordinators can be assigned multiple campuses to manage simultaneously.
          </p>
          <div style="background:var(--border-subtle); padding:12px; border-radius:var(--radius-md); display:flex; flex-direction:column; gap:8px;">
            <label class="checkbox-label" style="font-weight:600; border-bottom:1px solid var(--border-color); padding-bottom:6px;">
              <input type="checkbox" id="chk-global-campus" name="is_global_campus" value="true" ${isCurrentlyGlobal ? 'checked' : ''} onchange="toggleGlobalCampusSelection(this.checked)" />
              <span><i class="fa-solid fa-globe text-primary"></i> All Campuses (Global Management Scope)</span>
            </label>
            <div id="individual-campuses-list" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:8px; margin-top:4px;">
              ${campuses.map(c => `
                <label class="checkbox-label">
                  <input type="checkbox" name="campus_ids" class="campus-access-checkbox" value="${c.id}" ${!isCurrentlyGlobal && currentAssignedCampusIds.has(c.id) ? 'checked' : ''} />
                  <span>${escapeHtml(c.name)} (${escapeHtml(c.code)})</span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>

        <div style="background:var(--primary-light); border-left:4px solid var(--primary); padding:12px; border-radius:var(--radius-sm); margin:16px 0; font-size:0.85rem;">
          <i class="fa-solid fa-circle-info"></i> <strong>Example:</strong> To assign a Principal to manage <strong>North Campus AND South Campus</strong>:
          <br />• Set User Type = <code>ADMIN</code>
          <br />• Set Role = <code>Campus Principal</code>
          <br />• Check <code>North Campus</code> and <code>South Campus</code>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i class="fa-solid fa-floppy-disk"></i> Save Access & Scope
          </button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

function toggleGlobalCampusSelection(isGlobal) {
  const checkboxes = document.querySelectorAll('.campus-access-checkbox');
  checkboxes.forEach(cb => {
    if (isGlobal) {
      cb.checked = false;
      cb.disabled = true;
    } else {
      cb.disabled = false;
    }
  });
}

async function handleSaveUserAccess(event, userId) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const userType = formData.get('user_type');
  const roleId = formData.get('role_id');
  const isGlobal = formData.get('is_global_campus') === 'true';
  const selectedCampusIds = formData.getAll('campus_ids');

  let assignments = [];
  if (isGlobal || selectedCampusIds.length === 0) {
    assignments = [{ role_id: roleId, campus_id: null, permission_overrides: null }];
  } else {
    assignments = selectedCampusIds.map(cid => ({
      role_id: roleId,
      campus_id: cid,
      permission_overrides: null
    }));
  }

  const payload = {
    user_type: userType,
    assignments
  };

  try {
    const res = await api(`/users/${userId}/access`, {
      method: 'PUT',
      body: payload
    });
    showToast(res.message || 'Access and campus scope updated successfully!', 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Handled in api
  }
}

async function openCreateUserModal() {
  const campuses = await api('/campuses');

  const html = `
    <div class="card-header">
      <h3>Add New Faculty Member</h3>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-create-user" onsubmit="handleCreateUser(event)">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="form-group">
            <label>First Name <span class="text-danger">*</span></label>
            <input type="text" name="first_name" class="form-input" required />
          </div>
          <div class="form-group">
            <label>Last Name <span class="text-danger">*</span></label>
            <input type="text" name="last_name" class="form-input" required />
          </div>
        </div>
        <div class="form-group">
          <label>Email Address <span class="text-danger">*</span></label>
          <input type="email" name="email" class="form-input" required />
        </div>
        <div class="form-group">
          <label>Employee Code</label>
          <input type="text" name="employee_code" class="form-input" placeholder="e.g. EMP_TC10" />
        </div>
        <div class="form-group">
          <label>Primary Campus <span class="text-danger">*</span></label>
          <select name="campus_id" class="form-select" required>
            ${campuses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" name="class_teacher_status" value="true" />
            Class Teacher Appointment
          </label>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Teacher</button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

async function handleCreateUser(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    email: formData.get('email'),
    employee_code: formData.get('employee_code'),
    campus_id: formData.get('campus_id'),
    class_teacher_status: formData.get('class_teacher_status') === 'true',
    user_type: 'TEACHER'
  };

  try {
    await api('/users', { method: 'POST', body: payload });
    showToast('Teacher created successfully!', 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Ignored
  }
}

// Admin Groups Management
async function renderAdminGroups(container) {
  const groups = await api('/groups');
  const canEdit = hasPermission('groups.edit') || state.user.isSuperAdmin;
  const canManageMembers = hasPermission('groups.manage_members') || state.user.isSuperAdmin;

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
      <h2><i class="fa-solid fa-users-rectangle"></i> Campus Groups</h2>
      ${hasPermission('groups.create') ? `
        <button class="btn btn-primary" onclick="openCreateGroupModal()">
          <i class="fa-solid fa-plus"></i> Create Group
        </button>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Group Name</th>
                <th>Campus</th>
                <th>Description</th>
                <th>Approved Members</th>
                <th>Join Requests Allowed</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${groups.map(g => `
                <tr>
                  <td><strong>${escapeHtml(g.name)}</strong></td>
                  <td>${escapeHtml(g.campus_name)}</td>
                  <td>${escapeHtml(g.description || 'N/A')}</td>
                  <td><span class="badge badge-in-progress">${g.member_count} Members</span></td>
                  <td>${g.allow_join_requests ? '<span class="badge badge-active">Yes</span>' : '<span class="badge badge-not-started">No</span>'}</td>
                  <td><span class="badge badge-${(g.status || 'ACTIVE').toLowerCase()}">${g.status || 'ACTIVE'}</span></td>
                  <td>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                      ${canManageMembers ? `
                        <button class="btn btn-primary btn-sm" onclick="openManageGroupMembersModal('${g.id}')" title="Add / Remove Campus Teachers">
                          <i class="fa-solid fa-user-group"></i> Manage Members (${g.member_count})
                        </button>
                      ` : ''}
                      ${canEdit ? `
                        <button class="btn btn-outline btn-sm" onclick="openEditGroupModal('${g.id}')" title="Edit Group Details">
                          <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function openCreateGroupModal() {
  const [campuses, teachers] = await Promise.all([
    api('/campuses'),
    api('/users?user_type=TEACHER')
  ]);

  const html = `
    <div class="card-header">
      <h3>Create Faculty Group</h3>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-create-group" onsubmit="handleCreateGroup(event)">
        <div class="form-group">
          <label>Group Name <span class="text-danger">*</span></label>
          <input type="text" name="name" class="form-input" required placeholder="e.g. Science Faculty Forum" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description" class="form-textarea" placeholder="Group purpose..."></textarea>
        </div>
        <div class="form-group">
          <label>Campus <span class="text-danger">*</span></label>
          <select name="campus_id" id="group-campus-select" class="form-select" required>
            ${campuses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" name="allow_join_requests" value="true" checked />
            Allow Teachers to Request Membership
          </label>
        </div>

        <div class="form-group">
          <label>Bulk Initial Members (Optional)</label>
          <div style="max-height: 150px; overflow-y:auto; background:var(--border-subtle); padding:10px; border-radius:var(--radius-md);">
            ${teachers.map(t => `
              <label class="checkbox-label" style="margin-bottom:6px;">
                <input type="checkbox" name="member_ids" value="${t.id}" />
                ${escapeHtml(t.display_name)} (${escapeHtml(t.email)})
              </label>
            `).join('')}
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Group</button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

async function handleCreateGroup(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    name: formData.get('name'),
    description: formData.get('description'),
    campus_id: formData.get('campus_id'),
    allow_join_requests: formData.get('allow_join_requests') === 'true',
    member_ids: formData.getAll('member_ids')
  };

  try {
    await api('/groups', { method: 'POST', body: payload });
    showToast('Group created successfully!', 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Ignored
  }
}

async function openEditGroupModal(groupId) {
  const [groups, campuses] = await Promise.all([
    api('/groups'),
    api('/campuses')
  ]);
  const group = groups.find(g => g.id === groupId);
  if (!group) return showToast('Group not found', 'danger');

  const html = `
    <div class="card-header">
      <div>
        <h3>Edit Group Details</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">${escapeHtml(group.name)}</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-edit-group" onsubmit="handleSaveGroup(event, '${groupId}')">
        <div class="form-group">
          <label>Group Name <span class="text-danger">*</span></label>
          <input type="text" name="name" class="form-input" value="${escapeHtml(group.name)}" required />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description" class="form-textarea" placeholder="Group purpose...">${escapeHtml(group.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Campus <span class="text-danger">*</span></label>
          <select name="campus_id" class="form-select" required>
            ${campuses.map(c => `<option value="${c.id}" ${c.id === group.campus_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Group Status <span class="text-danger">*</span></label>
          <select name="status" class="form-select" required>
            <option value="ACTIVE" ${group.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
            <option value="INACTIVE" ${group.status === 'INACTIVE' ? 'selected' : ''}>INACTIVE</option>
            <option value="ARCHIVED" ${group.status === 'ARCHIVED' ? 'selected' : ''}>ARCHIVED</option>
          </select>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" name="allow_join_requests" value="true" ${group.allow_join_requests ? 'checked' : ''} />
            Allow Teachers to Request Membership
          </label>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i class="fa-solid fa-floppy-disk"></i> Save Group Details
          </button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

async function handleSaveGroup(event, groupId) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    name: formData.get('name'),
    description: formData.get('description'),
    campus_id: formData.get('campus_id'),
    status: formData.get('status'),
    allow_join_requests: formData.get('allow_join_requests') === 'true'
  };

  try {
    const res = await api(`/groups/${groupId}`, { method: 'PUT', body: payload });
    showToast(res.message || 'Group updated successfully!', 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Handled in api
  }
}

// Manage Managed Campus Teachers Group Members
async function openManageGroupMembersModal(groupId) {
  const data = await api(`/groups/${groupId}/members`);
  const { group, teachers } = data;

  const html = `
    <div class="card-header">
      <div>
        <h3>Manage Group Members: ${escapeHtml(group.name)}</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">
          Campus Teachers Directory (${escapeHtml(group.campus_name || 'Assigned Campus')}) • <strong>${teachers.filter(t => t.is_member).length} Active Members</strong>
        </span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      
      <!-- Quick Filter & Bulk Toolbar -->
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:16px; background:var(--border-subtle); padding:10px; border-radius:var(--radius-md);">
        <div class="search-input-wrapper" style="flex:1; min-width:200px;">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="group-member-search" class="form-input" placeholder="Search teacher by name or email..." oninput="filterGroupMembersTable()" />
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="toggleAllGroupMembers(true)">
            <i class="fa-solid fa-check-double"></i> Select All
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="toggleAllGroupMembers(false)">
            <i class="fa-solid fa-square-minus"></i> Deselect All
          </button>
        </div>
      </div>

      <!-- Campus Teachers Table -->
      <form id="form-group-members" onsubmit="handleSaveGroupMembers(event, '${groupId}')">
        <div class="table-responsive" style="max-height: 400px; overflow-y:auto; border:1px solid var(--border-color); border-radius:var(--radius-sm);">
          <table class="table" id="group-members-table">
            <thead>
              <tr>
                <th style="width: 40px; text-align:center;">Member?</th>
                <th>Teacher Name & Email</th>
                <th>Emp Code</th>
                <th>Group Role</th>
                <th>Current Status</th>
              </tr>
            </thead>
            <tbody>
              ${teachers.length === 0 ? `
                <tr><td colspan="5" class="empty-state">No teachers found in this campus.</td></tr>
              ` : teachers.map(t => `
                <tr class="group-member-row" data-search="${escapeHtml((t.display_name + ' ' + t.email + ' ' + (t.employee_code || '')).toLowerCase())}">
                  <td style="text-align:center;">
                    <input type="checkbox" class="group-member-checkbox" data-user-id="${t.id}" ${t.is_member ? 'checked' : ''} />
                  </td>
                  <td>
                    <strong>${escapeHtml(t.display_name)}</strong>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(t.email)}</div>
                  </td>
                  <td><code>${escapeHtml(t.employee_code || 'N/A')}</code></td>
                  <td>
                    <select class="form-select form-select-sm group-member-role" data-user-id="${t.id}" style="width: 140px;">
                      <option value="MEMBER" ${t.membership_role === 'MEMBER' ? 'selected' : ''}>Member</option>
                      <option value="GROUP_ADMIN" ${t.membership_role === 'GROUP_ADMIN' ? 'selected' : ''}>Group Admin</option>
                    </select>
                  </td>
                  <td>
                    ${t.is_member ? (t.membership_role === 'GROUP_ADMIN' ? '<span class="badge badge-active"><i class="fa-solid fa-crown"></i> Group Admin</span>' : '<span class="badge badge-in-progress">Approved Member</span>') : (t.status === 'PENDING' ? '<span class="badge badge-overdue">Request Pending</span>' : '<span class="badge badge-not-started">Not in Group</span>')}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px;">
          <span style="font-size:0.85rem; color:var(--text-muted);">
            <i class="fa-solid fa-circle-info"></i> Adding teachers grants them group task assignments and group announcements.
          </span>
          <div style="display:flex; gap:12px;">
            <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">
              <i class="fa-solid fa-check-double"></i> Save Group Membership
            </button>
          </div>
        </div>
      </form>

    </div>
  `;
  openModal(html);
}

function filterGroupMembersTable() {
  const query = (document.getElementById('group-member-search').value || '').toLowerCase();
  const rows = document.querySelectorAll('.group-member-row');
  rows.forEach(r => {
    const text = r.getAttribute('data-search') || '';
    r.style.display = text.includes(query) ? '' : 'none';
  });
}

function toggleAllGroupMembers(check) {
  const rows = document.querySelectorAll('.group-member-row');
  rows.forEach(r => {
    if (r.style.display !== 'none') {
      const cb = r.querySelector('.group-member-checkbox');
      if (cb) cb.checked = check;
    }
  });
}

async function handleSaveGroupMembers(event, groupId) {
  event.preventDefault();
  const checkboxes = document.querySelectorAll('.group-member-checkbox:checked');
  const members = [];

  checkboxes.forEach(cb => {
    const userId = cb.getAttribute('data-user-id');
    const roleSelect = document.querySelector(`.group-member-role[data-user-id="${userId}"]`);
    const membership_role = roleSelect ? roleSelect.value : 'MEMBER';
    members.push({ user_id: userId, membership_role });
  });

  try {
    const res = await api(`/groups/${groupId}/members`, {
      method: 'POST',
      body: { members }
    });
    showToast(res.message || 'Group members updated successfully!', 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Handled in api
  }
}

// Group Joining Requests Review
async function renderGroupRequests(container) {
  const requests = await api('/group-requests');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-user-check"></i> Pending Group Joining Requests</h2>
      </div>
      <div class="card-body">
        ${requests.length === 0 ? `
          <div class="empty-state">
            <i class="fa-solid fa-circle-check text-success"></i>
            <h3>No Pending Requests</h3>
            <p>All group membership requests have been reviewed.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Campus</th>
                  <th>Requested Group</th>
                  <th>Requested Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${requests.map(r => `
                  <tr>
                    <td>
                      <strong>${escapeHtml(r.teacher_name)}</strong>
                      <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(r.teacher_email)}</div>
                    </td>
                    <td>${escapeHtml(r.campus_name)}</td>
                    <td><strong class="text-primary">${escapeHtml(r.group_name)}</strong></td>
                    <td>${formatDateTime(r.requested_at)}</td>
                    <td>
                      <div style="display:flex; gap:8px;">
                        <button class="btn btn-success btn-sm" onclick="reviewGroupRequest('${r.id}', 'APPROVE')">
                          <i class="fa-solid fa-check"></i> Approve
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="reviewGroupRequest('${r.id}', 'REJECT')">
                          <i class="fa-solid fa-xmark"></i> Decline
                        </button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

async function reviewGroupRequest(id, action) {
  const notes = prompt(`Enter optional review notes for ${action.toLowerCase()} decision:`) || '';
  try {
    await api(`/group-requests/${id}/review`, {
      method: 'POST',
      body: { action, review_notes: notes }
    });
    showToast(`Request ${action === 'APPROVE' ? 'Approved' : 'Declined'} successfully`, 'success');
    fetchPendingGroupRequestsCount();
    loadCurrentView();
  } catch {
    // Ignored
  }
}

// Master Data Management
async function renderMasterData(container) {
  const currentTab = state.filters.masterTab || 'DEPARTMENT';
  const masters = await api(`/masters?master_type=${currentTab}`);
  const canEdit = hasPermission('masters.edit') || state.user.isSuperAdmin;

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
      <h2><i class="fa-solid fa-layer-group"></i> Master Data Management</h2>
      ${hasPermission('masters.create') ? `
        <button class="btn btn-primary" onclick="openCreateMasterModal('${currentTab}')">
          <i class="fa-solid fa-plus"></i> Add ${currentTab}
        </button>
      ` : ''}
    </div>

    <!-- Tab Bar -->
    <div style="display:flex; gap:8px; margin-bottom: 20px; border-bottom:1px solid var(--border-color); padding-bottom:8px; overflow-x:auto;">
      ${['DEPARTMENT', 'DESIGNATION', 'SUBJECT', 'CATEGORY'].map(tab => `
        <button class="btn ${currentTab === tab ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="state.filters.masterTab = '${tab}'; loadCurrentView();">
          ${tab}S
        </button>
      `).join('')}
    </div>

    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Campus Scope</th>
                <th>Sort Order</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${masters.map(m => `
                <tr>
                  <td><strong>${escapeHtml(m.name)}</strong></td>
                  <td><code>${escapeHtml(m.code || 'N/A')}</code></td>
                  <td>${m.campus_name ? escapeHtml(m.campus_name) : '<span class="badge badge-in-progress">Global (All Campuses)</span>'}</td>
                  <td>${m.sort_order || 0}</td>
                  <td><span class="badge badge-${(m.status || 'ACTIVE').toLowerCase()}">${m.status || 'ACTIVE'}</span></td>
                  <td>
                    ${canEdit ? `
                      <button class="btn btn-outline btn-sm" onclick="openEditMasterModal('${m.id}', '${currentTab}', '${escapeHtml(m.name).replace(/'/g, "\\'")}', '${escapeHtml(m.code || '').replace(/'/g, "\\'")}', '${m.campus_id || ''}', ${m.sort_order || 0}, '${m.status || 'ACTIVE'}')">
                        <i class="fa-solid fa-pen-to-square"></i> Edit
                      </button>
                    ` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function openCreateMasterModal(masterType) {
  const campuses = await api('/campuses');

  const html = `
    <div class="card-header">
      <h3>Add ${masterType} Master</h3>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-create-master" onsubmit="handleCreateMaster(event, '${masterType}')">
        <div class="form-group">
          <label>Name <span class="text-danger">*</span></label>
          <input type="text" name="name" class="form-input" required placeholder="e.g. Robotics & AI" />
        </div>
        <div class="form-group">
          <label>Code</label>
          <input type="text" name="code" class="form-input" placeholder="e.g. SUB_ROBOTICS" />
        </div>
        <div class="form-group">
          <label>Campus Scope</label>
          <select name="campus_id" class="form-select">
            <option value="">Global (All Campuses)</option>
            ${campuses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Master</button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

async function handleCreateMaster(event, masterType) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    master_type: masterType,
    name: formData.get('name'),
    code: formData.get('code'),
    campus_id: formData.get('campus_id') || null
  };

  try {
    await api('/masters', { method: 'POST', body: payload });
    showToast('Master value saved successfully!', 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Ignored
  }
}

async function openEditMasterModal(masterId, masterType, name, code, campusId, sortOrder, status) {
  const campuses = await api('/campuses');

  const html = `
    <div class="card-header">
      <div>
        <h3>Edit ${masterType} Master</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">${escapeHtml(name)}</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-edit-master" onsubmit="handleSaveMaster(event, '${masterId}')">
        <div class="form-group">
          <label>Name <span class="text-danger">*</span></label>
          <input type="text" name="name" class="form-input" value="${escapeHtml(name)}" required />
        </div>
        <div class="form-group">
          <label>Code</label>
          <input type="text" name="code" class="form-input" value="${escapeHtml(code || '')}" />
        </div>
        <div class="form-group">
          <label>Campus Scope</label>
          <select name="campus_id" class="form-select">
            <option value="" ${!campusId ? 'selected' : ''}>Global (All Campuses)</option>
            ${campuses.map(c => `<option value="${c.id}" ${c.id === campusId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="form-group">
            <label>Sort Order</label>
            <input type="number" name="sort_order" class="form-input" value="${sortOrder}" />
          </div>
          <div class="form-group">
            <label>Status <span class="text-danger">*</span></label>
            <select name="status" class="form-select" required>
              <option value="ACTIVE" ${status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
              <option value="INACTIVE" ${status === 'INACTIVE' ? 'selected' : ''}>INACTIVE</option>
            </select>
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i class="fa-solid fa-floppy-disk"></i> Save Master
          </button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

async function handleSaveMaster(event, masterId) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    name: formData.get('name'),
    code: formData.get('code'),
    campus_id: formData.get('campus_id') || null,
    sort_order: parseInt(formData.get('sort_order'), 10) || 0,
    status: formData.get('status')
  };

  try {
    const res = await api(`/masters/${masterId}`, { method: 'PUT', body: payload });
    showToast(res.message || 'Master updated successfully!', 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Handled in api
  }
}

// Recurring Tasks Management
async function renderRecurringTasks(container) {
  const tasks = await api('/tasks');
  const recurringTemplates = tasks.filter(t => t.task_type === 'RECURRING_TEMPLATE');

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
      <h2><i class="fa-solid fa-repeat"></i> Recurring Task Templates</h2>
      <button class="btn btn-primary" onclick="state.taskBuilder = null; navigateTo('task-builder');">
        <i class="fa-solid fa-plus"></i> Create Recurring Template
      </button>
    </div>

    <div class="card">
      <div class="card-body">
        ${recurringTemplates.length === 0 ? `
          <div class="empty-state">
            <i class="fa-solid fa-repeat"></i>
            <h3>No Recurring Templates</h3>
            <p>Set up recurring templates to automate daily, weekly, monthly, or yearly task generation.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Template Title</th>
                  <th>Recurrence Schedule</th>
                  <th>Next Generation</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${recurringTemplates.map(t => `
                  <tr>
                    <td><strong>${escapeHtml(t.title)}</strong></td>
                    <td>Monthly Recurrence (Auto-Audience Recalculation)</td>
                    <td>${t.next_generation_at ? formatDateTime(t.next_generation_at) : 'Calculated on schedule'}</td>
                    <td><span class="badge badge-active">${t.recurrence_status || 'ACTIVE'}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

// Import & Export Centre
async function renderImportExport(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-file-excel"></i> Institutional Data Import & Export Centre</h2>
      </div>
      <div class="card-body">
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">
          
          <!-- Step 1: Download Templates -->
          <div style="background:var(--border-subtle); padding:20px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
            <h3 style="margin-bottom:10px;"><i class="fa-solid fa-download text-primary"></i> 1. Download Blank / Edit Templates</h3>
            <p style="font-size:0.88rem; color:var(--text-muted); margin-bottom:16px;">
              Templates use strictly human-readable headers and names (never raw technical UUIDs or internal IDs).
            </p>
            <div style="display:flex; flex-direction:column; gap:10px;">
              <button class="btn btn-secondary btn-sm" onclick="downloadTemplate('NEW', 'users')">
                <i class="fa-solid fa-file-arrow-down"></i> New Teachers Template (.xlsx)
              </button>
              <button class="btn btn-secondary btn-sm" onclick="downloadTemplate('EDIT', 'users')">
                <i class="fa-solid fa-file-pen"></i> Edit Existing Teachers Template (.xlsx)
              </button>
            </div>
          </div>

          <!-- Step 2: Upload & Parse -->
          <div style="background:var(--border-subtle); padding:20px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
            <h3 style="margin-bottom:10px;"><i class="fa-solid fa-upload text-success"></i> 2. Upload & Validate File</h3>
            <p style="font-size:0.88rem; color:var(--text-muted); margin-bottom:12px;">
              5-Step Lifecycle: Upload ➔ Parse ➔ Validate ➔ Preview Warnings/Errors ➔ Commit.
            </p>
            <div class="form-group" style="margin-bottom:12px;">
              <label style="font-size:0.85rem;"><strong>Default Initial Password for Imported Teachers</strong></label>
              <input type="text" id="import-default-password" class="form-input" value="Welcome@2026" placeholder="Welcome@2026" />
              <span style="font-size:0.75rem; color:var(--text-muted);">Used if a teacher row does not specify a custom password in the Excel file.</span>
            </div>
            <input type="file" id="import-file" accept=".xlsx, .xls, .csv" class="form-input" style="margin-bottom:12px;" />
            <button class="btn btn-primary btn-block" onclick="handleImportPreview()">
              <i class="fa-solid fa-magnifying-glass"></i> Parse & Validate Data
            </button>
          </div>

        </div>

        <!-- Import Preview Container -->
        <div id="import-preview-results" style="margin-top:24px;"></div>
      </div>
    </div>
  `;
}

function downloadTemplate(mode, dataset) {
  window.open(`/api/import/template?mode=${mode}&dataset=${dataset}`, '_blank');
}

async function handleImportPreview() {
  const fileInput = document.getElementById('import-file');
  if (!fileInput.files || fileInput.files.length === 0) {
    return showToast('Please select an Excel or CSV file first', 'warning');
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    const res = await api('/import/preview', { method: 'POST', body: formData });
    const target = document.getElementById('import-preview-results');

    target.innerHTML = `
      <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:20px;">
        <h3>Import Validation Preview</h3>
        <div style="display:flex; gap:16px; margin: 16px 0;">
          <span class="badge badge-in-progress">${res.total_rows} Total Rows</span>
          <span class="badge badge-active">${res.new_rows} Valid Rows</span>
          ${res.errors.length > 0 ? `<span class="badge badge-overdue">${res.errors.length} Blocking Errors</span>` : ''}
        </div>

        ${res.errors.length > 0 ? `
          <div style="background:var(--danger-bg); border-left:4px solid var(--danger); padding:12px; margin-bottom:16px;">
            <strong class="text-danger">Blocking Validation Errors:</strong>
            <ul style="margin: 6px 0 0 20px; font-size:0.88rem;">
              ${res.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}
            </ul>
          </div>
        ` : `
          <div style="background:var(--success-bg); border-left:4px solid var(--success); padding:12px; margin-bottom:16px; font-size:0.88rem; color:var(--success-text);">
            <i class="fa-solid fa-circle-check"></i> File validated successfully with zero blocking errors. Ready to commit.
          </div>
          <button class="btn btn-success" onclick="handleImportCommit()">
            <i class="fa-solid fa-check-double"></i> Confirm & Transactional Commit
          </button>
        `}
      </div>
    `;
  } catch {
    // Ignored
  }
}

async function handleImportCommit() {
  const fileInput = document.getElementById('import-file');
  if (!fileInput.files || fileInput.files.length === 0) {
    return showToast('Please select an Excel or CSV file first', 'warning');
  }
  const defaultPassword = document.getElementById('import-default-password')?.value || 'Welcome@2026';

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('default_password', defaultPassword);

  try {
    const res = await api('/import/commit', { method: 'POST', body: formData });
    showToast(`Import batch committed successfully! Created: ${res.created_count}, Updated: ${res.updated_count}`, 'success');
    loadCurrentView();
  } catch {}
}

// Audit Logs Timeline with Sorting, Full Timestamp, and Multi-Criteria Filters
async function renderAuditLogs(container) {
  const search = state.filters.auditSearch || '';
  const campusFilter = state.filters.auditCampus || '';
  const actionFilter = state.filters.auditAction || '';
  const entityFilter = state.filters.auditEntityType || '';
  const sortBy = state.filters.auditSortBy || 'created_at';
  const sortDir = state.filters.auditSortDir || 'desc';

  const queryParams = new URLSearchParams();
  if (search) queryParams.set('search', search);
  if (campusFilter) queryParams.set('campus_id', campusFilter);
  if (actionFilter) queryParams.set('action', actionFilter);
  if (entityFilter) queryParams.set('entity_type', entityFilter);
  queryParams.set('sort_by', sortBy);
  queryParams.set('sort_dir', sortDir);

  const [logs, campuses] = await Promise.all([
    api(`/audit-logs?${queryParams.toString()}`),
    api('/campuses')
  ]);

  function renderAuditSortHeader(key, label) {
    const isSorted = sortBy === key;
    const icon = isSorted ? (sortDir === 'asc' ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short') : 'fa-sort';
    const newDir = isSorted && sortDir === 'asc' ? 'desc' : 'asc';
    return `
      <th style="cursor:pointer; user-select:none;" onclick="state.filters.auditSortBy = '${key}'; state.filters.auditSortDir = '${newDir}'; loadCurrentView();">
        <div style="display:flex; align-items:center; gap:6px;">
          <span>${escapeHtml(label)}</span>
          <i class="fa-solid ${icon}" style="font-size:0.75rem; color:${isSorted ? 'var(--primary)' : 'var(--text-subtle)'};"></i>
        </div>
      </th>
    `;
  }

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
      <div>
        <h2><i class="fa-solid fa-shield-halved"></i> Institutional Audit Trail</h2>
        <span style="font-size:0.85rem; color:var(--text-muted);">Immutable server-side audit logs of administrative mutations (${logs.length} entries)</span>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="loadCurrentView()">
        <i class="fa-solid fa-rotate"></i> Refresh Logs
      </button>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar" style="margin-bottom:16px;">
      <div class="search-input-wrapper" style="flex:1; min-width:200px;">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" class="form-input" placeholder="Search description, user, action..." value="${escapeHtml(search)}" oninput="state.filters.auditSearch = this.value; loadCurrentView();" />
      </div>

      <div style="display:flex; align-items:center; gap:8px;">
        <select class="form-select" onchange="state.filters.auditCampus = this.value; loadCurrentView();">
          <option value="">All Campuses</option>
          ${campuses.map(c => `<option value="${c.id}" ${c.id === campusFilter ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex; align-items:center; gap:8px;">
        <select class="form-select" onchange="state.filters.auditAction = this.value; loadCurrentView();">
          <option value="">All Actions</option>
          <option value="TASK_CREATED" ${actionFilter === 'TASK_CREATED' ? 'selected' : ''}>TASK_CREATED</option>
          <option value="TASK_PUBLISHED" ${actionFilter === 'TASK_PUBLISHED' ? 'selected' : ''}>TASK_PUBLISHED</option>
          <option value="TASK_STATUS_CHANGED" ${actionFilter === 'TASK_STATUS_CHANGED' ? 'selected' : ''}>TASK_STATUS_CHANGED</option>
          <option value="ROLE_CREATED" ${actionFilter === 'ROLE_CREATED' ? 'selected' : ''}>ROLE_CREATED</option>
          <option value="ROLE_UPDATED" ${actionFilter === 'ROLE_UPDATED' ? 'selected' : ''}>ROLE_UPDATED</option>
          <option value="USER_CREATED" ${actionFilter === 'USER_CREATED' ? 'selected' : ''}>USER_CREATED</option>
          <option value="USER_UPDATED" ${actionFilter === 'USER_UPDATED' ? 'selected' : ''}>USER_UPDATED</option>
          <option value="USER_ACCESS_UPDATED" ${actionFilter === 'USER_ACCESS_UPDATED' ? 'selected' : ''}>USER_ACCESS_UPDATED</option>
          <option value="MASTER_VALUE_CREATED" ${actionFilter === 'MASTER_VALUE_CREATED' ? 'selected' : ''}>MASTER_VALUE_CREATED</option>
          <option value="MASTER_VALUE_UPDATED" ${actionFilter === 'MASTER_VALUE_UPDATED' ? 'selected' : ''}>MASTER_VALUE_UPDATED</option>
          <option value="GROUP_CREATED" ${actionFilter === 'GROUP_CREATED' ? 'selected' : ''}>GROUP_CREATED</option>
          <option value="GROUP_UPDATED" ${actionFilter === 'GROUP_UPDATED' ? 'selected' : ''}>GROUP_UPDATED</option>
          <option value="GROUP_MEMBERSHIP_APPROVED" ${actionFilter === 'GROUP_MEMBERSHIP_APPROVED' ? 'selected' : ''}>GROUP_MEMBERSHIP_APPROVED</option>
          <option value="BULK_IMPORT_COMMITTED" ${actionFilter === 'BULK_IMPORT_COMMITTED' ? 'selected' : ''}>BULK_IMPORT_COMMITTED</option>
        </select>
      </div>

      <div style="display:flex; align-items:center; gap:8px;">
        <select class="form-select" onchange="state.filters.auditEntityType = this.value; loadCurrentView();">
          <option value="">All Entities</option>
          <option value="TASK" ${entityFilter === 'TASK' ? 'selected' : ''}>TASK</option>
          <option value="USER" ${entityFilter === 'USER' ? 'selected' : ''}>USER</option>
          <option value="ROLE" ${entityFilter === 'ROLE' ? 'selected' : ''}>ROLE</option>
          <option value="GROUP" ${entityFilter === 'GROUP' ? 'selected' : ''}>GROUP</option>
          <option value="MASTER_VALUE" ${entityFilter === 'MASTER_VALUE' ? 'selected' : ''}>MASTER_VALUE</option>
          <option value="CAMPUS" ${entityFilter === 'CAMPUS' ? 'selected' : ''}>CAMPUS</option>
          <option value="IMPORT" ${entityFilter === 'IMPORT' ? 'selected' : ''}>IMPORT</option>
        </select>
      </div>

      ${(search || campusFilter || actionFilter || entityFilter) ? `
        <button class="btn btn-secondary btn-sm" onclick="state.filters.auditSearch = ''; state.filters.auditCampus = ''; state.filters.auditAction = ''; state.filters.auditEntityType = ''; loadCurrentView();">
          <i class="fa-solid fa-xmark"></i> Clear Filters
        </button>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                ${renderAuditSortHeader('created_at', 'Date & Time')}
                ${renderAuditSortHeader('user_display_name', 'Actor / User')}
                ${renderAuditSortHeader('campus_name', 'Campus Scope')}
                ${renderAuditSortHeader('action', 'Action')}
                ${renderAuditSortHeader('entity_type', 'Entity')}
                <th>Description</th>
                <th style="text-align:right;">Payload</th>
              </tr>
            </thead>
            <tbody>
              ${logs.length === 0 ? `
                <tr><td colspan="7" class="empty-state">No audit log records match your active filters.</td></tr>
              ` : logs.map(l => `
                <tr>
                  <td style="white-space:nowrap; font-size:0.85rem;">
                    <strong>${formatFullDateTime(l.created_at)}</strong>
                  </td>
                  <td>
                    <strong>${escapeHtml(l.user_display_name || 'System')}</strong>
                    ${l.user_email ? `<div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(l.user_email)}</div>` : ''}
                  </td>
                  <td>${escapeHtml(l.campus_name || 'Global')}</td>
                  <td><code style="font-weight:600;">${escapeHtml(l.action)}</code></td>
                  <td><span class="badge badge-not-started">${escapeHtml(l.entity_type || 'N/A')}</span></td>
                  <td>${escapeHtml(l.description)}</td>
                  <td style="text-align:right;">
                    ${l.metadata && Object.keys(typeof l.metadata === 'string' ? JSON.parse(l.metadata || '{}') : l.metadata).length > 0 ? `
                      <button class="btn btn-outline btn-sm" onclick='viewAuditMetadata(${JSON.stringify(typeof l.metadata === 'string' ? JSON.parse(l.metadata) : l.metadata)})' title="View JSON Metadata">
                        <i class="fa-solid fa-code"></i> JSON
                      </button>
                    ` : '<span class="text-muted" style="font-size:0.75rem;">-</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function formatFullDateTime(d) {
  if (!d) return 'N/A';
  const dateObj = new Date(d);
  return dateObj.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function viewAuditMetadata(meta) {
  const html = `
    <div class="card-header">
      <h3>Audit Event Metadata</h3>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <pre style="background:var(--border-subtle); padding:16px; border-radius:6px; font-size:0.85rem; overflow-x:auto; max-height:400px;">${escapeHtml(JSON.stringify(meta, null, 2))}</pre>
      <div style="display:flex; justify-content:flex-end; margin-top:16px;">
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
      </div>
    </div>
  `;
  openModal(html);
}

// Roles & Permissions Matrix Management
const SYSTEM_PERMISSION_GROUPS = [
  {
    module: 'Dashboard',
    icon: 'fa-gauge-high',
    permissions: [
      { key: 'dashboard.view_admin', label: 'View Administrator Overview Dashboard' }
    ]
  },
  {
    module: 'Task Management',
    icon: 'fa-list-check',
    permissions: [
      { key: 'tasks.view', label: 'View Tasks' },
      { key: 'tasks.create', label: 'Create New Tasks' },
      { key: 'tasks.edit', label: 'Edit Existing Tasks' },
      { key: 'tasks.delete_draft', label: 'Delete Draft Tasks' },
      { key: 'tasks.publish', label: 'Publish Tasks to Audience' },
      { key: 'tasks.assign', label: 'Assign Teachers & Groups' },
      { key: 'tasks.archive', label: 'Archive Completed Tasks' },
      { key: 'tasks.send_reminder', label: 'Send Manual Task Reminders' },
      { key: 'tasks.export', label: 'Export Task Data' }
    ]
  },
  {
    module: 'Recurring Tasks',
    icon: 'fa-repeat',
    permissions: [
      { key: 'recurring_tasks.view', label: 'View Recurring Task Templates' },
      { key: 'recurring_tasks.create', label: 'Create Recurring Templates' },
      { key: 'recurring_tasks.edit', label: 'Edit Recurring Templates' },
      { key: 'recurring_tasks.pause', label: 'Pause/Resume Templates' },
      { key: 'recurring_tasks.publish', label: 'Publish Recurring Schedules' }
    ]
  },
  {
    module: 'Institutional Reports',
    icon: 'fa-chart-pie',
    permissions: [
      { key: 'reports.task_wise.view', label: 'View Task-Wise Report' },
      { key: 'reports.task_wise.export', label: 'Export Task-Wise Report' },
      { key: 'reports.teacher_wise.view', label: 'View Teacher-Wise Performance' },
      { key: 'reports.teacher_wise.export', label: 'Export Teacher-Wise Performance' },
      { key: 'reports.detailed.view', label: 'View Detailed Responses Report' },
      { key: 'reports.detailed.export', label: 'Export Detailed Responses Report' }
    ]
  },
  {
    module: 'Campus Groups',
    icon: 'fa-users-rectangle',
    permissions: [
      { key: 'groups.view', label: 'View Campus Groups' },
      { key: 'groups.create', label: 'Create Groups' },
      { key: 'groups.edit', label: 'Edit Group Details' },
      { key: 'groups.manage_members', label: 'Manage Group Members' },
      { key: 'groups.approve_requests', label: 'Review & Approve Joining Requests' },
      { key: 'groups.delete_or_deactivate', label: 'Deactivate / Archive Groups' }
    ]
  },
  {
    module: 'Faculty & Staff Directory',
    icon: 'fa-chalkboard-user',
    permissions: [
      { key: 'users.view', label: 'View Faculty Directory' },
      { key: 'users.create', label: 'Add New Faculty Member' },
      { key: 'users.edit', label: 'Edit Faculty Profiles & Attributes' },
      { key: 'users.deactivate', label: 'Deactivate / Suspend Users' },
      { key: 'users.import', label: 'Import Faculty Excel/CSV' },
      { key: 'users.export', label: 'Export Faculty Data' }
    ]
  },
  {
    module: 'Master Data Management',
    icon: 'fa-layer-group',
    permissions: [
      { key: 'masters.view', label: 'View Master Data' },
      { key: 'masters.create', label: 'Create Master Values' },
      { key: 'masters.edit', label: 'Edit Master Values' },
      { key: 'masters.deactivate', label: 'Deactivate Master Values' },
      { key: 'masters.import', label: 'Import Master Data' },
      { key: 'masters.export', label: 'Export Master Data' }
    ]
  },
  {
    module: 'Institutional Audit Trail',
    icon: 'fa-shield-halved',
    permissions: [
      { key: 'audit.view', label: 'View Audit Logs' },
      { key: 'audit.export', label: 'Export Audit Logs' }
    ]
  },
  {
    module: 'Imports & Exports',
    icon: 'fa-file-excel',
    permissions: [
      { key: 'imports.execute', label: 'Execute Data Imports' },
      { key: 'exports.execute', label: 'Execute Data Exports' }
    ]
  },
  {
    module: 'System Roles & Access Control',
    icon: 'fa-key',
    permissions: [
      { key: 'roles.view', label: 'View Roles & Permissions' },
      { key: 'roles.manage', label: 'Create & Edit Custom Roles' },
      { key: 'user_access.manage', label: 'Assign Roles & Campus Scope' }
    ]
  }
];

async function renderRolesManagement(container) {
  const roles = await api('/roles');
  const canManageRoles = state.user.isSuperAdmin || state.user.user_type === 'SUPER_ADMIN';

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
      <h2><i class="fa-solid fa-key"></i> System Roles & Permission Matrix</h2>
      ${canManageRoles ? `
        <button class="btn btn-primary" onclick="openRoleModal()">
          <i class="fa-solid fa-plus"></i> Create Custom Role
        </button>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Role Name</th>
                <th>Description</th>
                <th>Type</th>
                <th>Active Permissions</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${roles.map(r => {
                const count = Object.keys(r.permissions || {}).filter(k => r.permissions[k]).length;
                return `
                  <tr>
                    <td><strong>${escapeHtml(r.name)}</strong></td>
                    <td>${escapeHtml(r.description || 'N/A')}</td>
                    <td>${r.is_system_role ? '<span class="badge badge-active">System Role</span>' : '<span class="badge badge-not-started">Custom Role</span>'}</td>
                    <td><span class="badge badge-in-progress">${count} Permission Keys</span></td>
                    <td><span class="badge badge-${(r.status || 'ACTIVE').toLowerCase()}">${r.status || 'ACTIVE'}</span></td>
                    <td>
                      ${canManageRoles ? `
                        <button class="btn btn-outline btn-sm" onclick="openRoleModal('${r.id}')" title="Edit Role & Permissions">
                          <i class="fa-solid fa-pen-to-square"></i> Edit Permissions
                        </button>
                      ` : ''}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function openRoleModal(roleId = null) {
  let role = {
    name: '',
    description: '',
    status: 'ACTIVE',
    permissions: {},
    is_system_role: false
  };

  if (roleId) {
    const roles = await api('/roles');
    const found = roles.find(r => r.id === roleId);
    if (found) role = found;
  }

  const rolePerms = typeof role.permissions === 'string' ? JSON.parse(role.permissions || '{}') : (role.permissions || {});

  const html = `
    <div class="card-header">
      <div>
        <h3>${roleId ? 'Edit Role: ' + escapeHtml(role.name) : 'Create New Custom Role'}</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">
          Configure granular permission switches for modules and administrative operations.
        </span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-role" onsubmit="handleSaveRole(event, ${roleId ? `'${roleId}'` : 'null'})">
        
        <div style="display:grid; grid-template-columns: 2fr 1fr; gap:12px; margin-bottom:16px;">
          <div class="form-group">
            <label>Role Name <span class="text-danger">*</span></label>
            <input type="text" name="name" class="form-input" value="${escapeHtml(role.name)}" required placeholder="e.g. Department Head" />
          </div>
          <div class="form-group">
            <label>Role Status <span class="text-danger">*</span></label>
            <select name="status" class="form-select" required>
              <option value="ACTIVE" ${role.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
              <option value="INACTIVE" ${role.status === 'INACTIVE' ? 'selected' : ''}>INACTIVE</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-bottom:20px;">
          <label>Role Description</label>
          <input type="text" name="description" class="form-input" value="${escapeHtml(role.description || '')}" placeholder="Brief description of responsibilities..." />
        </div>

        <!-- Permissions Matrix Grouped by Module -->
        <h4 style="margin-bottom:12px; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
          <i class="fa-solid fa-shield-halved text-primary"></i> Module Permission Keys
        </h4>

        <div style="display:grid; grid-template-columns: 1fr; gap:16px; max-height:420px; overflow-y:auto; padding-right:6px;">
          ${SYSTEM_PERMISSION_GROUPS.map((group, gIdx) => `
            <div style="background:var(--border-subtle); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:12px 16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <strong><i class="fa-solid ${group.icon} text-primary"></i> ${group.module}</strong>
                <div style="display:flex; gap:8px;">
                  <button type="button" class="btn btn-secondary btn-sm" style="font-size:0.75rem; padding:2px 8px;" onclick="toggleRoleModulePermissions('group-${gIdx}', true)">All</button>
                  <button type="button" class="btn btn-secondary btn-sm" style="font-size:0.75rem; padding:2px 8px;" onclick="toggleRoleModulePermissions('group-${gIdx}', false)">None</button>
                </div>
              </div>
              <div id="group-${gIdx}" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:8px;">
                ${group.permissions.map(p => `
                  <label class="checkbox-label" style="font-size:0.85rem;">
                    <input type="checkbox" name="perm_${p.key}" class="role-perm-checkbox" ${rolePerms[p.key] ? 'checked' : ''} />
                    <span>${escapeHtml(p.label)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i class="fa-solid fa-floppy-disk"></i> ${roleId ? 'Update Role & Permissions' : 'Create Custom Role'}
          </button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

function toggleRoleModulePermissions(groupId, checked) {
  const container = document.getElementById(groupId);
  if (container) {
    const checkboxes = container.querySelectorAll('.role-perm-checkbox');
    checkboxes.forEach(cb => cb.checked = checked);
  }
}

async function handleSaveRole(event, roleId) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const name = formData.get('name');
  const description = formData.get('description');
  const status = formData.get('status');

  const permissions = {};
  for (const group of SYSTEM_PERMISSION_GROUPS) {
    for (const p of group.permissions) {
      if (formData.get(`perm_${p.key}`) === 'on') {
        permissions[p.key] = true;
      }
    }
  }

  const payload = {
    name,
    description,
    status,
    permissions
  };

  try {
    if (roleId) {
      const res = await api(`/roles/${roleId}`, { method: 'PUT', body: payload });
      showToast(res.message || 'Role updated successfully!', 'success');
    } else {
      const res = await api('/roles', { method: 'POST', body: payload });
      showToast('Role created successfully!', 'success');
    }
    closeModal();
    loadCurrentView();
  } catch {
    // Handled in api
  }
}

// ============================================================================
// 10. GLOBAL EVENT LISTENERS & UTILITIES
// ============================================================================

function setupGlobalEvents() {
  // Login Submit
  elements.formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = elements.loginEmail.value.trim();
    const password = elements.loginPassword.value;

    elements.btnLogin.disabled = true;
    elements.btnLogin.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Signing In...`;

    try {
      const res = await api('/auth/login', { method: 'POST', body: { email, password } });
      state.user = res.user;
      showToast(`Welcome back, ${res.user.display_name}!`, 'success');
      renderAuthenticatedApp();
    } catch {
      // Handled in api
    } finally {
      elements.btnLogin.disabled = false;
      elements.btnLogin.innerHTML = `<span>Sign In</span> <i class="fa-solid fa-arrow-right"></i>`;
    }
  });

  // Logout Click
  elements.btnLogout.addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      renderLoginView();
    }
  });

  // Refresh Screen Button
  elements.btnRefresh.addEventListener('click', () => loadCurrentView());

  // Mobile Sidebar Toggle
  elements.btnToggleSidebar.addEventListener('click', () => {
    elements.sidebar.classList.add('open');
    elements.sidebarOverlay.classList.add('open');
  });

  elements.btnCloseSidebar.addEventListener('click', closeMobileSidebar);
  elements.sidebarOverlay.addEventListener('click', closeMobileSidebar);

  // Theme Toggle
  elements.themeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('theme-dark');
    elements.themeToggle.innerHTML = isDark ? `<i class="fa-solid fa-sun"></i>` : `<i class="fa-solid fa-moon"></i>`;
  });
}

function closeMobileSidebar() {
  elements.sidebar.classList.remove('open');
  elements.sidebarOverlay.classList.remove('open');
}

function formatDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatStatus(status) {
  switch (status) {
    case 'SUBMITTED_ON_TIME': return 'Submitted On Time';
    case 'SUBMITTED_LATE': return 'Submitted Late';
    case 'IN_PROGRESS': return 'In Progress (Draft)';
    case 'OVERDUE': return 'Overdue';
    case 'NOT_STARTED': return 'Not Started';
    case 'ACTIVE': return 'Active';
    case 'PUBLISHED': return 'Published';
    case 'DRAFT': return 'Draft';
    default: return status;
  }
}
