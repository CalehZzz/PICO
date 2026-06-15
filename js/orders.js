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
    case 'cancelled':  return { cls: 'sc', txt: '❌ Cancelado' };
    case 'pending':    return { cls: 'sp', txt: '⏳ Pendiente' };
    case 'confirmado': return { cls: 'si', txt: '📦 Confirmado' };
    default:           return { cls: 'ss', txt: '✅ Entregado' };
  }
}
// Línea con el grado/sección (pickup) o el tipo de entrega (domicilio).
function orderEntregaMeta(o) {
  return o.tipoEntrega === 'domicilio'
    ? '<span>🚚 Envío a domicilio</span>'
    : `<span>🎓 ${o.grade || ''} – ${o.section || ''}</span>`;
}
// Bloque del ID de rastreo (solo domicilio, cuando ya está asignado).
function orderTrackingBlock(o) {
  if (o.tipoEntrega !== 'domicilio' || !o.trackingId) return '';
  return `<div style="margin-top:9px;padding:8px 12px;background:var(--b50);border:1.5px solid var(--b200);border-radius:9px;font-size:.8rem;color:var(--g700)">
      📦 <b>ID de rastreo:</b> <span style="color:var(--b600);font-weight:700;letter-spacing:.03em">${o.trackingId}</span>
    </div>`;
}
// Línea de envío dentro del desglose (solo domicilio).
function orderEnvioLine(o) {
  if (o.tipoEntrega !== 'domicilio' || !o.envioCosto) return '';
  return `<div class="odetail-subtotal"><span>🚚 Envío</span><span>$${(o.envioCosto).toFixed(2)}</span></div>`;
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
    return `
    <div class="ocard" ${isCancelled ? 'style="opacity:.65;border-color:#fca5a5"' : ''}>
      <div class="ocard-hd">
        <span class="ocode">${o.code}</span>
        <span class="sbadge ${badge.cls}">${badge.txt}</span>
      </div>
      <div class="ometa">
        <span>👤 ${o.name}</span>
        ${orderEntregaMeta(o)}
        <span>📅 ${fmtDate(o.createdAt)}</span>
        <span>💰 $${orderDisplayTotal(o).toFixed(2)}</span>
        ${o.deliveredAt ? `<span>📦 ${fmtDate(o.deliveredAt)}</span>` : ''}
      </div>
      ${orderTrackingBlock(o)}
      <div style="margin-top:9px;padding-top:9px;border-top:1px solid var(--b50)">
        <div class="odetail-list" style="gap:4px">
          ${(o.items || []).map(i => `
            <div class="odetail-item">
              <div>
                <div class="odetail-item-name">${i.name}</div>
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
      <div style="margin-top:10px;text-align:right">
        <button onclick="showOrderQR('${o.firestoreId}','${o.code}')"
          style="padding:5px 12px;border-radius:7px;border:1.5px solid var(--b200);background:var(--b50);color:var(--b600);font-family:var(--font);font-size:.73rem;font-weight:600;cursor:pointer">
          🔲 Ver QR
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
      const sucC = (orderData.sucursal === 'cdb' || orderData.sucursal === 'domicilio') ? 'ColegioDonBosco' : 'ColegioExsal';
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
    showToast('✅ Pedido cancelado — stock restaurado');
  } catch (err) {
    showToast('❌ Error al cancelar: ' + err.message);
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
      el.innerHTML = `<div style="background:#fee2e2;color:#dc2626;border-radius:10px;padding:12px 16px;font-size:.83rem;margin-bottom:14px">❌ Código no encontrado.</div>`;
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
          <span>👤 ${o.name}</span>
          ${orderEntregaMeta(o)}
          <span>📅 ${fmtDate(o.createdAt)}</span>
          <span>💰 $${orderDisplayTotal(o).toFixed(2)}</span>
          ${o.deliveredAt ? `<span>📦 ${fmtDate(o.deliveredAt)}</span>` : ''}
        </div>
        ${orderTrackingBlock(o)}
        <div style="margin-top:9px;padding-top:9px;border-top:1px solid var(--b50)">
          <div class="odetail-list" style="gap:4px">
            ${(o.items || []).map(i => `
              <div class="odetail-item">
                <div>
                  <div class="odetail-item-name">${i.name}</div>
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
      </div>`;
  } catch (err) {
    el.innerHTML = '<p style="color:var(--red);font-size:.85rem">Error al buscar el pedido.</p>';
    console.error('trackOrder:', err);
  }
}
