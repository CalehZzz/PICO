// ════════════════════════════════════════════════════════════════
// PICO · Descuentos: asignados, códigos promocionales y tarjeta de sellos
// ════════════════════════════════════════════════════════════════

// Escucha la colección "descuentos" (compartida con inventario)
function startDescuentosListener() {
  if (unsubDescuentos) return;
  unsubDescuentos = db.collection('descuentos').orderBy('createdAt', 'asc').onSnapshot(snap => {
    allDescuentos = [];
    snap.forEach(doc => allDescuentos.push({ id: doc.id, ...doc.data() }));
    renderCartDiscountSelector();
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
    // Si el descuento asignado seleccionado ya no está, limpiarlo
    if (selectedDiscount && selectedDiscount.source === 'assigned'
        && !userDiscountIds.includes(selectedDiscount.id)) {
      selectedDiscount = null;
    }
    renderCartDiscountSelector();
  }, err => console.error('User discount listener:', err));
}

// Tarjeta de sellos activa del email del usuario (máx. 1)
function startStampCardListener(email) {
  if (unsubStampCard) { unsubStampCard(); unsubStampCard = null; }
  userStampCard = null;
  const emailLower = String(email || '').trim().toLowerCase();
  if (!emailLower) { renderCartDiscountSelector(); return; }
  unsubStampCard = db.collection('stamp-cards')
    .where('emailLower', '==', emailLower)
    .where('status', '==', 'active')
    .limit(1)
    .onSnapshot(snap => {
      if (snap.empty) {
        userStampCard = null;
      } else {
        const doc = snap.docs[0];
        userStampCard = { code: doc.id, ...doc.data() };
        if (!userStampCard.code) userStampCard.code = doc.id;
      }
      // Si tenía seleccionado el 40% de sellos y ya no aplica, limpiar
      if (selectedDiscount && selectedDiscount.source === 'stamp') {
        if (!userStampCard || !stampRewardAvailable(userStampCard)) {
          selectedDiscount = null;
        }
      }
      renderCartDiscountSelector();
    }, err => console.error('Stamp card listener:', err));
}

function stopStampCardListener() {
  if (unsubStampCard) { unsubStampCard(); unsubStampCard = null; }
  userStampCard = null;
}

function stampRewardAvailable(card) {
  if (!card) return false;
  if (card.rewardUsed === true) return false;
  if (card.status && card.status !== 'active') return false;
  const sellos = Number(card.sellos) || 0;
  return card.rewardAvailable === true || sellos >= STAMP_TARGET;
}

function getUserDiscounts() {
  return allDescuentos.filter(d => userDiscountIds.includes(d.id));
}

function clearSelectedDiscount() {
  selectedDiscount = null;
}

// ═══════════════════════════════════════════════════
//  SELECTOR DEL CARRITO (asignado / código / sellos)
// ═══════════════════════════════════════════════════
function renderCartDiscountSelector() {
  const container = document.getElementById('cartDiscountContainer');
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = '';
    container.style.display = 'none';
    selectedDiscount = null;
    updateCartUI();
    return;
  }

  // Si hay productos en oferta, el descuento de carrito no se combina con ellos.
  const hasProdDisc = cartHasProductDiscount();
  if (hasProdDisc && selectedDiscount) {
    selectedDiscount = null;
  }

  const myDiscounts = getUserDiscounts();
  const stampOk = stampRewardAvailable(userStampCard);
  const hasAnyOption = myDiscounts.length > 0 || stampOk;

  container.style.display = 'block';

  const opts = [];
  opts.push('<option value="">Sin descuento</option>');
  myDiscounts.forEach(d => {
    const sel = selectedDiscount && selectedDiscount.source === 'assigned' && selectedDiscount.id === d.id ? 'selected' : '';
    opts.push(`<option value="assigned:${escHtml(d.id)}" ${sel}>${escHtml(d.nombre)} (${d.porcentaje}%)</option>`);
  });
  if (stampOk) {
    const sel = selectedDiscount && selectedDiscount.source === 'stamp' ? 'selected' : '';
    const name = (userStampCard && userStampCard.nombre) ? userStampCard.nombre : 'Tarjeta de sellos';
    opts.push(`<option value="stamp:${escHtml(userStampCard.code)}" ${sel}>🏅 ${escHtml(name)} — ${STAMP_REWARD_PCT}% (8 sellos)</option>`);
  }

  const codeVal = (selectedDiscount && selectedDiscount.source === 'code') ? (selectedDiscount.code || '') : '';
  const appliedInfo = selectedDiscount
    ? `<div class="cart-discount-info">Descuento del <b>${selectedDiscount.porcentaje}%</b> aplicado${selectedDiscount.nombre ? ' · ' + escHtml(selectedDiscount.nombre) : ''}</div>`
    : '';

  const stampHint = userStampCard && !stampOk
    ? `<div class="cart-stamp-hint">Tarjeta de sellos: <b>${Math.min(STAMP_TARGET, Number(userStampCard.sellos) || 0)}/${STAMP_TARGET}</b> — te faltan ${Math.max(0, STAMP_TARGET - (Number(userStampCard.sellos) || 0))} para el ${STAMP_REWARD_PCT}%</div>`
    : '';

  const prodNote = hasProdDisc
    ? `<p class="cart-discount-note">Hay productos en oferta en el carrito. Ese descuento no se combina con códigos, asignados ni tarjeta de sellos.</p>`
    : `<p class="cart-discount-note">Solo un descuento a la vez (asignado, código o tarjeta de sellos). No se combina con ofertas de producto.</p>`;

  const disabledAttr = hasProdDisc ? 'disabled' : '';

  container.innerHTML = `
    <div class="cart-discount-box">
      ${hasAnyOption ? `
      <div class="cart-discount-row">
        <label class="cart-discount-label"><span>🏷️ Descuento</span></label>
        <select id="cartDiscountSelect" onchange="onCartDiscountChange(this)" ${disabledAttr}>
          ${opts.join('')}
        </select>
      </div>` : ''}
      <div class="cart-code-row">
        <input type="text" id="cartDiscountCodeInput" class="cart-code-input" placeholder="Código promocional"
          value="${escHtml(codeVal)}" maxlength="40" autocomplete="off" ${disabledAttr}
          onkeydown="if(event.key==='Enter'){event.preventDefault();aplicarCodigoDescuentoCart();}">
        <button type="button" class="nbtn cart-code-btn" onclick="aplicarCodigoDescuentoCart()" ${disabledAttr}>Aplicar</button>
      </div>
      <div id="cartDiscountCodeMsg" class="cart-code-msg"></div>
      ${appliedInfo}
      ${stampHint}
      ${prodNote}
    </div>
  `;
  updateCartUI();
}

function onCartDiscountChange(sel) {
  if (cartHasProductDiscount()) {
    selectedDiscount = null;
    showToast('⚠️ No se puede combinar con ofertas de producto');
    renderCartDiscountSelector();
    return;
  }
  const val = sel.value || '';
  if (!val) {
    selectedDiscount = null;
    renderCartDiscountSelector();
    return;
  }
  if (val.startsWith('assigned:')) {
    const id = val.slice('assigned:'.length);
    const d = allDescuentos.find(x => x.id === id);
    selectedDiscount = d
      ? { source: 'assigned', id: d.id, nombre: d.nombre, porcentaje: Number(d.porcentaje) || 0 }
      : null;
  } else if (val.startsWith('stamp:')) {
    if (!stampRewardAvailable(userStampCard)) {
      selectedDiscount = null;
    } else {
      selectedDiscount = {
        source: 'stamp',
        id: userStampCard.code,
        nombre: userStampCard.nombre || 'Tarjeta de sellos (8 sellos)',
        porcentaje: STAMP_REWARD_PCT
      };
    }
  }
  renderCartDiscountSelector();
}

async function aplicarCodigoDescuentoCart() {
  const msg = document.getElementById('cartDiscountCodeMsg');
  const input = document.getElementById('cartDiscountCodeInput');
  if (!currentUser) {
    if (msg) { msg.style.color = '#dc2626'; msg.textContent = 'Inicia sesión para usar un código.'; }
    return;
  }
  if (cartHasProductDiscount()) {
    if (msg) { msg.style.color = '#dc2626'; msg.textContent = 'No se puede combinar con ofertas de producto.'; }
    return;
  }
  const raw = (input && input.value || '').trim().toUpperCase();
  if (!raw) {
    if (msg) { msg.style.color = '#dc2626'; msg.textContent = 'Escribe un código.'; }
    return;
  }
  if (msg) { msg.style.color = 'var(--g400)'; msg.textContent = 'Validando...'; }

  try {
    const resolved = await validarCodigoDescuento(raw, getCartRawTotal());
    selectedDiscount = {
      source: 'code',
      id: resolved.id,
      code: resolved.code,
      nombre: resolved.nombre,
      porcentaje: resolved.porcentaje
    };
    if (msg) { msg.style.color = 'var(--green)'; msg.textContent = `✅ ${resolved.nombre} (−${resolved.porcentaje}%) aplicado.`; }
    renderCartDiscountSelector();
  } catch (e) {
    if (msg) { msg.style.color = '#dc2626'; msg.textContent = e.message || 'Código no válido.'; }
  }
}

// Valida un código promocional (lectura Firestore + redención por usuario)
async function validarCodigoDescuento(codeUpper, cartRawTotal) {
  const code = String(codeUpper || '').trim().toUpperCase();
  if (!code) throw new Error('Escribe un código.');
  if (!currentUser) throw new Error('Inicia sesión para usar un código.');

  let snap = await db.collection('discount-codes').where('code', '==', code).limit(1).get();
  // Respaldo: el id del documento es el código
  if (snap.empty) {
    const byId = await db.collection('discount-codes').doc(code).get();
    if (byId.exists) snap = { empty: false, docs: [byId] };
  }
  if (snap.empty) throw new Error('Código no encontrado.');

  const doc = snap.docs[0];
  const d = doc.data() || {};
  if (d.activo === false) throw new Error('Este código ya no está activo.');

  const pct = Number(d.porcentaje);
  if (!(pct > 0 && pct <= 100)) throw new Error('Código con porcentaje inválido.');

  if (d.venceAt != null) {
    const venceMs = (typeof d.venceAt.toMillis === 'function')
      ? d.venceAt.toMillis()
      : (typeof d.venceAt === 'number' ? d.venceAt : new Date(d.venceAt).getTime());
    if (venceMs && Date.now() > venceMs) throw new Error('Este código ya venció.');
  }

  const maxUsos = d.maxUsos == null ? null : Number(d.maxUsos);
  const usos = Number(d.usosActuales) || 0;
  if (maxUsos != null && !isNaN(maxUsos) && usos >= maxUsos) {
    throw new Error('Este código ya alcanzó el máximo de usos.');
  }

  const min = Number(d.montoMinimo) || 0;
  if (cartRawTotal < min) {
    throw new Error(`Monto mínimo del carrito: $${min.toFixed(2)}.`);
  }

  if (d.unSoloUsoPorUsuario) {
    const red = await db.collection('discount-codes').doc(doc.id)
      .collection('redenciones').doc(currentUser.uid).get();
    if (red.exists) throw new Error('Ya usaste este código anteriormente.');
  }

  return {
    id: doc.id,
    code: (d.code || code).toUpperCase(),
    nombre: d.nombre || d.code || code,
    porcentaje: pct
  };
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** % de descuento de oferta del producto (0–100). Definido en inventario. */
function getProductDiscountPct(p) {
  if (!p) return 0;
  const n = typeof p.descuentoPct === 'number' ? p.descuentoPct : 0;
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.round(n));
}

/** Precio unitario a cobrar (aplica descuento de producto si existe). */
function getProductSalePrice(p) {
  if (!p) return 0;
  const pct = getProductDiscountPct(p);
  const price = typeof p.price === 'number' ? p.price : 0;
  if (pct <= 0) return price;
  return +(price * (1 - pct / 100)).toFixed(2);
}

/** true si algún ítem del carrito ya tiene descuento de producto. */
function cartHasProductDiscount() {
  return Object.keys(cart || {}).some(id => {
    const p = products.find(x => x.id === id);
    return getProductDiscountPct(p) > 0;
  });
}

function getCartTotal() {
  // No combinar: si hay ofertas de producto en el carrito, solo ellas aplican.
  // Si no, el descuento de carrito (código/asignado/sellos) aplica a todo.
  const hasProd = cartHasProductDiscount();
  if (hasProd && selectedDiscount) selectedDiscount = null;
  const cartPct = (!hasProd && selectedDiscount && selectedDiscount.porcentaje)
    ? selectedDiscount.porcentaje : 0;
  let total = 0;
  Object.keys(cart || {}).forEach(id => {
    const p = products.find(x => x.id === id);
    if (!p) return;
    const qty = cart[id] || 0;
    const prodPct = getProductDiscountPct(p);
    let unit = typeof p.price === 'number' ? p.price : 0;
    if (prodPct > 0) unit = unit * (1 - prodPct / 100);
    else if (cartPct > 0) unit = unit * (1 - cartPct / 100);
    total += unit * qty;
  });
  return +total.toFixed(2);
}

function getCartRawTotal() {
  // Subtotal "antes" del descuento de carrito: precios de lista con oferta de producto ya aplicada.
  return Object.keys(cart || {}).reduce((s, id) => {
    const p = products.find(x => x.id === id);
    return s + (p ? getProductSalePrice(p) * (cart[id] || 0) : 0);
  }, 0);
}

/** Subtotal a precio de lista (sin ningún descuento) — útil para mostrar tachado. */
function getCartListTotal() {
  return Object.keys(cart || {}).reduce((s, id) => {
    const p = products.find(x => x.id === id);
    return s + (p ? (p.price || 0) * (cart[id] || 0) : 0);
  }, 0);
}

// Campos de descuento para guardar en el pedido / factura / correo
function buildDiscountOrderFields() {
  if (!selectedDiscount) {
    return {
      totalConDescuento: null,
      discountId: null,
      discountName: null,
      discountPct: null,
      discountCode: null,
      discountCodeId: null,
      stampCardCode: null,
      discountSource: null
    };
  }
  const src = selectedDiscount.source || 'assigned';
  return {
    discountId:       src === 'assigned' ? selectedDiscount.id : null,
    discountName:     selectedDiscount.nombre || null,
    discountPct:      selectedDiscount.porcentaje || null,
    discountCode:     src === 'code' ? (selectedDiscount.code || null) : null,
    discountCodeId:   src === 'code' ? selectedDiscount.id : null,
    stampCardCode:    src === 'stamp' ? selectedDiscount.id : null,
    discountSource:   src
  };
}

// Tras crear el pedido: consumir código / archivar tarjeta (Cloud Function, Admin SDK)
async function consumirDescuentoTrasPedido(orderId) {
  if (!selectedDiscount || !orderId) return;
  if (selectedDiscount.source !== 'code' && selectedDiscount.source !== 'stamp') return;
  try {
    const fn = firebase.functions().httpsCallable('consumirDescuentoPedido');
    await fn({ orderId });
  } catch (e) {
    console.warn('No se pudo consumir el descuento del pedido:', e);
  }
}

// Tras marcar entregado: sumar sello si aplica (no rompe la entrega si falla)
async function añadirSelloTrasEntrega(orderId) {
  if (!orderId) return;
  try {
    const fn = firebase.functions().httpsCallable('anadirSelloPorPedido');
    await fn({ orderId });
  } catch (e) {
    console.warn('No se pudo añadir sello de tarjeta:', e);
  }
}

// ═══════════════════════════════════════════════════
//  ADMIN — GESTIÓN DE DESCUENTOS POR USUARIO
// ═══════════════════════════════════════════════════
async function saveUserDiscounts(uid, discountIds) {
  await db.collection('user-discounts').doc(uid).set({ discountIds, updatedAt: Date.now() }, { merge: true });
}

async function getUserDiscountIds(uid) {
  try {
    const snap = await db.collection('user-discounts').doc(uid).get();
    return snap.exists ? (snap.data().discountIds || []) : [];
  } catch { return []; }
}

function renderAdminDiscountSection() {
  const container = document.getElementById('adminDiscountSection');
  if (!container) return;

  const existingEmail = document.getElementById('discountUserEmail');
  if (existingEmail) return;

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

async function loadUserForDiscount() {
  const email = (document.getElementById('discountUserEmail').value || '').trim().toLowerCase();
  const info = document.getElementById('discountUserInfo');
  if (!email) { info.innerHTML = '<p style="color:#dc2626;font-size:.82rem">Ingresa un email.</p>'; return; }
  info.innerHTML = '<p style="font-size:.82rem;color:var(--g400)">Buscando...</p>';
  try {
    let uid = null;
    const perfSnap = await db.collection('perfiles').where('emailLower', '==', email).limit(1).get();
    if (!perfSnap.empty) {
      uid = perfSnap.docs[0].id;
    } else {
      const ordSnap = await db.collection('pedidos').where('email', '==', email).limit(1).get();
      if (!ordSnap.empty) uid = ordSnap.docs[0].data().userId || null;
    }
    if (!uid) {
      info.innerHTML = '<p style="font-size:.82rem;color:#dc2626">No se encontró ningún cliente con ese email. El cliente debe haber iniciado sesión al menos una vez con esa cuenta de Google.</p>';
      return;
    }
    const currentIds = await getUserDiscountIds(uid);
    renderDiscountAssigner(uid, email, currentIds);
  } catch(e) {
    console.error(e);
    info.innerHTML = '<p style="font-size:.82rem;color:#dc2626">Error al buscar. Intenta de nuevo.</p>';
  }
}

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
