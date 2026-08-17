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
  profile:    '/perfil/',
  stampCards: '/mis-tarjetas/'
};

// Normaliza una ruta para comparar (quita index.html y barras finales).
function normPath(p) {
  return p.replace(/index\.html$/, '').replace(/\/+$/, '') || '/';
}

// Navega a la página solicitada. Si ya estamos en ella, solo sube al inicio.
function showPage(name) {
  if (name === 'adminPanel' && !isAdmin) {
    showToast('Acceso solo para administradores');
    return;
  }
  const url = PAGE_URLS[name];
  if (!url) return;
  if (normPath(location.pathname) === normPath(url)) { window.scrollTo(0, 0); return; }
  location.href = url;
}

function closeNavMenu() {
  const menu = document.getElementById('navMenu');
  const btn = document.getElementById('navMenuBtn');
  if (menu) menu.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleNavMenu(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const menu = document.getElementById('navMenu');
  const btn = document.getElementById('navMenuBtn');
  if (!menu) return;
  const open = !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// Cerrar menú al tocar fuera / al cambiar tamaño a desktop
document.addEventListener('click', (e) => {
  const menu = document.getElementById('navMenu');
  if (!menu || !menu.classList.contains('open')) return;
  if (menu.contains(e.target)) return;
  closeNavMenu();
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 820) closeNavMenu();
});

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
      showToast('Inicia sesión para ver tu perfil');
      setTimeout(() => { location.href = '/'; }, 1300);
    }
  } else if (page === 'adminPanel') {
    if (isAdmin) {
      renderAdminPanel();
    } else {
      showToast('Acceso solo para administradores');
      setTimeout(() => { location.href = '/'; }, 1300);
    }
  } else if (page === 'stampCards') {
    if (currentUser) {
      if (typeof initStampCardsListPage === 'function') initStampCardsListPage();
    } else {
      showToast('Inicia sesión para ver tus tarjetas');
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
//  SELECTOR DE ENTREGA (modal de entrada, obligatorio)
//  Valores de entrega:
//    'domicilio' → Envío a domicilio
//    'cdb'       → Retiro en sucursal · Colegio Don Bosco
//    'udb'       → Retiro en sucursal · Universidad Don Bosco
//  "Otros" (escribir institución) → se atiende como 'domicilio' y se guarda la
//  institución para avisar por correo al equipo. Inventario ÚNICO: la entrega
//  NO cambia el stock, por eso ya no se vacía el carrito al cambiarla.
// ═══════════════════════════════════════════════════
const OTROS_KEY = 'pico_otros_institucion_v1';

function showSucursalGate() {
  const m = document.getElementById('sucursalGateModal');
  if (!m) return;
  // Reiniciar el sub-panel de retiro cada vez que se abre
  const panel = document.getElementById('gatePickupPanel');
  const sel   = document.getElementById('gatePickupSelect');
  const otros = document.getElementById('gateOtrosWrap');
  if (panel) panel.style.display = 'none';
  if (sel)   sel.value = '';
  if (otros) otros.style.display = 'none';
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
  document.body.style.touchAction = 'none';
}

/** Cierra el gate sin elegir entrega (se vuelve a pedir al agregar). */
function closeSucursalGate() {
  const m = document.getElementById('sucursalGateModal');
  if (m) m.classList.remove('open');
  if (!document.querySelector('.moverlay.open')) {
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
  }
}

/** true si ya hay entrega; si no, reabre el modal y bloquea la acción. */
function requireSucursalForCart() {
  if (selectedSucursal) return true;
  showToast('Elegí cómo recibir tu pedido para agregar productos');
  showSucursalGate();
  return false;
}

// Etiqueta PÚBLICA (cliente): nunca nombra la institución.
function entregaPublicLabel(suc) {
  return (suc === 'domicilio') ? 'Envío a domicilio' : 'Retiro en sucursal';
}
// Etiqueta INTERNA (dueño/admin): sí nombra la institución.
function sucursalInternalLabel(suc) {
  switch (suc) {
    case 'domicilio': return 'Envío a domicilio';
    case 'cdb':       return 'Colegio Don Bosco';
    case 'udb':       return 'Universidad Don Bosco';
    case 'exsal':     return 'EXSAL (histórico)';
    default:          return 'Retiro en sucursal';
  }
}

// El usuario elige "Retiro en sucursal": revela el sub-selector de institución.
function gateShowPickup() {
  const panel = document.getElementById('gatePickupPanel');
  if (panel) panel.style.display = 'block';
}
// Cambia el sub-selector: muestra el campo de texto solo si es "Otros".
function gatePickupSelectChange(v) {
  const otros = document.getElementById('gateOtrosWrap');
  if (otros) otros.style.display = (v === 'otros') ? 'block' : 'none';
}
// Botón "Envío a domicilio" del modal de entrada.
function gateChooseDomicilio() {
  try { localStorage.removeItem(OTROS_KEY); } catch (_) {}
  syncOtrosToProfile('');
  chooseGateSucursal('domicilio');
}
// Confirma el retiro elegido (Colegio Don Bosco / Universidad Don Bosco / Otros).
function gateConfirmPickup() {
  const sel = document.getElementById('gatePickupSelect');
  const v   = sel ? sel.value : '';
  if (!v) { showToast('Elegí desde dónde nos visitás'); return; }
  if (v === 'otros') {
    const inp  = document.getElementById('gateOtrosInput');
    const inst = inp ? inp.value.trim() : '';
    if (!inst) { showToast('Escribí el nombre de tu colegio o universidad'); return; }
    // "Otros" se atiende como envío a domicilio; guardamos la institución y avisamos al equipo.
    try { localStorage.setItem(OTROS_KEY, inst); } catch (_) {}
    syncOtrosToProfile(inst);
    sendOtrosVisitaEmail(inst);
    chooseGateSucursal('domicilio');
    showOtrosWelcome(inst);
    return;
  }
  // Colegio Don Bosco ('cdb') o Universidad Don Bosco ('udb'): retiro en sucursal.
  try { localStorage.removeItem(OTROS_KEY); } catch (_) {}
  syncOtrosToProfile('');
  chooseGateSucursal(v);
}

function chooseGateSucursal(suc) {
  selectedSucursal = suc;
  localStorage.setItem(SUCURSAL_KEY, suc);
  // Sincronizar con el perfil del usuario logueado (si lo hay)
  syncSucursalToProfile(suc);
  const m = document.getElementById('sucursalGateModal');
  if (m) m.classList.remove('open');
  if (!document.querySelector('.moverlay.open')) {
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
  }
  showToast(suc === 'domicilio' ? 'Entrega: Envío a domicilio' : 'Entrega: Retiro en sucursal');
  updateSucursalBadge();
  // Inventario ÚNICO: el stock no depende de la entrega → NO vaciamos el carrito.
  if (typeof products !== 'undefined' && products.length) { renderProducts(); updateCartUI(); }
  else loadProducts();
}

// Mensaje de bienvenida para quienes nos visitan desde "Otros".
function showOtrosWelcome(inst) {
  const prev = document.getElementById('otrosWelcomeModal');
  if (prev) prev.remove();
  const safe = String(inst).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html =
    '<div class="moverlay" id="otrosWelcomeModal" style="z-index:620">' +
      '<div class="modal" style="max-width:420px">' +
        '<div class="mbody" style="text-align:center;padding:32px 26px 10px">' +
          '<h2 style="font-size:1.2rem;font-weight:800;color:var(--g900);letter-spacing:-.02em;margin-bottom:10px">¡Nos encanta que nos visites desde ' + safe + '!</h2>' +
          '<p style="color:var(--g500);font-size:.9rem;line-height:1.55">Nos interesa mucho saber de dónde nos visitan. Por ahora, en tu zona te atendemos con <b>envío a domicilio</b> en todo El Salvador: hacé tu pedido normalmente y te lo llevamos. </p>' +
        '</div>' +
        '<div class="mfoot" style="padding-bottom:24px">' +
          '<button class="btn-pri" style="flex:none;width:100%" onclick="(function(){var m=document.getElementById(\'otrosWelcomeModal\');if(m)m.remove();})()">Entendido ✓</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.insertAdjacentHTML('beforeend', html);
  const m = document.getElementById('otrosWelcomeModal');
  if (m) m.classList.add('open');
}

function updateSucursalBadge() {
  const el = document.getElementById('sucursalBadge');
  if (!el) return;
  if (!selectedSucursal) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  // Badge PÚBLICO: genérico, sin nombrar la institución.
  el.innerHTML = entregaPublicLabel(selectedSucursal)
    + ' <span style="font-size:.7rem;color:var(--g400);font-weight:500">▼</span>';
}

// Permite reabrir el selector de entrega manualmente (ej. para cambiarla)
function reopenSucursalGate() { showSucursalGate(); }

function syncSucursalToProfile(suc) {
  if (!currentUser) return;
  const key   = 'el_profile_' + currentUser.uid;
  const saved = JSON.parse(localStorage.getItem(key) || '{}');
  saved.sucursal = suc;
  localStorage.setItem(key, JSON.stringify(saved));
  // Reflejar también en la nube (cross-device). No bloquea.
  if (typeof saveProfileToCloud === 'function') saveProfileToCloud({ sucursal: suc });
}

// Guarda (o limpia) la institución "Otros" en el perfil, para adjuntarla al correo del pedido.
function syncOtrosToProfile(inst) {
  if (!currentUser) return;
  const key   = 'el_profile_' + currentUser.uid;
  const saved = JSON.parse(localStorage.getItem(key) || '{}');
  if (inst) saved.visitaInstitucion = inst; else delete saved.visitaInstitucion;
  localStorage.setItem(key, JSON.stringify(saved));
  if (typeof saveProfileToCloud === 'function') saveProfileToCloud({ visitaInstitucion: inst || null });
}

// Aviso inmediato al equipo cuando alguien elige "Otros" y escribe su colegio/universidad.
// Usa Cloud Function (servidor) porque el visitante aún no tiene sesión y el cliente
// no puede escribir en la colección 'mail' por las reglas de Firestore.
async function sendOtrosVisitaEmail(institucion) {
  const inst = String(institucion || '').trim();
  if (!inst) return;
  try {
    if (typeof firebase !== 'undefined' && firebase.functions) {
      const fn = firebase.functions().httpsCallable('notificarVisitaOtros');
      await fn({ institucion: inst });
      return;
    }
  } catch (e) {
    console.warn('notificarVisitaOtros:', e);
  }
  showToast('No se pudo enviar el aviso. Intentá de nuevo o contactanos.');
}
