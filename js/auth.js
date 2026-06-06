// ════════════════════════════════════════════════════════════════
// PICO · Sesión: listener de estado, nav y login/logout
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  AUTH STATE LISTENER
// ═══════════════════════════════════════════════════
auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = {
      uid:      user.uid,
      email:    user.email,
      name:     user.displayName || user.email.split('@')[0],
      photoURL: user.photoURL || null
    };
    // Admin = autenticado con email + contraseña
    isAdmin = user.providerData.some(p => p.providerId === 'password');
    // Sincronizar la sucursal elegida en el gate con el perfil del usuario
    if (selectedSucursal) syncSucursalToProfile(selectedSucursal);
    updateNavAuth();
    // Recargar siempre al iniciar sesión para que el stockMap incluya pedidos pendientes
    loadProducts();
    // Cargar descuentos globales (todos los descuentos definidos por el admin)
    startDescuentosListener();
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
    } else {
      // Usuario normal: cargar sus descuentos asignados
      startUserDiscountListener(user.uid);
    }
    initPageAfterAuth();
  } else {
    currentUser = null;
    isAdmin     = false;
    if (adminUnsubscribe) { adminUnsubscribe(); adminUnsubscribe = null; }
    if (unsubDescuentos)  { unsubDescuentos();  unsubDescuentos  = null; }
    if (unsubUserDiscount){ unsubUserDiscount();unsubUserDiscount= null; }
    allDescuentos    = [];
    userDiscountIds  = [];
    selectedDiscount = null;
    updateNavAuth();
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

  if (currentUser) {
    const initials = currentUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const avatarHtml = currentUser.photoURL
      ? `<img src="${currentUser.photoURL}" class="user-photo" alt="">`
      : `<div class="user-avatar">${initials}</div>`;
    area.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <div class="user-pill" onclick="showPage('profile')" title="Ver perfil">
          ${avatarHtml}
          <span>${currentUser.name.split(' ')[0]}</span>
        </div>
        <button class="nbtn nbtn-ghost" onclick="doLogout()"
          style="font-size:.78rem;color:var(--g400)">Salir</button>
      </div>`;
    profBtn.classList.remove('hidden');
    isAdmin ? adminBtn.classList.remove('hidden') : adminBtn.classList.add('hidden');
    document.body.classList.toggle('is-admin', !!isAdmin);
    const invBtn = document.getElementById('inventoryNavBtn');
    isAdmin ? invBtn.classList.remove('hidden') : invBtn.classList.add('hidden');
  } else {
    area.innerHTML = `<button class="nbtn nbtn-outline" onclick="toggleAuth()">Iniciar Sesión</button>`;
    profBtn.classList.add('hidden');
    adminBtn.classList.add('hidden');
    document.body.classList.remove('is-admin');
    document.getElementById('inventoryNavBtn').classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════════
//  AUTH FUNCTIONS
// ═══════════════════════════════════════════════════
function toggleAuth() { document.getElementById('authOverlay').classList.toggle('open'); }
function closeAuth()  { document.getElementById('authOverlay').classList.remove('open'); }

function switchAuthTab(tab) {
  document.getElementById('panel-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('panel-register').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('loginErr').style.display = 'none';
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
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
  try { localStorage.removeItem('pico_cart'); } catch(_) {}
  renderCartDiscountSelector(); // Bug 5 fix: ocultar el selector de descuento inmediatamente
  updateCartUI();
  showPage('catalog');
  showToast('👋 Sesión cerrada');
}
