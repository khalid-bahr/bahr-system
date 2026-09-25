// Global Fetch Interceptor for Authentication
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  options = options || {};
  const token = localStorage.getItem('al_diyafa_token');
  if (token && typeof url === 'string' && url.startsWith('/api/') && !url.includes('/api/auth/login')) {
    options.headers = options.headers || {};
    if (options.headers instanceof Headers) {
      options.headers.set('Authorization', `Bearer ${token}`);
    } else {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await originalFetch(url, options);
  if (res.status === 401 && typeof url === 'string' && !url.includes('/api/auth/login')) {
    localStorage.removeItem('al_diyafa_token');
    state.currentUser = null;
    showLoginScreen();
  }
  return res;
};

// State Store
let state = {
  currentUser: null,
  currentTab: 'dashboard',
  date: new Date().toISOString().slice(0, 10),
  month: new Date().toISOString().slice(0, 7),
  currency: 'ر.ع',
  restaurantName: 'مطعم الضيافة العُمانية',
  shifts: [],
  expenses: [],
  users: [],
  activeShift: null,
  charts: {
    salesExpenses: null,
    categories: null
  }
};

// Auth UI Helpers
function showLoginScreen() {
  const loginView = document.getElementById('view-login');
  if (loginView) loginView.classList.remove('hidden');
  const userBadge = document.getElementById('user-profile-badge');
  if (userBadge) userBadge.classList.add('hidden');
  const uInput = document.getElementById('login-username');
  if (uInput) uInput.focus();
}

function hideLoginScreen() {
  const loginView = document.getElementById('view-login');
  if (loginView) loginView.classList.add('hidden');
  const userBadge = document.getElementById('user-profile-badge');
  if (userBadge) userBadge.classList.remove('hidden');
}

function getRoleArabic(role) {
  if (role === 'admin') return 'المدير العام';
  if (role === 'cashier') return 'كاشير';
  if (role === 'owner') return 'صاحب المطعم';
  return role || 'مستخدم';
}

function updateUserUI() {
  if (!state.currentUser) return;
  const user = state.currentUser;
  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-role-badge');
  if (nameEl) nameEl.textContent = user.full_name || user.username;
  if (roleEl) {
    roleEl.textContent = getRoleArabic(user.role);
    if (user.role === 'admin') {
      roleEl.className = 'text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-bold';
    } else if (user.role === 'owner') {
      roleEl.className = 'text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-bold';
    } else {
      roleEl.className = 'text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold';
    }
  }
}

function applyRolePermissions() {
  if (!state.currentUser) return;
  const role = state.currentUser.role;

  const tabSummary = document.getElementById('tab-btn-summary');
  const tabSettings = document.getElementById('tab-btn-settings');
  const tabUsers = document.getElementById('tab-btn-users');
  const mobileTabUsers = document.getElementById('mobile-tab-btn-users');
  const cashierInput = document.getElementById('shift-cashier');

  if (role === 'cashier') {
    // Cashier: restricted to shifts & expenses only
    if (tabSummary) tabSummary.classList.add('hidden');
    if (tabSettings) tabSettings.classList.add('hidden');
    if (tabUsers) tabUsers.classList.add('hidden');
    if (mobileTabUsers) mobileTabUsers.classList.add('hidden');

    if (cashierInput) {
      cashierInput.value = state.currentUser.full_name || state.currentUser.username;
      cashierInput.readOnly = true;
    }

    if (state.currentTab === 'summary' || state.currentTab === 'settings' || state.currentTab === 'users') {
      switchTab('dashboard');
    }
  } else if (role === 'owner') {
    // Owner: reports, monitoring & EXCLUSIVE User/Permissions management
    if (tabSummary) tabSummary.classList.remove('hidden');
    if (tabSettings) tabSettings.classList.remove('hidden');
    if (tabUsers) tabUsers.classList.remove('hidden');
    if (mobileTabUsers) mobileTabUsers.classList.remove('hidden');
    if (cashierInput) cashierInput.readOnly = false;
  } else {
    // Admin: operational management, no user accounts management (exclusive to owner)
    if (tabSummary) tabSummary.classList.remove('hidden');
    if (tabSettings) tabSettings.classList.remove('hidden');
    if (tabUsers) tabUsers.classList.add('hidden');
    if (mobileTabUsers) mobileTabUsers.classList.add('hidden');
    if (cashierInput) cashierInput.readOnly = false;

    if (state.currentTab === 'users') {
      switchTab('dashboard');
    }
  }
}

async function checkAuth() {
  const token = localStorage.getItem('al_diyafa_token');
  if (!token) {
    showLoginScreen();
    return false;
  }

  try {
    const res = await originalFetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.user) {
      state.currentUser = data.user;
      hideLoginScreen();
      updateUserUI();
      applyRolePermissions();
      return true;
    } else {
      localStorage.removeItem('al_diyafa_token');
      showLoginScreen();
      return false;
    }
  } catch (err) {
    console.error('Auth verification error:', err);
    showLoginScreen();
    return false;
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await originalFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.success && data.token) {
      localStorage.setItem('al_diyafa_token', data.token);
      state.currentUser = data.user;
      hideLoginScreen();
      updateUserUI();
      applyRolePermissions();
      loadDashboard();
      loadSettings();
    } else {
      alert(data.error || 'اسم المستخدم أو كلمة المرور غير صحيحة');
    }
  } catch (err) {
    alert('حدث خطأ أثناء الاتصال: ' + err.message);
  }
}

async function handleLogout() {
  if (!confirm('هل تريد تسجيل الخروج من النظام؟')) return;
  const token = localStorage.getItem('al_diyafa_token');
  if (token) {
    try {
      await originalFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (_) {}
  }
  localStorage.removeItem('al_diyafa_token');
  state.currentUser = null;
  showLoginScreen();
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  // Set default dates in inputs
  document.getElementById('dashboard-date-filter').value = state.date;
  document.getElementById('shifts-filter-month').value = state.month;
  document.getElementById('filter-exp-month').value = state.month;
  document.getElementById('summary-month-input').value = state.month;

  document.getElementById('exp-date').value = state.date;
  document.getElementById('exp-time').value = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('shift-date').value = state.date;

  // Initialize Lucide icons
  lucide.createIcons();

  // Check user session
  const isAuthenticated = await checkAuth();
  if (isAuthenticated) {
    loadDashboard();
    loadSettings();
  }
});

// Switch Tab Navigation
function switchTab(tabId) {
  state.currentTab = tabId;

  // Update tabs UI
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('bg-white', 'text-blue-600', 'font-bold', 'shadow-sm');
    btn.classList.add('text-slate-600');
  });

  const activeBtn = document.getElementById(`tab-btn-${tabId}`);
  if (activeBtn) {
    activeBtn.classList.add('bg-white', 'text-blue-600', 'font-bold', 'shadow-sm');
    activeBtn.classList.remove('text-slate-600');
  }

  // Switch Views
  document.querySelectorAll('.tab-view').forEach(view => view.classList.add('hidden'));
  const currentView = document.getElementById(`view-${tabId}`);
  if (currentView) currentView.classList.remove('hidden');

  // Trigger data load
  if (tabId === 'dashboard') loadDashboard();
  else if (tabId === 'shifts') loadShifts();
  else if (tabId === 'expenses') loadExpenses();
  else if (tabId === 'summary') loadMonthlySummary();
  else if (tabId === 'settings') loadSettings();
  else if (tabId === 'users') loadUsers();

  lucide.createIcons();
}

// Format Currency Helper
function formatMoney(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ==========================================
// 1. DASHBOARD LOGIC
// ==========================================
async function loadDashboard() {
  const selectedDate = document.getElementById('dashboard-date-filter').value || state.date;
  state.date = selectedDate;

  try {
    const res = await fetch(`/api/dashboard?date=${selectedDate}`);
    const data = await res.json();
    if (!data.success) return;

    // Update Header
    state.currency = data.currency || 'ر.ع';
    state.restaurantName = data.restaurantName || 'مطعم الضيافة العُمانية';
    document.querySelectorAll('.app-currency').forEach(el => el.textContent = state.currency);
    document.getElementById('nav-restaurant-name').textContent = state.restaurantName;
    document.getElementById('dashboard-date-display').textContent = `تاريخ المعاينة: ${selectedDate} | العملة: ${state.currency}`;

    // Today's total sales from today's shifts
    const todaySales = (data.todayShifts || []).reduce((acc, s) => acc + (Number(s.total_sales) || 0), 0);
    const todaySalesEl = document.getElementById('kpi-today-total-sales');
    if (todaySalesEl) todaySalesEl.textContent = formatMoney(todaySales);

    // Update KPIs
    const breakdownEl = document.getElementById('kpi-shifts-exp-breakdown');
    if (breakdownEl) {
      breakdownEl.textContent = `صباحية: ${formatMoney(data.kpis.morningExpense)} | مسائية: ${formatMoney(data.kpis.eveningExpense)}`;
    }

    document.getElementById('kpi-today-total-exp').textContent = formatMoney(data.kpis.todayTotalExpense);
    document.getElementById('kpi-month-total-exp').textContent = formatMoney(data.kpis.monthTotalExpense);
    document.getElementById('kpi-month-total-sales').textContent = formatMoney(data.kpis.monthTotalSales);
    
    document.getElementById('kpi-month-card').textContent = `بطاقة: ${formatMoney(data.kpis.monthCardSales)}`;
    document.getElementById('kpi-month-credit').textContent = `آجل: ${formatMoney(data.kpis.monthCreditSales)}`;
    document.getElementById('kpi-month-shortage').textContent = formatMoney(data.kpis.monthShortage);
    document.getElementById('kpi-month-overage').textContent = formatMoney(data.kpis.monthOverage);

    // Active Live Shift
    state.activeShift = data.activeShift;
    const badge = document.getElementById('active-shift-badge');
    const badgeText = document.getElementById('active-shift-text');

    if (state.activeShift) {
      badge.classList.remove('hidden');
      badgeText.textContent = `وردية ${state.activeShift.shift_type} مفتوحة (${state.activeShift.cashier_name})`;
      document.getElementById('live-shift-type-pill').textContent = `وردية ${state.activeShift.shift_type} نشطة`;
      document.getElementById('live-cashier-name').textContent = state.activeShift.cashier_name;
      document.getElementById('live-opening-custody').textContent = `${formatMoney(state.activeShift.opening_custody)} ${state.currency}`;
      document.getElementById('live-total-sales').textContent = `${formatMoney(state.activeShift.total_sales)} ${state.currency}`;
      document.getElementById('live-expenses-cash').textContent = `${formatMoney(state.activeShift.expenses_cash)} ${state.currency}`;
      document.getElementById('live-expected-cash').textContent = `${formatMoney(state.activeShift.expected_cash)} ${state.currency}`;
      document.getElementById('btn-close-live-shift').disabled = false;
    } else {
      badge.classList.add('hidden');
      document.getElementById('live-shift-type-pill').textContent = 'لا توجد وردية مفتوحة';
      document.getElementById('live-cashier-name').textContent = 'لا يوجد';
      document.getElementById('live-opening-custody').textContent = `0.00 ${state.currency}`;
      document.getElementById('live-total-sales').textContent = `0.00 ${state.currency}`;
      document.getElementById('live-expenses-cash').textContent = `0.00 ${state.currency}`;
      document.getElementById('live-expected-cash').textContent = `0.00 ${state.currency}`;
      document.getElementById('btn-close-live-shift').disabled = true;
    }

    // Render Today Shifts Table
    renderDashboardShifts(data.todayShifts);

    // Render Recent Expenses Table
    renderDashboardExpenses(data.recentExpenses);

    // Load Charts
    loadDashboardCharts();

  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

function goToToday() {
  const todayStr = new Date().toISOString().slice(0, 10);
  document.getElementById('dashboard-date-filter').value = todayStr;
  loadDashboard();
}

function renderDashboardShifts(shifts) {
  const tbody = document.getElementById('dashboard-today-shifts-body');
  if (!shifts || shifts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">لا توجد ورديات مسجلة لهذا اليوم. اضغط على <strong>+ وردية جديدة</strong> لبدء التشغيل.</td></tr>`;
    return;
  }

  tbody.innerHTML = shifts.map(s => {
    let statusBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-matched">متطابق</span>';
    if (s.result_status === 'عجز') {
      statusBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-shortage">عجز (${formatMoney(Math.abs(s.difference))})</span>`;
    } else if (s.result_status === 'زيادة') {
      statusBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-overage">زيادة (+${formatMoney(s.difference)})</span>`;
    } else if (s.status === 'open') {
      statusBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-pending">قيد التشغيل</span>';
    }

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-2 font-bold text-slate-800">${s.shift_type}</td>
        <td class="p-2 text-slate-600">${s.cashier_name}</td>
        <td class="p-2 font-bold text-emerald-600">${formatMoney(s.total_sales)}</td>
        <td class="p-2 font-semibold text-slate-700">${formatMoney(s.expected_cash)}</td>
        <td class="p-2 font-semibold text-slate-700">${s.status === 'open' ? 'قيد الجرد' : formatMoney(s.actual_cash)}</td>
        <td class="p-2 font-bold ${s.difference < 0 ? 'text-rose-600' : (s.difference > 0 ? 'text-blue-600' : 'text-slate-600')}">
          ${formatMoney(s.difference)}
        </td>
        <td class="p-2">${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

function renderDashboardExpenses(expenses) {
  const tbody = document.getElementById('dashboard-recent-expenses-body');
  if (!expenses || expenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">لا توجد مصروفات مسجلة اليوم. اضغط على <strong>+ تسجيل مصروف</strong> للإضافة.</td></tr>`;
    return;
  }

  tbody.innerHTML = expenses.map(e => `
    <tr class="hover:bg-stone-50 transition">
      <td class="p-2.5 text-stone-700">${e.date}</td>
      <td class="p-2.5 font-medium text-stone-600">${e.shift_type}</td>
      <td class="p-2.5"><span class="px-2 py-0.5 rounded-lg bg-stone-100 text-stone-700 text-xs">${e.category}</span></td>
      <td class="p-2.5">
        <strong class="text-stone-800">${e.item}</strong>
        ${e.details ? `<span class="text-xs text-stone-500 block">${e.details}</span>` : ''}
      </td>
      <td class="p-2.5 font-semibold ${e.payment_method === 'نقدي' ? 'text-amber-800' : 'text-indigo-700'}">
        ${e.payment_method}
      </td>
      <td class="p-2.5 font-bold text-rose-700">${formatMoney(e.amount)} ${state.currency}</td>
      <td class="p-2.5 text-xs text-stone-500">${e.notes || '-'}</td>
    </tr>
  `).join('');
}

// Charts Initialization
async function loadDashboardCharts() {
  try {
    const res = await fetch(`/api/monthly-summary?month=${state.month}`);
    const data = await res.json();
    if (!data.success) return;

    const days = data.summary.map(d => d.date.slice(8, 10));
    const sales = data.summary.map(d => d.total_sales);
    const expenses = data.summary.map(d => d.all_expenses);

    // 1. Sales vs Expenses Chart
    const ctx1 = document.getElementById('chart-sales-expenses').getContext('2d');
    if (state.charts.salesExpenses) state.charts.salesExpenses.destroy();

    state.charts.salesExpenses = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: days,
        datasets: [
          {
            label: 'إجمالي المبيعات',
            data: sales,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.06)',
            fill: true,
            tension: 0.3,
            borderWidth: 2
          },
          {
            label: 'المصروفات',
            data: expenses,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.04)',
            fill: true,
            tension: 0.3,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', rtl: true, labels: { font: { family: 'Cairo', size: 10 }, boxWidth: 12 } }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });

    // 2. Categories Distribution
    const expRes = await fetch(`/api/expenses?month=${state.month}`);
    const expData = await expRes.json();
    
    const catMap = {};
    if (expData.success && expData.expenses) {
      for (const e of expData.expenses) {
        catMap[e.category] = (catMap[e.category] || 0) + e.amount;
      }
    }

    const catLabels = Object.keys(catMap);
    const catValues = Object.values(catMap);

    const ctx2 = document.getElementById('chart-categories').getContext('2d');
    if (state.charts.categories) state.charts.categories.destroy();

    state.charts.categories = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catValues,
          backgroundColor: [
            '#2563eb', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Cairo', size: 10 }, boxWidth: 10 } }
        }
      }
    });

  } catch (err) {
    console.error('Error drawing charts:', err);
  }
}

// ==========================================
// 2. SHIFTS MANAGEMENT LOGIC
// ==========================================
async function loadShifts() {
  const dateInput = document.getElementById('shifts-filter-date');
  const date = dateInput ? dateInput.value : '';
  const monthInput = document.getElementById('shifts-filter-month');
  const month = monthInput ? monthInput.value : state.month;

  let url = '/api/shifts?';
  if (date) {
    url += `date=${encodeURIComponent(date)}`;
  } else if (month) {
    url += `month=${encodeURIComponent(month)}`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) return;

    state.shifts = data.shifts;
    renderShiftsTable(data.shifts);
  } catch (err) {
    console.error('Error loading shifts:', err);
  }
}

function onShiftsDateChange() {
  loadShifts();
}

function onShiftsMonthChange() {
  const dateInput = document.getElementById('shifts-filter-date');
  if (dateInput) dateInput.value = '';
  loadShifts();
}

function clearShiftsDateFilter() {
  const dateInput = document.getElementById('shifts-filter-date');
  if (dateInput) dateInput.value = '';
  loadShifts();
}

function renderShiftsTable(shifts) {
  const tbody = document.getElementById('shifts-table-body');
  if (!shifts || shifts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-stone-400">لا توجد ورديات مسجلة لهذا الشهر</td></tr>`;
    return;
  }

  tbody.innerHTML = shifts.map(s => {
    let statusBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-matched">متطابق</span>';
    if (s.result_status === 'عجز') {
      statusBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-shortage">عجز (${formatMoney(Math.abs(s.difference))})</span>`;
    } else if (s.result_status === 'زيادة') {
      statusBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-overage">زيادة (+${formatMoney(s.difference)})</span>`;
    } else if (s.status === 'open') {
      statusBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-pending">قيد التشغيل</span>';
    }

    const isNegative = s.difference < 0;
    const isPositive = s.difference > 0;

    return `
      <tr class="hover:bg-amber-50/30 transition text-stone-700">
        <td class="p-3 font-semibold">${s.date}</td>
        <td class="p-3 font-bold">${s.shift_type}</td>
        <td class="p-3 text-stone-600">${s.cashier_name}</td>
        <td class="p-3 font-bold text-stone-900">${formatMoney(s.total_sales)}</td>
        <td class="p-3 text-stone-600">${formatMoney(s.card_sales)}</td>
        <td class="p-3 text-stone-600">${formatMoney(s.credit_sales)}</td>
        <td class="p-3 font-semibold text-amber-900">${formatMoney(s.cash_sales)}</td>
        <td class="p-3 font-semibold text-rose-700">${formatMoney(s.expenses_cash)}</td>
        <td class="p-3 font-bold text-stone-800">${formatMoney(s.expected_cash)}</td>
        <td class="p-3 font-bold text-stone-900">${s.status === 'open' ? '-' : formatMoney(s.actual_cash)}</td>
        <td class="p-3 text-stone-500">${formatMoney(s.opening_custody)}</td>
        <td class="p-3 font-black ${isNegative ? 'text-rose-600 bg-rose-50/50' : (isPositive ? 'text-blue-600 bg-blue-50/50' : 'text-emerald-600')}">
          ${formatMoney(s.difference)}
        </td>
        <td class="p-3">${statusBadge}</td>
        <td class="p-3 text-center">
          <div class="flex items-center justify-center gap-1.5">
            ${s.status === 'open' ? `
              <button onclick="openCloseShiftWizard(${s.id})" class="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-1 shadow" title="إغلاق الوردية">
                <i data-lucide="lock" class="w-3.5 h-3.5"></i>
                <span>إغلاق</span>
              </button>
            ` : `
              <button onclick="printShiftReport(${s.id})" class="p-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700" title="طباعة إيصال Z">
                <i data-lucide="printer" class="w-4 h-4"></i>
              </button>
              <button onclick="openCloseShiftWizard(${s.id})" class="p-1.5 rounded-lg bg-stone-100 hover:bg-amber-100 text-amber-800" title="تعديل الأرقام">
                <i data-lucide="pencil" class="w-4 h-4"></i>
              </button>
            `}
            ${(state.currentUser && state.currentUser.role === 'cashier') ? '' : `
              <button onclick="deleteShift(${s.id})" class="p-1.5 rounded-lg hover:bg-rose-50 text-stone-400 hover:text-rose-600 transition" title="حذف الوردية">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// Quick trigger from Dashboard to close live shift
function triggerCloseLiveShift() {
  if (state.activeShift) {
    openCloseShiftWizard(state.activeShift.id);
  }
}

// Open Close Shift Wizard Modal
function openCloseShiftWizard(shiftId) {
  const shift = state.shifts.find(s => s.id === shiftId) || state.activeShift;
  if (!shift) return;

  document.getElementById('close-shift-id').value = shift.id;
  document.getElementById('close-modal-shift-info').textContent = `تاريخ: ${shift.date} | وردية: ${shift.shift_type} | كاشير: ${shift.cashier_name}`;
  
  document.getElementById('close-total-sales').value = shift.total_sales || '';
  document.getElementById('close-card-sales').value = shift.card_sales || '';
  document.getElementById('close-credit-sales').value = shift.credit_sales || '';
  document.getElementById('close-actual-cash').value = shift.actual_cash || '';
  document.getElementById('close-notes').value = shift.notes || '';

  document.getElementById('close-calc-custody').textContent = `${formatMoney(shift.opening_custody)} ${state.currency}`;
  document.getElementById('close-calc-expenses').textContent = `${formatMoney(shift.expenses_cash)} ${state.currency}`;

  // Store shift reference for dynamic calculations
  window.currentClosingShift = shift;

  // Calculate live numbers
  calculateClosingForm();

  openModal('modal-close-shift');
}

// Live Calculation in Close Shift Wizard
function calculateClosingForm() {
  const shift = window.currentClosingShift || {};
  const custody = Number(shift.opening_custody) || 0;
  const cashExpenses = Number(shift.expenses_cash) || 0;

  const totalSales = Number(document.getElementById('close-total-sales').value) || 0;
  const cardSales = Number(document.getElementById('close-card-sales').value) || 0;
  const creditSales = Number(document.getElementById('close-credit-sales').value) || 0;
  const actualCash = Number(document.getElementById('close-actual-cash').value) || 0;

  // Cash sales = total - card - credit
  let cashSales = totalSales - cardSales - creditSales;
  if (cashSales < 0) cashSales = 0;
  document.getElementById('close-calc-cash-sales').textContent = `${formatMoney(cashSales)} ${state.currency}`;

  // Expected Cash = (cashSales + custody) - cashExpenses
  const expectedCash = (cashSales + custody) - cashExpenses;
  document.getElementById('close-calc-expected').textContent = `${formatMoney(expectedCash)} ${state.currency}`;

  // Difference = Actual - Expected
  const difference = actualCash - expectedCash;
  const diffEl = document.getElementById('reconciliation-diff');
  diffEl.textContent = `${formatMoney(difference)} ${state.currency}`;

  const resultBox = document.getElementById('reconciliation-result-box');
  const titleEl = document.getElementById('reconciliation-title');
  const descEl = document.getElementById('reconciliation-desc');
  const iconEl = document.getElementById('reconciliation-icon');

  if (Math.abs(difference) < 0.01) {
    resultBox.className = 'p-4 rounded-2xl flex items-center justify-between border font-bold badge-matched';
    titleEl.textContent = 'الحالة: متطابق (100%)';
    descEl.textContent = 'النقدية الموجودة في الدرج مطابقة تماماً للمبيعات والمصروفات.';
    iconEl.innerHTML = `<i data-lucide="check-circle" class="w-6 h-6 text-emerald-600"></i>`;
  } else if (difference < 0) {
    resultBox.className = 'p-4 rounded-2xl flex items-center justify-between border font-bold badge-shortage';
    titleEl.textContent = `الحالة: يوجد عجز في الدرج (-${formatMoney(Math.abs(difference))} ${state.currency})`;
    descEl.textContent = 'المبلغ الفعلي أقل من المتوقع، يرجى مراجعة فواتير المصروفات أو الكاشير.';
    iconEl.innerHTML = `<i data-lucide="alert-triangle" class="w-6 h-6 text-rose-600"></i>`;
  } else {
    resultBox.className = 'p-4 rounded-2xl flex items-center justify-between border font-bold badge-overage';
    titleEl.textContent = `الحالة: توجد زيادة في الدرج (+${formatMoney(difference)} ${state.currency})`;
    descEl.textContent = 'المبلغ الفعلي بالدرج أكبر من المتوقع بحسب العمليات المسجلة.';
    iconEl.innerHTML = `<i data-lucide="sparkles" class="w-6 h-6 text-blue-600"></i>`;
  }

  lucide.createIcons();
}

// Denominations Counter Logic
function toggleDenominations() {
  const box = document.getElementById('denom-box');
  box.classList.toggle('hidden');
}

function calcDenoms() {
  let total = 0;
  document.querySelectorAll('.denom-input').forEach(input => {
    const val = Number(input.dataset.val);
    const count = Number(input.value) || 0;
    total += val * count;
  });
  document.getElementById('close-actual-cash').value = total.toFixed(2);
  calculateClosingForm();
}

// Handle Close Shift Submission
async function handleCloseShiftSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('close-shift-id').value;
  const total_sales = Number(document.getElementById('close-total-sales').value) || 0;
  const card_sales = Number(document.getElementById('close-card-sales').value) || 0;
  const credit_sales = Number(document.getElementById('close-credit-sales').value) || 0;
  const actual_cash = Number(document.getElementById('close-actual-cash').value) || 0;
  const notes = document.getElementById('close-notes').value;

  try {
    const res = await fetch('/api/shifts/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, total_sales, card_sales, credit_sales, actual_cash, notes })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('modal-close-shift');
      loadShifts();
      loadDashboard();
      alert('تم إغلاق ومطابقة الوردية بنجاح!');
    }
  } catch (err) {
    alert('حدث خطأ أثناء إغلاق الوردية: ' + err.message);
  }
}

// Handle New Shift Submission
async function handleNewShiftSubmit(e) {
  e.preventDefault();
  const date = document.getElementById('shift-date').value;
  const shift_type = document.getElementById('shift-type').value;
  const cashier_name = document.getElementById('shift-cashier').value;
  const opening_custody = Number(document.getElementById('shift-custody').value) || 0;
  const notes = document.getElementById('shift-notes').value;

  try {
    const res = await fetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, shift_type, cashier_name, opening_custody, notes, status: 'open' })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('modal-new-shift');
      document.getElementById('form-new-shift').reset();
      loadShifts();
      loadDashboard();
      alert(`تم فتح وردية ${shift_type} للكاشير ${cashier_name} بنجاح!`);
    }
  } catch (err) {
    alert('حدث خطأ: ' + err.message);
  }
}

// Delete Shift
async function deleteShift(id) {
  if (state.currentUser && state.currentUser.role === 'cashier') {
    return alert('عفواً، لا يملك حساب الكاشير صلاحية حذف الورديات. يرجى مراجعة إدارة المطعم.');
  }
  if (!confirm('هل أنت متأكد من حذف هذه الوردية؟')) return;
  try {
    await fetch(`/api/shifts/${id}`, { method: 'DELETE' });
    loadShifts();
    loadDashboard();
  } catch (err) {
    alert('حدث خطأ: ' + err.message);
  }
}

// Print Thermal Z-Report
function printShiftReport(shiftId) {
  const shift = state.shifts.find(s => s.id === shiftId);
  if (!shift) return;

  document.getElementById('receipt-p-name').textContent = state.restaurantName;
  document.getElementById('receipt-p-datetime').textContent = `${shift.date} - ${shift.closed_at || shift.opened_at || ''}`;
  document.getElementById('receipt-p-shift').textContent = shift.shift_type;
  document.getElementById('receipt-p-cashier').textContent = shift.cashier_name;
  document.getElementById('receipt-p-custody').textContent = `${formatMoney(shift.opening_custody)} ${state.currency}`;
  document.getElementById('receipt-p-sales').textContent = `${formatMoney(shift.total_sales)} ${state.currency}`;
  document.getElementById('receipt-p-card').textContent = `${formatMoney(shift.card_sales)} ${state.currency}`;
  document.getElementById('receipt-p-credit').textContent = `${formatMoney(shift.credit_sales)} ${state.currency}`;
  document.getElementById('receipt-p-cash').textContent = `${formatMoney(shift.cash_sales)} ${state.currency}`;
  document.getElementById('receipt-p-expenses').textContent = `${formatMoney(shift.expenses_cash)} ${state.currency}`;
  document.getElementById('receipt-p-expected').textContent = `${formatMoney(shift.expected_cash)} ${state.currency}`;
  document.getElementById('receipt-p-actual').textContent = `${formatMoney(shift.actual_cash)} ${state.currency}`;
  document.getElementById('receipt-p-diff').textContent = `${formatMoney(shift.difference)} ${state.currency}`;
  document.getElementById('receipt-p-status').textContent = shift.result_status;

  openModal('modal-receipt-print');
}

function printClosingSlipPreview() {
  const shift = window.currentClosingShift || {};
  printShiftReport(shift.id);
}

// ==========================================
// 3. EXPENSES MANAGEMENT LOGIC
// ==========================================
async function loadExpenses() {
  const dateInput = document.getElementById('filter-exp-date');
  const date = dateInput ? dateInput.value : '';
  const monthInput = document.getElementById('filter-exp-month');
  const month = monthInput ? monthInput.value : '';
  const shift_type = document.getElementById('filter-exp-shift').value;
  const category = document.getElementById('filter-exp-cat').value;
  const payment_method = document.getElementById('filter-exp-method').value;

  let url = '/api/expenses?';
  const badgeEl = document.getElementById('exp-current-filter-badge');

  if (date) {
    url += `date=${encodeURIComponent(date)}&`;
    if (badgeEl) badgeEl.textContent = `عرض يوم: ${date}`;
  } else if (month) {
    url += `month=${encodeURIComponent(month)}&`;
    if (badgeEl) badgeEl.textContent = `عرض شهر: ${month}`;
  } else {
    if (badgeEl) badgeEl.textContent = 'عرض كل المصروفات المسجلة';
  }

  if (shift_type) url += `shift_type=${encodeURIComponent(shift_type)}&`;
  if (category) url += `category=${encodeURIComponent(category)}&`;
  if (payment_method) url += `payment_method=${encodeURIComponent(payment_method)}&`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) return;

    state.expenses = data.expenses;
    renderExpensesTable(data.expenses);
  } catch (err) {
    console.error('Error loading expenses:', err);
  }
}

function onExpDateChange() {
  updatePresetButtons(null);
  loadExpenses();
}

function onExpMonthChange() {
  const dateInput = document.getElementById('filter-exp-date');
  if (dateInput) dateInput.value = '';
  updatePresetButtons('month');
  loadExpenses();
}

function clearExpDayFilter() {
  const dateInput = document.getElementById('filter-exp-date');
  if (dateInput) dateInput.value = '';
  updatePresetButtons('month');
  loadExpenses();
}

function setExpDatePreset(preset) {
  const dateInput = document.getElementById('filter-exp-date');
  const monthInput = document.getElementById('filter-exp-month');
  const now = new Date();

  updatePresetButtons(preset);

  if (preset === 'today') {
    const todayStr = now.toISOString().slice(0, 10);
    if (dateInput) dateInput.value = todayStr;
    if (monthInput) monthInput.value = todayStr.slice(0, 7);
  } else if (preset === 'yesterday') {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yestStr = yesterday.toISOString().slice(0, 10);
    if (dateInput) dateInput.value = yestStr;
    if (monthInput) monthInput.value = yestStr.slice(0, 7);
  } else if (preset === 'month') {
    if (dateInput) dateInput.value = '';
    if (monthInput) monthInput.value = now.toISOString().slice(0, 7);
  } else if (preset === 'all') {
    if (dateInput) dateInput.value = '';
    if (monthInput) monthInput.value = '';
  }

  loadExpenses();
}

function updatePresetButtons(activePreset) {
  const presets = ['today', 'yesterday', 'month', 'all'];
  presets.forEach(p => {
    const btn = document.getElementById(`btn-exp-preset-${p}`);
    if (!btn) return;
    if (p === activePreset) {
      btn.className = 'px-2.5 py-1 rounded-md bg-blue-600 text-white border border-blue-600 text-[11px] font-bold transition';
    } else {
      btn.className = 'px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 text-[11px] font-medium transition';
    }
  });
}

function renderExpensesTable(expenses) {
  const tbody = document.getElementById('expenses-table-body');
  if (!expenses || expenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-stone-400">لا توجد مصروفات مطابقة للفلتر المحدد</td></tr>`;
    document.getElementById('filtered-exp-count').textContent = '0';
    document.getElementById('filtered-exp-sum').textContent = '0.00';
    return;
  }

  // Update summary badge
  const totalSum = expenses.reduce((acc, e) => acc + Number(e.amount), 0);
  document.getElementById('filtered-exp-count').textContent = expenses.length;
  document.getElementById('filtered-exp-sum').textContent = formatMoney(totalSum);

  tbody.innerHTML = expenses.map((e, index) => `
    <tr class="hover:bg-amber-50/30 transition text-stone-700">
      <td class="p-3 text-stone-400 font-bold">${index + 1}</td>
      <td class="p-3 font-semibold">${e.date}</td>
      <td class="p-3 font-bold">${e.shift_type}</td>
      <td class="p-3 text-stone-500">${e.time || '-'}</td>
      <td class="p-3"><span class="px-2 py-0.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-semibold">${e.category}</span></td>
      <td class="p-3 font-bold text-stone-900">${e.item}</td>
      <td class="p-3 text-stone-600 max-w-xs truncate" title="${e.details || ''}">${e.details || '-'}</td>
      <td class="p-3 font-bold ${e.payment_method === 'نقدي' ? 'text-amber-800' : 'text-indigo-700'}">
        <span class="px-2 py-0.5 rounded-full text-xs ${e.payment_method === 'نقدي' ? 'bg-amber-100' : 'bg-indigo-100'}">${e.payment_method}</span>
      </td>
      <td class="p-3 font-black text-rose-700 text-base">${formatMoney(e.amount)}</td>
      <td class="p-3 text-center">
        ${e.receipt_image ? `
          <button onclick="openReceiptModal('${e.receipt_image}')" class="p-1 rounded bg-amber-100 text-amber-800 hover:bg-amber-200 transition" title="عرض الفاتورة">
            <i data-lucide="image" class="w-4 h-4"></i>
          </button>
        ` : '<span class="text-stone-300">-</span>'}
      </td>
      <td class="p-3 text-xs text-stone-500">${e.notes || '-'}</td>
      <td class="p-3 text-center">
        ${(state.currentUser && state.currentUser.role === 'cashier') ? '<span class="text-stone-300">-</span>' : `
          <button onclick="deleteExpense(${e.id})" class="p-1.5 rounded-lg hover:bg-rose-50 text-stone-400 hover:text-rose-600 transition" title="حذف المصروف">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        `}
      </td>
    </tr>
  `).join('');

  lucide.createIcons();
}

function filterExpensesTable() {
  const query = document.getElementById('filter-exp-search').value.toLowerCase();
  if (!query) {
    renderExpensesTable(state.expenses);
    return;
  }
  const filtered = state.expenses.filter(e => 
    (e.item && e.item.toLowerCase().includes(query)) ||
    (e.details && e.details.toLowerCase().includes(query)) ||
    (e.notes && e.notes.toLowerCase().includes(query))
  );
  renderExpensesTable(filtered);
}

// Handle Receipt File Preview
let currentReceiptBase64 = null;
function previewReceipt(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    currentReceiptBase64 = e.target.result;
    document.getElementById('receipt-preview-thumb').src = currentReceiptBase64;
    document.getElementById('receipt-preview-container').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function openReceiptModal(src) {
  document.getElementById('modal-image-src').src = src;
  openModal('modal-image-preview');
}

// Handle New Expense Submission
async function handleNewExpenseSubmit(e) {
  e.preventDefault();
  const date = document.getElementById('exp-date').value;
  const time = document.getElementById('exp-time').value;
  const shift_type = document.getElementById('exp-shift').value;
  const payment_method = document.getElementById('exp-method').value;
  const category = document.getElementById('exp-category').value;
  const item = document.getElementById('exp-item').value;
  const amount = Number(document.getElementById('exp-amount').value) || 0;
  const details = document.getElementById('exp-details').value;
  const notes = document.getElementById('exp-notes').value;

  try {
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date, time, shift_type, payment_method, category, item, amount, details, notes,
        receipt_image: currentReceiptBase64
      })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('modal-new-expense');
      document.getElementById('form-new-expense').reset();
      currentReceiptBase64 = null;
      document.getElementById('receipt-preview-container').classList.add('hidden');
      loadExpenses();
      loadDashboard();
      alert('تم تسجيل المصروف بنجاح ومطابقته فورياً!');
    }
  } catch (err) {
    alert('حدث خطأ: ' + err.message);
  }
}

// Delete Expense
async function deleteExpense(id) {
  if (state.currentUser && state.currentUser.role === 'cashier') {
    return alert('عفواً، لا يملك حساب الكاشير صلاحية حذف المصروفات. يرجى مراجعة إدارة المطعم.');
  }
  if (!confirm('هل أنت متأكد من حذف هذا المصروف؟')) return;
  try {
    await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    loadExpenses();
    loadDashboard();
  } catch (err) {
    alert('حدث خطأ: ' + err.message);
  }
}

// ==========================================
// 4. MONTHLY SUMMARY LOGIC
// ==========================================
async function loadMonthlySummary() {
  const month = document.getElementById('summary-month-input').value || state.month;
  try {
    const res = await fetch(`/api/monthly-summary?month=${month}`);
    const data = await res.json();
    if (!data.success) return;

    // Top Cards
    document.getElementById('sum-card-sales').textContent = formatMoney(data.totals.total_sales);
    document.getElementById('sum-card-card').textContent = `بطاقة: ${formatMoney(data.totals.card_sales)}`;
    document.getElementById('sum-card-credit').textContent = `آجل: ${formatMoney(data.totals.credit_sales)}`;
    document.getElementById('sum-card-expenses').textContent = formatMoney(data.totals.total_expenses);
    document.getElementById('sum-card-expected').textContent = formatMoney(data.totals.expected_cash);
    document.getElementById('sum-card-actual').textContent = formatMoney(data.totals.actual_cash);
    document.getElementById('sum-card-overage').textContent = formatMoney(data.totals.total_overage);
    document.getElementById('sum-card-shortage').textContent = formatMoney(data.totals.total_shortage);

    // Render Table
    const tbody = document.getElementById('summary-table-body');
    if (!data.summary || data.summary.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-stone-400">لا توجد بيانات مسجلة لهذا الشهر</td></tr>`;
      return;
    }

    tbody.innerHTML = data.summary.map(row => {
      let statusBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-matched">متطابق</span>';
      if (row.status === 'عجز') {
        statusBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-shortage">عجز</span>`;
      } else if (row.status === 'زيادة') {
        statusBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold badge-overage">زيادة</span>`;
      }

      return `
        <tr class="hover:bg-stone-50 transition text-stone-700">
          <td class="p-3 font-bold">${row.date}</td>
          <td class="p-3 text-center font-semibold">${row.shift_count}</td>
          <td class="p-3 font-bold text-stone-900">${formatMoney(row.total_sales)}</td>
          <td class="p-3 text-stone-600">${formatMoney(row.card_sales)}</td>
          <td class="p-3 text-stone-600">${formatMoney(row.credit_sales)}</td>
          <td class="p-3 font-semibold text-amber-900">${formatMoney(row.cash_sales)}</td>
          <td class="p-3 font-semibold text-rose-700">${formatMoney(row.all_expenses)}</td>
          <td class="p-3 font-bold text-stone-800">${formatMoney(row.expected_cash)}</td>
          <td class="p-3 font-bold text-stone-900">${formatMoney(row.actual_cash)}</td>
          <td class="p-3 text-stone-500">${formatMoney(row.total_custody)}</td>
          <td class="p-3 font-black ${row.total_diff < 0 ? 'text-rose-600' : (row.total_diff > 0 ? 'text-blue-600' : 'text-emerald-600')}">
            ${formatMoney(row.total_diff)}
          </td>
          <td class="p-3">${statusBadge}</td>
        </tr>
      `;
    }).join('');

    window.currentMonthlySummaryData = data;

  } catch (err) {
    console.error('Error loading summary:', err);
  }
}

// ==========================================
// 5. EXCEL EXPORT (USING SHEETJS)
// ==========================================
function exportShiftsToExcel() {
  if (!state.shifts || state.shifts.length === 0) return alert('لا توجد بيانات لتصديرها');

  const rows = state.shifts.map(s => ({
    'التاريخ': s.date,
    'الوردية': s.shift_type,
    'الكاشير': s.cashier_name,
    'إجمالي المبيعات': s.total_sales,
    'البطاقة (شبكة)': s.card_sales,
    'الآجل': s.credit_sales,
    'النقدي': s.cash_sales,
    'المصروفات النقدية': s.expenses_cash,
    'النقدي المتوقع': s.expected_cash,
    'النقدي الموجود': s.actual_cash,
    'العهدة الافتتاحية': s.opening_custody,
    'الفرق': s.difference,
    'الحالة': s.result_status,
    'ملاحظات': s.notes || ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "إغلاق الورديات");
  const dateInput = document.getElementById('shifts-filter-date');
  const filename = (dateInput && dateInput.value) ? `ورديات_يوم_${dateInput.value}.xlsx` : `ورديات_${state.month}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function exportExpensesToExcel() {
  if (!state.expenses || state.expenses.length === 0) return alert('لا توجد مصروفات لتصديرها');

  const rows = state.expenses.map((e, idx) => ({
    'م': idx + 1,
    'التاريخ': e.date,
    'الوردية': e.shift_type,
    'الوقت': e.time || '',
    'تصنيف المصروف': e.category,
    'بند المصروف': e.item,
    'التفاصيل / البيان': e.details || '',
    'طريقة الدفع': e.payment_method,
    'المبلغ': e.amount,
    'ملاحظات': e.notes || ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "المصروفات");
  const expDateInput = document.getElementById('filter-exp-date');
  const expFilename = (expDateInput && expDateInput.value) ? `مصروفات_يوم_${expDateInput.value}.xlsx` : `مصروفات_${state.month}.xlsx`;
  XLSX.writeFile(wb, expFilename);
}

function exportMonthlySummaryToExcel() {
  if (!window.currentMonthlySummaryData || !window.currentMonthlySummaryData.summary) {
    return alert('لا توجد بيانات ملخص لتصديرها');
  }

  const rows = window.currentMonthlySummaryData.summary.map(d => ({
    'التاريخ': d.date,
    'عدد الورديات': d.shift_count,
    'المبيعات': d.total_sales,
    'البطاقة': d.card_sales,
    'الآجل': d.credit_sales,
    'النقدي': d.cash_sales,
    'المصروفات': d.all_expenses,
    'النقدي المتوقع': d.expected_cash,
    'النقدي الموجود': d.actual_cash,
    'العهدة': d.total_custody,
    'الفرق': d.total_diff,
    'الحالة': d.status
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "ملخص الشهر");
  XLSX.writeFile(wb, `ملخص_الشهر_${state.month}.xlsx`);
}

// ==========================================
// 6. SETTINGS & DEMO SEED
// ==========================================
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.success && data.settings) {
      document.getElementById('setting-restaurant-name').value = data.settings.restaurant_name || '';
      document.getElementById('setting-currency').value = data.settings.currency || 'ر.ع';
      document.getElementById('setting-manager-name').value = data.settings.manager_name || '';
      
      state.restaurantName = data.settings.restaurant_name || state.restaurantName;
      state.currency = data.settings.currency || state.currency;
      document.getElementById('nav-restaurant-name').textContent = state.restaurantName;
      document.querySelectorAll('.app-currency').forEach(el => el.textContent = state.currency);
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function saveSettings() {
  const restaurant_name = document.getElementById('setting-restaurant-name').value;
  const currency = document.getElementById('setting-currency').value;
  const manager_name = document.getElementById('setting-manager-name').value;

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurant_name, currency, manager_name })
    });
    const data = await res.json();
    if (data.success) {
      alert('تم حفظ الإعدادات بنجاح!');
      loadSettings();
      loadDashboard();
    }
  } catch (err) {
    alert('حدث خطأ: ' + err.message);
  }
}

async function quickSeedDemo() {
  if (!confirm('هل تريد استعادة البيانات التجريبية المطابقة تماماً لشيتات الإكسيل (حركات شهر سبتمبر 2026)؟')) return;
  try {
    const res = await fetch('/api/seed-demo', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadDashboard();
      loadShifts();
      loadExpenses();
      loadMonthlySummary();
    }
  } catch (err) {
    alert('حدث خطأ: ' + err.message);
  }
}

async function resetDatabase() {
  if (!confirm('⚠️ تحذير: هل أنت متأكد من تصفير وتفريغ جميع بيانات الورديات والمصروفات لبدء التشغيل الفعلي للمطعم؟')) return;
  try {
    const res = await fetch('/api/reset-database', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadDashboard();
      loadShifts();
      loadExpenses();
      loadMonthlySummary();
    }
  } catch (err) {
    alert('حدث خطأ: ' + err.message);
  }
}

// Helper: Modal toggles
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  lucide.createIcons();
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function updateItemsDropdown() {
  // Can provide suggested items for categories
}

// ==========================================
// 7. USER MANAGEMENT LOGIC
// ==========================================
async function loadUsers() {
  if (!state.currentUser || state.currentUser.role !== 'owner') return;
  try {
    const res = await fetch('/api/users');
    const data = await res.json();
    if (!data.success) return;
    state.users = data.users || [];
    renderUsersTable(state.users);
    const badge = document.getElementById('users-count-badge');
    if (badge) badge.textContent = `عدد المستخدمين: ${state.users.length}`;
  } catch (err) {
    console.error('Error loading users:', err);
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  if (!users || users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-slate-400">لا يوجد مستخدمون مسجلون</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    let roleBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">كاشير</span>';
    if (u.role === 'admin') {
      roleBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">مدير عام</span>';
    } else if (u.role === 'owner') {
      roleBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">صاحب مطعم</span>';
    }

    const isCurrent = state.currentUser && state.currentUser.id === u.id;

    return `
      <tr class="hover:bg-slate-50 transition text-slate-700">
        <td class="p-2.5 font-bold font-mono text-slate-900">${u.username}</td>
        <td class="p-2.5 font-semibold">${u.full_name}</td>
        <td class="p-2.5">${roleBadge}</td>
        <td class="p-2.5 text-slate-500 text-[10px]">${u.created_at ? u.created_at.slice(0, 10) : '-'}</td>
        <td class="p-2.5 text-center">
          ${isCurrent ? '<span class="text-[10px] text-blue-600 font-bold">أنت (الحساب الحالي)</span>' : `
            <button onclick="deleteUser(${u.id})" class="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition" title="حذف الحساب">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          `}
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

async function handleNewUserSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('user-new-username').value.trim();
  const password = document.getElementById('user-new-password').value;
  const full_name = document.getElementById('user-new-fullname').value.trim();
  const role = document.getElementById('user-new-role').value;

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, full_name, role })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('modal-new-user');
      document.getElementById('form-new-user').reset();
      loadUsers();
      alert(`تم إضافة الحساب بنجاح! اسم الدخول: ${username}`);
    } else {
      alert(data.error || 'حدث خطأ أثناء إضافة الحساب');
    }
  } catch (err) {
    alert('حدث خطأ: ' + err.message);
  }
}

async function deleteUser(id) {
  if (!confirm('هل أنت متأكد من حذف هذا الحساب؟')) return;
  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadUsers();
    } else {
      alert(data.error || 'حدث خطأ أثناء الحذف');
    }
  } catch (err) {
    alert('حدث خطأ: ' + err.message);
  }
}

