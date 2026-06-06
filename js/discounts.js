// ════════════════════════════════════════════════════════════════
// PICO · Descuentos: listeners y asignación por usuario (admin)
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  DESCUENTOS — LISTENERS Y LÓGICA
// ═══════════════════════════════════════════════════

// Escucha la colección "descuentos" (compartida con inventario)
function startDescuentosListener() {
  if (unsubDescuentos) return;
  unsubDescuentos = db.collection('descuentos').orderBy('createdAt', 'asc').onSnapshot(snap => {
    allDescuentos = [];
    snap.forEach(doc => allDescuentos.push({ id: doc.id, ...doc.data() }));
    // Si hay selector de descuento activo, actualizarlo
    renderCartDiscountSelector();
    // Si el panel admin está visible, actualizar su sección de descuentos
    if (isAdmin && document.body.dataset.page === 'adminPanel') {
      renderAdminDiscountSection();
    }
  }, err => console.error('Descuentos listener:', err));
}

// Escucha el documento user-discounts/{uid} del usuario actual
function startUserDiscountListener(uid) {
  if (unsubUserDiscount) { unsubUserDiscount(); unsubUserDiscount = null; }
  unsubUserDiscount = db.collection('user-discounts').doc(uid).onSnapshot(snap => {
    if (snap.exists) {
      userDiscountIds = snap.data().discountIds || [];
    } else {
      userDiscountIds = [];
    }
    selectedDiscount = null; // resetear selección al actualizar
    renderCartDiscountSelector();
  }, err => console.error('User discount listener:', err));
}

// Descuentos del usuario actual (filtrados de la lista global)
function getUserDiscounts() {
  return allDescuentos.filter(d => userDiscountIds.includes(d.id));
}

// Renderiza el selector de descuento en el carrito (si el usuario tiene descuentos asignados)
function renderCartDiscountSelector() {
  const container = document.getElementById('cartDiscountContainer');
  if (!container) return;
  const myDiscounts = getUserDiscounts();
  if (!currentUser || isAdmin || myDiscounts.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    selectedDiscount = null;
    updateCartUI();
    return;
  }
  container.style.display = 'block';
  const opts = myDiscounts.map(d =>
    `<option value="${d.id}" ${selectedDiscount && selectedDiscount.id === d.id ? 'selected' : ''}>${escHtml(d.nombre)} (${d.porcentaje}%)</option>`
  ).join('');
  container.innerHTML = `
    <div class="cart-discount-row">
      <label class="cart-discount-label"><span>🏷️ Descuento</span></label>
      <select id="cartDiscountSelect" onchange="onCartDiscountChange(this)">
        <option value="">Sin descuento</option>
        ${opts}
      </select>
    </div>
    ${selectedDiscount ? `<div class="cart-discount-info">Descuento del <b>${selectedDiscount.porcentaje}%</b> aplicado al total</div>` : ''}
  `;
  updateCartUI();
}

function onCartDiscountChange(sel) {
  const id = sel.value;
  if (!id) {
    selectedDiscount = null;
  } else {
    selectedDiscount = allDescuentos.find(d => d.id === id) || null;
  }
  renderCartDiscountSelector();
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Calcular total del carrito con descuento aplicado
function getCartTotal() {
  const raw = Object.keys(cart).reduce((s, id) => {
    const p = products.find(x => x.id === id);
    return s + (p ? p.price * (cart[id] || 0) : 0);
  }, 0);
  if (selectedDiscount && selectedDiscount.porcentaje) {
    return +(raw * (1 - selectedDiscount.porcentaje / 100)).toFixed(2);
  }
  return +raw.toFixed(2);
}

function getCartRawTotal() {
  return Object.keys(cart).reduce((s, id) => {
    const p = products.find(x => x.id === id);
    return s + (p ? p.price * (cart[id] || 0) : 0);
  }, 0);
}

// ═══════════════════════════════════════════════════
//  ADMIN — GESTIÓN DE DESCUENTOS POR USUARIO
// ═══════════════════════════════════════════════════

// Guardar descuentos asignados a un usuario en Firestore
async function saveUserDiscounts(uid, discountIds) {
  await db.collection('user-discounts').doc(uid).set({ discountIds, updatedAt: Date.now() }, { merge: true });
}

// Obtener los discountIds actuales de un usuario
async function getUserDiscountIds(uid) {
  try {
    const snap = await db.collection('user-discounts').doc(uid).get();
    return snap.exists ? (snap.data().discountIds || []) : [];
  } catch { return []; }
}

// Renderizar la sección de asignación de descuentos en el panel admin
function renderAdminDiscountSection() {
  const container = document.getElementById('adminDiscountSection');
  if (!container) return;

  // Bug 2 fix: si ya hay una búsqueda activa (el campo de email existe y tiene contenido,
  // o ya hay resultados mostrándose), no re-renderizar y perder el trabajo del admin.
  const existingEmail = document.getElementById('discountUserEmail');
  if (existingEmail) return; // ya está montado el formulario, no pisar

  if (allDescuentos.length === 0) {
    container.innerHTML = '<p style="font-size:.82rem;color:var(--g400);padding:12px 0">No hay descuentos creados aún. Créalos desde el inventario.</p>';
    return;
  }
  container.innerHTML = `
    <div class="discount-assign-box">
      <div class="discount-assign-row">
        <input type="email" id="discountUserEmail" class="finput" placeholder="Email del cliente (cuenta Google)" style="flex:1;min-width:0">
        <button class="nbtn" onclick="loadUserForDiscount()" style="white-space:nowrap;padding:10px 16px">Buscar</button>
      </div>
      <div id="discountUserInfo" style="margin-top:10px"></div>
    </div>
  `;
}

// Buscar usuario por email y mostrar sus descuentos actuales
async function loadUserForDiscount() {
  const email = (document.getElementById('discountUserEmail').value || '').trim().toLowerCase();
  const info = document.getElementById('discountUserInfo');
  if (!email) { info.innerHTML = '<p style="color:#dc2626;font-size:.82rem">Ingresa un email.</p>'; return; }
  info.innerHTML = '<p style="font-size:.82rem;color:var(--g400)">Buscando...</p>';
  try {
    // Buscar pedidos de ese email para obtener el uid
    const snap = await db.collection('pedidos').where('email', '==', email).limit(1).get();
    if (snap.empty) {
      info.innerHTML = '<p style="font-size:.82rem;color:#dc2626">No se encontró ningún pedido con ese email. El cliente debe haber realizado al menos un pedido.</p>';
      return;
    }
    const orderData = snap.docs[0].data();
    const uid = orderData.userId;
    if (!uid) {
      info.innerHTML = '<p style="font-size:.82rem;color:#dc2626">El cliente no tiene cuenta de Google vinculada.</p>';
      return;
    }
    const currentIds = await getUserDiscountIds(uid);
    renderDiscountAssigner(uid, email, currentIds);
  } catch(e) {
    console.error(e);
    info.innerHTML = '<p style="font-size:.82rem;color:#dc2626">Error al buscar. Intenta de nuevo.</p>';
  }
}

// Mostrar checkboxes de descuentos para asignar a un usuario
function renderDiscountAssigner(uid, email, currentIds) {
  const info = document.getElementById('discountUserInfo');
  const checks = allDescuentos.map(d => `
    <label style="display:flex;align-items:center;gap:8px;font-size:.85rem;padding:6px 0;cursor:pointer">
      <input type="checkbox" value="${d.id}" ${currentIds.includes(d.id) ? 'checked' : ''} style="accent-color:var(--b600);width:15px;height:15px">
      <span><b>${escHtml(d.nombre)}</b> — ${d.porcentaje}%</span>
    </label>
  `).join('');
  info.innerHTML = `
    <div style="background:var(--b50);border:1.5px solid var(--b200);border-radius:10px;padding:14px 16px">
      <p style="font-size:.82rem;font-weight:700;color:var(--b600);margin-bottom:10px">Cliente: ${escHtml(email)}</p>
      <p style="font-size:.78rem;color:var(--g400);margin-bottom:10px">Selecciona los descuentos que puede elegir:</p>
      <div id="discountChecks">${checks || '<p style="font-size:.82rem;color:var(--g400)">Sin descuentos disponibles.</p>'}</div>
      <button class="nbtn" onclick="saveDiscountAssignment('${uid}')" style="margin-top:12px;width:100%;padding:10px">Guardar asignación</button>
      <div id="discountSaveMsg" style="margin-top:8px;font-size:.8rem;text-align:center"></div>
    </div>
  `;
}

async function saveDiscountAssignment(uid) {
  const checks = document.querySelectorAll('#discountChecks input[type=checkbox]:checked');
  const ids = Array.from(checks).map(c => c.value);
  const msg = document.getElementById('discountSaveMsg');
  msg.textContent = 'Guardando...';
  try {
    await saveUserDiscounts(uid, ids);
    msg.style.color = 'var(--green)';
    msg.textContent = ids.length > 0 ? `✅ ${ids.length} descuento(s) asignado(s).` : '✅ Descuentos eliminados.';
  } catch(e) {
    msg.style.color = '#dc2626';
    msg.textContent = 'Error al guardar.';
  }
}
