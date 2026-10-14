// ════════════════════════════════════════════════════════════════
// PICO · Mis pedidos y seguimiento por código
// ════════════════════════════════════════════════════════════════

// ── Helpers de presentación de pedidos (compartidos cliente/seguimiento) ──
// Total a mostrar: para domicilio incluye el envío; en lo demás, el de productos.
function orderDisplayTotal(o) {
  if (o && o.tipoEntrega === 'domicilio' && typeof o.totalConEnvio === 'number') return o.totalConEnvio;
  return (typeof o.totalConDescuento === 'number') ? o.totalConDescuento : (o.total || 0);
}
// Badge de estado (incluye el estado 'confirmado' del envío a domicilio).
function orderStatusBadge(o) {
  switch (o.status) {
    case 'cancelled':  return { cls: 'sc', txt: 'Cancelado' };
    case 'pending':    return { cls: 'sp', txt: 'Pendiente' };
    case 'confirmado': return { cls: 'si', txt: 'Confirmado' };
    default:           return { cls: 'ss', txt: 'Entregado' };
  }
}
// Línea con el grado/sección (pickup Colegio) o el tipo de entrega. Texto PÚBLICO:
// para retiro sin datos académicos (universidad) se muestra genérico, sin institución.
function orderEntregaMeta(o) {
  if (o.tipoEntrega === 'domicilio') return '<span>Envío a domicilio</span>';
  if (o.grade || o.section) return `<span>${o.grade || ''} – ${o.section || ''}</span>`;
  return '<span>Retiro en sucursal</span>';
}
// Normaliza URL de rastreo (solo http/https). Vacío si no es válida.
function normalizeTrackingUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch (_) {
    return '';
  }
}
function _trackEsc(str) {
  if (typeof _pdEsc === 'function') return _pdEsc(str);
  if (typeof escHtml === 'function') return escHtml(str);
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Bloque del ID de rastreo (solo domicilio, cuando ya está asignado).
// El cliente ve el número; si hay link, al tocarlo abre el trackingUrl.
function orderTrackingBlock(o) {
  if (o.tipoEntrega !== 'domicilio' || !o.trackingId) return '';
  const idEsc = _trackEsc(o.trackingId);
  const url = normalizeTrackingUrl(o.trackingUrl);
  const idHtml = url
    ? `<a class="tracking-id-link" href="${_trackEsc(url)}" target="_blank" rel="noopener noreferrer">${idEsc}</a>`
    : `<span class="tracking-id-text">${idEsc}</span>`;
  return `<div class="order-tracking-block">
      <b>ID de rastreo:</b> ${idHtml}
    </div>`;
}
// Línea de envío dentro del desglose (solo domicilio).
function orderEnvioLine(o) {
  if (o.tipoEntrega !== 'domicilio' || !o.envioCosto) return '';
  return `<div class="odetail-subtotal"><span>Envío</span><span>$${(o.envioCosto).toFixed(2)}</span></div>`;
}

// ── Calificación de pedidos a domicilio (producto + envío, 1–5) ──
let _rateDraft = { orderId: null, code: '', product: 0, shipping: 0 };

function orderHasRating(o) {
  return !!(o && o.rating && (o.rating.product || o.rating.shipping || o.ratedAt));
}

function orderCanRate(o) {
  if (!o || o.tipoEntrega !== 'domicilio') return false;
  if (o.status !== 'delivered' && o.status !== 'sold') return false;
  if (orderHasRating(o)) return false;
  if (currentUser && o.userId && currentUser.uid !== o.userId) return false;
  return true;
}

function orderRatingStarsText(n) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  return '★'.repeat(v) + '☆'.repeat(5 - v);
}

function orderRatingBlock(o) {
  if (!orderHasRating(o)) return '';
  const p = o.rating?.product || 0;
  const s = o.rating?.shipping || 0;
  return `<div class="order-rating-done">Tu calificación · Producto <b>${orderRatingStarsText(p)}</b> (${p}/5) · Envío <b>${orderRatingStarsText(s)}</b> (${s}/5)</div>`;
}

function orderRateActionHtml(o) {
  if (!orderCanRate(o)) return orderRatingBlock(o);
  const id = _trackEsc(o.firestoreId || '');
  const code = _trackEsc(o.code || '');
  return `<div style="margin-top:12px;text-align:right">
      <button type="button" class="btn-rate-order" onclick="openRateOrderModal('${id}','${code}')">Calificar pedido</button>
    </div>`;
}

function _paintRateStars(containerId, value, kind) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = [1, 2, 3, 4, 5].map(n =>
    `<button type="button" class="rate-star${n <= value ? ' is-on' : ''}" aria-label="${n} de 5"
      aria-checked="${n === value ? 'true' : 'false'}" role="radio"
      onclick="setRateDraft('${kind}',${n})">${n}</button>`
  ).join('');
}

function setRateDraft(kind, value) {
  if (kind === 'product') _rateDraft.product = value;
  else if (kind === 'shipping') _rateDraft.shipping = value;
  _paintRateStars('rateProductStars', _rateDraft.product, 'product');
  _paintRateStars('rateShippingStars', _rateDraft.shipping, 'shipping');
  const err = document.getElementById('rateOrderErr');
  if (err) err.hidden = true;
}

function openRateOrderModal(orderId, code) {
  if (!currentUser) { showToast('Inicia sesión para calificar'); return; }
  _rateDraft = { orderId, code: code || '', product: 0, shipping: 0 };
  const title = document.getElementById('rateOrderTitle');
  if (title) title.textContent = code ? `Calificar ${code}` : 'Calificar pedido';
  const err = document.getElementById('rateOrderErr');
  if (err) err.hidden = true;
  const btn = document.getElementById('rateOrderSubmitBtn');
  if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
  _paintRateStars('rateProductStars', 0, 'product');
  _paintRateStars('rateShippingStars', 0, 'shipping');
  openModal('rateOrderModal');
}

async function submitOrderRating() {
  const { orderId, product, shipping } = _rateDraft;
  const err = document.getElementById('rateOrderErr');
  if (!orderId || !currentUser) {
    showToast('Inicia sesión para calificar');
    return;
  }
  if (!(product >= 1 && product <= 5) || !(shipping >= 1 && shipping <= 5)) {
    if (err) err.hidden = false;
    return;
  }
  const btn = document.getElementById('rateOrderSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const ref = db.collection('pedidos').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Pedido no encontrado');
    const o = snap.data() || {};
    if (o.userId && o.userId !== currentUser.uid) throw new Error('Solo el dueño del pedido puede calificar');
    if (o.tipoEntrega !== 'domicilio') throw new Error('Solo se califican envíos a domicilio');
    if (o.status !== 'delivered' && o.status !== 'sold') throw new Error('El pedido aún no está entregado');
    if (o.rating && (o.rating.product || o.rating.shipping)) throw new Error('Este pedido ya fue calificado');
    await ref.update({
      rating: { product, shipping },
      ratedAt: firebase.firestore.FieldValue.serverTimestamp(),
      ratedBy: currentUser.uid
    });
    closeModal('rateOrderModal');
    showToast('¡Gracias por tu calificación!');
    if (typeof myOrdersPaging !== 'undefined') {
      myOrdersPaging.page = 0; myOrdersPaging.cursors = []; myOrdersPaging.atEnd = false;
    }
    if (typeof renderMyOrders === 'function') renderMyOrders();
    if (typeof refreshAdminAfterChange === 'function') refreshAdminAfterChange();
    if (typeof loadAdminRatings === 'function') loadAdminRatings();
  } catch (e) {
    showToast(e.message || 'No se pudo guardar la calificación');
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
  }
}

// ═══════════════════════════════════════════════════
//  MY ORDERS (Firestore)
// ═══════════════════════════════════════════════════
// Cache de mis pedidos para evitar re-queries en cada navegacion
const MY_ORDERS_PAGE_SIZE = 5;
let myOrdersTab = 'active';
const myOrdersPaging = { page: 0, cursors: [], docs: [], atEnd: false, loading: false, uid: null };

function switchMyOrdersTab(tab) {
  if (myOrdersTab === tab) return;
  myOrdersTab = tab;
  document.getElementById('otab-active').classList.toggle('active', tab === 'active');
  document.getElementById('otab-done').classList.toggle('active', tab === 'done');
  // Reiniciar paginación al cambiar de pestaña
  myOrdersPaging.page = 0;
  myOrdersPaging.cursors = [];
  myOrdersPaging.atEnd = false;
  loadMyOrdersPage();
}

// Query base de "Mis Pedidos" según pestaña (más recientes primero)
function myOrdersQuery() {
  const base = db.collection('pedidos').where('userId', '==', currentUser.uid);
  if (myOrdersTab === 'active') {
    // 'pending' y 'confirmado' (envío con guía generada) cuentan como activos.
    return base.where('status', 'in', ['pending', 'confirmado']).orderBy('createdAt', 'desc');
  }
  return base.where('status', 'in', ['delivered', 'sold', 'cancelled']).orderBy('createdAt', 'desc');
}

async function renderMyOrders() {
  const el = document.getElementById('myOrdersList');
  const tabs = document.getElementById('myOrdersTabs');
  const pager = document.getElementById('myOrdersPager');
  if (!currentUser) {
    el.innerHTML = '<p style="color:var(--g300);font-size:.85rem">Inicia sesión para ver tu historial de pedidos.</p>';
    if (tabs)  tabs.style.display = 'none';
    if (pager) pager.classList.add('hidden');
    return;
  }
  if (tabs) tabs.style.display = '';
  // Si cambió de usuario, reiniciar
  if (myOrdersPaging.uid !== currentUser.uid) {
    myOrdersPaging.uid = currentUser.uid;
    myOrdersPaging.page = 0;
    myOrdersPaging.cursors = [];
    myOrdersPaging.atEnd = false;
  }
  loadMyOrdersPage();
}

// Carga la página actual de Mis Pedidos desde Firestore (5 docs reales)
async function loadMyOrdersPage() {
  if (!currentUser) return;
  const el = document.getElementById('myOrdersList');
  const st = myOrdersPaging;
  if (st.loading) return;
  st.loading = true;
  el.innerHTML = '<p style="color:var(--g400);font-size:.85rem;text-align:center;padding:24px 0">Cargando...</p>';
  try {
    let q = myOrdersQuery().limit(MY_ORDERS_PAGE_SIZE);
    if (st.page > 0 && st.cursors[st.page - 1]) {
      q = q.startAfter(st.cursors[st.page - 1]);
    }
    const snap = await q.get();
    st.docs = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    if (snap.docs.length) st.cursors[st.page] = snap.docs[snap.docs.length - 1];
    st.atEnd = snap.docs.length < MY_ORDERS_PAGE_SIZE;
    _renderMyOrdersList(el, st.docs);
    _renderMyOrdersPager();
  } catch (err) {
    el.innerHTML = `<p style="color:var(--red);font-size:.85rem">Error al cargar los pedidos. ${err.code === 'failed-precondition' ? 'Falta un índice en Firestore (revisa la consola).' : ''}</p>`;
    console.error('renderMyOrders:', err);
  } finally {
    st.loading = false;
  }
}

function myOrdersPageNav(dir) {
  const st = myOrdersPaging;
  if (dir > 0) {
    if (st.atEnd) return;
    st.page++;
  } else {
    if (st.page === 0) return;
    st.page--;
  }
  loadMyOrdersPage();
}

function _renderMyOrdersPager() {
  const st = myOrdersPaging;
  const pager = document.getElementById('myOrdersPager');
  // Ocultar paginador si estamos en la primera página y no hay más
  if (st.page === 0 && st.atEnd) { pager.classList.add('hidden'); return; }
  pager.classList.remove('hidden');
  document.getElementById('myOrdersPageInfo').textContent = `Página ${st.page + 1}`;
  document.getElementById('myOrdersPrevBtn').disabled = st.page === 0;
  document.getElementById('myOrdersNextBtn').disabled = st.atEnd;
}


function _renderMyOrdersList(el, myOrders) {
  if (!myOrders.length) {
    const msg = myOrdersTab === 'active'
      ? (myOrdersPaging.page === 0 ? 'No tienes pedidos activos.' : 'No hay más pedidos en esta página.')
      : (myOrdersPaging.page === 0 ? 'No tienes pedidos entregados ni cancelados.' : 'No hay más pedidos en esta página.');
    el.innerHTML = `<p style="color:var(--g300);font-size:.85rem">${msg}</p>`;
    return;
  }
  el.innerHTML = myOrders.map(o => {
    const isCancelled  = o.status === 'cancelled';
    const isPending    = o.status === 'pending';
    // El cliente NO puede cancelar pedidos a domicilio (solo el admin).
    const canCancel    = isPending && o.tipoEntrega !== 'domicilio';
    const badge        = orderStatusBadge(o);
    const payPending   = o.metodoPago === 'tarjeta'
      && o.paymentStatus === 'pending'
      && !o.creditsFullyPaid;
    const payLabel = o.metodoPago === 'tarjeta' ? 'Tarjeta'
                   : o.metodoPago === 'efectivo' ? 'Efectivo' : null;
    return `
    <div class="ocard" ${isCancelled ? 'style="opacity:.65;border-color:#fca5a5"' : ''}>
      <div class="ocard-hd">
        <span class="ocode">${o.code}</span>
        <span class="sbadge ${badge.cls}">${badge.txt}</span>
      </div>
      <div class="ometa">
        <span>${o.name}</span>
        ${orderEntregaMeta(o)}
        <span>${fmtDate(o.createdAt)}</span>
        <span>$${orderDisplayTotal(o).toFixed(2)}</span>
        ${payLabel ? `<span>${payLabel}${o.paymentStatus === 'paid' ? ' · Pagado' : (o.paymentStatus === 'pending' ? ' · Pendiente de pago' : '')}</span>` : ''}
        ${o.deliveredAt ? `<span>${fmtDate(o.deliveredAt)}</span>` : ''}
      </div>
      ${orderTrackingBlock(o)}
      <div style="margin-top:9px;padding-top:9px;border-top:1px solid var(--b50)">
        <div class="odetail-list" style="gap:4px">
          ${(o.items || []).map(i => `
            <div class="odetail-item">
              <div>
                <div class="odetail-item-name">${(typeof _pdEsc === 'function') ? _pdEsc(i.name || '') : (i.name || '')}${(typeof orderItemColorBadgeHtml === 'function') ? orderItemColorBadgeHtml(i) : ''}</div>
                <div class="odetail-item-sub">$${(i.price||0).toFixed(2)} × ${i.qty}</div>
              </div>
              <div class="odetail-item-price">$${((i.price||0)*i.qty).toFixed(2)}</div>
            </div>`).join('')}
          ${orderEnvioLine(o)}
          <div class="odetail-subtotal">
            <span>Total</span>
            <span>$${orderDisplayTotal(o).toFixed(2)}</span>
          </div>
        </div>
      </div>
      ${payPending ? `
      <div style="margin-top:12px;text-align:right">
        <button class="btn-pri" style="padding:8px 14px;font-size:.78rem"
          onclick="startWompiCheckout('${o.firestoreId}').catch(e=>showToast(e.message||'No se pudo abrir el pago'))">
          Pagar con tarjeta
        </button>
      </div>` : ''}
      ${canCancel ? `
      <div style="margin-top:12px;text-align:right">
        <button class="btn-cancel-order" onclick="customerCancelOrder('${o.firestoreId}','${o.code}',this)">
          ✕ Cancelar pedido
        </button>
      </div>` : ''}
      ${orderRateActionHtml(o)}
      <div style="margin-top:10px;text-align:right">
        <button onclick="showOrderQR('${o.firestoreId}','${o.code}')"
          style="padding:5px 12px;border-radius:7px;border:1.5px solid var(--b200);background:var(--b50);color:var(--b600);font-family:var(--font);font-size:.73rem;font-weight:600;cursor:pointer">
          Ver QR
        </button>
      </div>
    </div>`;
  }).join('');
}

async function customerCancelOrder(firestoreId, code, btn) {
  if (!confirm(`¿Estás seguro de cancelar el pedido ${code}?\nEsta acción no se puede deshacer.`)) return;
  btn.disabled = true;
  btn.textContent = 'Cancelando...';
  try {
    const snap = await db.collection('pedidos').doc(firestoreId).get();
    const orderData = snap.data() || {};
    // Los pedidos a domicilio solo los cancela el admin.
    if (orderData.tipoEntrega === 'domicilio') {
      showToast('Los envíos a domicilio solo puede cancelarlos el administrador');
      btn.disabled = false;
      btn.textContent = '✕ Cancelar pedido';
      return;
    }
    // No se permite cancelar entregados
    if (orderData.status === 'delivered' || orderData.status === 'sold') {
      showToast('Este pedido ya fue entregado y no puede cancelarse');
      btn.disabled = false;
      btn.textContent = '✕ Cancelar pedido';
      return;
    }
    const items = orderData.items || [];
    const batch = db.batch();
    // Las facturas NUNCA se borran: se marcan como ANULADAS para conservar el historial contable.
    try {
      const facSnap = await db.collection('facturas').where('fromOrder', '==', firestoreId).get();
      facSnap.forEach(d => batch.update(d.ref, {
        anulada: true,
        anuladaAt: firebase.firestore.FieldValue.serverTimestamp(),
        anuladaBy: currentUser?.uid || 'customer'
      }));
    } catch (e) { console.warn('No se pudo marcar la factura del pedido como anulada:', e); }
    // Marcar pedido como cancelado
    batch.update(db.collection('pedidos').doc(firestoreId), {
      status: 'cancelled',
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
      cancelledBy: currentUser?.uid || 'customer',
      stockDeducted: false
    });
    // Ajustar contadores de pedidos en estadísticas (el cliente solo cancela pendientes)
    {
      const sucC = (orderData.sucursal === 'exsal') ? 'ColegioExsal' : 'ColegioDonBosco';
      const statUpdate = { 'pedidosCancelados': firebase.firestore.FieldValue.increment(1) };
      if (orderData.status === 'pending') {
        statUpdate['pedidosPendientes'] = firebase.firestore.FieldValue.increment(-1);
      }
      batch.set(db.collection('estadisticas').doc(sucC), statUpdate, { merge: true });
    }
    // Restaurar stock en Firebase (atómico) si el pedido tenía stock descontado.
    if (orderData.stockDeducted) {
      const sucursal   = orderData.sucursal;
      const stockField = sucursal === 'exsal' ? 'stockExsal' : 'stockCdb';
      for (const item of items) {
        batch.update(db.collection('productos').doc(item.id), {
          [stockField]: firebase.firestore.FieldValue.increment(item.qty || 0),
          updatedAt: Date.now()   // marca cambio para el caché incremental
        });
      }
    }
    await batch.commit();
    // El caché eterno se conserva; la próxima carga releerá solo lo cambiado.
    // Restaurar stock visual local
    if (orderData.stockDeducted) {
      for (const item of items) {
        stockMap[item.id] = (stockMap[item.id] || 0) + (item.qty || 0);
      }
    }
    renderProducts();
    myOrdersPaging.page = 0; myOrdersPaging.cursors = []; myOrdersPaging.atEnd = false;
    renderMyOrders();
    showToast('Pedido cancelado — stock restaurado');
  } catch (err) {
    showToast('Error al cancelar: ' + err.message);
    btn.disabled = false;
    btn.textContent = '✕ Cancelar pedido';
  }
}
async function trackOrder() {
  const code = document.getElementById('trackInput').value.trim().toUpperCase();
  const el   = document.getElementById('trackResult');
  if (!code) return;
  el.innerHTML = '<p style="color:var(--g400);font-size:.85rem">Buscando...</p>';
  try {
    const snap = await db.collection('pedidos').where('code', '==', code).limit(1).get();
    if (snap.empty) {
      el.innerHTML = `<div style="background:#fee2e2;color:#dc2626;border-radius:10px;padding:12px 16px;font-size:.83rem;margin-bottom:14px">Código no encontrado.</div>`;
      return;
    }
    const o = { firestoreId: snap.docs[0].id, ...snap.docs[0].data() };
    const isCancelled = o.status === 'cancelled';
    const isPending   = o.status === 'pending';
    // El cliente NO puede cancelar pedidos a domicilio (solo el admin).
    const canCancel   = isPending && o.tipoEntrega !== 'domicilio' && currentUser && currentUser.uid === o.userId;
    const badge       = orderStatusBadge(o);
    el.innerHTML = `
      <div class="ocard" style="border-color:var(--b300);box-shadow:var(--sh2)" ${isCancelled ? 'style="opacity:.65"' : ''}>
        <div class="ocard-hd">
          <span class="ocode">${o.code}</span>
          <span class="sbadge ${badge.cls}">${badge.txt}</span>
        </div>
        <div class="ometa">
          <span>${o.name}</span>
          ${orderEntregaMeta(o)}
          <span>${fmtDate(o.createdAt)}</span>
          <span>$${orderDisplayTotal(o).toFixed(2)}</span>
          ${o.deliveredAt ? `<span>${fmtDate(o.deliveredAt)}</span>` : ''}
        </div>
        ${orderTrackingBlock(o)}
        <div style="margin-top:9px;padding-top:9px;border-top:1px solid var(--b50)">
          <div class="odetail-list" style="gap:4px">
            ${(o.items || []).map(i => `
              <div class="odetail-item">
                <div>
                  <div class="odetail-item-name">${(typeof _pdEsc === 'function') ? _pdEsc(i.name || '') : (i.name || '')}${(typeof orderItemColorBadgeHtml === 'function') ? orderItemColorBadgeHtml(i) : ''}</div>
                  <div class="odetail-item-sub">$${(i.price||0).toFixed(2)} × ${i.qty}</div>
                </div>
                <div class="odetail-item-price">$${((i.price||0)*i.qty).toFixed(2)}</div>
              </div>`).join('')}
            ${orderEnvioLine(o)}
            <div class="odetail-subtotal">
              <span>Total</span>
              <span>$${orderDisplayTotal(o).toFixed(2)}</span>
            </div>
          </div>
        </div>
        ${canCancel ? `
        <div style="margin-top:12px;text-align:right">
          <button class="btn-cancel-order" onclick="customerCancelOrder('${o.firestoreId}','${o.code}',this)">
            ✕ Cancelar pedido
          </button>
        </div>` : ''}
        ${orderRateActionHtml(o)}
      </div>`;
  } catch (err) {
    el.innerHTML = '<p style="color:var(--red);font-size:.85rem">Error al buscar el pedido.</p>';
    console.error('trackOrder:', err);
  }
}
