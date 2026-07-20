// ════════════════════════════════════════════════════════════════
// PICO · Sesión: listener de estado, nav y login/logout
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  AUTH STATE LISTENER
// ═══════════════════════════════════════════════════
auth.onAuthStateChanged(async user => {
  if (user) {
    currentUser = {
      uid:      user.uid,
      email:    user.email,
      name:     user.displayName || user.email.split('@')[0],
      photoURL: user.photoURL || null
    };
    // Rol de administrador REAL: custom claim en el token (admin === true).
    // Lo define la Cloud Function 'setAdminRole' y lo aplican las reglas de Firestore.
    try {
      const tokenResult = await user.getIdTokenResult();
      isAdmin = tokenResult.claims.admin === true;
    } catch (_) {
      isAdmin = false;
    }
    // Sincronizar la sucursal elegida en el gate con el perfil del usuario
    if (selectedSucursal) syncSucursalToProfile(selectedSucursal);
    // Si eligió "Otros" antes de iniciar sesión, persistir la institución en el perfil
    try {
      const otros = localStorage.getItem(typeof OTROS_KEY !== 'undefined' ? OTROS_KEY : 'pico_otros_institucion_v1');
      if (otros && typeof syncOtrosToProfile === 'function') syncOtrosToProfile(otros);
    } catch (_) {}
    // Cargar el perfil guardado en la nube (cross-device) y fusionarlo con el caché local
    loadProfileFromCloud();
    updateNavAuth();
    // Recargar siempre al iniciar sesión para que el stockMap incluya pedidos pendientes
    loadProducts();
    // Cargar descuentos globales (todos los descuentos definidos por el admin)
    startDescuentosListener();
    // Cargar los descuentos asignados a ESTE usuario (incluidos los admins:
    // un admin también puede tener y usar descuentos asignados a su cuenta).
    startUserDiscountListener(user.uid);
    // Tarjeta de sellos activa vinculada al correo (para el 40% al completar 8)
    startStampCardListener(user.email);
    if (isAdmin) {
      startAdminListener();
      // Si llegó desde un QR (URL con ?pedido=ID)
      const params    = new URLSearchParams(window.location.search);
      const pedidoId  = params.get('pedido');
      const page      = document.body.dataset.page;
      if (pedidoId && page !== 'adminPanel') {
        // El QR puede abrirse desde cualquier página: redirigir al panel admin.
        location.href = '/admin/?pedido=' + encodeURIComponent(pedidoId);
        return;
      }
      if (pedidoId && page === 'adminPanel') {
        setTimeout(() => highlightOrder(pedidoId), 1800);
      }
    }
    initPageAfterAuth();
  } else {
    currentUser = null;
    isAdmin     = false;
    if (adminUnsubscribe) { adminUnsubscribe(); adminUnsubscribe = null; }
    if (typeof unsubAdmins !== 'undefined' && unsubAdmins) { unsubAdmins(); unsubAdmins = null; }
    if (unsubDescuentos)  { unsubDescuentos();  unsubDescuentos  = null; }
    if (unsubUserDiscount){ unsubUserDiscount();unsubUserDiscount= null; }
    if (typeof stopStampCardListener === 'function') stopStampCardListener();
    allDescuentos    = [];
    userDiscountIds  = [];
    selectedDiscount = null;
    userStampCard    = null;
    updateNavAuth();
    if (typeof renderCartDiscountSelector === 'function') renderCartDiscountSelector();
    // Sin sesión: cargar productos (solo stock de Firebase, sin ajuste de pedidos)
    loadProducts();
    initPageAfterAuth();
  }
});

// ═══════════════════════════════════════════════════
//  NAV AUTH UPDATE
// ═══════════════════════════════════════════════════
function updateNavAuth() {
  const area     = document.getElementById('authNavArea');
  const profBtn  = document.getElementById('profileNavBtn');
  const adminBtn = document.getElementById('adminNavBtn');
  const stampsBtn = document.getElementById('stampsNavBtn');
  const stampsLabel = document.getElementById('stampsNavLabelBtn');

  if (currentUser) {
    const initials = currentUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const avatarHtml = currentUser.photoURL
      ? `<img src="${currentUser.photoURL}" class="user-photo" alt="">`
      : `<div class="user-avatar">${initials}</div>`;
    area.innerHTML = `
      <div class="nav-auth-logged">
        <div class="user-pill" onclick="closeNavMenu();showPage('profile')" title="Ver perfil">
          ${avatarHtml}
          <span>${currentUser.name.split(' ')[0]}</span>
        </div>
        <button class="nbtn nbtn-ghost nav-logout-btn" onclick="closeNavMenu();doLogout()">Salir</button>
      </div>`;
    if (profBtn) profBtn.classList.remove('hidden');
    if (stampsBtn) stampsBtn.classList.remove('hidden');
    if (stampsLabel) stampsLabel.textContent = isAdmin ? '🏅 Tarjetas' : '🏅 Mis tarjetas';
    isAdmin ? adminBtn.classList.remove('hidden') : adminBtn.classList.add('hidden');
    document.body.classList.toggle('is-admin', !!isAdmin);
    const invBtn = document.getElementById('inventoryNavBtn');
    isAdmin ? invBtn.classList.remove('hidden') : invBtn.classList.add('hidden');
  } else {
    area.innerHTML = `<button class="nbtn nbtn-outline" onclick="closeNavMenu();toggleAuth()">Iniciar Sesión</button>`;
    if (profBtn) profBtn.classList.add('hidden');
    if (stampsBtn) stampsBtn.classList.add('hidden');
    adminBtn.classList.add('hidden');
    document.body.classList.remove('is-admin');
    document.getElementById('inventoryNavBtn').classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════════
//  AUTH FUNCTIONS
// ═══════════════════════════════════════════════════
function ensureAuthLoginFields() {
  const box = document.getElementById('authLoginFields');
  if (!box || document.getElementById('loginPass')) return;
  box.innerHTML = `
    <form id="authLoginForm" autocomplete="on" onsubmit="event.preventDefault();doLogin();return false">
      <label class="flabel">Correo electrónico</label>
      <input type="email" id="loginEmail" name="username" class="finput" placeholder="tu@correo.com"
        autocomplete="username" onkeydown="if(event.key==='Enter'){event.preventDefault();doLogin()}">
      <label class="flabel">Contraseña</label>
      <input type="password" id="loginPass" name="password" class="finput" placeholder="••••••••"
        autocomplete="current-password" onkeydown="if(event.key==='Enter'){event.preventDefault();doLogin()}">
    </form>`;
  const btn = document.getElementById('loginSubmitBtn');
  const div = document.getElementById('authLoginDivider');
  if (btn) btn.style.display = '';
  if (div) div.style.display = '';
}

function toggleAuth() {
  // Campos de contraseña solo cuando se abre el panel (evita el prompt del navegador en cada subpágina)
  ensureAuthLoginFields();
  document.getElementById('authOverlay').classList.toggle('open');
}
function closeAuth()  { document.getElementById('authOverlay').classList.remove('open'); }

function switchAuthTab(tab) {
  if (tab === 'login') ensureAuthLoginFields();
  document.getElementById('panel-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('panel-register').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('loginErr').style.display = 'none';
}

async function doLogin() {
  ensureAuthLoginFields();
  const emailEl = document.getElementById('loginEmail');
  const passEl  = document.getElementById('loginPass');
  const email = (emailEl && emailEl.value || '').trim();
  const pass  = passEl && passEl.value || '';
  const errEl = document.getElementById('loginErr');
  errEl.style.display = 'none';
  if (!email || !pass) { showToast('⚠️ Ingresa correo y contraseña'); return; }
  try {
    await auth.signInWithEmailAndPassword(email, pass);
    closeAuth();
    showToast('✅ Bienvenido al panel admin');
  } catch (err) {
    errEl.textContent    = 'Correo o contraseña incorrectos';
    errEl.style.display  = 'block';
  }
}

async function doGoogleLogin() {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
    closeAuth();
    const firstName = auth.currentUser?.displayName?.split(' ')[0] || '';
    showToast('✅ ¡Hola' + (firstName ? ', ' + firstName : '') + '!');
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('❌ Error con Google: ' + err.message);
    }
  }
}

async function doLogout() {
  await auth.signOut();
  if (adminUnsubscribe) { adminUnsubscribe(); adminUnsubscribe = null; }
  orders = [];
  cart   = {};
  selectedDiscount = null; // Bug 5 fix: limpiar descuento antes de actualizar UI
  if (typeof stopStampCardListener === 'function') stopStampCardListener();
  try { localStorage.removeItem('pico_cart'); } catch(_) {}
  renderCartDiscountSelector(); // Bug 5 fix: ocultar el selector de descuento inmediatamente
  updateCartUI();
  showPage('catalog');
  showToast('👋 Sesión cerrada');
}
