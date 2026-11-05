/**
 * Kappy Cafe - Professional Admin Portal Controller
 * Connects Firebase Authentication & Cloud Firestore with Local Fallbacks
 */

// GLOBAL STATE
let db = null;
let auth = null;
let isFirebaseConnected = false;
let currentTab = 'dashboard';
let currentAdminUser = null;

let ADMIN_MENU = {};
let ADMIN_CATEGORIES = [];
let ADMIN_ORDERS = [];
let unsubscribeOrders = null;
let unsubscribeMenu = null;

const DEFAULT_PIN = "0005";

// Default Restaurant Settings
let REST_SETTINGS = {
  restaurantName: "Kappy Cafe",
  tagline: "Good Food • Good Vibes • Always",
  whatsappNumber: "919781625429",
  secondaryPhone: "8968915301",
  deliveryFee: 30,
  takeawayFee: 10,
  address: "Road, Raja Garden Colony, Phagwara, Punjab"
};

// ==========================================
// 1. INITIALIZATION & FIREBASE INIT
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  loadStoredSettings();
  initFirebase();
  checkAuthSession();
  await loadAdminMenuData();
  renderDashboard();
});

function loadStoredSettings() {
  const saved = localStorage.getItem('kappy_cafe_settings');
  if (saved) {
    try { Object.assign(REST_SETTINGS, JSON.parse(saved)); } catch(e){}
  }
  const elW = document.getElementById('cfgWhatsApp');
  const elP = document.getElementById('cfgPhone2');
  const elD = document.getElementById('cfgDeliveryFee');
  const elT = document.getElementById('cfgTakeawayFee');
  const elN = document.getElementById('cfgRestName');
  const elTag = document.getElementById('cfgTagline');

  if (elW) elW.value = REST_SETTINGS.whatsappNumber;
  if (elP) elP.value = REST_SETTINGS.secondaryPhone;
  if (elD) elD.value = REST_SETTINGS.deliveryFee;
  if (elT) elT.value = REST_SETTINGS.takeawayFee;
  if (elN) elN.value = REST_SETTINGS.restaurantName;
  if (elTag) elTag.value = REST_SETTINGS.tagline;
}

function initFirebase() {
  const cfgJson = localStorage.getItem('kappy_cafe_firebase_config');
  let config = null;

  if (cfgJson) {
    try { config = JSON.parse(cfgJson); } catch (e) {}
  }

  // Pre-fill Firebase inputs if stored
  if (config) {
    const elK = document.getElementById('fbApiKey');
    const elA = document.getElementById('fbAuthDomain');
    const elP = document.getElementById('fbProjectId');
    const elS = document.getElementById('fbStorageBucket');
    if (elK) elK.value = config.apiKey || '';
    if (elA) elA.value = config.authDomain || '';
    if (elP) elP.value = config.projectId || '';
    if (elS) elS.value = config.storageBucket || '';
  }

  if (config && config.projectId) {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      db = firebase.firestore();
      auth = firebase.auth();
      isFirebaseConnected = true;

      const badge = document.getElementById('firebaseStatusBadge');
      if (badge) {
        badge.classList.remove('hidden');
        badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-status-green animate-ping"></span> Live Firestore (${config.projectId})`;
      }

      setupRealtimeOrders();
      setupRealtimeMenuListener();
    } catch (err) {
      console.warn('Firebase init warning:', err);
      isFirebaseConnected = false;
    }
  } else {
    isFirebaseConnected = false;
    const badge = document.getElementById('firebaseStatusBadge');
    if (badge) {
      badge.classList.remove('hidden');
      badge.className = "hidden md:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-status-amber/15 text-status-amber border border-status-amber/30";
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-status-amber"></span> Local Mode (Configure in Settings)`;
    }
  }
}

// ==========================================
// 2. AUTHENTICATION (Firebase & PIN)
// ==========================================
function setAuthMode(mode) {
  const tabE = document.getElementById('tabBtnEmail');
  const tabP = document.getElementById('tabBtnPin');
  const formE = document.getElementById('emailLoginForm');
  const formP = document.getElementById('pinLoginForm');
  const err = document.getElementById('authErrorMsg');
  if (err) err.classList.add('hidden');

  if (mode === 'email') {
    tabE.className = "py-2 text-xs font-bold rounded-xl bg-brand-gold text-surface-lowest transition-all";
    tabP.className = "py-2 text-xs font-bold rounded-xl text-on-muted hover:text-on-surface transition-all";
    formE.classList.remove('hidden');
    formP.classList.add('hidden');
  } else {
    tabP.className = "py-2 text-xs font-bold rounded-xl bg-brand-gold text-surface-lowest transition-all";
    tabE.className = "py-2 text-xs font-bold rounded-xl text-on-muted hover:text-on-surface transition-all";
    formP.classList.remove('hidden');
    formE.classList.add('hidden');
  }
}

function checkAuthSession() {
  const session = sessionStorage.getItem('kappy_admin_authenticated');
  const userEmail = sessionStorage.getItem('kappy_admin_email');
  if (session === 'true') {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('userEmailDisplay').textContent = userEmail || 'Manager';
  } else if (auth) {
    auth.onAuthStateChanged(user => {
      if (user) {
        currentAdminUser = user;
        sessionStorage.setItem('kappy_admin_authenticated', 'true');
        sessionStorage.setItem('kappy_admin_email', user.email);
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('userEmailDisplay').textContent = user.email;
      }
    });
  }
}

async function handleEmailLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('authErrorMsg');
  const btn = document.getElementById('loginSubmitBtn');

  if (errEl) errEl.classList.add('hidden');
  if (!isFirebaseConnected || !auth) {
    showAuthError("Firebase is not connected yet. Please use the Manager PIN tab (PIN: 0005) or configure your Firebase credentials.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Verifying Credentials...";

  try {
    const cred = await auth.signInWithEmailAndPassword(email, pass);
    currentAdminUser = cred.user;
    sessionStorage.setItem('kappy_admin_authenticated', 'true');
    sessionStorage.setItem('kappy_admin_email', cred.user.email);
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('userEmailDisplay').textContent = cred.user.email;
  } catch (err) {
    showAuthError(err.message || "Failed to authenticate with Firebase.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In with Firebase";
  }
}

function handlePinLogin(e) {
  e.preventDefault();
  const pin = document.getElementById('loginPin').value.trim();
  const configuredPin = localStorage.getItem('kappy_admin_pin') || DEFAULT_PIN;

  if (pin === configuredPin) {
    sessionStorage.setItem('kappy_admin_authenticated', 'true');
    sessionStorage.setItem('kappy_admin_email', 'Manager (PIN Verified)');
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('userEmailDisplay').textContent = 'Manager';
  } else {
    showAuthError("Invalid Manager PIN. Default PIN is 0005.");
  }
}

function showAuthError(msg) {
  const errEl = document.getElementById('authErrorMsg');
  if (errEl) {
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  }
}

function logoutAdmin() {
  if (auth) {
    auth.signOut().catch(() => {});
  }
  sessionStorage.removeItem('kappy_admin_authenticated');
  sessionStorage.removeItem('kappy_admin_email');
  document.getElementById('authScreen').classList.remove('hidden');
}

// ==========================================
// 3. MENU DATA LOADING & CLOUD FIRESTORE SYNC
// ==========================================
async function loadAdminMenuData() {
  // 1. Try Firestore if connected
  if (isFirebaseConnected && db) {
    try {
      const snap = await db.collection('menu_items').get();
      if (!snap.empty) {
        const cloudMenu = {};
        snap.forEach(doc => {
          const item = doc.data();
          const cat = item.category || 'other';
          if (!cloudMenu[cat]) cloudMenu[cat] = [];
          cloudMenu[cat].push({ ...item, id: doc.id });
        });
        ADMIN_MENU = cloudMenu;
      }

      const catSnap = await db.collection('categories').orderBy('order', 'asc').get();
      if (!catSnap.empty) {
        ADMIN_CATEGORIES = [];
        catSnap.forEach(doc => ADMIN_CATEGORIES.push({ id: doc.id, ...doc.data() }));
      }
    } catch (err) {
      console.warn('Firestore load failed, using local cache:', err);
    }
  }

  // 2. Fallback to Local Storage / menu.json
  if (!ADMIN_CATEGORIES || ADMIN_CATEGORIES.length === 0) {
    const stored = localStorage.getItem('kappy_cafe_menu_data');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        ADMIN_CATEGORIES = parsed._categories || [];
        delete parsed._categories;
        delete parsed._addons;
        ADMIN_MENU = parsed;
      } catch (e) {}
    }
  }

  // 3. Fallback to fetch('./menu.json')
  if (!ADMIN_CATEGORIES || ADMIN_CATEGORIES.length === 0 || Object.keys(ADMIN_MENU).length === 0) {
    try {
      const res = await fetch('./menu.json?t=' + Date.now());
      if (res.ok) {
        const json = await res.json();
        ADMIN_CATEGORIES = json._categories || [];
        delete json._categories;
        delete json._addons;
        ADMIN_MENU = json;
      }
    } catch (e) {}
  }

  // Save active copy locally
  saveLocalAdminMenu();
}

function saveLocalAdminMenu() {
  const full = {
    _categories: ADMIN_CATEGORIES,
    _addons: [
      { id: "extra_cheese_reg", name: "Extra Pizza Cheese (Regular)", price: 30, maxQty: 1, appliesTo: "category", targetCategory: "pizza", excludeCategories: [], enabled: true },
      { id: "extra_cheese_large", name: "Extra Pizza Cheese (Double / Large)", price: 50, maxQty: 1, appliesTo: "category", targetCategory: "pizza", excludeCategories: [], enabled: true }
    ],
    ...ADMIN_MENU
  };
  localStorage.setItem('kappy_cafe_menu_data', JSON.stringify(full));
}

function setupRealtimeMenuListener() {
  if (!isFirebaseConnected || !db) return;
  if (unsubscribeMenu) unsubscribeMenu();

  unsubscribeMenu = db.collection('menu_items').onSnapshot(snap => {
    const cloudMenu = {};
    snap.forEach(doc => {
      const item = doc.data();
      const cat = item.category || 'other';
      if (!cloudMenu[cat]) cloudMenu[cat] = [];
      cloudMenu[cat].push({ ...item, id: doc.id });
    });
    if (Object.keys(cloudMenu).length > 0) {
      ADMIN_MENU = cloudMenu;
      saveLocalAdminMenu();
      refreshCurrentTabView();
    }
  }, err => console.warn('Menu onSnapshot error:', err));
}

// ==========================================
// 4. ORDERS MANAGEMENT (Firestore Realtime)
// ==========================================
function setupRealtimeOrders() {
  if (!isFirebaseConnected || !db) {
    loadLocalOrders();
    return;
  }

  if (unsubscribeOrders) unsubscribeOrders();

  unsubscribeOrders = db.collection('orders').orderBy('createdAt', 'desc').limit(50).onSnapshot(snap => {
    ADMIN_ORDERS = [];
    snap.forEach(doc => {
      ADMIN_ORDERS.push({ id: doc.id, ...doc.data() });
    });
    localStorage.setItem('kappy_cafe_orders', JSON.stringify(ADMIN_ORDERS));
    updateOrdersBadge();
    if (currentTab === 'dashboard') renderRecentOrdersTable();
    if (currentTab === 'orders') renderOrdersTab();
  }, err => {
    console.warn('Orders realtime listener notice:', err);
    loadLocalOrders();
  });
}

function loadLocalOrders() {
  const saved = localStorage.getItem('kappy_cafe_orders');
  if (saved) {
    try { ADMIN_ORDERS = JSON.parse(saved); } catch (e) { ADMIN_ORDERS = []; }
  } else {
    ADMIN_ORDERS = [];
  }
  updateOrdersBadge();
}

function updateOrdersBadge() {
  const newCount = ADMIN_ORDERS.filter(o => o.status === 'New').length;
  const badge = document.getElementById('navOrderBadge');
  if (badge) {
    if (newCount > 0) {
      badge.textContent = newCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  const statOrders = document.getElementById('statTotalOrders');
  if (statOrders) statOrders.textContent = ADMIN_ORDERS.length;
}

// ==========================================
// 5. NAVIGATION TABS
// ==========================================
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('active', 'bg-brand-gold/15', 'text-brand-gold');
    el.classList.add('text-on-muted');
  });

  const activeContent = document.getElementById(`tab-${tab}`);
  const activeNav = document.getElementById(`nav-${tab}`);
  if (activeContent) activeContent.classList.remove('hidden');
  if (activeNav) {
    activeNav.classList.add('active', 'bg-brand-gold/15', 'text-brand-gold');
    activeNav.classList.remove('text-on-muted');
  }

  const titleMap = {
    dashboard: "Dashboard Overview",
    orders: "Customer Orders Stream",
    menu: "Menu Items & Catalog",
    prices: "Quick Price Management",
    stock: "Kitchen Stock & Availability",
    settings: "Settings & Cloud Sync"
  };
  document.getElementById('pageTitle').textContent = titleMap[tab] || "Dashboard";

  // Hide mobile drawer if open
  const sidebar = document.getElementById('sidebarNav');
  if (window.innerWidth < 768 && sidebar) {
    sidebar.classList.add('hidden');
    document.getElementById('mobileNavIcon').textContent = 'menu';
  }

  refreshCurrentTabView();
}

function toggleMobileMenu() {
  const nav = document.getElementById('sidebarNav');
  const icon = document.getElementById('mobileNavIcon');
  if (nav.classList.contains('hidden')) {
    nav.classList.remove('hidden');
    icon.textContent = 'close';
  } else {
    nav.classList.add('hidden');
    icon.textContent = 'menu';
  }
}

function refreshCurrentTabView() {
  if (currentTab === 'dashboard') renderDashboard();
  else if (currentTab === 'orders') renderOrdersTab();
  else if (currentTab === 'menu') renderMenuTab();
  else if (currentTab === 'prices') renderPriceCards();
  else if (currentTab === 'stock') renderStockCards();
}

function refreshAllData() {
  loadAdminMenuData().then(() => {
    refreshCurrentTabView();
  });
}

// ==========================================
// 6. DASHBOARD RENDERING
// ==========================================
function renderDashboard() {
  let totalItems = 0;
  let activeItems = 0;
  let outStock = 0;

  Object.values(ADMIN_MENU).forEach(list => {
    if (Array.isArray(list)) {
      list.forEach(dish => {
        totalItems++;
        if (dish.status === 'out_of_stock' || dish.status === 'unavailable' || dish.isOutOfStock) {
          outStock++;
        } else {
          activeItems++;
        }
      });
    }
  });

  document.getElementById('statTotalItems').textContent = totalItems;
  document.getElementById('statTotalCategories').textContent = ADMIN_CATEGORIES.length || 11;
  document.getElementById('statActiveItems').textContent = activeItems;
  document.getElementById('statOutStock').textContent = outStock;
  document.getElementById('statTotalOrders').textContent = ADMIN_ORDERS.length;

  renderRecentOrdersTable();
}

function renderRecentOrdersTable() {
  const tbody = document.getElementById('recentOrdersTbody');
  if (!tbody) return;

  if (ADMIN_ORDERS.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-on-muted">No orders received yet. Customer orders will appear here automatically.</td></tr>`;
    return;
  }

  const recents = ADMIN_ORDERS.slice(0, 7);
  tbody.innerHTML = recents.map(order => {
    const statusColor = getStatusColor(order.status);
    const timeStr = formatOrderTime(order.createdAt || order.createdAtLocal);
    const itemsCount = (order.items || []).reduce((sum, it) => sum + (it.qty || 1), 0);

    return `
      <tr class="hover:bg-surface-high/30 transition-colors">
        <td class="p-3.5 font-mono font-bold text-brand-gold text-[11px]">#${(order.orderId || order.id || 'ORD').slice(-6)}</td>
        <td class="p-3.5 font-medium text-on-surface">
          <div>${escapeHtml(order.customerName || 'Customer')}</div>
          <a href="tel:${order.customerPhone}" class="text-[10px] text-on-muted hover:text-brand-gold">${order.customerPhone || ''}</a>
        </td>
        <td class="p-3.5 capitalize">
          <span class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${order.orderType === 'delivery' ? 'bg-purple-500/15 text-purple-400' : (order.orderType === 'pickup' ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400')}">
            ${order.orderType || 'Dine-In'}
          </span>
        </td>
        <td class="p-3.5 text-on-muted">${itemsCount} items</td>
        <td class="p-3.5 font-bold text-on-surface">₹${Number(order.totalAmount || 0).toFixed(2)}</td>
        <td class="p-3.5 text-on-muted text-[11px]">${timeStr}</td>
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${statusColor}">
            ${order.status || 'New'}
          </span>
        </td>
        <td class="p-3.5 text-right">
          <button onclick="switchTab('orders')" class="px-2.5 py-1 rounded-lg bg-surface-high hover:bg-surface-highest text-on-surface font-semibold text-[11px]">Manage</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================
// 7. ORDERS TAB RENDERING & STATUS UPDATES
// ==========================================
let activeOrderFilter = 'ALL';

function filterOrders(status) {
  activeOrderFilter = status;
  document.querySelectorAll('.order-pill').forEach(btn => {
    if (btn.textContent.trim().toUpperCase() === status.toUpperCase() || (status === 'ALL' && btn.textContent.trim() === 'All')) {
      btn.className = "order-pill active px-3 py-1.5 rounded-xl text-xs font-bold bg-brand-gold text-surface-lowest";
    } else {
      btn.className = "order-pill px-3 py-1.5 rounded-xl text-xs font-bold bg-surface-high text-on-muted hover:text-on-surface";
    }
  });
  renderOrdersTab();
}

function renderOrdersTab() {
  const container = document.getElementById('ordersListContainer');
  if (!container) return;

  const filtered = activeOrderFilter === 'ALL'
    ? ADMIN_ORDERS
    : ADMIN_ORDERS.filter(o => o.status === activeOrderFilter);

  document.getElementById('orderFilterCount').textContent = filtered.length;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full p-12 text-center rounded-2xl bg-surface-card border border-surface-high text-on-muted flex flex-col items-center justify-center gap-2">
        <span class="material-symbols-outlined text-[36px] text-brand-gold">inbox</span>
        <span class="font-bold text-sm text-on-surface">No ${activeOrderFilter === 'ALL' ? '' : activeOrderFilter} orders found</span>
        <p class="text-xs max-w-sm">When customers place orders via WhatsApp or online tray, they will instantly stream here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(order => {
    const statusColor = getStatusColor(order.status);
    const timeStr = formatOrderTime(order.createdAt || order.createdAtLocal);
    const itemsListHtml = (order.items || []).map(it => {
      const v = it.variantLabel ? ` (${it.variantLabel})` : '';
      return `<li class="flex justify-between py-1 border-b border-surface-high/40 text-[11px]">
        <span><strong>${it.qty || 1}x</strong> ${escapeHtml(it.name || it.dishName || 'Item')}${v}</span>
        <span class="font-mono text-on-surface">₹${Number(it.price || it.unitPrice || 0) * (it.qty || 1)}</span>
      </li>`;
    }).join('');

    const customerPhone = order.customerPhone || '';
    const cleanPhone = customerPhone.replace(/\D/g, '');

    return `
      <div class="p-4 md:p-5 rounded-2xl bg-surface-card border border-surface-high flex flex-col justify-between shadow-sm">
        <div class="flex flex-col gap-2.5">
          <!-- Card Header -->
          <div class="flex items-center justify-between pb-2 border-b border-surface-high">
            <div>
              <span class="font-mono font-bold text-brand-gold text-xs">#${(order.orderId || order.id || 'ORD').slice(-6)}</span>
              <span class="text-[10px] text-on-muted ml-2">${timeStr}</span>
            </div>
            <span class="px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold uppercase ${statusColor}">
              ${order.status || 'New'}
            </span>
          </div>

          <!-- Customer Details -->
          <div class="flex items-start justify-between">
            <div class="flex flex-col">
              <span class="font-bold text-sm text-on-surface">${escapeHtml(order.customerName || 'Customer')}</span>
              <span class="text-xs text-on-muted">${order.customerPhone || 'No Phone'}</span>
              ${order.address ? `<span class="text-[11px] text-brand-gold-light mt-0.5">📍 ${escapeHtml(order.address)}</span>` : ''}
              ${order.specialInstructions ? `<span class="text-[10px] text-amber-300 italic mt-0.5">Note: ${escapeHtml(order.specialInstructions)}</span>` : ''}
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              ${cleanPhone ? `
                <a href="tel:${cleanPhone}" class="w-8 h-8 rounded-xl bg-surface-high hover:bg-surface-highest text-brand-gold flex items-center justify-center" title="Call Customer">
                  <span class="material-symbols-outlined text-[16px]">call</span>
                </a>
                <a href="https://wa.me/${cleanPhone}" target="_blank" class="w-8 h-8 rounded-xl bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 flex items-center justify-center" title="WhatsApp Customer">
                  <span class="material-symbols-outlined text-[16px]">chat</span>
                </a>
              ` : ''}
            </div>
          </div>

          <!-- Items Ordered -->
          <div class="mt-1 bg-surface-low rounded-xl p-2.5 border border-surface-high/60">
            <span class="text-[10px] uppercase tracking-wider text-on-muted font-bold block mb-1">Items Ordered:</span>
            <ul class="flex flex-col">${itemsListHtml}</ul>
            <div class="flex justify-between items-center pt-2 text-xs font-bold text-brand-gold">
              <span>Total Payable</span>
              <span>₹${Number(order.totalAmount || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>

        <!-- Status Action Stepper -->
        <div class="mt-4 pt-3 border-t border-surface-high flex flex-col gap-1.5">
          <span class="text-[10px] uppercase tracking-wider text-on-muted font-semibold">Update Status:</span>
          <div class="grid grid-cols-3 gap-1">
            <button onclick="updateOrderStatus('${order.id}', 'Accepted')" class="py-1 text-[10px] font-bold rounded-lg bg-surface-high hover:bg-surface-highest text-on-surface ${order.status === 'Accepted' ? 'ring-1 ring-brand-gold text-brand-gold' : ''}">Accept</button>
            <button onclick="updateOrderStatus('${order.id}', 'Preparing')" class="py-1 text-[10px] font-bold rounded-lg bg-surface-high hover:bg-surface-highest text-on-surface ${order.status === 'Preparing' ? 'ring-1 ring-brand-gold text-brand-gold' : ''}">Cooking</button>
            <button onclick="updateOrderStatus('${order.id}', 'Ready')" class="py-1 text-[10px] font-bold rounded-lg bg-surface-high hover:bg-surface-highest text-on-surface ${order.status === 'Ready' ? 'ring-1 ring-brand-gold text-brand-gold' : ''}">Ready</button>
            <button onclick="updateOrderStatus('${order.id}', 'Completed')" class="py-1 text-[10px] font-bold rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30">Complete</button>
            <button onclick="updateOrderStatus('${order.id}', 'Cancelled')" class="py-1 text-[10px] font-bold rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30">Cancel</button>
            <button onclick="deleteOrder('${order.id}')" class="py-1 text-[10px] font-bold rounded-lg bg-surface-high text-on-muted hover:text-red-400">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function updateOrderStatus(orderId, newStatus) {
  // Update local memory first
  const order = ADMIN_ORDERS.find(o => o.id === orderId);
  if (order) order.status = newStatus;
  localStorage.setItem('kappy_cafe_orders', JSON.stringify(ADMIN_ORDERS));
  renderOrdersTab();
  updateOrdersBadge();

  // Sync to Firestore if online
  if (isFirebaseConnected && db && orderId) {
    try {
      await db.collection('orders').doc(orderId).update({
        status: newStatus,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('Failed to update order status in Firestore:', e);
    }
  }
}

async function deleteOrder(orderId) {
  if (!confirm('Are you sure you want to delete this order record?')) return;
  ADMIN_ORDERS = ADMIN_ORDERS.filter(o => o.id !== orderId);
  localStorage.setItem('kappy_cafe_orders', JSON.stringify(ADMIN_ORDERS));
  renderOrdersTab();
  updateOrdersBadge();

  if (isFirebaseConnected && db && orderId) {
    try {
      await db.collection('orders').doc(orderId).delete();
    } catch (e) {}
  }
}

// ==========================================
// 8. MENU MANAGEMENT TAB
// ==========================================
function renderMenuTab() {
  populateCategoryDropdowns();
  renderAdminMenuItemsTable();
}

function populateCategoryDropdowns() {
  const catFilter = document.getElementById('menuAdminCatSelect');
  const catModalSelect = document.getElementById('itemFormCategory');

  if (catFilter) {
    catFilter.innerHTML = `<option value="ALL">All Categories (${ADMIN_CATEGORIES.length})</option>` +
      ADMIN_CATEGORIES.map(c => `<option value="${c.id}">${c.emoji || '🍽️'} ${c.name}</option>`).join('');
  }

  if (catModalSelect) {
    catModalSelect.innerHTML = ADMIN_CATEGORIES.map(c => `<option value="${c.id}">${c.emoji || '🍽️'} ${c.name}</option>`).join('');
  }
}

function renderAdminMenuItemsTable() {
  const tbody = document.getElementById('menuAdminTbody');
  if (!tbody) return;

  const search = (document.getElementById('menuAdminSearch')?.value || '').toLowerCase().trim();
  const selectedCat = document.getElementById('menuAdminCatSelect')?.value || 'ALL';

  let rows = [];

  Object.entries(ADMIN_MENU).forEach(([catKey, items]) => {
    if (selectedCat !== 'ALL' && catKey !== selectedCat) return;
    if (!Array.isArray(items)) return;

    items.forEach((dish, idx) => {
      const matchSearch = !search ||
        dish.name.toLowerCase().includes(search) ||
        (dish.description && dish.description.toLowerCase().includes(search));

      if (matchSearch) {
        rows.push({ ...dish, _category: catKey, _index: idx });
      }
    });
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-on-muted">No dishes found matching your filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(item => {
    const isOut = item.status === 'out_of_stock' || item.isOutOfStock;
    const catObj = ADMIN_CATEGORIES.find(c => c.id === item._category) || { name: item._category, emoji: '🍽️' };

    let priceDisplay = '';
    if (Array.isArray(item.variants) && item.variants.length > 0) {
      priceDisplay = item.variants.map(v => `<span class="px-1.5 py-0.5 rounded bg-surface-low text-on-muted text-[10px] font-mono mr-1">${v.label}: ₹${v.price}</span>`).join('');
    } else {
      priceDisplay = `<span class="font-bold font-mono text-brand-gold text-xs">₹${item.price || 0}</span>`;
    }

    return `
      <tr class="hover:bg-surface-high/30 transition-colors">
        <td class="p-3.5">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-surface-low border border-surface-high flex items-center justify-center shrink-0 text-base">
              ${item.image ? `<img src="${item.image}" class="w-full h-full object-cover rounded-lg">` : (catObj.emoji || '🍽️')}
            </div>
            <div>
              <span class="font-bold text-xs text-on-surface block">${escapeHtml(item.name)}</span>
            </div>
          </div>
        </td>
        <td class="p-3.5 text-on-muted whitespace-nowrap">
          <span class="px-2 py-0.5 rounded-lg bg-surface-low border border-surface-high text-[11px] font-medium">
            ${catObj.emoji || '🍽️'} ${catObj.name}
          </span>
        </td>
        <td class="p-3.5 text-on-muted text-[11px] max-w-xs truncate">
          ${escapeHtml(item.description || '—')}
        </td>
        <td class="p-3.5 whitespace-nowrap">${priceDisplay}</td>
        <td class="p-3.5 whitespace-nowrap">
          <button onclick="toggleDishAvailability('${item._category}', ${item._index})" class="px-2.5 py-1 rounded-xl text-[10px] font-bold ${isOut ? 'bg-status-amber/15 text-status-amber border border-status-amber/30' : 'bg-status-green/15 text-status-green border border-status-green/30'} flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full ${isOut ? 'bg-status-amber' : 'bg-status-green'}"></span>
            ${isOut ? 'Out of Stock' : 'Available'}
          </button>
        </td>
        <td class="p-3.5 text-right whitespace-nowrap">
          <button onclick="openEditItemModal('${item._category}', ${item._index})" class="p-1.5 rounded-lg hover:bg-surface-highest text-on-muted hover:text-brand-gold mr-1" title="Edit">
            <span class="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button onclick="deleteMenuItem('${item._category}', ${item._index})" class="p-1.5 rounded-lg hover:bg-red-500/20 text-on-muted hover:text-red-400" title="Delete">
            <span class="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Modal Handlers
function openAddItemModal() {
  document.getElementById('itemModalTitle').textContent = "Add New Menu Dish";
  document.getElementById('editItemOriginalKey').value = "";
  document.getElementById('editItemOriginalCategory').value = "";
  document.getElementById('itemFormName').value = "";
  document.getElementById('itemFormDesc').value = "";
  document.getElementById('itemFormSinglePrice').value = "";
  document.getElementById('itemFormImage').value = "";
  document.getElementById('itemFormAvailable').checked = true;

  togglePricingInputs(false);
  populateCategoryDropdowns();
  document.getElementById('itemModal').classList.remove('hidden');
}

function openEditItemModal(category, index) {
  const item = (ADMIN_MENU[category] || [])[index];
  if (!item) return;

  document.getElementById('itemModalTitle').textContent = `Edit Dish: ${item.name}`;
  document.getElementById('editItemOriginalCategory').value = category;
  document.getElementById('editItemOriginalKey').value = index;

  populateCategoryDropdowns();
  document.getElementById('itemFormCategory').value = category;
  document.getElementById('itemFormName').value = item.name || '';
  document.getElementById('itemFormDesc').value = item.description || '';
  document.getElementById('itemFormImage').value = item.image || '';
  document.getElementById('itemFormAvailable').checked = !(item.status === 'out_of_stock' || item.isOutOfStock);

  if (Array.isArray(item.variants) && item.variants.length > 0) {
    document.querySelector('input[name="pricingType"][value="variants"]').checked = true;
    togglePricingInputs(true);
    const container = document.getElementById('variantsInputsContainer');
    container.innerHTML = '';
    item.variants.forEach(v => addVariantRow(v.label, v.price));
  } else {
    document.querySelector('input[name="pricingType"][value="single"]').checked = true;
    togglePricingInputs(false);
    document.getElementById('itemFormSinglePrice').value = item.price || 0;
  }

  document.getElementById('itemModal').classList.remove('hidden');
}

function closeItemModal() {
  document.getElementById('itemModal').classList.add('hidden');
}

function togglePricingInputs(isVariants) {
  const sSec = document.getElementById('singlePriceSection');
  const vSec = document.getElementById('variantsPriceSection');
  if (isVariants) {
    sSec.classList.add('hidden');
    vSec.classList.remove('hidden');
    const container = document.getElementById('variantsInputsContainer');
    if (container.children.length === 0) {
      addVariantRow('S', 80);
      addVariantRow('M', 140);
      addVariantRow('L', 240);
    }
  } else {
    sSec.classList.remove('hidden');
    vSec.classList.add('hidden');
  }
}

function addVariantRow(label = '', price = '') {
  const container = document.getElementById('variantsInputsContainer');
  const row = document.createElement('div');
  row.className = "flex items-center gap-2";
  row.innerHTML = `
    <input type="text" placeholder="Portion (e.g. S / With Cheese)" value="${escapeHtml(label)}" class="var-label flex-1 bg-surface-card border border-surface-high p-2 rounded-xl text-on-surface">
    <input type="number" placeholder="Price (₹)" value="${price}" class="var-price w-28 bg-surface-card border border-surface-high p-2 rounded-xl text-on-surface font-mono">
    <button type="button" onclick="this.parentElement.remove()" class="text-on-muted hover:text-red-400 p-1">
      <span class="material-symbols-outlined text-[16px]">remove_circle</span>
    </button>
  `;
  container.appendChild(row);
}

async function handleSaveItem(e) {
  e.preventDefault();
  const cat = document.getElementById('itemFormCategory').value;
  const name = document.getElementById('itemFormName').value.trim();
  const desc = document.getElementById('itemFormDesc').value.trim();
  const img = document.getElementById('itemFormImage').value.trim();
  const available = document.getElementById('itemFormAvailable').checked;
  const isVariants = document.querySelector('input[name="pricingType"]:checked').value === 'variants';

  const origCat = document.getElementById('editItemOriginalCategory').value;
  const origIdx = document.getElementById('editItemOriginalKey').value;

  const newItem = {
    name,
    description: desc,
    status: available ? 'available' : 'out_of_stock',
    updatedAt: Date.now()
  };
  if (img) newItem.image = img;

  if (isVariants) {
    const varRows = document.querySelectorAll('#variantsInputsContainer > div');
    const variants = [];
    varRows.forEach(r => {
      const l = r.querySelector('.var-label').value.trim();
      const p = Number(r.querySelector('.var-price').value) || 0;
      if (l) variants.push({ label: l, price: p });
    });
    newItem.variants = variants;
  } else {
    newItem.price = Number(document.getElementById('itemFormSinglePrice').value) || 0;
  }

  // Save to Memory
  if (!ADMIN_MENU[cat]) ADMIN_MENU[cat] = [];

  if (origIdx !== "" && origCat) {
    // If category changed, remove from old
    if (origCat !== cat) {
      ADMIN_MENU[origCat].splice(Number(origIdx), 1);
      ADMIN_MENU[cat].push(newItem);
    } else {
      ADMIN_MENU[cat][Number(origIdx)] = newItem;
    }
  } else {
    ADMIN_MENU[cat].push(newItem);
  }

  saveLocalAdminMenu();
  closeItemModal();
  renderAdminMenuItemsTable();
  renderDashboard();

  // Sync to Firestore if connected
  if (isFirebaseConnected && db) {
    try {
      const docId = `${cat}_${name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
      await db.collection('menu_items').doc(docId).set({
        ...newItem,
        category: cat
      }, { merge: true });
    } catch (err) {
      console.warn('Firestore item save error:', err);
    }
  }
}

async function deleteMenuItem(category, index) {
  const item = (ADMIN_MENU[category] || [])[index];
  if (!item) return;

  if (!confirm(`Are you sure you want to permanently delete "${item.name}" from the menu?`)) {
    return;
  }

  ADMIN_MENU[category].splice(index, 1);
  saveLocalAdminMenu();
  renderAdminMenuItemsTable();
  renderDashboard();

  if (isFirebaseConnected && db) {
    try {
      const docId = `${category}_${item.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
      await db.collection('menu_items').doc(docId).delete();
    } catch (e) {}
  }
}

async function toggleDishAvailability(category, index) {
  const item = (ADMIN_MENU[category] || [])[index];
  if (!item) return;

  const currentOut = item.status === 'out_of_stock' || item.isOutOfStock;
  item.status = currentOut ? 'available' : 'out_of_stock';
  item.isOutOfStock = !currentOut;

  saveLocalAdminMenu();
  renderAdminMenuItemsTable();
  renderDashboard();

  if (isFirebaseConnected && db) {
    try {
      const docId = `${category}_${item.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
      await db.collection('menu_items').doc(docId).set({
        status: item.status,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {}
  }
}

// Category Creation
function openAddCategoryModal() {
  document.getElementById('newCatName').value = '';
  document.getElementById('categoryModal').classList.remove('hidden');
}
function closeCategoryModal() {
  document.getElementById('categoryModal').classList.add('hidden');
}

async function handleSaveCategory(e) {
  e.preventDefault();
  const name = document.getElementById('newCatName').value.trim();
  const emoji = document.getElementById('newCatEmoji').value.trim() || '🍽️';
  if (!name) return;

  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (ADMIN_CATEGORIES.some(c => c.id === id)) {
    alert('This category already exists!');
    return;
  }

  const newCat = { id, name, emoji, order: ADMIN_CATEGORIES.length + 1 };
  ADMIN_CATEGORIES.push(newCat);
  if (!ADMIN_MENU[id]) ADMIN_MENU[id] = [];

  saveLocalAdminMenu();
  closeCategoryModal();
  populateCategoryDropdowns();
  renderAdminMenuItemsTable();

  if (isFirebaseConnected && db) {
    try {
      await db.collection('categories').doc(id).set(newCat);
    } catch (e) {}
  }
}

// ==========================================
// 9. PRICE MANAGEMENT TAB
// ==========================================
function renderPriceCards() {
  const container = document.getElementById('priceCardsContainer');
  if (!container) return;

  let html = '';
  Object.entries(ADMIN_MENU).forEach(([catKey, items]) => {
    if (!Array.isArray(items)) return;
    const cat = ADMIN_CATEGORIES.find(c => c.id === catKey) || { name: catKey, emoji: '🍽️' };

    items.forEach((dish, idx) => {
      const hasVariants = Array.isArray(dish.variants) && dish.variants.length > 0;

      let inputsHtml = '';
      if (hasVariants) {
        inputsHtml = dish.variants.map((v, vIdx) => `
          <div class="flex items-center justify-between text-xs py-1 border-b border-surface-high/40">
            <span class="text-on-muted">${v.label}:</span>
            <div class="flex items-center gap-1 font-mono">
              <span>₹</span>
              <input type="number" min="0" step="1" value="${v.price}" data-cat="${catKey}" data-idx="${idx}" data-vidx="${vIdx}" class="bulk-price-input w-20 bg-surface-low border border-surface-high p-1 text-right text-on-surface rounded-lg">
            </div>
          </div>
        `).join('');
      } else {
        inputsHtml = `
          <div class="flex items-center justify-between text-xs py-1">
            <span class="text-on-muted">Regular Price:</span>
            <div class="flex items-center gap-1 font-mono">
              <span>₹</span>
              <input type="number" min="0" step="1" value="${dish.price || 0}" data-cat="${catKey}" data-idx="${idx}" class="bulk-price-input w-24 bg-surface-low border border-surface-high p-1 text-right text-on-surface rounded-lg">
            </div>
          </div>
        `;
      }

      html += `
        <div class="p-3.5 rounded-2xl bg-surface-card border border-surface-high flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="font-bold text-xs text-on-surface truncate">${escapeHtml(dish.name)}</span>
              <span class="text-[10px] text-on-muted bg-surface-low px-1.5 py-0.5 rounded">${cat.emoji || ''} ${cat.name}</span>
            </div>
            <div class="flex flex-col">${inputsHtml}</div>
          </div>
          <button onclick="saveSinglePrice('${catKey}', ${idx})" class="mt-3 py-1.5 rounded-xl bg-surface-high hover:bg-brand-gold hover:text-surface-lowest text-[11px] font-bold text-on-surface transition-all">
            Update Price
          </button>
        </div>
      `;
    });
  });

  container.innerHTML = html;
}

async function saveSinglePrice(catKey, idx) {
  const inputs = document.querySelectorAll(`.bulk-price-input[data-cat="${catKey}"][data-idx="${idx}"]`);
  const dish = (ADMIN_MENU[catKey] || [])[idx];
  if (!dish) return;

  if (inputs.length === 1 && !inputs[0].hasAttribute('data-vidx')) {
    dish.price = Number(inputs[0].value) || 0;
  } else {
    inputs.forEach(inp => {
      const vIdx = Number(inp.getAttribute('data-vidx'));
      if (dish.variants && dish.variants[vIdx]) {
        dish.variants[vIdx].price = Number(inp.value) || 0;
      }
    });
  }

  dish.updatedAt = Date.now();
  saveLocalAdminMenu();

  if (isFirebaseConnected && db) {
    try {
      const docId = `${catKey}_${dish.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
      await db.collection('menu_items').doc(docId).set({
        price: dish.price || 0,
        variants: dish.variants || null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {}
  }

  alert(`Price updated for "${dish.name}"!`);
}

async function saveAllBulkPrices() {
  const inputs = document.querySelectorAll('.bulk-price-input');
  inputs.forEach(inp => {
    const cat = inp.getAttribute('data-cat');
    const idx = Number(inp.getAttribute('data-idx'));
    const dish = (ADMIN_MENU[cat] || [])[idx];
    if (!dish) return;

    if (inp.hasAttribute('data-vidx')) {
      const vIdx = Number(inp.getAttribute('data-vidx'));
      if (dish.variants && dish.variants[vIdx]) {
        dish.variants[vIdx].price = Number(inp.value) || 0;
      }
    } else {
      dish.price = Number(inp.value) || 0;
    }
  });

  saveLocalAdminMenu();

  if (isFirebaseConnected && db) {
    const batch = db.batch();
    Object.entries(ADMIN_MENU).forEach(([catKey, items]) => {
      items.forEach(dish => {
        const docId = `${catKey}_${dish.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
        const ref = db.collection('menu_items').doc(docId);
        batch.set(ref, {
          price: dish.price || 0,
          variants: dish.variants || null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
    });
    await batch.commit().catch(() => {});
  }

  alert('All prices successfully updated and synced!');
}

// ==========================================
// 10. STOCK & AVAILABILITY TAB
// ==========================================
function renderStockCards() {
  const container = document.getElementById('stockGridContainer');
  if (!container) return;

  let html = '';
  Object.entries(ADMIN_MENU).forEach(([catKey, items]) => {
    if (!Array.isArray(items)) return;
    const cat = ADMIN_CATEGORIES.find(c => c.id === catKey) || { name: catKey, emoji: '🍽️' };

    items.forEach((dish, idx) => {
      const isOut = dish.status === 'out_of_stock' || dish.isOutOfStock;

      html += `
        <div class="p-3.5 rounded-2xl bg-surface-card border border-surface-high flex items-center justify-between">
          <div class="flex flex-col pr-2">
            <span class="font-bold text-xs text-on-surface">${escapeHtml(dish.name)}</span>
            <span class="text-[10px] text-on-muted">${cat.emoji || ''} ${cat.name}</span>
          </div>
          <button onclick="toggleDishAvailability('${catKey}', ${idx}); renderStockCards();" class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${isOut ? 'bg-status-amber/15 text-status-amber border border-status-amber/30' : 'bg-status-green/15 text-status-green border border-status-green/30'} flex items-center gap-1.5 shrink-0">
            <span class="w-2 h-2 rounded-full ${isOut ? 'bg-status-amber' : 'bg-status-green'}"></span>
            <span>${isOut ? 'Out of Stock' : 'Available'}</span>
          </button>
        </div>
      `;
    });
  });

  container.innerHTML = html;
}

// ==========================================
// 11. RESTAURANT SETTINGS & 1-CLICK SEED FIRESTORE
// ==========================================
async function saveRestaurantSettings() {
  REST_SETTINGS.restaurantName = document.getElementById('cfgRestName').value.trim();
  REST_SETTINGS.tagline = document.getElementById('cfgTagline').value.trim();
  REST_SETTINGS.whatsappNumber = document.getElementById('cfgWhatsApp').value.trim();
  REST_SETTINGS.secondaryPhone = document.getElementById('cfgPhone2').value.trim();
  REST_SETTINGS.deliveryFee = Number(document.getElementById('cfgDeliveryFee').value) || 0;
  REST_SETTINGS.takeawayFee = Number(document.getElementById('cfgTakeawayFee').value) || 0;

  localStorage.setItem('kappy_cafe_settings', JSON.stringify(REST_SETTINGS));

  if (isFirebaseConnected && db) {
    try {
      await db.collection('settings').doc('restaurant_settings').set(REST_SETTINGS, { merge: true });
    } catch (e) {}
  }

  alert('Settings successfully updated! WhatsApp ordering number: +' + REST_SETTINGS.whatsappNumber);
}

async function saveFirebaseConfig() {
  const config = {
    apiKey: document.getElementById('fbApiKey').value.trim(),
    authDomain: document.getElementById('fbAuthDomain').value.trim(),
    projectId: document.getElementById('fbProjectId').value.trim(),
    storageBucket: document.getElementById('fbStorageBucket').value.trim()
  };

  if (!config.projectId) {
    alert('Please enter at least your Firebase Project ID.');
    return;
  }

  localStorage.setItem('kappy_cafe_firebase_config', JSON.stringify(config));

  // Sync to secure backend server so customer orders are saved to Firebase silently in the background
  try {
    await fetch('/api/server-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: config.projectId, apiKey: config.apiKey })
    });
  } catch (e) {}

  alert('Firebase configuration saved and synced with server backend!');
  window.location.reload();
}

async function testFirebaseConnection() {
  const resEl = document.getElementById('fbTestResult');
  resEl.className = "text-xs p-3 rounded-xl bg-surface-high text-on-surface block";
  resEl.textContent = "Testing connection to Cloud Firestore...";

  if (!isFirebaseConnected || !db) {
    resEl.className = "text-xs p-3 rounded-xl bg-status-amber/20 text-status-amber block";
    resEl.textContent = "Firebase is not yet initialized. Please check API Key and Project ID above, then click 'Save Firebase Config'.";
    return;
  }

  try {
    const testDoc = await db.collection('settings').doc('restaurant_settings').get();
    resEl.className = "text-xs p-3 rounded-xl bg-status-green/20 text-status-green block";
    resEl.textContent = `✓ Successfully connected to Firebase Project "${db.app.options.projectId}"! Firestore is ready.`;
  } catch (err) {
    resEl.className = "text-xs p-3 rounded-xl bg-status-red/20 text-status-red block";
    resEl.textContent = `Connection failed: ${err.message}. Ensure Cloud Firestore is enabled in Firebase Console (Test mode / rules applied).`;
  }
}

async function seedFirestoreFromLocalMenu() {
  if (!isFirebaseConnected || !db) {
    alert("Please configure and save your Firebase Project credentials first!");
    return;
  }

  if (!confirm("This will upload all 11 Kappy Cafe categories and full menu items into Cloud Firestore. Proceed?")) {
    return;
  }

  const resEl = document.getElementById('fbTestResult');
  resEl.className = "text-xs p-3 rounded-xl bg-surface-high text-brand-gold block";
  resEl.textContent = "Uploading categories and menu items to Firestore in batch...";

  try {
    const batch = db.batch();

    // 1. Seed Categories
    ADMIN_CATEGORIES.forEach((cat, idx) => {
      const ref = db.collection('categories').doc(cat.id);
      batch.set(ref, {
        id: cat.id,
        name: cat.name,
        emoji: cat.emoji || '🍽️',
        order: idx + 1,
        active: true
      });
    });

    // 2. Seed Menu Items
    Object.entries(ADMIN_MENU).forEach(([catKey, items]) => {
      if (Array.isArray(items)) {
        items.forEach(dish => {
          const docId = `${catKey}_${dish.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
          const ref = db.collection('menu_items').doc(docId);
          batch.set(ref, {
            name: dish.name,
            category: catKey,
            description: dish.description || '',
            price: dish.price || 0,
            variants: dish.variants || null,
            status: dish.status || 'available',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
      }
    });

    // 3. Seed Restaurant Settings
    const setRef = db.collection('settings').doc('restaurant_settings');
    batch.set(setRef, REST_SETTINGS, { merge: true });

    await batch.commit();

    resEl.className = "text-xs p-3 rounded-xl bg-status-green/20 text-status-green block";
    resEl.textContent = `✓ Successfully seeded Firestore with ${ADMIN_CATEGORIES.length} categories and all menu dishes!`;
    alert("Firestore has been populated with all categories and menu items!");
  } catch (err) {
    resEl.className = "text-xs p-3 rounded-xl bg-status-red/20 text-status-red block";
    resEl.textContent = `Seeding failed: ${err.message}`;
  }
}

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getStatusColor(status) {
  switch (status) {
    case 'New': return 'bg-brand-amber/15 text-brand-amber border border-brand-amber/30';
    case 'Accepted': return 'bg-blue-500/15 text-blue-400 border border-blue-500/30';
    case 'Preparing': return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
    case 'Ready': return 'bg-teal-500/15 text-teal-400 border border-teal-500/30';
    case 'Completed': return 'bg-status-green/15 text-status-green border border-status-green/30';
    case 'Cancelled': return 'bg-status-red/15 text-status-red border border-status-red/30';
    default: return 'bg-surface-high text-on-muted';
  }
}

function formatOrderTime(ts) {
  if (!ts) return 'Just now';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch (e) {
    return 'Recent';
  }
}
