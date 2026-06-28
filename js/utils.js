// ════════════════════════════════════════════════════════════════
// PICO · Utilidades, fix de stock y gate de sucursal
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════
// Mapa de páginas → archivos HTML (estructura multipágina).
const PAGE_URLS = {
  catalog:    '/',
  myOrders:   '/mis-pedidos/',
  adminPanel: '/admin/',
  profile:    '/perfil/'
};

// Normaliza una ruta para comparar (quita index.html y barras finales).
function normPath(p) {
  return p.replace(/index\.html$/, '').replace(/\/+$/, '') || '/';
}

// Navega a la página solicitada. Si ya estamos en ella, solo sube al inicio.
function showPage(name) {
  if (name === 'adminPanel' && !isAdmin) {
    showToast('⚠️ Acceso solo para administradores');
    return;
  }
  const url = PAGE_URLS[name];
  if (!url) return;
  if (normPath(location.pathname) === normPath(url)) { window.scrollTo(0, 0); return; }
  location.href = url;
}

// Comportamiento del logo del encabezado:
//   • Si YA estamos en la página principal (catálogo) → recarga la página.
//   • Si estamos en cualquier otra página → redirige a la principal.
function goHomeFromLogo() {
  const enPrincipal = normPath(location.pathname) === normPath(PAGE_URLS.catalog);
  if (enPrincipal) {
    location.reload();                 // ya en la principal → refrescar
  } else {
    location.href = PAGE_URLS.catalog; // otra página → ir a la principal
  }
}

// Dispatcher de inicialización según la página actual (data-page en <body>).
// Se llama desde onAuthStateChanged, cuando ya se conoce el estado de sesión.
function initPageAfterAuth() {
  const page = document.body.dataset.page;
  if (page === 'myOrders') {
    renderMyOrders();
  } else if (page === 'profile') {
    if (currentUser) {
      renderProfile();
    } else {
      showToast('⚠️ Inicia sesión para ver tu perfil');
      setTimeout(() => { location.href = '/'; }, 1300);
    }
  } else if (page === 'adminPanel') {
    if (isAdmin) {
      renderAdminPanel();
    } else {
      showToast('⚠️ Acceso solo para administradores');
      setTimeout(() => { location.href = '/'; }, 1300);
    }
  }
  // 'catalog' se renderiza vía loadProducts() -> renderProducts().
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
  document.body.style.touchAction = 'none';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  const anyOpen = document.querySelector('.moverlay.open');
  if (!anyOpen) {
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
  }
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-SV', { day:'2-digit', month:'2-digit', year:'numeric' })
       + ' ' + d.toLocaleTimeString('es-SV', { hour:'2-digit', minute:'2-digit' });
}

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'EL-';
  for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ═══════════════════════════════════════════════════
//  FIX STOCK — ejecutar UNA VEZ desde consola de Chrome:
//  fixStockTotal()
// ═══════════════════════════════════════════════════
async function fixStockTotal() {
  // Ya no es necesaria: el stock se calcula en tiempo real como stockCdb + stockExsal.
  // El campo "stock" ya no se escribe en Firestore desde ninguna pagina.
  console.log('fixStockTotal() ya no es necesaria. El stock se calcula en tiempo real desde stockCdb + stockExsal.');
  alert('Esta funcion ya no es necesaria. El stock se calcula automaticamente como stockCdb + stockExsal.');
}

// ═══════════════════════════════════════════════════
//  GATE DE SUCURSAL (obligatorio antes de usar la app)
// ═══════════════════════════════════════════════════
function showSucursalGate() {
  const m = document.getElementById('sucursalGateModal');
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}
// Muestra el aviso de "Próximamente" para el envío a domicilio.
function showComingSoon() {
  openModal('comingSoonModal');
}

function chooseGateSucursal(suc) {
  selectedSucursal = suc;
  localStorage.setItem(SUCURSAL_KEY, suc);
  // Sincronizar con el perfil del usuario logueado (si lo hay)
  syncSucursalToProfile(suc);
  const m = document.getElementById('sucursalGateModal');
  m.classList.remove('open');
  if (!document.querySelector('.moverlay.open')) document.body.style.overflow = '';
  showToast(suc === 'cdb' ? '🏫 Sucursal: Don Bosco (CDB)'
          : suc === 'exsal' ? '🏢 Sucursal: EXSAL'
          : '🚚 Entrega: Envío a domicilio');
  // Vaciar carrito al cambiar de sucursal (el stock difiere entre sucursales)
  cart = {};
  saveCart();
  updateCartUI();
  // Recargar productos con el stock de la nueva sucursal
  loadProducts();
}
function updateSucursalBadge() {
  const el = document.getElementById('sucursalBadge');
  if (!el) return;
  if (!selectedSucursal) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  const sucLabel = selectedSucursal === 'cdb'   ? '🏫 CDB'
                 : selectedSucursal === 'exsal' ? '🏢 EXSAL'
                 : selectedSucursal === 'domicilio' ? '🚚 Domicilio'
                 : '';
  el.innerHTML = sucLabel
    + ' <span style="font-size:.7rem;color:var(--g400);font-weight:500">▼</span>';
}

// Permite reabrir el gate manualmente (ej. para cambiar de sucursal)
function reopenSucursalGate() { showSucursalGate(); }

function syncSucursalToProfile(suc) {
  if (!currentUser) return;
  const key   = 'el_profile_' + currentUser.uid;
  const saved = JSON.parse(localStorage.getItem(key) || '{}');
  saved.sucursal = suc;
  localStorage.setItem(key, JSON.stringify(saved));
}
