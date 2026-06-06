// ════════════════════════════════════════════════════════════════
// PICO · Carrito y checkout
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  CART  (con persistencia en localStorage)
// ═══════════════════════════════════════════════════
function saveCart() {
  try { localStorage.setItem('pico_cart', JSON.stringify(cart)); } catch(_) {}
}
function loadCart() {
  try {
    const s = localStorage.getItem('pico_cart');
    if (s) cart = JSON.parse(s);
  } catch(_) {}
}

function addToCart(id) {
  const s = stockMap[id] || 0;
  if (s < 1) { showToast('⚠️ Sin stock disponible'); return; }
  cart[id] = 1;
  saveCart();
  updateCartUI();
  updateAddZone(id);
  showToast('✅ Agregado al carrito');
}

function cartInc(id) {
  const max = stockMap[id] || 0;
  if ((cart[id] || 0) >= max) { showToast('⚠️ Stock máximo alcanzado'); return; }
  cart[id] = (cart[id] || 0) + 1;
  saveCart(); updateCartUI(); updateAddZone(id);
}

function cartDec(id) {
  cart[id] = (cart[id] || 0) - 1;
  if (cart[id] <= 0) delete cart[id];
  saveCart(); updateCartUI(); updateAddZone(id);
}

function cartSetVal(id, val) {
  const n = parseInt(val);
  if (isNaN(n) || n <= 0) { delete cart[id]; }
  else { cart[id] = Math.min(n, stockMap[id] || 0); }
  saveCart(); updateCartUI(); updateAddZone(id);
}

function changeQty(id, d) {
  cart[id] = (cart[id] || 0) + d;
  if (cart[id] <= 0) delete cart[id];
  if (!Object.keys(cart).length) selectedDiscount = null;
  saveCart(); updateCartUI(); updateAddZone(id);
}

function removeFromCart(id) {
  delete cart[id];
  if (!Object.keys(cart).length) selectedDiscount = null;
  saveCart(); updateCartUI(); updateAddZone(id);
}

function updateCartUI() {
  const rawTotal = getCartRawTotal();
  const total    = getCartTotal();
  const count = Object.values(cart).reduce((s, n) => s + n, 0);

  const badge = document.getElementById('cartBadge');
  badge.textContent = count;
  count > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');

  // Mostrar precio original tachado si hay descuento
  const totalEl = document.getElementById('cartTotal');
  if (selectedDiscount && rawTotal !== total) {
    totalEl.innerHTML = `<span style="text-decoration:line-through;color:var(--g400);font-size:.88rem;font-weight:500">$${rawTotal.toFixed(2)}</span> <span style="color:var(--b600)">$${total.toFixed(2)}</span>`;
  } else {
    totalEl.textContent = '$' + total.toFixed(2);
  }

  const el = document.getElementById('cartItems');
  if (!Object.keys(cart).length) {
    el.innerHTML = `<div class="empty-cart"><div class="icon">🛒</div><p>Tu carrito está vacío</p></div>`;
    return;
  }
  el.innerHTML = Object.keys(cart).map(id => {
    const p = products.find(x => x.id === id);
    if (!p) return '';
    const thumbHtml = p.img
      ? `<div class="citem-emoji" style="overflow:hidden;padding:0"><img src="${p.img}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:9px" onerror="this.parentElement.innerHTML='${p.e}'"></div>`
      : `<div class="citem-emoji">${p.e}</div>`;
    return `<div class="citem">
      ${thumbHtml}
      <div class="citem-info">
        <div class="citem-name">${p.name}</div>
        <div class="citem-price">$${(p.price * (cart[id] || 0)).toFixed(2)}</div>
      </div>
      <div class="cqty">
        <button class="cqbtn" onclick="changeQty('${id}', -1)">−</button>
        <span class="cqval">${cart[id]}</span>
        <button class="cqbtn" onclick="changeQty('${id}', +1)">+</button>
      </div>
      <button class="rmbtn" onclick="removeFromCart('${id}')">🗑️</button>
    </div>`;
  }).join('');
}

function openCart()  {
  document.getElementById('cartOverlay').classList.add('open');
  document.getElementById('cartPanel').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.body.style.touchAction = 'none';
}
function closeCart() {
  document.getElementById('cartOverlay').classList.remove('open');
  document.getElementById('cartPanel').classList.remove('open');
  document.body.style.overflow = '';
  document.body.style.touchAction = '';
}

// ═══════════════════════════════════════════════════
//  CHECKOUT
// ═══════════════════════════════════════════════════
function openCheckout() {
  if (!currentUser) {
    closeCart();
    toggleAuth();
    showToast('⚠️ Inicia sesión para hacer un pedido');
    return;
  }
  if (!Object.keys(cart).length) { showToast('⚠️ El carrito está vacío'); return; }
  closeCart();

  const items = Object.keys(cart).map(id => {
    const p = products.find(x => x.id === id);
    return `<div class="odetail-item">
      <div>
        <div class="odetail-item-name">${p.e} ${p.name}</div>
        <div class="odetail-item-sub">$${p.price.toFixed(2)} × ${cart[id]}</div>
      </div>
      <div class="odetail-item-price">$${(p.price * cart[id]).toFixed(2)}</div>
    </div>`;
  }).join('');
  const rawTotal   = getCartRawTotal();
  const finalTotal = getCartTotal();
  const discountRow = selectedDiscount
    ? `<div class="odetail-subtotal" style="color:var(--green)">
         <span>🏷️ Descuento (${selectedDiscount.nombre} −${selectedDiscount.porcentaje}%)</span>
         <span>−$${(rawTotal - finalTotal).toFixed(2)}</span>
       </div>`
    : '';

  document.getElementById('checkoutSummary').innerHTML = `
    <div class="osumtitle">Resumen del pedido</div>
    <div class="odetail-list" style="gap:4px">${items}
      ${selectedDiscount ? `<div class="odetail-subtotal"><span>Subtotal</span><span>$${rawTotal.toFixed(2)}</span></div>` : ''}
      ${discountRow}
      <div class="odetail-subtotal" ${selectedDiscount ? 'style="font-weight:700;color:var(--b600)"' : ''}>
        <span>${selectedDiscount ? 'Total con descuento' : 'Subtotal'}</span><span>$${finalTotal.toFixed(2)}</span>
      </div>
    </div>`;

  document.getElementById('studentName').value = currentUser.name || '';
  const saved = getSavedProfile();
  if (saved.grade)   document.getElementById('studentGrade').value   = saved.grade;
  if (saved.section) document.getElementById('studentSection').value = saved.section;

  // Sucursal obligatoria desde perfil
  const sucursalInfoEl = document.getElementById('checkoutSucursalInfo');
  if (!saved.sucursal) {
    sucursalInfoEl.innerHTML = `⚠️ <b>Sucursal no configurada.</b> Debes guardar tu sucursal en tu <a href="#" onclick="closeModal('checkoutModal');showPage('profile')" style="color:var(--b600);font-weight:600">perfil</a> antes de continuar.`;
    sucursalInfoEl.style.background = '#fee2e2';
    sucursalInfoEl.style.borderColor = '#fca5a5';
    sucursalInfoEl.style.color = '#dc2626';
    document.getElementById('placeOrderBtn').disabled = true;
  } else {
    const label = saved.sucursal === 'cdb' ? '🏫 CDB' : '🏢 EXSAL';
    sucursalInfoEl.innerHTML = `🏫 <b>Sucursal:</b> ${label} <span style="font-size:.75rem;color:var(--g400)">(puedes cambiarlo en tu perfil)</span>`;
    sucursalInfoEl.style.background = '';
    sucursalInfoEl.style.borderColor = '';
    sucursalInfoEl.style.color = '';
    document.getElementById('placeOrderBtn').disabled = false;
  }
  openModal('checkoutModal');
}

async function placeOrder() {
  const name    = document.getElementById('studentName').value.trim();
  const grade   = document.getElementById('studentGrade').value;
  const section = document.getElementById('studentSection').value;
  if (!name || !grade || !section) { showToast('⚠️ Completa todos los campos'); return; }

  // Sucursal desde perfil (obligatoria)
  const savedProfile = getSavedProfile();
  const sucursal = savedProfile.sucursal || null;
  if (!sucursal) {
    showToast('⚠️ Configura tu sucursal en tu perfil');
    closeModal('checkoutModal');
    showPage('profile');
    return;
  }

  // Validar stock local
  for (const id of Object.keys(cart)) {
    if ((stockMap[id] || 0) < (cart[id] || 0)) {
      const p = products.find(x => x.id === id);
      showToast('⚠️ Stock insuficiente: ' + (p?.name || id));
      return;
    }
  }

  const btn = document.getElementById('placeOrderBtn');
  btn.disabled    = true;
  btn.textContent = 'Guardando...';

  const code  = genCode();
  const items = Object.keys(cart).map(id => {
    const p = products.find(x => x.id === id);
    return { id, name: p.name, qty: cart[id], price: p.price, cost: p.cost };
  });
  const rawTotal   = items.reduce((s, i) => s + i.qty * i.price, 0);
  const finalTotal = selectedDiscount
    ? +(rawTotal * (1 - selectedDiscount.porcentaje / 100)).toFixed(2)
    : +rawTotal.toFixed(2);

  try {
    const stockField = sucursal === 'cdb' ? 'stockCdb' : 'stockExsal';

    const docRef = await db.collection('pedidos').add({
      code, name, grade, section, items,
      total:               +rawTotal.toFixed(2),
      totalConDescuento:   selectedDiscount ? finalTotal : null,
      discountId:          selectedDiscount ? selectedDiscount.id        : null,
      discountName:        selectedDiscount ? selectedDiscount.nombre    : null,
      discountPct:         selectedDiscount ? selectedDiscount.porcentaje: null,
      sucursal:    sucursal,
      status:      'pending',
      stockDeducted: true,
      createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
      deliveredAt: null,
      userId:      currentUser?.uid   || null,
      email:       currentUser?.email || null
    });

    // Descontar el stock de la sucursal en Firebase (atómico) al crear el pedido.
    try {
      const stockBatch = db.batch();
      for (const id of Object.keys(cart)) {
        stockBatch.update(db.collection('productos').doc(id), {
          [stockField]: firebase.firestore.FieldValue.increment(-(cart[id] || 0)),
          updatedAt: Date.now()   // marca el producto como cambiado para el caché incremental
        });
      }
      await stockBatch.commit();
      // El caché eterno se mantiene; la próxima carga releerá solo estos productos
      // gracias al sello updatedAt. (Ya no se borra todo el caché.)
    } catch (e) { console.warn('No se pudo descontar stock al crear el pedido:', e); }

    // Incrementar contador de pedidos pendientes en estadísticas (tiempo real, NO se resetea por mes)
    try {
      const statDocId = sucursal === 'cdb' ? 'ColegioDonBosco' : 'ColegioExsal';
      await db.collection('estadisticas').doc(statDocId).set({
        pedidosPendientes: firebase.firestore.FieldValue.increment(1)
      }, { merge: true });
    } catch (e) { console.warn('No se pudo incrementar pedidosPendientes:', e); }

    // Reflejar el descuento en el stockMap local
    for (const id of Object.keys(cart)) {
      stockMap[id] = Math.max(0, (stockMap[id] || 0) - (cart[id] || 0));
    }

    cart = {};
    myOrdersPaging.page = 0; myOrdersPaging.cursors = []; myOrdersPaging.atEnd = false; // refrescar al crear pedido
    selectedDiscount = null; // Bug 1 fix: resetear descuento seleccionado al completar pedido
    try { localStorage.removeItem('pico_cart'); } catch(_) {}
    updateCartUI();
    renderProducts();
    closeModal('checkoutModal');
    document.getElementById('studentGrade').value   = '';
    document.getElementById('studentSection').value = '';
    document.getElementById('generatedCode').textContent = code;

    // ─── GENERAR QR ───
    const qrContainer = document.getElementById('qr-pedido');
    qrContainer.innerHTML = '';
    const urlQR = `https://calehzzz.github.io/PICO/?pedido=${docRef.id}`;
    new QRCode(qrContainer, {
      text:         urlQR,
      width:        140,
      height:       140,
      colorDark:    '#0f172a',
      colorLight:   '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });

    openModal('successModal');
  } catch (err) {
    showToast('❌ Error al guardar el pedido: ' + err.message);
    console.error('placeOrder:', err);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Realizar Pedido ✓';
  }
}

function onSuccessClose() {
  closeModal('successModal');
  document.getElementById('qr-pedido').innerHTML = '';
  showPage('myOrders');
}

function showOrderQR(firestoreId, code) {
  document.getElementById('qrViewerCode').textContent = code;
  const container = document.getElementById('qr-viewer-container');
  container.innerHTML = '';
  const urlQR = `https://calehzzz.github.io/PICO/?pedido=${firestoreId}`;
  new QRCode(container, {
    text:         urlQR,
    width:        160,
    height:       160,
    colorDark:    '#0f172a',
    colorLight:   '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
  openModal('qrViewerModal');
}
