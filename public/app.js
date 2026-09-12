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
  const container = elements.modalContainer || document.getElementById('modal-container');
  const content = elements.modalContent || document.getElementById('modal-content');
  if (content && container) {
    content.innerHTML = htmlContent;
    container.classList.remove('hidden');
    container.style.display = 'flex';
  }
}

function closeModal() {
  const container = elements.modalContainer || document.getElementById('modal-container');
  const content = elements.modalContent || document.getElementById('modal-content');
  if (container) {
    container.classList.add('hidden');
    container.style.display = 'none';
  }
  if (content) {
    content.innerHTML = '';
  }
}

window.openModal = openModal;
window.closeModal = closeModal;

function getLocalDateTimeLocalString(d = new Date(), offsetHours = 0) {
  const baseTime = (d instanceof Date) ? d.getTime() : new Date(d).getTime();
  const targetDate = new Date(baseTime + offsetHours * 60 * 60 * 1000);
  
  // Format in Asia/Kolkata timezone (or configured timezone)
  const tz = (state.settings && state.settings.timezone) || 'Asia/Kolkata';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(targetDate);
  const getPart = (type) => parts.find(p => p.type === type)?.value || '00';
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}`;
}
window.getLocalDateTimeLocalString = getLocalDateTimeLocalString;

async function loadSystemSettings() {
  try {
    const s = await api('/settings');
    state.settings = s;
  } catch {
    state.settings = {
      app_name: 'TaskTrack Pro',
      timezone: 'Asia/Kolkata',
      default_deadline_offset_hours: 24,
      session_expiry_hours: 24
    };
  }
}

// ============================================================================
// 3. AUTHENTICATION & SESSION MANAGEMENT
// ============================================================================

async function checkAuthSession() {
  await loadSystemSettings();
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

  // Set Operational Date in Topbar (Asia/Kolkata)
  const topbarDate = document.getElementById('topbar-current-date');
  if (topbarDate) {
    const today = new Date();
    topbarDate.textContent = today.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // Setup Clean Active Campus Dropdown Widget
  setupActiveCampusWidget();

  buildSidebarNav();
  navigateTo(state.user.user_type === 'TEACHER' ? 'teacher-dashboard' : 'admin-dashboard');
  fetchPendingGroupRequestsCount();
}

function setupActiveCampusWidget() {
  const triggerBtn = document.getElementById('btn-campus-dropdown');
  const dropdownMenu = document.getElementById('campus-dropdown-menu');
  const userCampuses = state.user ? (state.user.campuses || []) : [];

  if (!state.selectedCampusId) {
    state.selectedCampusId = 'ALL';
  }

  updateCampusWidgetLabel();

  if (!triggerBtn || !dropdownMenu) return;

  if (userCampuses.length <= 1 && state.user.user_type !== 'SUPER_ADMIN' && !state.user.isSuperAdmin) {
    triggerBtn.style.cursor = 'default';
    const chevron = triggerBtn.querySelector('.campus-chevron');
    if (chevron) chevron.style.display = 'none';
    dropdownMenu.innerHTML = '';
    return;
  }

  let menuHtml = `
    <button type="button" class="campus-dropdown-item ${state.selectedCampusId === 'ALL' ? 'active' : ''}" data-campus-id="ALL">
      <span>All Campuses (${userCampuses.length || 'Global'})</span>
      ${state.selectedCampusId === 'ALL' ? '<i class="fa-solid fa-check check-icon"></i>' : ''}
    </button>
  `;

  userCampuses.forEach(c => {
    menuHtml += `
      <button type="button" class="campus-dropdown-item ${state.selectedCampusId === c.id ? 'active' : ''}" data-campus-id="${c.id}">
        <span>${escapeHtml(c.name)}</span>
        ${state.selectedCampusId === c.id ? '<i class="fa-solid fa-check check-icon"></i>' : ''}
      </button>
    `;
  });

  dropdownMenu.innerHTML = menuHtml;

  triggerBtn.onclick = (e) => {
    e.stopPropagation();
    const isHidden = dropdownMenu.classList.contains('hidden');
    dropdownMenu.classList.toggle('hidden', !isHidden);
    triggerBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
  };

  dropdownMenu.querySelectorAll('.campus-dropdown-item').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const campusId = btn.getAttribute('data-campus-id');
      state.selectedCampusId = campusId;
      dropdownMenu.classList.add('hidden');
      triggerBtn.setAttribute('aria-expanded', 'false');
      setupActiveCampusWidget();
      showToast(campusId === 'ALL' ? 'Viewing all campuses' : `Campus filter applied`, 'info');
      loadCurrentView();
    };
  });

  document.addEventListener('click', () => {
    if (!dropdownMenu.classList.contains('hidden')) {
      dropdownMenu.classList.add('hidden');
      triggerBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

function updateCampusWidgetLabel() {
  const campusScopeSpan = document.getElementById('page-campus-scope');
  if (!campusScopeSpan) return;

  const userCampuses = state.user ? (state.user.campuses || []) : [];
  if (state.selectedCampusId === 'ALL' || !state.selectedCampusId) {
    if (userCampuses.length === 1) {
      campusScopeSpan.textContent = userCampuses[0].name;
    } else if (userCampuses.length > 1) {
      campusScopeSpan.textContent = `All Campuses (${userCampuses.length})`;
    } else {
      campusScopeSpan.textContent = 'All Campuses';
    }
  } else {
    const found = userCampuses.find(c => c.id === state.selectedCampusId);
    campusScopeSpan.textContent = found ? found.name : 'Active Campus';
  }
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
    if (state.user.user_type === 'SUPER_ADMIN' || state.user.isSuperAdmin || hasPermission('campuses.manage')) {
      addNavItem(nav, 'campuses', 'fa-building-columns', 'Campuses');
    }
    if (hasPermission('imports.execute') || hasPermission('exports.execute')) {
      addNavItem(nav, 'import-export', 'fa-file-excel', 'Import & Export');
    }
    if (hasPermission('audit.view')) {
      addNavItem(nav, 'audit-logs', 'fa-shield-halved', 'Audit Log');
    }
    if (state.user.user_type === 'SUPER_ADMIN' || state.user.isSuperAdmin) {
      addNavItem(nav, 'roles', 'fa-key', 'Roles & Access');
      addNavItem(nav, 'settings', 'fa-gear', 'System Settings');
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

function setPageTitle(title) {
  if (elements.pageTitle) {
    elements.pageTitle.textContent = title;
  }
}

async function renderCurrentView() {
  const route = state.currentRoute;
  const container = elements.mainContent;

  switch (route) {
    // Teacher Views
    case 'teacher-dashboard':
      setPageTitle('Teacher Dashboard');
      await renderTeacherDashboard(container);
      break;
    case 'teacher-tasks':
      setPageTitle('My Assigned Tasks');
      await renderTeacherTasks(container);
      break;
    case 'teacher-history':
      setPageTitle('Submission History');
      await renderTeacherHistory(container);
      break;
    case 'teacher-performance':
      setPageTitle('My Performance');
      await renderTeacherPerformance(container);
      break;
    case 'teacher-groups':
      setPageTitle('Faculty Groups');
      await renderTeacherGroups(container);
      break;
    case 'my-profile':
      setPageTitle('My Profile');
      await renderMyProfile(container);
      break;

    // Admin Views
    case 'admin-dashboard':
      setPageTitle('Institutional Dashboard');
      await renderAdminDashboard(container);
      break;
    case 'tasks':
      setPageTitle('Task Management');
      await renderAdminTasks(container);
      break;
    case 'task-builder':
      setPageTitle('Guided Task Builder');
      await renderTaskBuilder(container);
      break;
    case 'recurring-tasks':
      setPageTitle('Recurring Task Templates');
      await renderRecurringTasks(container);
      break;
    case 'reports-task-wise':
      setPageTitle('Task-Wise Reports');
      await renderTaskWiseReport(container);
      break;
    case 'reports-teacher-wise':
      setPageTitle('Teacher Performance Report');
      await renderTeacherWiseReport(container);
      break;
    case 'reports-detailed':
      setPageTitle('Detailed Response Report');
      await renderDetailedResponseReport(container);
      break;
    case 'users':
      setPageTitle('Faculty & User Directory');
      await renderUsersDirectory(container);
      break;
    case 'groups':
      setPageTitle('Group Management');
      await renderAdminGroups(container);
      break;
    case 'group-requests':
      setPageTitle('Group Joining Requests');
      await renderGroupRequests(container);
      break;
    case 'masters':
      setPageTitle('Master Data Management');
      await renderMasterData(container);
      break;
    case 'campuses':
      setPageTitle('Campus Management');
      await renderCampusesView(container);
      break;
    case 'import-export':
      setPageTitle('Import & Export Centre');
      await renderImportExport(container);
      break;
    case 'audit-logs':
      setPageTitle('Audit Log Timeline');
      await renderAuditLogs(container);
      break;
    case 'roles':
      setPageTitle('Roles & Permissions');
      await renderRolesManagement(container);
      break;
    case 'settings':
      setPageTitle('System Settings');
      await renderSystemSettings(container);
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

  const dueSoon = tasks.filter(t => t.status === 'NOT_STARTED' || t.status === 'IN_PROGRESS');
  const overdue = tasks.filter(t => t.status === 'OVERDUE');
  const completed = tasks.filter(t => t.status === 'SUBMITTED_ON_TIME' || t.status === 'SUBMITTED_LATE');
  const firstName = (state.user ? state.user.first_name : '') || 'Teacher';
  const todayDateString = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <!-- Teacher Control Room Header -->
    <div class="dashboard-hero-header">
      <div>
        <span class="section-kicker">TEACHER WORKSPACE</span>
        <h1 class="hero-title">Good morning, ${escapeHtml(firstName)}</h1>
      </div>
      <div class="hero-actions-right">
        <button class="btn btn-accent btn-sm" onclick="navigateTo('teacher-tasks')">
          <i class="fa-solid fa-list-check"></i> My Assigned Tasks
        </button>
      </div>
    </div>

    <!-- Live Operational View Banner -->
    <div class="live-banner">
      <div class="live-banner-left">
        <span class="live-dot-pulse"></span>
        <div>
          <div class="live-banner-title">Live task tracking view</div>
          <div class="live-banner-sub">Focus on pending items and strict deadlines.</div>
        </div>
      </div>
      <div class="live-banner-date hide-sm">${todayDateString}</div>
    </div>

    <!-- RouteReady Metric KPI Grid -->
    <div class="kpi-grid">
      <div class="kpi-card" onclick="navigateTo('teacher-tasks')">
        <div class="kpi-title">Assigned workflows</div>
        <div class="kpi-value">${perf.total_assigned}</div>
        <div class="kpi-subtext">Total active assignments</div>
      </div>
      <div class="kpi-card" onclick="navigateTo('teacher-tasks')">
        <div class="kpi-title">Completed on time</div>
        <div class="kpi-value">${perf.submitted_on_time}</div>
        <div class="kpi-subtext">${perf.completion_rate}% completion rate</div>
      </div>
      <div class="kpi-card ${perf.overdue > 0 ? 'kpi-card-highlight' : ''}" onclick="navigateTo('teacher-tasks')">
        <div class="kpi-title">Overdue / Action items</div>
        <div class="kpi-value">${perf.overdue}</div>
        <div class="kpi-subtext">${perf.overdue > 0 ? 'Immediate action required' : 'Zero overdue tasks'}</div>
      </div>
      <div class="kpi-card" onclick="navigateTo('teacher-performance')">
        <div class="kpi-title">Punctuality rate</div>
        <div class="kpi-value">${perf.on_time_rate || 100}%</div>
        <div class="kpi-subtext">On-time submission reliability</div>
      </div>
    </div>

    <!-- Dual Workspace Columns -->
    <div class="grid-split-2">
      <!-- Left Column: Tasks Due Soon & Action Items -->
      <div class="card">
        <div class="card-header">
          <h2>Pending task action items</h2>
          <a href="javascript:void(0)" class="card-header-link" onclick="navigateTo('teacher-tasks')">Open workspace →</a>
        </div>
        <div class="card-body">
          ${dueSoon.length === 0 ? `
            <div class="empty-state">
              <i class="fa-solid fa-circle-check text-success"></i>
              <h3>You are all caught up!</h3>
              <p>No pending tasks currently require your attention.</p>
            </div>
          ` : `
            <div class="list-card-stack">
              ${dueSoon.slice(0, 6).map(t => {
                const isOverdue = t.status === 'OVERDUE';
                return `
                  <div class="list-card-item" onclick="openTaskSubmissionModal('${t.task_id}')" style="cursor:pointer;">
                    <div class="list-card-left">
                      <div class="list-card-icon orange"><i class="fa-regular fa-sun"></i></div>
                      <div class="list-card-meta">
                        <div class="list-card-title">${escapeHtml(t.title)}</div>
                        <div class="list-card-sub">Due: ${formatDateTime(t.due_at)}</div>
                      </div>
                    </div>
                    <div>
                      <span class="badge ${isOverdue ? 'badge-overdue' : 'badge-pending'}">${isOverdue ? 'OVERDUE' : 'PENDING'}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </div>

      <!-- Right Column: Recent Submissions -->
      <div class="card">
        <div class="card-header">
          <h2>Recent submissions</h2>
          <a href="javascript:void(0)" class="card-header-link" onclick="navigateTo('teacher-history')">View history →</a>
        </div>
        <div class="card-body">
          ${completed.length === 0 ? `
            <div class="empty-state">
              <i class="fa-solid fa-clock-rotate-left"></i>
              <h3>No submissions yet</h3>
              <p>Completed tasks will be archived here.</p>
            </div>
          ` : `
            <div class="list-card-stack">
              ${completed.slice(0, 6).map(t => `
                <div class="list-card-item" onclick="openTaskSubmissionModal('${t.task_id}')" style="cursor:pointer;">
                  <div class="list-card-left">
                    <div class="list-card-icon green"><i class="fa-solid fa-circle-check"></i></div>
                    <div class="list-card-meta">
                      <div class="list-card-title">${escapeHtml(t.title)}</div>
                      <div class="list-card-sub">Submitted: ${formatDate(t.submitted_at || t.assigned_at)}</div>
                    </div>
                  </div>
                  <div>
                    <span class="badge badge-completed">SUBMITTED</span>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
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

  const myGroups = groups.filter(g => g.user_membership_status === 'APPROVED' || g.user_membership_status === 'PENDING');
  const availableGroups = groups.filter(g => !g.user_membership_status);

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h2><i class="fa-solid fa-users-rectangle text-primary"></i> Campus Faculty Groups & Communities</h2>
      <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 4px;">
        Browse and join faculty collaboration groups across your assigned campus. Group members receive targeted task broadcasts and announcements.
      </p>
    </div>

    <!-- Section 1: My Enrolled / Pending Groups -->
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <h3 style="font-size: 1.1rem; margin: 0;"><i class="fa-solid fa-circle-check text-success"></i> My Enrolled Groups (${myGroups.length})</h3>
      </div>
      <div class="card-body">
        ${myGroups.length === 0 ? `
          <div class="empty-state" style="padding: 24px;">
            <i class="fa-solid fa-users-slash" style="font-size: 2rem; color: var(--text-muted); margin-bottom: 8px;"></i>
            <p>You have not joined any campus faculty groups yet. Browse available campus groups below to join.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Group Name</th>
                  <th>Campus</th>
                  <th>Description</th>
                  <th>Total Members</th>
                  <th>Membership Status</th>
                </tr>
              </thead>
              <tbody>
                ${myGroups.map(g => `
                  <tr>
                    <td><strong>${escapeHtml(g.name)}</strong></td>
                    <td><span class="badge badge-in-progress">${escapeHtml(g.campus_name || 'All Campuses')}</span></td>
                    <td>${escapeHtml(g.description || '—')}</td>
                    <td>${g.member_count || 0} Members</td>
                    <td>
                      ${g.user_membership_status === 'APPROVED' 
                        ? `<span class="badge badge-active"><i class="fa-solid fa-check"></i> Enrolled Member</span>` 
                        : `<span class="badge badge-pending"><i class="fa-solid fa-clock"></i> Request Pending Approval</span>`}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>

    <!-- Section 2: Discoverable Campus Groups -->
    <div class="card">
      <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <h3 style="font-size: 1.1rem; margin: 0;"><i class="fa-solid fa-compass text-primary"></i> Available Campus Groups (${availableGroups.length})</h3>
      </div>
      <div class="card-body">
        ${availableGroups.length === 0 ? `
          <div class="empty-state" style="padding: 24px;">
            <i class="fa-solid fa-circle-info" style="font-size: 2rem; color: var(--text-muted); margin-bottom: 8px;"></i>
            <p>No additional campus groups available to join at this time.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Group Name</th>
                  <th>Campus</th>
                  <th>Description</th>
                  <th>Members</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${availableGroups.map(g => `
                  <tr>
                    <td><strong>${escapeHtml(g.name)}</strong></td>
                    <td><span class="badge badge-in-progress">${escapeHtml(g.campus_name || 'All Campuses')}</span></td>
                    <td>${escapeHtml(g.description || '—')}</td>
                    <td>${g.member_count || 0} Members</td>
                    <td>
                      ${g.allow_join_requests !== false ? `
                        <button class="btn btn-primary btn-sm" onclick="requestGroupJoin('${g.id}', '${escapeHtml(g.name)}')">
                          <i class="fa-solid fa-user-plus"></i> Request to Join
                        </button>
                      ` : `
                        <span style="font-size:0.8rem; color:var(--text-muted);"><i class="fa-solid fa-lock"></i> Invitation Only</span>
                      `}
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

    <!-- Self-Service Institutional PIN (IPIN) Management Card -->
    <div class="card" style="max-width: 800px; margin: 24px auto 0;">
      <div class="card-header">
        <h2><i class="fa-solid fa-key text-primary"></i> Change Institutional PIN (IPIN)</h2>
      </div>
      <div class="card-body">
        <p style="color:var(--text-muted); font-size:0.88rem; margin-bottom:16px;">
          Your Institutional PIN (IPIN) is a 4 to 6 digit numeric security code used for quick, secure mobile and desktop access.
        </p>
        <form id="form-change-password" onsubmit="handlePasswordReset(event)">
          <div class="form-group">
            <label>Current IPIN <span class="text-danger">*</span></label>
            <input type="password" name="current_password" class="form-input" inputmode="numeric" pattern="[0-9]*" maxlength="8" required placeholder="Enter current IPIN" />
          </div>
          <div class="form-group">
            <label>New 4-6 Digit IPIN <span class="text-danger">*</span></label>
            <input type="password" name="new_password" class="form-input" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" required placeholder="e.g. 123456" />
          </div>
          <div class="form-group">
            <label>Confirm New IPIN <span class="text-danger">*</span></label>
            <input type="password" name="confirm_password" class="form-input" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" required placeholder="Confirm new 4-6 digit IPIN" />
          </div>

          <div style="margin-top: 24px;">
            <button type="submit" class="btn btn-primary">
              <i class="fa-solid fa-shield-halved"></i> Update IPIN
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
    return showToast('New IPINs do not match', 'warning');
  }

  if (new_password.length < 4 || new_password.length > 8) {
    return showToast('IPIN must be between 4 and 8 digits (recommended 4-6 digits)', 'warning');
  }

  try {
    const res = await api('/profile/password', {
      method: 'PUT',
      body: { current_password, new_password, confirm_password }
    });
    showToast(res.message || 'Institutional PIN (IPIN) updated successfully!', 'success');
    form.reset();
  } catch {}
}

// ============================================================================
// 6. ADMIN & MANAGEMENT VIEWS
// ============================================================================

async function renderAdminDashboard(container) {
  const [allTasks, allTeachers, requests] = await Promise.all([
    api('/tasks'),
    api('/users?user_type=TEACHER'),
    hasPermission('groups.approve_requests') ? api('/group-requests/pending-count') : Promise.resolve({ count: 0 })
  ]);

  // Apply active campus filter if selected
  const activeCampusId = state.selectedCampusId;
  const tasks = (activeCampusId && activeCampusId !== 'ALL')
    ? allTasks.filter(t => {
        const cIds = typeof t.campus_ids === 'string' ? JSON.parse(t.campus_ids || '[]') : (t.campus_ids || []);
        return cIds.includes(activeCampusId);
      })
    : allTasks;

  const teachers = (activeCampusId && activeCampusId !== 'ALL')
    ? allTeachers.filter(u => (u.campuses || []).some(c => c.id === activeCampusId))
    : allTeachers;

  const activeTasks = tasks.filter(t => t.status === 'PUBLISHED');
  const totalOverdue = activeTasks.reduce((acc, t) => acc + (t.overdue || 0), 0);
  const totalAssigned = activeTasks.reduce((acc, t) => acc + (t.total_assigned || 0), 0);
  const totalSubmitted = activeTasks.reduce((acc, t) => acc + (t.submitted_on_time || 0) + (t.submitted_late || 0), 0);
  const firstName = (state.user ? state.user.first_name : '') || 'Administrator';
  const todayDateString = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <!-- Control Room Hero Header -->
    <div class="dashboard-hero-header">
      <div>
        <span class="section-kicker">TODAY'S CONTROL ROOM</span>
        <h1 class="hero-title">Good morning, ${escapeHtml(firstName)}</h1>
      </div>
      <div class="hero-actions-right">
        <div class="date-filter-control hide-sm">
          <input type="date" value="${todayDateString}" id="admin-dashboard-date-filter" />
        </div>
        ${(state.user.isSuperAdmin || state.user.user_type === 'SUPER_ADMIN' || state.user.user_type === 'ADMIN') ? `
          <button class="btn btn-secondary btn-sm" onclick="openTestEmailModal()">
            <i class="fa-solid fa-paper-plane"></i> <span class="hide-sm">Test SMTP</span>
          </button>
        ` : ''}
        ${hasPermission('tasks.create') ? `
          <button class="btn btn-accent btn-sm" onclick="navigateTo('task-builder')">
            <i class="fa-solid fa-plus"></i> Create Task
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Live Operational View Banner -->
    <div class="live-banner">
      <div class="live-banner-left">
        <span class="live-dot-pulse"></span>
        <div>
          <div class="live-banner-title">Live operational view</div>
          <div class="live-banner-sub">Focus on exceptions. Everything else stays quietly in order.</div>
        </div>
      </div>
      <div class="live-banner-date hide-sm">${todayDateString}</div>
    </div>

    <!-- RouteReady Metric KPI Grid -->
    <div class="kpi-grid">
      <div class="kpi-card" onclick="navigateTo('tasks')">
        <div class="kpi-title">Active task operations</div>
        <div class="kpi-value">${activeTasks.length}/${tasks.length}</div>
        <div class="kpi-subtext">Active institutional workflows</div>
      </div>
      <div class="kpi-card" onclick="navigateTo('users')">
        <div class="kpi-title">Faculty submissions</div>
        <div class="kpi-value">${totalSubmitted}/${totalAssigned || 0}</div>
        <div class="kpi-subtext">Across active teachers</div>
      </div>
      <div class="kpi-card ${totalOverdue > 0 ? 'kpi-card-highlight' : ''}" onclick="navigateTo('reports-task-wise')">
        <div class="kpi-title">Overdue / Exceptions</div>
        <div class="kpi-value">${totalOverdue}</div>
        <div class="kpi-subtext">${totalOverdue > 0 ? 'Action items require follow-up' : 'Zero exceptions recorded'}</div>
      </div>
      <div class="kpi-card" onclick="navigateTo('group-requests')">
        <div class="kpi-title">Pending group requests</div>
        <div class="kpi-value">${requests.count}</div>
        <div class="kpi-subtext">Faculty awaiting approval</div>
      </div>
    </div>

    <!-- Dual Workspace Columns (matching screenshot layout) -->
    <div class="grid-split-2">
      <!-- Left Column: Active Institutional Tasks -->
      <div class="card">
        <div class="card-header">
          <h2>Task operations</h2>
          <a href="javascript:void(0)" class="card-header-link" onclick="navigateTo('tasks')">Open workspace →</a>
        </div>
        <div class="card-body">
          ${activeTasks.length === 0 ? `
            <div class="empty-state">
              <i class="fa-solid fa-circle-check text-success"></i>
              <h3>All tasks completed</h3>
              <p>No published tasks currently active.</p>
            </div>
          ` : `
            <div class="list-card-stack">
              ${activeTasks.slice(0, 6).map(t => {
                const isOverdue = (t.overdue || 0) > 0;
                return `
                  <div class="list-card-item" onclick="openTaskReport('${t.id}')" style="cursor:pointer;">
                    <div class="list-card-left">
                      <div class="list-card-icon orange"><i class="fa-regular fa-sun"></i></div>
                      <div class="list-card-meta">
                        <div class="list-card-title">${escapeHtml(t.title)}</div>
                        <div class="list-card-sub">${t.total_assigned ? `${(t.submitted_on_time || 0) + (t.submitted_late || 0)}/${t.total_assigned} submitted` : 'Pending audience'}</div>
                      </div>
                    </div>
                    <div>
                      <span class="badge ${isOverdue ? 'badge-pending' : 'badge-completed'}">${isOverdue ? 'PENDING' : 'ON TRACK'}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </div>

      <!-- Right Column: Institutional Directory & Workflows -->
      <div class="card">
        <div class="card-header">
          <h2>Active faculty</h2>
          <a href="javascript:void(0)" class="card-header-link" onclick="navigateTo('users')">Open directory →</a>
        </div>
        <div class="card-body">
          ${teachers.length === 0 ? `
            <div class="empty-state">
              <i class="fa-solid fa-users"></i>
              <h3>No teachers found</h3>
              <p>No faculty members listed in the directory.</p>
            </div>
          ` : `
            <div class="list-card-stack">
              ${teachers.slice(0, 6).map(u => `
                <div class="list-card-item">
                  <div class="list-card-left">
                    <div class="list-card-icon green"><i class="fa-solid fa-chalkboard-user"></i></div>
                    <div class="list-card-meta">
                      <div class="list-card-title">${escapeHtml(u.display_name)}</div>
                      <div class="list-card-sub">${escapeHtml(u.designation_name || u.email)}</div>
                    </div>
                  </div>
                  <div>
                    <span class="badge badge-waiting">ACTIVE</span>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

// Admin Tasks Management
async function renderAdminTasks(container) {
  state.taskTab = state.taskTab || 'ACTIVE';
  state.taskFilters = state.taskFilters || { campusId: '', search: '', taskType: '', sortBy: 'priority' };

  const [allTasks, campuses] = await Promise.all([
    api('/tasks'),
    api('/campuses')
  ]);

  // Compute section counts
  const activeCount = allTasks.filter(t => (t.status === 'ACTIVE' || t.status === 'PUBLISHED') && !t.is_scheduled).length;
  const scheduledCount = allTasks.filter(t => t.status === 'SCHEDULED' || t.is_scheduled).length;
  const pausedCount = allTasks.filter(t => t.status === 'PAUSED').length;
  const archivedCount = allTasks.filter(t => t.status === 'ARCHIVED').length;

  // 1. Filter by active section tab
  let tasks = allTasks.filter(t => {
    if (state.taskTab === 'ACTIVE') {
      return (t.status === 'ACTIVE' || t.status === 'PUBLISHED') && !t.is_scheduled;
    }
    if (state.taskTab === 'SCHEDULED') {
      return t.status === 'SCHEDULED' || t.is_scheduled;
    }
    if (state.taskTab === 'PAUSED') {
      return t.status === 'PAUSED';
    }
    if (state.taskTab === 'ARCHIVED') {
      return t.status === 'ARCHIVED';
    }
    return true;
  });

  // 2. Filter by Campus
  if (state.taskFilters.campusId) {
    tasks = tasks.filter(t => {
      const cids = Array.isArray(t.campus_ids) ? t.campus_ids : (typeof t.campus_ids === 'string' ? JSON.parse(t.campus_ids) : []);
      return cids.includes(state.taskFilters.campusId);
    });
  }

  // 3. Filter by Task Type
  if (state.taskFilters.taskType) {
    tasks = tasks.filter(t => t.task_type === state.taskFilters.taskType);
  }

  // 4. Filter by Search (Title, Assignor, Description)
  if (state.taskFilters.search) {
    const q = state.taskFilters.search.toLowerCase().trim();
    tasks = tasks.filter(t => 
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.creator_name && t.creator_name.toLowerCase().includes(q)) ||
      (t.campus_names && t.campus_names.toLowerCase().includes(q)) ||
      (t.description && t.description.toLowerCase().includes(q))
    );
  }

  // 5. Apply Sorting
  const sortBy = state.taskFilters.sortBy || 'priority';
  tasks.sort((a, b) => {
    if (sortBy === 'deadline_asc') return new Date(a.deadline_at || 0) - new Date(b.deadline_at || 0);
    if (sortBy === 'deadline_desc') return new Date(b.deadline_at || 0) - new Date(a.deadline_at || 0);
    if (sortBy === 'title_asc') return (a.title || '').localeCompare(b.title || '');
    if (sortBy === 'title_desc') return (b.title || '').localeCompare(a.title || '');
    if (sortBy === 'completion_desc') return (b.completion_rate || 0) - (a.completion_rate || 0);
    if (sortBy === 'completion_asc') return (a.completion_rate || 0) - (b.completion_rate || 0);
    if (sortBy === 'assigned_desc') return (b.total_assigned || 0) - (a.total_assigned || 0);
    if (sortBy === 'created_desc') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    // Default: Priority / sort_order ASC
    return (a.sort_order - b.sort_order) || (new Date(b.created_at || 0) - new Date(a.created_at || 0));
  });

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom: 16px;">
      <div>
        <h2 style="margin:0 0 4px 0;"><i class="fa-solid fa-list-check"></i> Tasks Directory</h2>
        <p style="color:var(--text-muted); font-size:0.88rem; margin:0;">
          Create, schedule, organize and track institutional tasks across campuses.
        </p>
      </div>
      ${hasPermission('tasks.create') ? `
        <button class="btn btn-primary" onclick="state.taskBuilder = null; navigateTo('task-builder')">
          <i class="fa-solid fa-plus"></i> Create Task
        </button>
      ` : ''}
    </div>

    <!-- 1. Task Section Tabs -->
    <div class="nav-tab-pills">
      <button class="tab-pill ${state.taskTab === 'ACTIVE' ? 'active' : ''}" onclick="state.taskTab = 'ACTIVE'; loadCurrentView();">
        <i class="fa-solid fa-circle-check"></i> Active <span class="tab-count-badge">${activeCount}</span>
      </button>
      <button class="tab-pill ${state.taskTab === 'SCHEDULED' ? 'active' : ''}" onclick="state.taskTab = 'SCHEDULED'; loadCurrentView();">
        <i class="fa-solid fa-calendar-clock"></i> Scheduled <span class="tab-count-badge">${scheduledCount}</span>
      </button>
      <button class="tab-pill ${state.taskTab === 'PAUSED' ? 'active' : ''}" onclick="state.taskTab = 'PAUSED'; loadCurrentView();">
        <i class="fa-solid fa-pause"></i> Paused <span class="tab-count-badge">${pausedCount}</span>
      </button>
      <button class="tab-pill ${state.taskTab === 'ARCHIVED' ? 'active' : ''}" onclick="state.taskTab = 'ARCHIVED'; loadCurrentView();">
        <i class="fa-solid fa-box-archive"></i> Archived <span class="tab-count-badge">${archivedCount}</span>
      </button>
    </div>

    <!-- 2. Responsive Filter & Sort Toolbar -->
    <div class="filter-sort-bar">
      <div class="filter-sort-group">
        <!-- Campus Filter -->
        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:0.85rem; font-weight:600; color:var(--text-muted); white-space:nowrap;"><i class="fa-solid fa-building-columns"></i> Campus:</label>
          <select class="form-select form-select-sm" style="min-width:150px;" onchange="state.taskFilters.campusId = this.value; loadCurrentView();">
            <option value="">All Campuses</option>
            ${campuses.map(c => `<option value="${c.id}" ${state.taskFilters.campusId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>

        <!-- Task Type Filter -->
        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:0.85rem; font-weight:600; color:var(--text-muted); white-space:nowrap;"><i class="fa-solid fa-tag"></i> Type:</label>
          <select class="form-select form-select-sm" style="min-width:130px;" onchange="state.taskFilters.taskType = this.value; loadCurrentView();">
            <option value="">All Types</option>
            <option value="ONE_TIME" ${state.taskFilters.taskType === 'ONE_TIME' ? 'selected' : ''}>One-Time</option>
            <option value="RECURRING_INSTANCE" ${state.taskFilters.taskType === 'RECURRING_INSTANCE' ? 'selected' : ''}>Recurring Instance</option>
          </select>
        </div>

        <!-- Search Box -->
        <div style="position:relative; display:flex; align-items:center;">
          <input type="text" class="form-input form-input-sm" style="padding-left:28px; width:220px;" placeholder="Search title, assignor, campus..." value="${escapeHtml(state.taskFilters.search || '')}" oninput="state.taskFilters.search = this.value; debounceTaskSearch();" />
          <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:10px; font-size:0.8rem; color:var(--text-muted); pointer-events:none;"></i>
          ${state.taskFilters.search ? `
            <button type="button" onclick="state.taskFilters.search = ''; loadCurrentView();" style="position:absolute; right:8px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.8rem;">
              <i class="fa-solid fa-xmark"></i>
            </button>
          ` : ''}
        </div>
      </div>

      <div class="filter-sort-group">
        <!-- Sort Selector -->
        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:0.85rem; font-weight:600; color:var(--text-muted); white-space:nowrap;"><i class="fa-solid fa-arrow-down-short-wide"></i> Sort By:</label>
          <select class="form-select form-select-sm" style="min-width:160px;" onchange="state.taskFilters.sortBy = this.value; loadCurrentView();">
            <option value="priority" ${sortBy === 'priority' ? 'selected' : ''}>Manual Priority (Default)</option>
            <option value="deadline_asc" ${sortBy === 'deadline_asc' ? 'selected' : ''}>Deadline: Earliest First</option>
            <option value="deadline_desc" ${sortBy === 'deadline_desc' ? 'selected' : ''}>Deadline: Latest First</option>
            <option value="title_asc" ${sortBy === 'title_asc' ? 'selected' : ''}>Title: A to Z</option>
            <option value="title_desc" ${sortBy === 'title_desc' ? 'selected' : ''}>Title: Z to A</option>
            <option value="completion_desc" ${sortBy === 'completion_desc' ? 'selected' : ''}>Completion: High to Low</option>
            <option value="completion_asc" ${sortBy === 'completion_asc' ? 'selected' : ''}>Completion: Low to High</option>
            <option value="assigned_desc" ${sortBy === 'assigned_desc' ? 'selected' : ''}>Assigned Count: Most</option>
            <option value="created_desc" ${sortBy === 'created_desc' ? 'selected' : ''}>Created: Newest First</option>
          </select>
        </div>

        ${(state.taskFilters.campusId || state.taskFilters.taskType || state.taskFilters.search || sortBy !== 'priority') ? `
          <button class="btn btn-outline btn-sm" onclick="state.taskFilters = { campusId: '', search: '', taskType: '', sortBy: 'priority' }; loadCurrentView();" title="Reset Filters">
            <i class="fa-solid fa-arrow-rotate-left"></i> Reset
          </button>
        ` : ''}
      </div>
    </div>

    <!-- 3. Tasks Table -->
    <div class="card">
      <div class="card-body" style="padding:0;">
        <div class="table-responsive">
          <table class="table" style="margin-bottom:0;">
            <thead>
              <tr>
                <th style="width: 70px; text-align:center;">Priority</th>
                <th>Task Details & Info</th>
                <th>Type</th>
                <th>Status</th>
                <th style="text-align:center;">Assigned</th>
                <th>Schedule & Deadline</th>
                <th>Completion</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.length === 0 ? `
                <tr>
                  <td colspan="8" class="empty-state" style="padding:40px 20px;">
                    <i class="fa-solid fa-folder-open" style="font-size:2rem; color:var(--text-muted); margin-bottom:10px; display:block;"></i>
                    <p style="font-size:1rem; font-weight:600; margin:0 0 6px 0;">No tasks found in "${state.taskTab}"</p>
                    <small style="color:var(--text-muted);">Try adjusting your search or campus filters, or create a new task.</small>
                  </td>
                </tr>
              ` : tasks.map((t, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === tasks.length - 1;

                let statusBadge = `<span class="badge badge-${t.status.toLowerCase()}">${t.status}</span>`;
                if (t.status === 'SCHEDULED' || t.is_scheduled) {
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
                        <button class="btn btn-outline btn-sm" style="padding:2px 6px; font-size:0.75rem;" ${isFirst || sortBy !== 'priority' ? 'disabled' : ''} onclick="reorderTask('${t.id}', 'UP')" title="Move Up in Priority">
                          <i class="fa-solid fa-arrow-up"></i>
                        </button>
                        <button class="btn btn-outline btn-sm" style="padding:2px 6px; font-size:0.75rem;" ${isLast || sortBy !== 'priority' ? 'disabled' : ''} onclick="reorderTask('${t.id}', 'DOWN')" title="Move Down in Priority">
                          <i class="fa-solid fa-arrow-down"></i>
                        </button>
                      </div>
                    </td>
                    <td>
                      <div style="font-size:0.95rem; font-weight:700; color:var(--text-main); margin-bottom:4px;">
                        ${escapeHtml(t.title)}
                      </div>
                      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
                        <div class="task-meta-tag">
                          <i class="fa-solid fa-user-pen"></i> Assigned by: <strong style="color:var(--text-main);">${escapeHtml(t.creator_name || 'Super Administrator')}</strong>
                        </div>
                        <div class="task-meta-tag">
                          <i class="fa-solid fa-building-columns"></i> Campus: <span class="badge badge-secondary" style="font-size:0.72rem;">${escapeHtml(t.campus_names || 'All Campuses')}</span>
                        </div>
                      </div>
                      ${t.description ? `<p style="font-size:0.8rem; color:var(--text-muted); margin:4px 0 0 0; max-width:420px;">${escapeHtml(t.description)}</p>` : ''}
                    </td>
                    <td>
                      <span class="badge badge-not-started" style="font-size:0.75rem;">${t.task_type === 'RECURRING_INSTANCE' ? 'RECURRING' : t.task_type}</span>
                    </td>
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
                    <td style="text-align:center;">
                      <button type="button" class="btn-badge-interactive" onclick="openTaskAssignedTeachersModal('${t.id}', '${escapeHtml(t.title).replace(/'/g, "\\'")}')" title="Click to view full list of assigned teachers">
                        <span>${t.total_assigned || 0}</span>
                        <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.65rem;"></i>
                      </button>
                    </td>
                    <td>
                      <div style="font-size:0.85rem;"><i class="fa-regular fa-clock text-danger"></i> Due: <strong>${formatDateTime(t.deadline_at)}</strong></div>
                      ${t.open_at ? `<div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">Opens: ${formatDateTime(t.open_at)}</div>` : ''}
                      ${!t.allow_late_submissions ? `<div style="font-size:0.75rem; color:var(--danger); font-weight:600;"><i class="fa-solid fa-lock"></i> Late Closed</div>` : `<div style="font-size:0.75rem; color:var(--success);"><i class="fa-solid fa-lock-open"></i> Late Allowed</div>`}
                    </td>
                    <td>
                      <div style="display:flex; align-items:center; gap:6px;">
                        <div style="width:50px; height:6px; background:var(--border-color); border-radius:3px; overflow:hidden;">
                          <div style="height:100%; width:${t.completion_rate || 0}%; background:var(--primary);"></div>
                        </div>
                        <strong style="font-size:0.85rem;">${t.completion_rate || 0}%</strong>
                      </div>
                    </td>
                    <td style="text-align:right;">
                      <div style="display:inline-flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
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

let taskSearchDebounceTimer = null;
function debounceTaskSearch() {
  clearTimeout(taskSearchDebounceTimer);
  taskSearchDebounceTimer = setTimeout(() => {
    loadCurrentView();
  }, 250);
}

// Modal showing list of assigned teachers for a task
async function openTaskAssignedTeachersModal(taskId, taskTitle) {
  try {
    const data = await api(`/reports/task-wise?task_id=${taskId}`);
    const { stats, rows = [] } = data;

    let filterStatus = '';
    let searchQuery = '';

    function renderModalBody() {
      let filtered = rows;
      if (filterStatus) {
        filtered = filtered.filter(r => r.status === filterStatus);
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase().trim();
        filtered = filtered.filter(r => 
          (r.display_name && r.display_name.toLowerCase().includes(q)) ||
          (r.email && r.email.toLowerCase().includes(q)) ||
          (r.campus_name && r.campus_name.toLowerCase().includes(q))
        );
      }

      return `
        <div style="max-height: 80vh; display:flex; flex-direction:column;">
          <!-- Modal Header -->
          <div class="modal-header-with-stats">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
              <div>
                <h2 style="margin:0 0 4px 0; font-size:1.25rem;"><i class="fa-solid fa-users text-primary"></i> Assigned Faculty Members</h2>
                <div style="font-size:0.88rem; color:var(--text-muted);">
                  Task: <strong style="color:var(--text-main);">${escapeHtml(taskTitle)}</strong>
                </div>
              </div>
              <button class="btn-icon" onclick="closeModal()" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <!-- Summary KPI Pills -->
            <div class="modal-stats-pills">
              <span class="stat-pill" style="background:rgba(37, 99, 235, 0.1); color:var(--primary);">
                <i class="fa-solid fa-list-check"></i> Total Assigned: <strong>${stats.total}</strong>
              </span>
              <span class="stat-pill" style="background:rgba(16, 185, 129, 0.1); color:var(--success);">
                <i class="fa-solid fa-check"></i> On-Time: <strong>${stats.on_time}</strong>
              </span>
              <span class="stat-pill" style="background:rgba(245, 158, 11, 0.1); color:var(--warning);">
                <i class="fa-solid fa-clock"></i> Late: <strong>${stats.late}</strong>
              </span>
              <span class="stat-pill" style="background:rgba(239, 68, 68, 0.1); color:var(--danger);">
                <i class="fa-solid fa-triangle-exclamation"></i> Overdue: <strong>${stats.overdue}</strong>
              </span>
              <span class="stat-pill" style="background:rgba(100, 116, 139, 0.1); color:var(--text-muted);">
                <i class="fa-solid fa-hourglass-half"></i> In Progress: <strong>${stats.pending}</strong>
              </span>
            </div>
          </div>

          <!-- Interactive Search & Status Filter inside Modal -->
          <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
            <div style="position:relative; flex:1; min-width:200px;">
              <input type="text" id="modal-teacher-search" class="form-input form-input-sm" style="padding-left:28px;" placeholder="Search teacher by name, email, campus..." value="${escapeHtml(searchQuery)}" />
              <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:0.8rem; color:var(--text-muted); pointer-events:none;"></i>
            </div>
            <select id="modal-teacher-status" class="form-select form-select-sm" style="width:170px;">
              <option value="">All Statuses</option>
              <option value="SUBMITTED_ON_TIME" ${filterStatus === 'SUBMITTED_ON_TIME' ? 'selected' : ''}>Submitted On Time</option>
              <option value="SUBMITTED_LATE" ${filterStatus === 'SUBMITTED_LATE' ? 'selected' : ''}>Submitted Late</option>
              <option value="OVERDUE" ${filterStatus === 'OVERDUE' ? 'selected' : ''}>Overdue</option>
              <option value="IN_PROGRESS" ${filterStatus === 'IN_PROGRESS' ? 'selected' : ''}>In Progress</option>
              <option value="NOT_STARTED" ${filterStatus === 'NOT_STARTED' ? 'selected' : ''}>Not Started</option>
            </select>
          </div>

          <!-- Teachers Table -->
          <div class="table-responsive" style="max-height: 400px; overflow-y:auto; border:1px solid var(--border-color); border-radius:var(--radius-md);">
            <table class="table" style="margin-bottom:0; font-size:0.88rem;">
              <thead style="position:sticky; top:0; background:var(--bg-surface); z-index:2;">
                <tr>
                  <th style="width:40px;">#</th>
                  <th>Faculty Member</th>
                  <th>Campus</th>
                  <th>Status</th>
                  <th>Due Date</th>
                  <th>Submission Time</th>
                  <th style="text-align:right;">Action</th>
                </tr>
              </thead>
              <tbody id="modal-teacher-rows">
                ${filtered.length === 0 ? `
                  <tr><td colspan="7" class="empty-state" style="padding:24px;">No faculty members matched the search.</td></tr>
                ` : filtered.map((r, i) => `
                  <tr>
                    <td><span style="color:var(--text-muted); font-size:0.8rem;">${i + 1}</span></td>
                    <td>
                      <strong>${escapeHtml(r.display_name)}</strong>
                      <div style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(r.email)}</div>
                    </td>
                    <td><span class="badge badge-secondary" style="font-size:0.72rem;">${escapeHtml(r.campus_name)}</span></td>
                    <td><span class="badge badge-${r.status.toLowerCase().replace(/_/g, '-')}">${formatStatus(r.status)}</span></td>
                    <td>${formatDateTime(r.due_at)}</td>
                    <td>${r.submitted_at ? formatDateTime(r.submitted_at) : '<span class="text-muted">Not Submitted</span>'}</td>
                    <td style="text-align:right;">
                      ${(r.status === 'SUBMITTED_ON_TIME' || r.status === 'SUBMITTED_LATE') ? `
                        <button class="btn btn-outline btn-sm" style="padding:2px 8px; font-size:0.78rem;" onclick="closeModal(); openResponseViewerModal('${taskId}', '${r.user_id}', '${escapeHtml(r.display_name).replace(/'/g, "\\'")}')">
                          <i class="fa-solid fa-file-lines"></i> View
                        </button>
                      ` : '<span class="text-muted" style="font-size:0.78rem;">-</span>'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px;">
            <span style="font-size:0.82rem; color:var(--text-muted);">Showing <strong>${filtered.length}</strong> of <strong>${rows.length}</strong> assigned teachers</span>
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
          </div>
        </div>
      `;
    }

    openModal(renderModalBody());

    // Attach search & filter events inside modal
    const searchInput = document.getElementById('modal-teacher-search');
    const statusSelect = document.getElementById('modal-teacher-status');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        const bodyEl = document.getElementById('modal-content');
        if (bodyEl) {
          bodyEl.innerHTML = renderModalBody();
          // Re-focus and restore caret
          const newSearchInput = document.getElementById('modal-teacher-search');
          if (newSearchInput) {
            newSearchInput.focus();
            newSearchInput.setSelectionRange(searchQuery.length, searchQuery.length);
          }
        }
      });
    }

    if (statusSelect) {
      statusSelect.addEventListener('change', (e) => {
        filterStatus = e.target.value;
        const bodyEl = document.getElementById('modal-content');
        if (bodyEl) {
          bodyEl.innerHTML = renderModalBody();
        }
      });
    }

  } catch (err) {
    showToast('Failed to load assigned teachers: ' + err.message, 'danger');
  }
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

    const defaultOffset = (state.settings && parseInt(state.settings.default_deadline_offset_hours, 10)) || 24;
    state.taskBuilder = {
      editingTaskId: task.id,
      step: 1,
      title: task.title,
      description: task.description || '',
      task_type: task.task_type || 'ONE_TIME',
      open_at: task.open_at ? getLocalDateTimeLocalString(task.open_at, 0) : getLocalDateTimeLocalString(new Date(), 0),
      deadline_at: task.deadline_at ? getLocalDateTimeLocalString(task.deadline_at, 0) : getLocalDateTimeLocalString(new Date(), defaultOffset),
      allow_late_submissions: task.allow_late_submissions !== false,
      allow_edit_submission: task.allow_edit_submission === true,
      status: task.status || 'ACTIVE',
      sort_order: task.sort_order || 0,
      recurrence_config: task.recurrence_config ? (typeof task.recurrence_config === 'string' ? JSON.parse(task.recurrence_config) : task.recurrence_config) : { frequency: 'MONTHLY', interval: 1, weekdays: [1], dayOfMonth: 1, monthOfYear: 1, deadline_offset_days: 7, end_type: 'NEVER', end_date: '', max_occurrences: '' },
      questions: questions.length > 0 ? questions : [{ key: 'Q1', label: '', type: 'short_text', required: true }],
      campus_ids: campuses,
      audience_rules: {
        operator: audienceRules.operator || 'AND',
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
    const defaultOffset = (state.settings && parseInt(state.settings.default_deadline_offset_hours, 10)) || 24;
    const nowLocal = getLocalDateTimeLocalString(new Date(), 0);
    const deadlineLocal = getLocalDateTimeLocalString(new Date(), defaultOffset);

    state.taskBuilder = {
      step: 1,
      title: '',
      description: '',
      task_type: 'ONE_TIME',
      open_at: nowLocal,
      deadline_at: deadlineLocal,
      allow_late_submissions: true,
      allow_edit_submission: false,
      questions: [
        { key: 'Q1', label: 'Sample question text', type: 'short_text', required: true }
      ],
      campus_ids: state.user.authorizedCampusIds && state.user.authorizedCampusIds.length > 0 ? [state.user.authorizedCampusIds[0]] : [],
      audience_rules: {
        operator: 'AND',
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
            <input type="datetime-local" id="tb-open-at" class="form-input" value="${tb.open_at}" onchange="handleTaskOpenDateChange(this.value)" />
            <span style="font-size:0.75rem; color:var(--text-muted);">Future date sets status as <strong>Scheduled</strong>.</span>
          </div>
          <div class="form-group">
            <label>Submission Deadline <span class="text-danger">*</span></label>
            <input type="datetime-local" id="tb-deadline" class="form-input" value="${tb.deadline_at}" />
            <span style="font-size:0.75rem; color:var(--text-muted);">Defaults to 24 hours after start time.</span>
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

      const ar = tb.audience_rules || {};
      const currentOp = ar.operator || 'AND';

      return `
        <h3>Step 4: Target Audience Rules</h3>
        
        <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:16px; margin: 16px 0 24px;">
          <div style="font-weight:600; font-size:0.95rem; margin-bottom:6px; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
            <i class="fa-solid fa-code-fork" style="color:var(--primary);"></i> Audience Combination Operator
          </div>
          <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:12px;">
            If no filter options are checked below, <strong>all teachers</strong> from the selected campuses will be included. If multiple filter categories are checked, choose how they combine:
          </p>
          <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:center;">
            <label class="radio-label" style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-weight:500;">
              <input type="radio" name="tb_operator" value="AND" ${currentOp === 'AND' ? 'checked' : ''} />
              <span><strong>AND Logic</strong> (Recipient must match <em>ALL</em> selected active categories)</span>
            </label>
            <label class="radio-label" style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-weight:500;">
              <input type="radio" name="tb_operator" value="OR" ${currentOp === 'OR' ? 'checked' : ''} />
              <span><strong>OR Logic</strong> (Recipient matches if they satisfy <em>ANY</em> selected category)</span>
            </label>
          </div>
        </div>

        <div class="form-group">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <label style="margin:0;">Departments</label>
            <div style="font-size:0.8rem;">
              <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="toggleCheckboxGroup('tb_depts', true)">Select All</button>
              <span style="color:var(--text-muted);">|</span>
              <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="toggleCheckboxGroup('tb_depts', false)">Clear</button>
            </div>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:6px;">
            ${depts.map(d => `
              <label class="checkbox-label">
                <input type="checkbox" name="tb_depts" value="${d.id}" ${(ar.departments || []).includes(d.id) ? 'checked' : ''} />
                ${escapeHtml(d.name)}
              </label>
            `).join('')}
          </div>
        </div>

        <div class="form-group">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <label style="margin:0;">Designations</label>
            <div style="font-size:0.8rem;">
              <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="toggleCheckboxGroup('tb_desigs', true)">Select All</button>
              <span style="color:var(--text-muted);">|</span>
              <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="toggleCheckboxGroup('tb_desigs', false)">Clear</button>
            </div>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:6px;">
            ${desigs.map(d => `
              <label class="checkbox-label">
                <input type="checkbox" name="tb_desigs" value="${d.id}" ${(ar.designations || []).includes(d.id) ? 'checked' : ''} />
                ${escapeHtml(d.name)}
              </label>
            `).join('')}
          </div>
        </div>

        <div class="form-group">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <label style="margin:0;">Subjects</label>
            <div style="font-size:0.8rem;">
              <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="toggleCheckboxGroup('tb_subjs', true)">Select All</button>
              <span style="color:var(--text-muted);">|</span>
              <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="toggleCheckboxGroup('tb_subjs', false)">Clear</button>
            </div>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:6px;">
            ${subjs.map(s => `
              <label class="checkbox-label">
                <input type="checkbox" name="tb_subjs" value="${s.id}" ${(ar.subjects || []).includes(s.id) ? 'checked' : ''} />
                ${escapeHtml(s.name)}
              </label>
            `).join('')}
          </div>
        </div>

        ${cats && cats.length > 0 ? `
          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <label style="margin:0;">Categories</label>
              <div style="font-size:0.8rem;">
                <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="toggleCheckboxGroup('tb_cats', true)">Select All</button>
                <span style="color:var(--text-muted);">|</span>
                <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="toggleCheckboxGroup('tb_cats', false)">Clear</button>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:6px;">
              ${cats.map(c => `
                <label class="checkbox-label">
                  <input type="checkbox" name="tb_cats" value="${c.id}" ${(ar.categories || []).includes(c.id) ? 'checked' : ''} />
                  ${escapeHtml(c.name)}
                </label>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="form-group">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <label style="margin:0;">Faculty Groups</label>
            <div style="font-size:0.8rem;">
              <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="toggleCheckboxGroup('tb_groups', true)">Select All</button>
              <span style="color:var(--text-muted);">|</span>
              <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="toggleCheckboxGroup('tb_groups', false)">Clear</button>
            </div>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:6px;">
            ${groups.map(g => `
              <label class="checkbox-label">
                <input type="checkbox" name="tb_groups" value="${g.id}" ${(ar.groups || []).includes(g.id) ? 'checked' : ''} />
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
      tb.previewRecipients = previewRes.recipients || [];
      const totalRecipients = tb.previewRecipients.length;
      const activeCountStep5 = tb.previewRecipients.filter(r => !tb.recipient_exclusions.includes(r.id)).length;
      const isAllChecked = totalRecipients > 0 && activeCountStep5 === totalRecipients;
      const isIndeterminate = activeCountStep5 > 0 && activeCountStep5 < totalRecipients;

      return `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom: 16px;">
          <div>
            <h3 style="margin:0 0 6px 0;">Step 5: Dynamic Recipient Preview</h3>
            <span id="recipient-selection-badge" class="badge badge-in-progress">${activeCountStep5} of ${totalRecipients} Teachers Selected</span>
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn btn-outline btn-sm" onclick="toggleAllRecipients(true)" style="display:inline-flex; align-items:center; gap:6px;">
              <i class="fa-solid fa-check-double"></i> Select All
            </button>
            <button type="button" class="btn btn-outline btn-sm" onclick="toggleAllRecipients(false)" style="display:inline-flex; align-items:center; gap:6px;">
              <i class="fa-solid fa-square-xmark"></i> Deselect All
            </button>
          </div>
        </div>
        <p style="color:var(--text-muted); font-size:0.88rem; margin-bottom: 16px;">
          All matching teachers are selected by default. Use the master checkbox or click individual checkboxes to include or exclude teachers from this task.
        </p>

        <div class="table-responsive" style="max-height: 350px; overflow-y: auto;">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 44px; text-align:center;">
                  <input type="checkbox" id="select-all-recipients" ${isAllChecked ? 'checked' : ''} ${isIndeterminate ? 'data-indeterminate="true"' : ''} onchange="toggleAllRecipients(this.checked)" title="Select / Deselect All" style="cursor:pointer; width:16px; height:16px;" />
                </th>
                <th>Teacher Name</th>
                <th>Email</th>
                <th>Campus</th>
                <th>Class Teacher</th>
              </tr>
            </thead>
            <tbody>
              ${tb.previewRecipients.map(r => {
                const isExcluded = tb.recipient_exclusions.includes(r.id);
                return `
                <tr>
                  <td style="text-align:center;">
                    <input type="checkbox" class="recipient-toggle" data-user-id="${r.id}" value="${r.id}" ${!isExcluded ? 'checked' : ''} onchange="toggleRecipientExclusion('${r.id}', this.checked)" style="cursor:pointer; width:16px; height:16px;" />
                  </td>
                  <td><strong>${escapeHtml(r.display_name)}</strong></td>
                  <td>${escapeHtml(r.email)}</td>
                  <td>${escapeHtml(r.campus_name)}</td>
                  <td>${r.class_teacher_status ? '<span class="badge badge-active">Yes</span>' : '<span class="badge badge-not-started">No</span>'}</td>
                </tr>
              `;
              }).join('')}
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
  const op = document.querySelector('input[name="tb_operator"]:checked')?.value || 'AND';
  state.taskBuilder.audience_rules.operator = op;
  state.taskBuilder.audience_rules.departments = Array.from(document.querySelectorAll('input[name="tb_depts"]:checked')).map(el => el.value);
  state.taskBuilder.audience_rules.designations = Array.from(document.querySelectorAll('input[name="tb_desigs"]:checked')).map(el => el.value);
  state.taskBuilder.audience_rules.subjects = Array.from(document.querySelectorAll('input[name="tb_subjs"]:checked')).map(el => el.value);
  state.taskBuilder.audience_rules.categories = Array.from(document.querySelectorAll('input[name="tb_cats"]:checked')).map(el => el.value);
  state.taskBuilder.audience_rules.groups = Array.from(document.querySelectorAll('input[name="tb_groups"]:checked')).map(el => el.value);

  const ct = document.getElementById('tb-class-teacher').value;
  state.taskBuilder.audience_rules.class_teacher_status = ct === '' ? null : (ct === 'true');

  state.taskBuilder.step = 5;
  loadCurrentView();
}

function toggleCheckboxGroup(name, selectAll) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(cb => {
    cb.checked = selectAll;
  });
}
window.toggleCheckboxGroup = toggleCheckboxGroup;

function toggleRecipientExclusion(userId, isChecked) {
  const tb = state.taskBuilder;
  if (!tb) return;
  if (!isChecked) {
    if (!tb.recipient_exclusions.includes(userId)) tb.recipient_exclusions.push(userId);
  } else {
    tb.recipient_exclusions = tb.recipient_exclusions.filter(id => id !== userId);
  }
  updateRecipientPreviewState();
}

function toggleAllRecipients(isChecked) {
  const tb = state.taskBuilder;
  if (!tb || !tb.previewRecipients) return;
  if (isChecked) {
    tb.recipient_exclusions = [];
    document.querySelectorAll('.recipient-toggle').forEach(el => el.checked = true);
    const master = document.getElementById('select-all-recipients');
    if (master) { master.checked = true; master.indeterminate = false; }
  } else {
    tb.recipient_exclusions = tb.previewRecipients.map(r => r.id);
    document.querySelectorAll('.recipient-toggle').forEach(el => el.checked = false);
    const master = document.getElementById('select-all-recipients');
    if (master) { master.checked = false; master.indeterminate = false; }
  }
  updateRecipientPreviewState();
}

function updateRecipientPreviewState() {
  const tb = state.taskBuilder;
  if (!tb || !tb.previewRecipients) return;
  const total = tb.previewRecipients.length;
  const active = tb.previewRecipients.filter(r => !tb.recipient_exclusions.includes(r.id)).length;
  const badge = document.getElementById('recipient-selection-badge');
  if (badge) {
    badge.textContent = `${active} of ${total} Teachers Selected`;
  }
  const master = document.getElementById('select-all-recipients');
  if (master) {
    if (active === 0) {
      master.checked = false;
      master.indeterminate = false;
    } else if (active === total) {
      master.checked = true;
      master.indeterminate = false;
    } else {
      master.checked = false;
      master.indeterminate = true;
    }
  }
}

function handleTaskOpenDateChange(val) {
  if (!val || !state.taskBuilder) return;
  state.taskBuilder.open_at = val;
  const deadlineInput = document.getElementById('tb-deadline');
  if (deadlineInput) {
    const openDate = new Date(val);
    if (!isNaN(openDate.getTime())) {
      const defaultOffset = (state.settings && parseInt(state.settings.default_deadline_offset_hours, 10)) || 24;
      const newDeadline = getLocalDateTimeLocalString(openDate, defaultOffset);
      deadlineInput.value = newDeadline;
      state.taskBuilder.deadline_at = newDeadline;
    }
  }
}

window.handleTaskOpenDateChange = handleTaskOpenDateChange;

window.toggleAllRecipients = toggleAllRecipients;
window.toggleRecipientExclusion = toggleRecipientExclusion;
window.updateRecipientPreviewState = updateRecipientPreviewState;

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
  state.filters.tpCampusId = state.filters.tpCampusId || '';
  state.filters.tpSearch = state.filters.tpSearch || '';
  state.filters.tpSortBy = state.filters.tpSortBy || 'name_asc';
  state.filters.tpStatus = state.filters.tpStatus || '';

  const [allTeachers, campuses] = await Promise.all([
    api('/users?user_type='),
    api('/campuses')
  ]);

  // 1. Filter Teachers by Campus
  let teachers = allTeachers;
  if (state.filters.tpCampusId) {
    teachers = teachers.filter(t => t.campus_id === state.filters.tpCampusId);
  }

  // 2. Filter Teachers by Search
  if (state.filters.tpSearch) {
    const q = state.filters.tpSearch.toLowerCase().trim();
    teachers = teachers.filter(t => 
      (t.display_name && t.display_name.toLowerCase().includes(q)) ||
      (t.email && t.email.toLowerCase().includes(q)) ||
      (t.employee_code && t.employee_code.toLowerCase().includes(q)) ||
      (t.campus_name && t.campus_name.toLowerCase().includes(q))
    );
  }

  // 3. Sort Teachers
  teachers.sort((a, b) => {
    if (state.filters.tpSortBy === 'name_desc') {
      return (b.display_name || '').localeCompare(a.display_name || '');
    }
    return (a.display_name || '').localeCompare(b.display_name || '');
  });

  const selectedTeacherId = (teachers.some(t => t.id === state.filters.teacherId) ? state.filters.teacherId : null) || (teachers[0] ? teachers[0].id : null);

  if (!selectedTeacherId) {
    container.innerHTML = `
      ${renderReportTabs('teacher-wise')}
      <div class="filter-sort-bar" style="margin-top:16px;">
        <div class="filter-sort-group">
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:0.85rem; font-weight:600; color:var(--text-muted);"><i class="fa-solid fa-building-columns"></i> Campus:</label>
            <select class="form-select form-select-sm" onchange="state.filters.tpCampusId = this.value; loadCurrentView();">
              <option value="">All Campuses</option>
              ${campuses.map(c => `<option value="${c.id}" ${state.filters.tpCampusId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div style="position:relative; display:flex; align-items:center;">
            <input type="text" class="form-input form-input-sm" style="padding-left:28px;" placeholder="Search faculty name, email..." value="${escapeHtml(state.filters.tpSearch)}" oninput="state.filters.tpSearch = this.value; debounceTeacherSearch();" />
            <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:10px; font-size:0.8rem; color:var(--text-muted); pointer-events:none;"></i>
          </div>
        </div>
        ${(state.filters.tpCampusId || state.filters.tpSearch) ? `
          <button class="btn btn-outline btn-sm" onclick="state.filters.tpCampusId = ''; state.filters.tpSearch = ''; loadCurrentView();">
            <i class="fa-solid fa-arrow-rotate-left"></i> Reset
          </button>
        ` : ''}
      </div>
      <div class="card" style="margin-top:16px;"><div class="card-body"><div class="empty-state"><h3>No faculty members match the selected filters</h3><p>Try resetting the campus or search query.</p></div></div></div>
    `;
    return;
  }

  const data = await api(`/reports/teacher-wise?teacher_id=${selectedTeacherId}`);
  const { teacher, stats, assignments: rawAssignments = [] } = data;

  // Filter historical assignments
  let assignments = rawAssignments;
  if (state.filters.tpStatus) {
    assignments = assignments.filter(a => a.status === state.filters.tpStatus);
  }

  container.innerHTML = `
    ${renderReportTabs('teacher-wise')}

    <!-- Teacher Performance Filter & Sort Bar -->
    <div class="filter-sort-bar" style="margin-top:16px;">
      <div class="filter-sort-group">
        <!-- Campus Filter -->
        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:0.85rem; font-weight:600; color:var(--text-muted);"><i class="fa-solid fa-building-columns"></i> Campus:</label>
          <select class="form-select form-select-sm" style="min-width:150px;" onchange="state.filters.tpCampusId = this.value; loadCurrentView();">
            <option value="">All Campuses</option>
            ${campuses.map(c => `<option value="${c.id}" ${state.filters.tpCampusId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>

        <!-- Faculty Search -->
        <div style="position:relative; display:flex; align-items:center;">
          <input type="text" class="form-input form-input-sm" style="padding-left:28px; width:200px;" placeholder="Search faculty..." value="${escapeHtml(state.filters.tpSearch)}" oninput="state.filters.tpSearch = this.value; debounceTeacherSearch();" />
          <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:10px; font-size:0.8rem; color:var(--text-muted); pointer-events:none;"></i>
        </div>

        <!-- Faculty Member Select -->
        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:0.85rem; font-weight:600; color:var(--text-muted);"><i class="fa-solid fa-chalkboard-user"></i> Faculty:</label>
          <select class="form-select form-select-sm" style="min-width:240px; font-weight:600;" onchange="state.filters.teacherId = this.value; loadCurrentView();">
            ${teachers.map(t => `<option value="${t.id}" ${t.id === selectedTeacherId ? 'selected' : ''}>${escapeHtml(t.display_name)} (${escapeHtml(t.campus_name || 'Campus')})</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="filter-sort-group">
        <!-- Sort Faculty -->
        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:0.85rem; font-weight:600; color:var(--text-muted);"><i class="fa-solid fa-arrow-down-a-z"></i> Sort:</label>
          <select class="form-select form-select-sm" onchange="state.filters.tpSortBy = this.value; loadCurrentView();">
            <option value="name_asc" ${state.filters.tpSortBy === 'name_asc' ? 'selected' : ''}>Faculty Name (A to Z)</option>
            <option value="name_desc" ${state.filters.tpSortBy === 'name_desc' ? 'selected' : ''}>Faculty Name (Z to A)</option>
          </select>
        </div>

        <!-- Assignment Status Filter -->
        <div style="display:flex; align-items:center; gap:6px;">
          <label style="font-size:0.85rem; font-weight:600; color:var(--text-muted);"><i class="fa-solid fa-filter"></i> Task Status:</label>
          <select class="form-select form-select-sm" onchange="state.filters.tpStatus = this.value; loadCurrentView();">
            <option value="">All Statuses</option>
            <option value="SUBMITTED_ON_TIME" ${state.filters.tpStatus === 'SUBMITTED_ON_TIME' ? 'selected' : ''}>Submitted On Time</option>
            <option value="SUBMITTED_LATE" ${state.filters.tpStatus === 'SUBMITTED_LATE' ? 'selected' : ''}>Submitted Late</option>
            <option value="OVERDUE" ${state.filters.tpStatus === 'OVERDUE' ? 'selected' : ''}>Overdue</option>
            <option value="IN_PROGRESS" ${state.filters.tpStatus === 'IN_PROGRESS' ? 'selected' : ''}>In Progress</option>
            <option value="NOT_STARTED" ${state.filters.tpStatus === 'NOT_STARTED' ? 'selected' : ''}>Not Started</option>
          </select>
        </div>

        ${(state.filters.tpCampusId || state.filters.tpSearch || state.filters.tpStatus || state.filters.tpSortBy !== 'name_asc') ? `
          <button class="btn btn-outline btn-sm" onclick="state.filters.tpCampusId = ''; state.filters.tpSearch = ''; state.filters.tpStatus = ''; state.filters.tpSortBy = 'name_asc'; loadCurrentView();" title="Reset Filters">
            <i class="fa-solid fa-arrow-rotate-left"></i> Reset
          </button>
        ` : ''}
      </div>
    </div>

    <!-- KPI Summary Grid -->
    <div class="kpi-grid" style="margin-top:16px;">
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
          <div class="kpi-label">On-Time Reliability</div>
        </div>
      </div>
    </div>

    <!-- Historical Assignments Table -->
    <div class="card" style="margin-top:20px;">
      <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="margin:0 0 2px 0;"><i class="fa-solid fa-clock-rotate-left"></i> Historical Assignments Log</h2>
          <span style="font-size:0.82rem; color:var(--text-muted);">Faculty: <strong>${escapeHtml(teacher.display_name)}</strong> &bull; Showing ${assignments.length} assignments</span>
        </div>
      </div>
      <div class="card-body" style="padding:0;">
        <div class="table-responsive">
          <table class="table" style="margin-bottom:0;">
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
              ${assignments.length === 0 ? `
                <tr><td colspan="6" class="empty-state" style="padding:30px;">No historical assignments match the status filter.</td></tr>
              ` : assignments.map(a => `
                <tr>
                  <td><strong>${escapeHtml(a.task_title)}</strong></td>
                  <td><span class="badge badge-secondary" style="font-size:0.75rem;">${escapeHtml(a.campus_name)}</span></td>
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

let teacherSearchDebounceTimer = null;
function debounceTeacherSearch() {
  clearTimeout(teacherSearchDebounceTimer);
  teacherSearchDebounceTimer = setTimeout(() => {
    loadCurrentView();
  }, 250);
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
                  <td>${u.campus_name ? escapeHtml(u.campus_name) : '<span class="text-muted">Unassigned</span>'}</td>
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
              <option value="">Select Primary Campus...</option>
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
            <option value="">Select Primary Campus...</option>
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

// Global state for Group Builder
window._groupBuilderState = {
  campuses: [],
  departments: [],
  designations: [],
  subjects: [],
  categories: [],
  selectedCampusIds: [],
  audienceRules: {
    departments: [],
    designations: [],
    subjects: [],
    categories: [],
    class_teacher_status: null,
    operator: 'AND'
  },
  searchQuery: '',
  teachers: [],
  selectedMembers: new Map() // userId -> role ('MEMBER' | 'GROUP_ADMIN')
};

async function openCreateGroupModal() {
  const [campuses, depts, desigs, subjs, cats] = await Promise.all([
    api('/campuses'),
    api('/masters?master_type=DEPARTMENT'),
    api('/masters?master_type=DESIGNATION'),
    api('/masters?master_type=SUBJECT'),
    api('/masters?master_type=CATEGORY')
  ]);

  const activeCampuses = (campuses || []).filter(c => c.status === 'ACTIVE');
  const initialCampusIds = activeCampuses.map(c => c.id);

  window._groupBuilderState = {
    campuses: activeCampuses,
    departments: depts || [],
    designations: desigs || [],
    subjects: subjs || [],
    categories: cats || [],
    selectedCampusIds: initialCampusIds,
    audienceRules: {
      departments: [],
      designations: [],
      subjects: [],
      categories: [],
      class_teacher_status: null,
      operator: 'AND'
    },
    searchQuery: '',
    teachers: [],
    selectedMembers: new Map()
  };

  const html = `
    <div class="card-header">
      <div>
        <h3><i class="fa-solid fa-users-rectangle text-primary"></i> Create Faculty Group</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">Target multiple campuses, filter by department/designation/subjects, and assign members</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body" style="max-height: 80vh; overflow-y: auto;">
      <form id="form-create-group" onsubmit="handleCreateGroupWithFilters(event)">
        
        <!-- Step 1: Basic Information -->
        <div style="background:var(--border-subtle); padding:16px; border-radius:var(--radius-md); margin-bottom:18px;">
          <h4 style="margin:0 0 12px; font-size:0.95rem; color:var(--text-primary);"><i class="fa-solid fa-info-circle text-primary"></i> 1. Group Details</h4>
          <div class="form-group" style="margin-bottom:12px;">
            <label>Group Name <span class="text-danger">*</span></label>
            <input type="text" name="name" class="form-input" required placeholder="e.g. Senior Secondary Science Faculty Forum" />
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label>Description</label>
            <textarea name="description" class="form-textarea" rows="2" placeholder="State the purpose, scope, or collaboration goals of this group..."></textarea>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="checkbox-label">
              <input type="checkbox" name="allow_join_requests" value="true" checked />
              Allow teachers from selected campuses to discover and request to join this group
            </label>
          </div>
        </div>

        <!-- Step 2: Target Campuses Multi-Selection -->
        <div style="border:1px solid var(--border-color); padding:16px; border-radius:var(--radius-md); margin-bottom:18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <h4 style="margin:0; font-size:0.95rem; color:var(--text-primary);"><i class="fa-solid fa-school text-primary"></i> 2. Target Campuses <span class="text-danger">*</span></h4>
            <div style="font-size:0.8rem;">
              <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="toggleGbCheckboxGroup('gb_campuses', true)">Select All</button>
              <span style="color:var(--text-muted);">|</span>
              <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="toggleGbCheckboxGroup('gb_campuses', false)">Clear</button>
            </div>
          </div>
          <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:10px;">
            Select one or more campuses associated with this group. Teachers from any of the selected campuses can be added or request membership.
          </p>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:8px;">
            ${activeCampuses.map(c => `
              <label class="checkbox-label" style="background:var(--bg-surface); padding:8px 12px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                <input type="checkbox" name="gb_campuses" value="${c.id}" checked onchange="handleGbAudienceChange()" />
                <strong>${escapeHtml(c.name)}</strong>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Step 3: Audience Filter Rules Multi-Selection (like Task Builder) -->
        <div style="border:1px solid var(--border-color); padding:16px; border-radius:var(--radius-md); margin-bottom:18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h4 style="margin:0; font-size:0.95rem; color:var(--text-primary);"><i class="fa-solid fa-filter text-primary"></i> 3. Target Audience Criteria Filters</h4>
            <button type="button" class="btn btn-secondary btn-sm" onclick="resetGbAudienceFilters()">
              <i class="fa-solid fa-rotate-left"></i> Reset All Filters
            </button>
          </div>
          
          <!-- Combination Operator -->
          <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:14px; display:flex; flex-wrap:wrap; gap:16px; align-items:center;">
            <span style="font-size:0.85rem; font-weight:600; color:var(--text-primary);"><i class="fa-solid fa-code-fork text-primary"></i> Criteria Operator:</span>
            <label class="radio-label" style="display:inline-flex; align-items:center; gap:6px; font-size:0.85rem; cursor:pointer;">
              <input type="radio" name="gb_operator" value="AND" checked onchange="handleGbAudienceChange()" />
              <span><strong>AND Logic</strong> (Matches all selected categories)</span>
            </label>
            <label class="radio-label" style="display:inline-flex; align-items:center; gap:6px; font-size:0.85rem; cursor:pointer;">
              <input type="radio" name="gb_operator" value="OR" onchange="handleGbAudienceChange()" />
              <span><strong>OR Logic</strong> (Matches any selected category)</span>
            </label>
          </div>

          <!-- Departments Multi-select -->
          <div class="form-group" style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <label style="margin:0; font-size:0.85rem; font-weight:600;">Departments</label>
              <div style="font-size:0.8rem;">
                <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="toggleGbCheckboxGroup('gb_depts', true)">Select All</button>
                <span style="color:var(--text-muted);">|</span>
                <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="toggleGbCheckboxGroup('gb_depts', false)">Clear</button>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:6px; max-height:130px; overflow-y:auto; background:var(--bg-surface); padding:8px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
              ${depts.map(d => `
                <label class="checkbox-label" style="font-size:0.82rem;">
                  <input type="checkbox" name="gb_depts" value="${d.id}" onchange="handleGbAudienceChange()" />
                  ${escapeHtml(d.name)}
                </label>
              `).join('')}
            </div>
          </div>

          <!-- Designations Multi-select -->
          <div class="form-group" style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <label style="margin:0; font-size:0.85rem; font-weight:600;">Designations</label>
              <div style="font-size:0.8rem;">
                <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="toggleGbCheckboxGroup('gb_desigs', true)">Select All</button>
                <span style="color:var(--text-muted);">|</span>
                <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="toggleGbCheckboxGroup('gb_desigs', false)">Clear</button>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:6px; max-height:130px; overflow-y:auto; background:var(--bg-surface); padding:8px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
              ${desigs.map(d => `
                <label class="checkbox-label" style="font-size:0.82rem;">
                  <input type="checkbox" name="gb_desigs" value="${d.id}" onchange="handleGbAudienceChange()" />
                  ${escapeHtml(d.name)}
                </label>
              `).join('')}
            </div>
          </div>

          <!-- Subjects Multi-select -->
          <div class="form-group" style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <label style="margin:0; font-size:0.85rem; font-weight:600;">Subjects</label>
              <div style="font-size:0.8rem;">
                <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="toggleGbCheckboxGroup('gb_subjs', true)">Select All</button>
                <span style="color:var(--text-muted);">|</span>
                <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="toggleGbCheckboxGroup('gb_subjs', false)">Clear</button>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:6px; max-height:130px; overflow-y:auto; background:var(--bg-surface); padding:8px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
              ${subjs.map(s => `
                <label class="checkbox-label" style="font-size:0.82rem;">
                  <input type="checkbox" name="gb_subjs" value="${s.id}" onchange="handleGbAudienceChange()" />
                  ${escapeHtml(s.name)}
                </label>
              `).join('')}
            </div>
          </div>

          <!-- Categories Multi-select -->
          ${cats.length > 0 ? `
            <div class="form-group" style="margin-bottom:14px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <label style="margin:0; font-size:0.85rem; font-weight:600;">Categories</label>
                <div style="font-size:0.8rem;">
                  <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="toggleGbCheckboxGroup('gb_cats', true)">Select All</button>
                  <span style="color:var(--text-muted);">|</span>
                  <button type="button" class="btn-link" style="padding:0 4px; font-size:0.8rem; background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="toggleGbCheckboxGroup('gb_cats', false)">Clear</button>
                </div>
              </div>
              <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:6px; max-height:130px; overflow-y:auto; background:var(--bg-surface); padding:8px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                ${cats.map(c => `
                  <label class="checkbox-label" style="font-size:0.82rem;">
                    <input type="checkbox" name="gb_cats" value="${c.id}" onchange="handleGbAudienceChange()" />
                    ${escapeHtml(c.name)}
                  </label>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Class Teacher Status Multi-select -->
          <div class="form-group" style="margin-bottom:0;">
            <label style="font-size:0.85rem; font-weight:600; margin-bottom:6px; display:block;">Class Teacher Status</label>
            <div style="display:flex; flex-wrap:wrap; gap:16px;">
              <label class="checkbox-label" style="font-size:0.82rem;">
                <input type="checkbox" id="gb_ct_yes" value="true" onchange="handleGbAudienceChange()" />
                Class Teachers Only
              </label>
              <label class="checkbox-label" style="font-size:0.82rem;">
                <input type="checkbox" id="gb_ct_no" value="false" onchange="handleGbAudienceChange()" />
                Non-Class Teachers Only
              </label>
            </div>
          </div>
        </div>

        <!-- Step 4: Candidate Teachers Selection Roster -->
        <div style="border:1px solid var(--border-color); padding:16px; border-radius:var(--radius-md);">
          <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px;">
            <h4 style="margin:0; font-size:0.95rem; color:var(--text-primary);"><i class="fa-solid fa-users text-primary"></i> 4. Assign Initial Group Members</h4>
            <div id="gb-counts-badge" style="font-size:0.85rem; font-weight:600; color:var(--primary);">
              Loading candidate teachers...
            </div>
          </div>

          <!-- Toolbar: Search & Bulk Controls -->
          <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:12px; background:var(--bg-surface); padding:8px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
            <div class="search-input-wrapper" style="flex:1; min-width:200px;">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input type="text" id="gb-search-input" class="form-input form-input-sm" placeholder="Search teacher by name, email, or employee code..." oninput="handleGroupBuilderSearch(this.value)" />
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="toggleAllGroupBuilderTeachers(true)">
                <i class="fa-solid fa-check-double"></i> Select All Filtered
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="toggleAllGroupBuilderTeachers(false)">
                <i class="fa-solid fa-square-minus"></i> Deselect Filtered
              </button>
            </div>
          </div>

          <!-- Teachers Roster Container -->
          <div id="gb-teachers-table-container" style="max-height: 280px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-sm);">
            <div style="text-align:center; padding:24px; color:var(--text-muted);">
              <i class="fa-solid fa-spinner fa-spin"></i> Loading campus teachers...
            </div>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; border-top:1px solid var(--border-color); padding-top:16px;">
          <span id="gb-footer-selected-count" style="font-size:0.85rem; color:var(--text-muted);">
            0 members selected
          </span>
          <div style="display:flex; gap:12px;">
            <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">
              <i class="fa-solid fa-plus-circle"></i> Create Faculty Group
            </button>
          </div>
        </div>
      </form>
    </div>
  `;
  openModal(html);

  // Initial load of teachers
  await fetchAndRenderGroupBuilderTeachers();
}

function toggleGbCheckboxGroup(name, check) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(cb => {
    cb.checked = check;
  });
  handleGbAudienceChange();
}

function resetGbAudienceFilters() {
  ['gb_depts', 'gb_desigs', 'gb_subjs', 'gb_cats'].forEach(name => {
    document.querySelectorAll(`input[name="${name}"]`).forEach(cb => { cb.checked = false; });
  });
  if (document.getElementById('gb_ct_yes')) document.getElementById('gb_ct_yes').checked = false;
  if (document.getElementById('gb_ct_no')) document.getElementById('gb_ct_no').checked = false;
  if (document.getElementById('gb-search-input')) document.getElementById('gb-search-input').value = '';

  handleGbAudienceChange();
}

async function handleGbAudienceChange() {
  const selectedCampuses = Array.from(document.querySelectorAll('input[name="gb_campuses"]:checked')).map(cb => cb.value);
  const depts = Array.from(document.querySelectorAll('input[name="gb_depts"]:checked')).map(cb => cb.value);
  const desigs = Array.from(document.querySelectorAll('input[name="gb_desigs"]:checked')).map(cb => cb.value);
  const subjs = Array.from(document.querySelectorAll('input[name="gb_subjs"]:checked')).map(cb => cb.value);
  const cats = Array.from(document.querySelectorAll('input[name="gb_cats"]:checked')).map(cb => cb.value);
  const operator = document.querySelector('input[name="gb_operator"]:checked')?.value || 'AND';

  const ctYes = document.getElementById('gb_ct_yes')?.checked;
  const ctNo = document.getElementById('gb_ct_no')?.checked;
  let class_teacher_status = null;
  if (ctYes && !ctNo) class_teacher_status = true;
  else if (!ctYes && ctNo) class_teacher_status = false;

  window._groupBuilderState.selectedCampusIds = selectedCampuses;
  window._groupBuilderState.audienceRules = {
    departments: depts,
    designations: desigs,
    subjects: subjs,
    categories: cats,
    class_teacher_status,
    operator
  };

  await fetchAndRenderGroupBuilderTeachers();
}

async function fetchAndRenderGroupBuilderTeachers() {
  const campusIds = window._groupBuilderState.selectedCampusIds;
  const container = document.getElementById('gb-teachers-table-container');
  const countsBadge = document.getElementById('gb-counts-badge');

  if (!campusIds || campusIds.length === 0) {
    if (container) {
      container.innerHTML = `<div class="empty-state" style="padding:20px; color:var(--warning);"><i class="fa-solid fa-triangle-exclamation"></i> Please select at least one campus above to see candidate teachers.</div>`;
    }
    if (countsBadge) countsBadge.innerHTML = '0 campuses selected';
    return;
  }

  try {
    const res = await api('/tasks/preview-recipients', {
      method: 'POST',
      body: {
        campus_ids: campusIds,
        audience_rules: window._groupBuilderState.audienceRules
      }
    });

    window._groupBuilderState.teachers = (res.recipients || []).map(r => ({
      id: r.id,
      display_name: r.display_name,
      email: r.email,
      employee_code: r.employee_code,
      campus_name: r.campus_name,
      department_name: r.department_name,
      designation_name: r.designation_name
    }));

    renderGroupBuilderTeachersTable();
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="empty-state" style="padding:20px; color:var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Could not load candidate teachers: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function handleGroupBuilderSearch(query) {
  window._groupBuilderState.searchQuery = (query || '').toLowerCase().trim();
  renderGroupBuilderTeachersTable();
}

function renderGroupBuilderTeachersTable() {
  const container = document.getElementById('gb-teachers-table-container');
  const countsBadge = document.getElementById('gb-counts-badge');
  const footerCount = document.getElementById('gb-footer-selected-count');
  if (!container) return;

  const query = window._groupBuilderState.searchQuery;
  const allTeachers = window._groupBuilderState.teachers || [];
  const selectedMap = window._groupBuilderState.selectedMembers;

  const filtered = allTeachers.filter(t => {
    if (!query) return true;
    const searchString = `${t.display_name} ${t.email} ${t.employee_code || ''} ${t.campus_name || ''} ${t.department_name || ''} ${t.designation_name || ''}`.toLowerCase();
    return searchString.includes(query);
  });

  if (countsBadge) {
    countsBadge.innerHTML = `Showing ${filtered.length} of ${allTeachers.length} teachers (${selectedMap.size} selected)`;
  }
  if (footerCount) {
    footerCount.innerHTML = `<strong>${selectedMap.size}</strong> group members selected`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px;">
        <i class="fa-solid fa-user-slash" style="font-size:1.8rem; color:var(--text-muted); margin-bottom:6px;"></i>
        <p>No campus teachers match the current filters and search criteria.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table class="table table-sm" style="margin:0;">
      <thead style="position:sticky; top:0; background:var(--bg-surface); z-index:2;">
        <tr>
          <th style="width:40px; text-align:center;">Add?</th>
          <th>Teacher</th>
          <th>Emp Code</th>
          <th>Campus / Dept / Designation</th>
          <th style="width:140px;">Group Role</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(t => {
          const isSelected = selectedMap.has(t.id);
          const currentRole = selectedMap.get(t.id) || 'MEMBER';
          return `
            <tr>
              <td style="text-align:center;">
                <input type="checkbox" class="gb-teacher-cb" value="${t.id}" ${isSelected ? 'checked' : ''} onchange="toggleGroupBuilderTeacher('${t.id}', this.checked)" />
              </td>
              <td>
                <strong>${escapeHtml(t.display_name)}</strong>
                <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(t.email)}</div>
              </td>
              <td><code>${escapeHtml(t.employee_code || '—')}</code></td>
              <td>
                <span class="badge badge-in-progress" style="font-size:0.72rem; margin-right:4px;">${escapeHtml(t.campus_name || 'Campus')}</span>
                <span style="font-size:0.8rem; color:var(--text-primary);">${escapeHtml(t.department_name || 'General')}</span>
                ${t.designation_name ? `<div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(t.designation_name)}</div>` : ''}
              </td>
              <td>
                <select class="form-select form-select-sm" style="font-size:0.8rem;" onchange="setGroupBuilderTeacherRole('${t.id}', this.value)" ${!isSelected ? 'disabled' : ''} id="gb-role-${t.id}">
                  <option value="MEMBER" ${currentRole === 'MEMBER' ? 'selected' : ''}>Member</option>
                  <option value="GROUP_ADMIN" ${currentRole === 'GROUP_ADMIN' ? 'selected' : ''}>Group Admin</option>
                </select>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function toggleGroupBuilderTeacher(userId, checked) {
  const roleSelect = document.getElementById(`gb-role-${userId}`);
  if (checked) {
    const role = roleSelect ? roleSelect.value : 'MEMBER';
    window._groupBuilderState.selectedMembers.set(userId, role);
    if (roleSelect) roleSelect.disabled = false;
  } else {
    window._groupBuilderState.selectedMembers.delete(userId);
    if (roleSelect) roleSelect.disabled = true;
  }
  const footerCount = document.getElementById('gb-footer-selected-count');
  const countsBadge = document.getElementById('gb-counts-badge');
  const selectedSize = window._groupBuilderState.selectedMembers.size;
  if (footerCount) footerCount.innerHTML = `<strong>${selectedSize}</strong> group members selected`;
  if (countsBadge) {
    countsBadge.innerHTML = `Showing ${window._groupBuilderState.teachers.length} teachers (${selectedSize} selected)`;
  }
}

function setGroupBuilderTeacherRole(userId, role) {
  if (window._groupBuilderState.selectedMembers.has(userId)) {
    window._groupBuilderState.selectedMembers.set(userId, role);
  }
}

function toggleAllGroupBuilderTeachers(check) {
  const query = window._groupBuilderState.searchQuery;
  const allTeachers = window._groupBuilderState.teachers || [];
  const filtered = allTeachers.filter(t => {
    if (!query) return true;
    const searchString = `${t.display_name} ${t.email} ${t.employee_code || ''} ${t.campus_name || ''} ${t.department_name || ''} ${t.designation_name || ''}`.toLowerCase();
    return searchString.includes(query);
  });

  filtered.forEach(t => {
    if (check) {
      if (!window._groupBuilderState.selectedMembers.has(t.id)) {
        window._groupBuilderState.selectedMembers.set(t.id, 'MEMBER');
      }
    } else {
      window._groupBuilderState.selectedMembers.delete(t.id);
    }
  });

  renderGroupBuilderTeachersTable();
}

async function handleCreateGroupWithFilters(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const name = (formData.get('name') || '').trim();
  const description = (formData.get('description') || '').trim();
  const campus_ids = Array.from(document.querySelectorAll('input[name="gb_campuses"]:checked')).map(cb => cb.value);
  const allow_join_requests = formData.get('allow_join_requests') === 'true';

  if (!name || campus_ids.length === 0) {
    return showToast('Group name and at least one campus are required', 'warning');
  }

  const member_ids = Array.from(window._groupBuilderState.selectedMembers.entries()).map(([userId, role]) => ({
    userId,
    role
  }));

  try {
    await api('/groups', {
      method: 'POST',
      body: {
        name,
        description,
        campus_ids,
        campus_id: campus_ids[0],
        allow_join_requests,
        member_ids
      }
    });
    showToast(`Faculty Group "${name}" created successfully with ${member_ids.length} members across ${campus_ids.length} campuses!`, 'success');
    closeModal();
    loadCurrentView();
  } catch (err) {
    // Handled in api wrapper
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

// Global state for Manage Group Members Modal
window._manageGroupState = {
  groupId: '',
  group: null,
  teachers: [],
  filterTab: 'ALL', // 'ALL', 'MEMBERS', 'NON_MEMBERS', 'PENDING'
  searchQuery: ''
};

// Manage Managed Campus Teachers Group Members
async function openManageGroupMembersModal(groupId) {
  const data = await api(`/groups/${groupId}/members`);
  const { group, teachers } = data;

  window._manageGroupState = {
    groupId,
    group,
    teachers: teachers || [],
    filterTab: 'ALL',
    searchQuery: ''
  };

  const html = `
    <div class="card-header">
      <div>
        <h3>Manage Group Members: ${escapeHtml(group.name)}</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">
          Campus Teachers Directory (${escapeHtml(group.campus_name || 'Assigned Campus')}) • <strong id="mg-active-count">${teachers.filter(t => t.is_member).length} Active Members</strong>
        </span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      
      <!-- Filter Tabs & Search Toolbar -->
      <div style="background:var(--border-subtle); padding:12px; border-radius:var(--radius-md); margin-bottom:16px;">
        <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-sm btn-primary mg-tab-btn" data-tab="ALL" onclick="setManageGroupTab('ALL')">All Teachers (${teachers.length})</button>
            <button type="button" class="btn btn-sm btn-secondary mg-tab-btn" data-tab="MEMBERS" onclick="setManageGroupTab('MEMBERS')">Active Members (${teachers.filter(t => t.is_member).length})</button>
            <button type="button" class="btn btn-sm btn-secondary mg-tab-btn" data-tab="NON_MEMBERS" onclick="setManageGroupTab('NON_MEMBERS')">Non-Members (${teachers.filter(t => !t.is_member && t.status !== 'PENDING').length})</button>
            <button type="button" class="btn btn-sm btn-secondary mg-tab-btn" data-tab="PENDING" onclick="setManageGroupTab('PENDING')">Pending Requests (${teachers.filter(t => t.status === 'PENDING').length})</button>
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="toggleAllManageGroupMembers(true)">
              <i class="fa-solid fa-check-double"></i> Select Filtered
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="toggleAllManageGroupMembers(false)">
              <i class="fa-solid fa-square-minus"></i> Deselect Filtered
            </button>
          </div>
        </div>

        <div class="search-input-wrapper">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="mg-search-input" class="form-input form-input-sm" placeholder="Search teacher by name, email, or employee code..." oninput="handleManageGroupSearch(this.value)" />
        </div>
      </div>

      <!-- Campus Teachers Table -->
      <form id="form-group-members" onsubmit="handleSaveGroupMembers(event, '${groupId}')">
        <div class="table-responsive" style="max-height: 380px; overflow-y:auto; border:1px solid var(--border-color); border-radius:var(--radius-sm);" id="mg-table-container">
          <!-- Populated by renderManageGroupTable -->
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; border-top:1px solid var(--border-color); padding-top:16px;">
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
  renderManageGroupTable();
}

function setManageGroupTab(tab) {
  window._manageGroupState.filterTab = tab;
  document.querySelectorAll('.mg-tab-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tab) {
      btn.className = 'btn btn-sm btn-primary mg-tab-btn';
    } else {
      btn.className = 'btn btn-sm btn-secondary mg-tab-btn';
    }
  });
  renderManageGroupTable();
}

function handleManageGroupSearch(query) {
  window._manageGroupState.searchQuery = (query || '').toLowerCase().trim();
  renderManageGroupTable();
}

function renderManageGroupTable() {
  const container = document.getElementById('mg-table-container');
  if (!container) return;

  const { teachers, filterTab, searchQuery } = window._manageGroupState;

  const filtered = teachers.filter(t => {
    // Tab filter
    if (filterTab === 'MEMBERS' && !t.is_member) return false;
    if (filterTab === 'NON_MEMBERS' && (t.is_member || t.status === 'PENDING')) return false;
    if (filterTab === 'PENDING' && t.status !== 'PENDING') return false;

    // Search query
    if (searchQuery) {
      const s = `${t.display_name} ${t.email} ${t.employee_code || ''}`.toLowerCase();
      if (!s.includes(searchQuery)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px;">
        <i class="fa-solid fa-users-slash" style="font-size:1.8rem; color:var(--text-muted); margin-bottom:6px;"></i>
        <p>No teachers match the current search or tab filter.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
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
        ${filtered.map(t => `
          <tr class="group-member-row" data-user-id="${t.id}">
            <td style="text-align:center;">
              <input type="checkbox" class="group-member-checkbox" data-user-id="${t.id}" ${t.is_member ? 'checked' : ''} onchange="handleMemberCheckboxChange('${t.id}', this.checked)" />
            </td>
            <td>
              <strong>${escapeHtml(t.display_name)}</strong>
              <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(t.email)}</div>
            </td>
            <td><code>${escapeHtml(t.employee_code || 'N/A')}</code></td>
            <td>
              <select class="form-select form-select-sm group-member-role" data-user-id="${t.id}" style="width: 140px;" onchange="handleMemberRoleChange('${t.id}', this.value)">
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
  `;
}

function handleMemberCheckboxChange(userId, checked) {
  const teacher = window._manageGroupState.teachers.find(t => t.id === userId);
  if (teacher) {
    teacher.is_member = checked;
    if (checked && !teacher.membership_role) teacher.membership_role = 'MEMBER';
  }
}

function handleMemberRoleChange(userId, role) {
  const teacher = window._manageGroupState.teachers.find(t => t.id === userId);
  if (teacher) {
    teacher.membership_role = role;
  }
}

function toggleAllManageGroupMembers(check) {
  const checkboxes = document.querySelectorAll('.group-member-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = check;
    const userId = cb.getAttribute('data-user-id');
    handleMemberCheckboxChange(userId, check);
  });
}

async function handleSaveGroupMembers(event, groupId) {
  event.preventDefault();
  const members = (window._manageGroupState.teachers || [])
    .filter(t => t.is_member)
    .map(t => ({
      user_id: t.id,
      membership_role: t.membership_role || 'MEMBER'
    }));

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
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; flex-wrap:wrap; gap:12px;">
      <h2><i class="fa-solid fa-layer-group"></i> Master Data Management</h2>
      <div style="display:flex; gap:10px;">
        ${hasPermission('masters.create') ? `
          <button class="btn btn-secondary" onclick="openBulkMasterModal('${currentTab}')">
            <i class="fa-solid fa-bolt text-warning"></i> Bulk Add ${currentTab}s
          </button>
          <button class="btn btn-primary" onclick="openCreateMasterModal('${currentTab}')">
            <i class="fa-solid fa-plus"></i> Add Single ${currentTab}
          </button>
        ` : ''}
      </div>
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
              ${masters.length === 0 ? `
                <tr><td colspan="6" class="empty-state">No ${currentTab.toLowerCase()} entries found. Use "Add Single" or "Bulk Add" above.</td></tr>
              ` : masters.map(m => `
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

async function openBulkMasterModal(masterType) {
  const campuses = await api('/campuses');

  const html = `
    <div class="card-header">
      <div>
        <h3><i class="fa-solid fa-bolt text-warning"></i> Bulk Add ${masterType}s</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">Paste or type multiple entries at once</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-bulk-master" onsubmit="handleBulkMasters(event, '${masterType}')">
        <div class="form-group">
          <label>Campus Scope</label>
          <select name="campus_id" class="form-select">
            <option value="">Global (All Campuses)</option>
            ${campuses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label>Entries (One per line, format: <code>Name</code> or <code>Name, Code</code>) <span class="text-danger">*</span></label>
          <textarea name="text" class="form-textarea" rows="8" required placeholder="English&#10;Mathematics, DEP_MATH&#10;Physics, SUB_PHY&#10;Chemistry, SUB_CHEM&#10;Senior Secondary Wing, CAT_SNR"></textarea>
          <span style="font-size:0.75rem; color:var(--text-muted);">Codes and sequential sort orders will be automatically generated if omitted.</span>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i class="fa-solid fa-plus-circle"></i> Bulk Insert Items
          </button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

async function handleBulkMasters(event, masterType) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const text = formData.get('text');
  const campus_id = formData.get('campus_id') || null;

  try {
    const res = await api('/masters/bulk', {
      method: 'POST',
      body: { master_type: masterType, campus_id, text }
    });
    showToast(`Successfully bulk added ${res.count} ${masterType.toLowerCase()}s!`, 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Handled in api
  }
}

async function openCreateMasterModal(masterType) {
  const campuses = await api('/campuses');

  const html = `
    <div class="card-header">
      <h3>Add Single ${masterType} Master</h3>
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

// ============================================================================
// CAMPUSES MANAGEMENT VIEW & MODALS
// ============================================================================

async function renderCampusesView(container) {
  const campuses = await api('/campuses?include_inactive=true');
  const isSuperAdmin = state.user.isSuperAdmin || state.user.user_type === 'SUPER_ADMIN';

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2><i class="fa-solid fa-building-columns"></i> Campus Management</h2>
        <p style="color:var(--text-muted); font-size:0.88rem; margin:4px 0 0 0;">Create, organize, and manage physical institutional campuses and learning wings.</p>
      </div>
      ${isSuperAdmin ? `
        <div style="display:flex; gap:10px;">
          <button class="btn btn-secondary" onclick="openBulkCampusesModal()">
            <i class="fa-solid fa-bolt text-warning"></i> Bulk Add Campuses
          </button>
          <button class="btn btn-primary" onclick="openCreateCampusModal()">
            <i class="fa-solid fa-plus"></i> Add Single Campus
          </button>
        </div>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th>Campus Name</th>
                <th>Campus Code</th>
                <th>Status</th>
                <th>Created Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${campuses.length === 0 ? `
                <tr>
                  <td colspan="5" class="empty-state">
                    <i class="fa-solid fa-building-columns"></i>
                    <h3>No Campuses Created Yet</h3>
                    <p>Click "Add Single Campus" or "Bulk Add Campuses" to establish your institution's campuses.</p>
                  </td>
                </tr>
              ` : campuses.map(c => `
                <tr>
                  <td>
                    <strong>${escapeHtml(c.name)}</strong>
                  </td>
                  <td><code>${escapeHtml(c.code)}</code></td>
                  <td>
                    <span class="badge badge-${(c.status || 'ACTIVE').toLowerCase()}">${c.status || 'ACTIVE'}</span>
                  </td>
                  <td>${formatDate(c.created_at)}</td>
                  <td>
                    ${isSuperAdmin ? `
                      <div style="display:flex; gap:8px;">
                        <button class="btn btn-outline btn-sm" onclick="openEditCampusModal('${c.id}', '${escapeHtml(c.name).replace(/'/g, "\\'")}', '${escapeHtml(c.code).replace(/'/g, "\\'")}', '${c.status || 'ACTIVE'}')">
                          <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="toggleCampusStatus('${c.id}', '${c.name}', '${c.status || 'ACTIVE'}')">
                          <i class="fa-solid ${c.status === 'INACTIVE' ? 'fa-toggle-on text-success' : 'fa-toggle-off text-danger'}"></i> ${c.status === 'INACTIVE' ? 'Activate' : 'Deactivate'}
                        </button>
                      </div>
                    ` : '<span style="color:var(--text-muted); font-size:0.8rem;">Read-only</span>'}
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

function openCreateCampusModal() {
  const html = `
    <div class="card-header">
      <h3>Add New Institutional Campus</h3>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-create-campus" onsubmit="handleCreateCampus(event)">
        <div class="form-group">
          <label>Campus Name <span class="text-danger">*</span></label>
          <input type="text" name="name" class="form-input" required placeholder="e.g. North Campus" />
        </div>
        <div class="form-group">
          <label>Campus Code</label>
          <input type="text" name="code" class="form-input" placeholder="e.g. NORTH (Auto-generated if left blank)" />
        </div>
        <div class="form-group">
          <label>Status <span class="text-danger">*</span></label>
          <select name="status" class="form-select" required>
            <option value="ACTIVE" selected>ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i class="fa-solid fa-plus-circle"></i> Create Campus
          </button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

async function handleCreateCampus(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    name: formData.get('name'),
    code: formData.get('code'),
    status: formData.get('status')
  };

  try {
    const res = await api('/campuses', { method: 'POST', body: payload });
    showToast(`Campus "${res.name}" created successfully!`, 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Handled in api
  }
}

function openEditCampusModal(campusId, name, code, status) {
  const html = `
    <div class="card-header">
      <div>
        <h3>Edit Campus Details</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">${escapeHtml(name)}</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-edit-campus" onsubmit="handleSaveCampus(event, '${campusId}')">
        <div class="form-group">
          <label>Campus Name <span class="text-danger">*</span></label>
          <input type="text" name="name" class="form-input" value="${escapeHtml(name)}" required />
        </div>
        <div class="form-group">
          <label>Campus Code <span class="text-danger">*</span></label>
          <input type="text" name="code" class="form-input" value="${escapeHtml(code)}" required />
        </div>
        <div class="form-group">
          <label>Status <span class="text-danger">*</span></label>
          <select name="status" class="form-select" required>
            <option value="ACTIVE" ${status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
            <option value="INACTIVE" ${status === 'INACTIVE' ? 'selected' : ''}>INACTIVE</option>
          </select>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i class="fa-solid fa-floppy-disk"></i> Save Changes
          </button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

async function handleSaveCampus(event, campusId) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    name: formData.get('name'),
    code: formData.get('code'),
    status: formData.get('status')
  };

  try {
    const res = await api(`/campuses/${campusId}`, { method: 'PUT', body: payload });
    showToast(res.message || 'Campus updated successfully!', 'success');
    closeModal();
    loadCurrentView();
  } catch {
    // Handled in api
  }
}

async function toggleCampusStatus(campusId, name, currentStatus) {
  const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  if (!confirm(`Are you sure you want to change the status of campus "${name}" to ${newStatus}?`)) return;

  try {
    await api(`/campuses/${campusId}`, {
      method: 'PUT',
      body: { name, code: '', status: newStatus }
    });
    showToast(`Campus "${name}" is now ${newStatus}.`, 'success');
    loadCurrentView();
  } catch {
    // Handled in api
  }
}

function openBulkCampusesModal() {
  const html = `
    <div class="card-header">
      <div>
        <h3><i class="fa-solid fa-bolt text-warning"></i> Bulk Add Institutional Campuses</h3>
        <span style="font-size:0.85rem; color:var(--text-muted);">Quickly create multiple campuses in one operation</span>
      </div>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <form id="form-bulk-campuses" onsubmit="handleBulkCampuses(event)">
        <div class="form-group">
          <label>Campus List (One per line, format: <code>Campus Name</code> or <code>Campus Name, CODE</code>) <span class="text-danger">*</span></label>
          <textarea name="text" class="form-textarea" rows="8" required placeholder="North Campus, NORTH&#10;South Campus, SOUTH&#10;West Campus, WEST&#10;Primary Wing, PRI_WING&#10;Senior Secondary Campus, SR_SEC"></textarea>
          <span style="font-size:0.75rem; color:var(--text-muted);">Codes will be generated automatically if omitted.</span>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i class="fa-solid fa-plus-circle"></i> Bulk Create Campuses
          </button>
        </div>
      </form>
    </div>
  `;
  openModal(html);
}

async function handleBulkCampuses(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const text = formData.get('text');

  try {
    const res = await api('/campuses/bulk', {
      method: 'POST',
      body: { text }
    });
    showToast(`Successfully created ${res.count} campuses!`, 'success');
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
              <label style="font-size:0.85rem;"><strong>Default Initial IPIN for Imported Teachers (4-6 digits)</strong></label>
              <input type="text" id="import-default-ipin" class="form-input" value="123456" placeholder="123456" />
              <span style="font-size:0.75rem; color:var(--text-muted);">Used if a teacher row does not specify a custom IPIN in the Excel file.</span>
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
  const defaultIpin = document.getElementById('import-default-ipin')?.value || '123456';

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('default_ipin', defaultIpin);

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
// 9.5 SYSTEM SETTINGS
// ============================================================================

async function renderSystemSettings(container) {
  const isSuperAdmin = state.user && (state.user.isSuperAdmin || state.user.user_type === 'SUPER_ADMIN');
  if (!isSuperAdmin) {
    container.innerHTML = `
      <div class="card"><div class="card-body"><div class="empty-state"><i class="fa-solid fa-lock"></i><h3>Access Restricted</h3><p>Only Super Administrators can configure System Settings.</p></div></div></div>
    `;
    return;
  }

  const s = await api('/settings');
  state.settings = s;

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom: 20px;">
      <div>
        <h2 style="margin:0 0 4px 0;"><i class="fa-solid fa-gear text-primary"></i> System Settings & Configuration</h2>
        <p style="color:var(--text-muted); font-size:0.9rem; margin:0;">
          Configure global application parameters, timing policies, session security, and Google Cloud OAuth2 email integration.
        </p>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="openTestEmailModal()">
        <i class="fa-solid fa-envelope-circle-check"></i> Test Email Dispatch
      </button>
    </div>

    <form onsubmit="saveSystemSettings(event)">
      <!-- 1. Application & Institutional Branding -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3><i class="fa-solid fa-building-flag text-primary"></i> Institutional & App Branding</h3>
        </div>
        <div class="card-body">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            <div class="form-group">
              <label>Application Name <span class="text-danger">*</span></label>
              <input type="text" name="app_name" class="form-input" value="${escapeHtml(s.app_name || 'TaskTrack Pro')}" required />
            </div>
            <div class="form-group">
              <label>Academic Session / Term</label>
              <input type="text" name="academic_session" class="form-input" value="${escapeHtml(s.academic_session || '2026-2027')}" placeholder="e.g. 2026-2027" />
            </div>
          </div>
          <div class="form-group">
            <label>App Subtitle / Portal Tagline</label>
            <input type="text" name="app_subtitle" class="form-input" value="${escapeHtml(s.app_subtitle || 'Teacher Task, Workflow & Performance Portal')}" />
          </div>
        </div>
      </div>

      <!-- 2. Timezone & Timing Policies -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3><i class="fa-solid fa-clock text-primary"></i> Timezone, Timing & Submission Deadlines</h3>
        </div>
        <div class="card-body">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            <div class="form-group">
              <label>Default System Timezone <span class="text-danger">*</span></label>
              <select name="timezone" class="form-select">
                <option value="Asia/Kolkata" ${s.timezone === 'Asia/Kolkata' ? 'selected' : ''}>Asia/Kolkata (IST, UTC+5:30) - Default</option>
                <option value="UTC" ${s.timezone === 'UTC' ? 'selected' : ''}>UTC (Coordinated Universal Time)</option>
                <option value="Asia/Dubai" ${s.timezone === 'Asia/Dubai' ? 'selected' : ''}>Asia/Dubai (GST, UTC+4:00)</option>
                <option value="Europe/London" ${s.timezone === 'Europe/London' ? 'selected' : ''}>Europe/London (GMT/BST)</option>
                <option value="America/New_York" ${s.timezone === 'America/New_York' ? 'selected' : ''}>America/New_York (EST/EDT)</option>
              </select>
              <small style="color:var(--text-muted); font-size:0.75rem;">Controls date/time formatting across portals, reports, and emails.</small>
            </div>
            <div class="form-group">
              <label>Default Task Submission Window (Hours) <span class="text-danger">*</span></label>
              <input type="number" name="default_deadline_offset_hours" class="form-input" min="1" max="720" value="${escapeHtml(s.default_deadline_offset_hours || '24')}" required />
              <small style="color:var(--text-muted); font-size:0.75rem;">Difference between task start time and submission deadline (e.g. 24 hours).</small>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Session & Security Policies -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3><i class="fa-solid fa-shield-halved text-primary"></i> Session, Security & Submission Defaults</h3>
        </div>
        <div class="card-body">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            <div class="form-group">
              <label>User Session Expiry (Hours) <span class="text-danger">*</span></label>
              <input type="number" name="session_expiry_hours" class="form-input" min="1" max="168" value="${escapeHtml(s.session_expiry_hours || '24')}" required />
              <small style="color:var(--text-muted); font-size:0.75rem;">Duration before inactive login sessions automatically require re-authentication.</small>
            </div>
            <div class="form-group">
              <label>Institutional PIN (IPIN) Requirement</label>
              <input type="text" class="form-input" value="4 to 6 Numeric Digits" disabled />
              <small style="color:var(--text-muted); font-size:0.75rem;">Standard PIN security constraint enforced across all teacher accounts.</small>
            </div>
          </div>

          <div style="margin-top:12px; display:flex; flex-direction:column; gap:10px;">
            <label class="checkbox-label">
              <input type="checkbox" name="allow_late_submissions_default" ${s.allow_late_submissions_default === 'true' || s.allow_late_submissions_default === true ? 'checked' : ''} />
              <span><strong>Default: Allow Late Submissions</strong> (New tasks will default to accepting late submissions)</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" name="allow_edit_submission_default" ${s.allow_edit_submission_default === 'true' || s.allow_edit_submission_default === true ? 'checked' : ''} />
              <span><strong>Default: Allow Response Editing</strong> (New tasks will default to allowing responses to be updated)</span>
            </label>
          </div>
        </div>
      </div>

      <!-- 4. Email & Dispatch Configuration -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3><i class="fa-solid fa-envelope text-primary"></i> Email & System Notifications</h3>
        </div>
        <div class="card-body">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            <div class="form-group">
              <label>Sender Display Name</label>
              <input type="text" name="email_from_name" class="form-input" value="${escapeHtml(s.email_from_name || 'TaskTrack Operations')}" placeholder="e.g. SRBPS Task Portal" />
            </div>
            <div class="form-group">
              <label>From Email Address <span class="text-danger">*</span></label>
              <input type="email" name="email_from_address" class="form-input" value="${escapeHtml(s.email_from_address || 'contact@srbps.com')}" required placeholder="e.g. contact@srbps.com" />
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
        <button type="submit" id="btn-save-settings" class="btn btn-primary btn-lg">
          <i class="fa-solid fa-floppy-disk"></i> Save System Settings
        </button>
      </div>
    </form>
  `;
}

async function saveSystemSettings(event) {
  event.preventDefault();
  const form = event.target;
  const btn = document.getElementById('btn-save-settings');

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  const payload = {
    app_name: form.app_name.value.trim(),
    app_subtitle: form.app_subtitle.value.trim(),
    academic_session: form.academic_session.value.trim(),
    timezone: form.timezone.value,
    default_deadline_offset_hours: form.default_deadline_offset_hours.value.trim(),
    session_expiry_hours: form.session_expiry_hours.value.trim(),
    allow_late_submissions_default: form.allow_late_submissions_default.checked ? 'true' : 'false',
    allow_edit_submission_default: form.allow_edit_submission_default.checked ? 'true' : 'false',
    email_from_name: form.email_from_name.value.trim(),
    email_from_address: form.email_from_address.value.trim()
  };

  try {
    const res = await api('/settings', { method: 'PUT', body: payload });
    state.settings = res.settings;
    showToast('System settings saved successfully!', 'success');
    loadCurrentView();
  } catch {
    // Handled in api
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save System Settings`;
  }
}

window.renderSystemSettings = renderSystemSettings;
window.saveSystemSettings = saveSystemSettings;

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
  return new Date(d).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function formatDateTime(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
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

// Self-Service Set / Reset Institutional PIN (IPIN) via Institutional Email
function openResetIpinModal(step = 1, email = '') {
  if (step === 1) {
    openModal(`
      <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <h2><i class="fa-solid fa-key text-primary"></i> Set / Reset Institutional PIN (IPIN)</h2>
        <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="card-body">
        <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:16px;">
          Enter your registered institutional email address (username). We will email you a 6-digit verification code to set or reset your IPIN.
        </p>
        <form onsubmit="handleRequestIpinOtp(event)">
          <div class="form-group">
            <label>Institutional Email <span class="text-danger">*</span></label>
            <input type="email" id="reset-ipin-email" class="form-input" placeholder="e.g. ask4deepak@gmail.com" value="${escapeHtml(email || (elements.loginEmail ? elements.loginEmail.value : ''))}" required autofocus />
          </div>
          <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:20px;">
            <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button type="submit" id="btn-request-ipin-otp" class="btn btn-primary">
              <i class="fa-solid fa-paper-plane"></i> Send Verification Code
            </button>
          </div>
        </form>
      </div>
    `);
  } else if (step === 2) {
    openModal(`
      <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <h2><i class="fa-solid fa-shield-halved text-primary"></i> Enter Code & Set New IPIN</h2>
        <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="card-body">
        <div style="background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; padding:10px 14px; border-radius:6px; font-size:0.88rem; margin-bottom:16px;">
          <i class="fa-solid fa-envelope-circle-check"></i> 6-digit verification code sent to <strong>${escapeHtml(email)}</strong>
        </div>
        <form onsubmit="handleConfirmIpinReset(event, '${escapeHtml(email)}')">
          <div class="form-group">
            <label>6-Digit Verification Code (OTP) <span class="text-danger">*</span></label>
            <input type="text" id="reset-ipin-otp" class="form-input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="e.g. 123456" required autofocus style="letter-spacing: 2px; font-weight: bold; font-size: 1.1rem;" />
          </div>
          <div class="form-group">
            <label>New Institutional PIN (IPIN) <span class="text-danger">*</span></label>
            <input type="password" id="reset-ipin-new" class="form-input" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" placeholder="4-6 digit numeric PIN" required />
            <small style="color:var(--text-muted); font-size:0.75rem;">Must be 4 to 6 numeric digits (e.g. 123456)</small>
          </div>
          <div class="form-group">
            <label>Confirm New IPIN <span class="text-danger">*</span></label>
            <input type="password" id="reset-ipin-confirm" class="form-input" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" placeholder="Re-enter 4-6 digit numeric PIN" required />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-top:20px;">
            <button type="button" class="btn btn-link" style="padding:0; font-size:0.85rem; background:none; border:none; color:var(--primary); cursor:pointer;" onclick="openResetIpinModal(1, '${escapeHtml(email)}')">
              <i class="fa-solid fa-arrow-left"></i> Resend Code / Change Email
            </button>
            <div style="display:flex; gap:12px;">
              <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
              <button type="submit" id="btn-confirm-ipin-reset" class="btn btn-success">
                <i class="fa-solid fa-check"></i> Save New IPIN
              </button>
            </div>
          </div>
        </form>
      </div>
    `);
  }
}

async function handleRequestIpinOtp(event) {
  event.preventDefault();
  const emailInput = document.getElementById('reset-ipin-email');
  const email = emailInput ? emailInput.value.trim() : '';
  if (!email) return showToast('Please enter your institutional email', 'warning');

  const btn = document.getElementById('btn-request-ipin-otp');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending Code...`;
  }

  try {
    const res = await api('/auth/reset-ipin-request', {
      method: 'POST',
      body: { email }
    });
    showToast(res.message || 'Verification code sent to your email!', 'success');
    openResetIpinModal(2, email);
  } catch {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send Verification Code`;
    }
  }
}

async function handleConfirmIpinReset(event, email) {
  event.preventDefault();
  const otp = document.getElementById('reset-ipin-otp')?.value.trim();
  const new_ipin = document.getElementById('reset-ipin-new')?.value.trim();
  const confirm_ipin = document.getElementById('reset-ipin-confirm')?.value.trim();

  if (!otp || !new_ipin || !confirm_ipin) {
    return showToast('Please fill in all fields', 'warning');
  }
  if (new_ipin !== confirm_ipin) {
    return showToast('New IPIN and Confirm IPIN do not match', 'danger');
  }
  if (!/^[0-9]{4,6}$/.test(new_ipin)) {
    return showToast('IPIN must be 4 to 6 numeric digits', 'danger');
  }

  const btn = document.getElementById('btn-confirm-ipin-reset');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating IPIN...`;
  }

  try {
    const res = await api('/auth/reset-ipin-confirm', {
      method: 'POST',
      body: { email, otp, new_ipin, confirm_ipin }
    });
    showToast(res.message || 'IPIN successfully reset!', 'success');
    closeModal();
    if (elements.loginEmail) elements.loginEmail.value = email;
    if (elements.loginPassword) {
      elements.loginPassword.value = '';
      elements.loginPassword.focus();
    }
  } catch {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Save New IPIN`;
    }
  }
}

window.openResetIpinModal = openResetIpinModal;
window.handleRequestIpinOtp = handleRequestIpinOtp;
window.handleConfirmIpinReset = handleConfirmIpinReset;

// SMTP Test Email Modal for Super Admins & Admins
function openTestEmailModal() {
  openModal(`
    <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
      <h2><i class="fa-solid fa-envelope-circle-check text-primary"></i> Test SMTP Email Configuration</h2>
      <button class="btn-icon" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="card-body">
      <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:16px;">
        Send an instant verification email to test your Gmail / Google Workspace SMTP credentials.
      </p>
      <form onsubmit="handleSendTestEmail(event)">
        <div class="form-group">
          <label>Recipient Test Email Address <span class="text-danger">*</span></label>
          <input type="email" name="to_email" class="form-input" value="${escapeHtml(state.user ? state.user.email : '')}" required placeholder="e.g. contact@srbps.com" />
        </div>
        <div id="test-email-result" style="margin-top:12px; display:none;"></div>
        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:20px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Close</button>
          <button type="submit" id="btn-submit-test-email" class="btn btn-primary">
            <i class="fa-solid fa-paper-plane"></i> Send Test Email
          </button>
        </div>
      </form>
    </div>
  `);
}

window.openTestEmailModal = openTestEmailModal;
window.handleSendTestEmail = handleSendTestEmail;

async function handleSendTestEmail(event) {
  event.preventDefault();
  const form = event.target;
  const to_email = form.to_email.value.trim();
  const btn = document.getElementById('btn-submit-test-email');
  const resDiv = document.getElementById('test-email-result');

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;
  resDiv.style.display = 'none';

  try {
    const res = await api('/admin/test-email', { method: 'POST', body: { to_email } });

    resDiv.style.display = 'block';
    resDiv.innerHTML = `
      <div style="background:#f0fdf4; border:1px solid #86efac; color:#166534; padding:12px; border-radius:6px; font-size:0.9rem;">
        <i class="fa-solid fa-circle-check"></i> <strong>Success!</strong> ${escapeHtml(res.message)}
        <div style="font-size:0.8rem; margin-top:4px; color:#15803d;">SMTP User: ${escapeHtml(res.details ? res.details.smtp_user : '')}</div>
      </div>
    `;
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send Another`;
  } catch (err) {
    resDiv.style.display = 'block';
    resDiv.innerHTML = `
      <div style="background:#fef2f2; border:1px solid #fca5a5; color:#991b1b; padding:12px; border-radius:6px; font-size:0.9rem;">
        <i class="fa-solid fa-circle-exclamation"></i> <strong>SMTP Notice / Error:</strong> ${escapeHtml(err.message)}
        <div style="font-size:0.8rem; margin-top:6px; color:#b91c1c;">
          For Google Workspace (e.g. <code>contact@srbps.com</code>):<br/>
          1. Enable 2-Step Verification on <code>contact@srbps.com</code>.<br/>
          2. Generate a 16-character App Password at <a href="https://myaccount.google.com/apppasswords" target="_blank" style="color:#b91c1c; text-decoration:underline;">myaccount.google.com/apppasswords</a>.<br/>
          3. Use <code>SMTP_HOST=smtp.gmail.com</code>, <code>SMTP_PORT=587</code>, and enter the 16-character App Password into <code>SMTP_PASS</code> in Railway / <code>.env</code>.
        </div>
      </div>
    `;
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Retry`;
  }
}
