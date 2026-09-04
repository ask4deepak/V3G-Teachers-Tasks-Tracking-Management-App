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

  const isTeacher = state.user.user_type === 'TEACHER';

  if (isTeacher) {
    // TEACHER NAVIGATION
    addNavItem(nav, 'teacher-dashboard', 'fa-gauge-high', 'Dashboard');
    addNavItem(nav, 'teacher-tasks', 'fa-list-check', 'My Tasks');
    addNavItem(nav, 'teacher-history', 'fa-clock-rotate-left', 'Task History');
    addNavItem(nav, 'teacher-performance', 'fa-chart-line', 'My Performance');
    addNavItem(nav, 'teacher-groups', 'fa-users-rectangle', 'Groups');
    addNavItem(nav, 'my-profile', 'fa-id-badge', 'My Profile');
  } else {
    // ADMIN NAVIGATION (Subject to granular permissions)
    addNavItem(nav, 'admin-dashboard', 'fa-gauge-high', 'Dashboard');

    if (hasPermission('tasks.view')) {
      addNavItem(nav, 'tasks', 'fa-list-check', 'Tasks');
    }
    if (hasPermission('recurring_tasks.view')) {
      addNavItem(nav, 'recurring-tasks', 'fa-repeat', 'Recurring Tasks');
    }
    if (hasPermission('reports.task_wise.view') || hasPermission('reports.teacher_wise.view')) {
      addNavItem(nav, 'reports-task-wise', 'fa-chart-pie', 'Reports');
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
  }
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
                ${tasks.map(t => `
                  <tr>
                    <td>
                      <strong>${escapeHtml(t.title)}</strong>
                      ${t.description ? `<p style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">${escapeHtml(t.description)}</p>` : ''}
                    </td>
                    <td>${formatDate(t.assigned_at)}</td>
                    <td><strong>${formatDateTime(t.due_at)}</strong></td>
                    <td><span class="badge badge-${t.status.toLowerCase().replace(/_/g, '-')}">${formatStatus(t.status)}</span></td>
                    <td>
                      <button class="btn ${t.submitted_at ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="openTaskSubmissionModal('${t.task_id}')">
                        <i class="fa-solid ${t.submitted_at ? 'fa-eye' : 'fa-pen-to-square'}"></i> ${t.submitted_at ? 'View Submission' : (t.draft_flag ? 'Resume Draft' : 'Complete Task')}
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

  const html = `
    <div class="card-header">
      <div>
        <h3>${escapeHtml(task.title)}</h3>
        <span style="font-size:0.8rem; color:var(--text-muted);">Due: ${formatDateTime(assignment.due_at)}</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      ${task.description ? `<p style="margin-bottom: 20px; color:var(--text-muted);">${escapeHtml(task.description)}</p>` : ''}
      
      <form id="form-task-submission">
        ${questions.map((q, idx) => `
          <div class="form-group question-block">
            <label>
              <strong>${idx + 1}. ${escapeHtml(q.label)}</strong>
              ${q.required ? `<span class="text-danger">*</span>` : ''}
            </label>
            ${renderQuestionInput(q, answers[q.key], isSubmitted)}
          </div>
        `).join('')}

        ${!isSubmitted ? `
          <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
            <button type="button" class="btn btn-secondary" onclick="submitTaskResponse('${taskId}', true)">
              <i class="fa-regular fa-floppy-disk"></i> Save Draft
            </button>
            <button type="button" class="btn btn-primary" onclick="submitTaskResponse('${taskId}', false)">
              <i class="fa-solid fa-paper-plane"></i> Submit Final Response
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
        <button class="btn btn-primary" onclick="navigateTo('task-builder')">
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
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Assigned</th>
                <th>Deadline</th>
                <th>Completion Rate</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.map(t => `
                <tr>
                  <td><strong>${escapeHtml(t.title)}</strong></td>
                  <td><span class="badge badge-not-started">${t.task_type}</span></td>
                  <td><span class="badge badge-${t.status.toLowerCase()}">${t.status}</span></td>
                  <td>${t.total_assigned || 0}</td>
                  <td>${formatDateTime(t.deadline_at)}</td>
                  <td><strong>${t.completion_rate || 0}%</strong></td>
                  <td>
                    <div style="display:flex; gap:6px;">
                      ${t.status === 'DRAFT' && hasPermission('tasks.publish') ? `
                        <button class="btn btn-success btn-sm" onclick="publishTaskDirectly('${t.id}')">
                          <i class="fa-solid fa-upload"></i> Publish
                        </button>
                      ` : ''}
                      <button class="btn btn-secondary btn-sm" onclick="openTaskReport('${t.id}')">
                        <i class="fa-solid fa-chart-pie"></i> Report
                      </button>
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
      deadline_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
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
    <!-- Stepper Indicator -->
    <div class="stepper-header">
      ${[
        { num: 1, label: 'Details' },
        { num: 2, label: 'Form Builder' },
        { num: 3, label: 'Campuses' },
        { num: 4, label: 'Audience Rules' },
        { num: 5, label: 'Recipient Preview' },
        { num: 6, label: 'Review' },
        { num: 7, label: 'Publish' }
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
        <p style="color:var(--text-muted); margin-bottom: 20px;">Provide the title, scope, and deadline for the task.</p>
        <div class="form-group">
          <label>Task Title <span class="text-danger">*</span></label>
          <input type="text" id="tb-title" class="form-input" value="${escapeHtml(tb.title)}" placeholder="e.g. Term 1 Syllabus Verification" />
        </div>
        <div class="form-group">
          <label>Description & Teacher Instructions</label>
          <textarea id="tb-desc" class="form-textarea" placeholder="Provide context and instructions for teachers...">${escapeHtml(tb.description)}</textarea>
        </div>
        <div class="form-group">
          <label>Task Type</label>
          <select id="tb-type" class="form-select">
            <option value="ONE_TIME" ${tb.task_type === 'ONE_TIME' ? 'selected' : ''}>One-Time Task</option>
            <option value="RECURRING_TEMPLATE" ${tb.task_type === 'RECURRING_TEMPLATE' ? 'selected' : ''}>Recurring Template</option>
          </select>
        </div>
        <div class="form-group">
          <label>Submission Deadline <span class="text-danger">*</span></label>
          <input type="datetime-local" id="tb-deadline" class="form-input" value="${tb.deadline_at}" />
        </div>
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
      return `
        <h3>Step 6: Review Task Configuration</h3>
        <div style="background:var(--border-subtle); padding: 16px; border-radius:var(--radius-md); margin: 20px 0; display:flex; flex-direction:column; gap:10px;">
          <div><strong>Title:</strong> ${escapeHtml(tb.title)}</div>
          <div><strong>Type:</strong> ${tb.task_type}</div>
          <div><strong>Deadline:</strong> ${formatDateTime(tb.deadline_at)}</div>
          <div><strong>Questions:</strong> ${tb.questions.length} Fields Configured</div>
          <div><strong>Campuses:</strong> ${tb.campus_ids.length} Campuses Selected</div>
          <div><strong>Final Recipient Count:</strong> <strong class="text-primary">${activeCount} Teachers</strong></div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:24px;">
          <button class="btn btn-secondary" onclick="state.taskBuilder.step = 5; loadCurrentView();"><i class="fa-solid fa-arrow-left"></i> Back</button>
          <button class="btn btn-primary" onclick="state.taskBuilder.step = 7; loadCurrentView();">Proceed to Publish <i class="fa-solid fa-arrow-right"></i></button>
        </div>
      `;

    case 7:
      return `
        <div style="text-align:center; padding: 24px 0;">
          <div class="brand-badge" style="background:linear-gradient(135deg, var(--success), #059669);"><i class="fa-solid fa-rocket"></i></div>
          <h3>Ready to Publish Task</h3>
          <p style="color:var(--text-muted); max-width: 500px; margin: 12px auto 24px;">
            Publishing will recalculate eligible recipients on the server, freeze immutable assignments, and dispatch assignment notification emails to teachers.
          </p>

          <div style="display:flex; justify-content:center; gap: 16px;">
            <button class="btn btn-outline" onclick="saveTaskDraft()">
              <i class="fa-regular fa-floppy-disk"></i> Save as Draft Only
            </button>
            <button class="btn btn-success" onclick="commitPublishTask()">
              <i class="fa-solid fa-upload"></i> Confirm & Publish Now
            </button>
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
    tb.deadline_at = document.getElementById('tb-deadline').value;
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
        deadline_at: tb.deadline_at,
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
        deadline_at: tb.deadline_at,
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

// ============================================================================
// 8. REPORTS & REMINDERS
// ============================================================================

async function renderTaskWiseReport(container) {
  const tasks = await api('/tasks');
  const selectedTaskId = state.filters.reportTaskId || (tasks[0] ? tasks[0].id : null);

  if (!selectedTaskId) {
    container.innerHTML = `<div class="empty-state"><h3>No tasks available for reporting</h3></div>`;
    return;
  }

  const report = await api(`/reports/task-wise?task_id=${selectedTaskId}`);
  const { task, stats, rows } = report;

  container.innerHTML = `
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
  const teachers = await api('/users?user_type=TEACHER');
  const selectedTeacherId = state.filters.teacherId || (teachers[0] ? teachers[0].id : null);

  if (!selectedTeacherId) {
    container.innerHTML = `<div class="empty-state"><h3>No teachers found</h3></div>`;
    return;
  }

  const data = await api(`/reports/teacher-wise?teacher_id=${selectedTeacherId}`);
  const { teacher, stats, assignments } = data;

  container.innerHTML = `
    <div class="filter-bar">
      <div style="display:flex; align-items:center; gap:8px;">
        <label><strong>Select Teacher:</strong></label>
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

// Detailed Response Report
async function renderDetailedResponseReport(container) {
  const tasks = await api('/tasks');
  const selectedTaskId = state.filters.detailedTaskId || (tasks[0] ? tasks[0].id : null);

  if (!selectedTaskId) {
    container.innerHTML = `<div class="empty-state"><h3>No tasks available</h3></div>`;
    return;
  }

  const report = await api(`/reports/task-wise?task_id=${selectedTaskId}`);
  const { task, rows } = report;
  const questions = typeof task.questions === 'string' ? JSON.parse(task.questions) : task.questions;

  container.innerHTML = `
    <div class="filter-bar">
      <div style="display:flex; align-items:center; gap:8px;">
        <label><strong>Task:</strong></label>
        <select class="form-select" onchange="state.filters.detailedTaskId = this.value; loadCurrentView();">
          ${tasks.map(t => `<option value="${t.id}" ${t.id === selectedTaskId ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}
        </select>
      </div>

      <div style="margin-left:auto;">
        <button class="btn btn-secondary btn-sm" onclick="exportTaskResponses('${task.id}')">
          <i class="fa-solid fa-file-excel"></i> Export Detailed Excel
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-table-columns"></i> Joined Response Grid (${rows.length} Records)</h2>
      </div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Campus</th>
                <th>Status</th>
                ${questions.map(q => `<th>${escapeHtml(q.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td><strong>${escapeHtml(r.display_name)}</strong></td>
                  <td>${escapeHtml(r.campus_name)}</td>
                  <td><span class="badge badge-${r.status.toLowerCase().replace(/_/g, '-')}">${formatStatus(r.status)}</span></td>
                  ${questions.map(q => `<td>${escapeHtml(r.answers[q.key] !== undefined ? String(r.answers[q.key]) : '-')}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// 9. FACULTY, GROUPS, MASTERS & RECURRING TASKS
// ============================================================================

async function renderUsersDirectory(container) {
  const [users, campuses] = await Promise.all([
    api('/users?user_type=TEACHER'),
    api('/campuses')
  ]);

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
      <h2><i class="fa-solid fa-chalkboard-user"></i> Faculty Directory</h2>
      ${hasPermission('users.create') ? `
        <button class="btn btn-primary" onclick="openCreateUserModal()">
          <i class="fa-solid fa-user-plus"></i> Add Teacher
        </button>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Employee Code</th>
                <th>Campus</th>
                <th>Class Teacher</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td><strong>${escapeHtml(u.display_name)}</strong></td>
                  <td>${escapeHtml(u.email)}</td>
                  <td>${escapeHtml(u.employee_code || 'N/A')}</td>
                  <td>${escapeHtml(u.campus_name)}</td>
                  <td>${u.class_teacher_status ? '<span class="badge badge-active">Yes</span>' : '<span class="badge badge-not-started">No</span>'}</td>
                  <td><span class="badge badge-${u.status.toLowerCase()}">${u.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
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
                  <td><span class="badge badge-active">${g.status}</span></td>
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
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${masters.map(m => `
                <tr>
                  <td><strong>${escapeHtml(m.name)}</strong></td>
                  <td><code>${escapeHtml(m.code || 'N/A')}</code></td>
                  <td>${m.campus_name ? escapeHtml(m.campus_name) : '<span class="badge badge-in-progress">Global (All Campuses)</span>'}</td>
                  <td><span class="badge badge-active">${m.status}</span></td>
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
            <p style="font-size:0.88rem; color:var(--text-muted); margin-bottom:16px;">
              5-Step Lifecycle: Upload ➔ Parse ➔ Validate ➔ Preview Warnings/Errors ➔ Commit.
            </p>
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
          <button class="btn btn-success" onclick="showToast('Import batch committed successfully!', 'success'); loadCurrentView();">
            <i class="fa-solid fa-check-double"></i> Confirm & Transactional Commit
          </button>
        `}
      </div>
    `;
  } catch {
    // Ignored
  }
}

// Audit Logs Timeline
async function renderAuditLogs(container) {
  const logs = await api('/audit-logs');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-shield-halved"></i> Institutional Audit Trail</h2>
      </div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>User</th>
                <th>Campus</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map(l => `
                <tr>
                  <td>${formatDateTime(l.created_at)}</td>
                  <td><strong>${escapeHtml(l.user_display_name)}</strong></td>
                  <td>${escapeHtml(l.campus_name)}</td>
                  <td><code>${escapeHtml(l.action)}</code></td>
                  <td><span class="badge badge-not-started">${escapeHtml(l.entity_type)}</span></td>
                  <td>${escapeHtml(l.description)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// Roles & Permissions Matrix
async function renderRolesManagement(container) {
  const roles = await api('/roles');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2><i class="fa-solid fa-key"></i> System Roles & Permission Matrix</h2>
      </div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Role Name</th>
                <th>Description</th>
                <th>Type</th>
                <th>Permissions Count</th>
              </tr>
            </thead>
            <tbody>
              ${roles.map(r => {
                const count = Object.keys(r.permissions || {}).length;
                return `
                  <tr>
                    <td><strong>${escapeHtml(r.name)}</strong></td>
                    <td>${escapeHtml(r.description || 'N/A')}</td>
                    <td>${r.is_system_role ? '<span class="badge badge-active">System Role</span>' : '<span class="badge badge-not-started">Custom</span>'}</td>
                    <td><span class="badge badge-in-progress">${count} Permission Keys</span></td>
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
