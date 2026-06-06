// ════════════════════════════════════════════════════════════════
// PICO · Panel de administración (pedidos en tiempo real)
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  ADMIN — REAL-TIME LISTENER
// ═══════════════════════════════════════════════════
const ADMIN_PAGE_SIZE = 5;

// Estado de paginación por sección. cursors[n] = snapshot del último doc de la página n (para startAfter)
const adminPaging = {
  active: { page: 0, cursors: [], docs: [], atEnd: false, loading: false },
  done:   { page: 0, cursors: [], docs: [], atEnd: false, loading: false }
};

function startAdminListener() {
  // Ya no usamos un listener global que lea todos los pedidos.
  // La carga es paginada y bajo demanda (5 en 5) al abrir el panel.
}

// Construye la query base de cada sección (orden: más recientes primero)
function adminSectionQuery(section) {
  const base = db.collection('pedidos');
  if (section === 'active') {
    return base.where('status', '==', 'pending').orderBy('createdAt', 'desc');
  }
  // 'done' = entregados/vendidos + cancelados. Firestore no permite "in" + orderBy distinto
  // sin índice, así que usamos 'status' "in" con orderBy createdAt (requiere índice compuesto).
  return base.where('status', 'in', ['delivered', 'sold', 'cancelled']).orderBy('createdAt', 'desc');
}

// Carga la página actual de una sección desde Firestore (lectura real de 5 docs)
async function loadAdminSection(section) {
  const st = adminPaging[section];
  if (st.loading) return;
  st.loading = true;
  const bodyId = section === 'active' ? 'adminActiveBody' : 'adminDoneBody';
  const tb = document.getElementById(bodyId);
  tb.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--g300)">Cargando...</td></tr>`;
  try {
    let q = adminSectionQuery(section).limit(ADMIN_PAGE_SIZE);
    if (st.page > 0 && st.cursors[st.page - 1]) {
      q = q.startAfter(st.cursors[st.page - 1]);
    }
    const snap = await q.get();
    st.docs = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    // Guardar cursor (último doc) de esta página para poder avanzar
    if (snap.docs.length) st.cursors[st.page] = snap.docs[snap.docs.length - 1];
    // Si trajimos menos de PAGE_SIZE, ya no hay más páginas
    st.atEnd = snap.docs.length < ADMIN_PAGE_SIZE;
    renderAdminSection(section);
  } catch (err) {
    console.error('loadAdminSection ' + section + ':', err);
    tb.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--red)">Error al cargar. ${err.code === 'failed-precondition' ? 'Falta un índice en Firestore (revisa la consola).' : err.message}</td></tr>`;
  } finally {
    st.loading = false;
  }
}

// Avanzar/retroceder página de una sección
function adminPage(section, dir) {
  const st = adminPaging[section];
  if (dir > 0) {
    if (st.atEnd) return;
    st.page++;
  } else {
    if (st.page === 0) return;
    st.page--;
  }
  loadAdminSection(section);
}

// Tras cambiar estado/cancelar un pedido: refrescar stats y recargar las páginas visibles
function refreshAdminAfterChange() {
  if (!isAdmin) return;
  // En la estructura multipágina, "ver el panel admin" = estar en admin.html
  if (document.body.dataset.page !== 'adminPanel') return;
  loadAdminSection('active');
  loadAdminSection('done');
}

function renderAdminPanel() {
  if (!isAdmin) return;
  renderAdminDiscountSection();
  // Reiniciar a la primera página de cada sección y cargar
  adminPaging.active = { page: 0, cursors: [], docs: [], atEnd: false, loading: false };
  adminPaging.done   = { page: 0, cursors: [], docs: [], atEnd: false, loading: false };
  loadAdminSection('active');
  loadAdminSection('done');
}

// Renderiza la página actual de una sección (con filtro de texto opcional sobre lo cargado)
function renderAdminSection(section, filterText) {
  const st = adminPaging[section];
  const bodyId  = section === 'active' ? 'adminActiveBody' : 'adminDoneBody';
  const pagerId = section === 'active' ? 'adminActivePager' : 'adminDonePager';
  const infoId  = section === 'active' ? 'activePageInfo'   : 'donePageInfo';
  const prevId  = section === 'active' ? 'activePrevBtn'    : 'donePrevBtn';
  const nextId  = section === 'active' ? 'activeNextBtn'    : 'doneNextBtn';

  let data = st.docs;
  if (filterText) {
    const lq = filterText.toLowerCase();
    data = data.filter(o =>
      (o.name    || '').toLowerCase().includes(lq) ||
      (o.code    || '').toLowerCase().includes(lq) ||
      (o.grade   || '').toLowerCase().includes(lq) ||
      (o.section || '').toLowerCase().includes(lq)
    );
  }
  renderAdminRows(bodyId, data);

  // Controles de paginación
  const pager = document.getElementById(pagerId);
  pager.classList.remove('hidden');
  document.getElementById(infoId).textContent = `Página ${st.page + 1}`;
  document.getElementById(prevId).disabled = st.page === 0;
  document.getElementById(nextId).disabled = st.atEnd;
}

function renderAdminRows(bodyId, data) {
  const tb = document.getElementById(bodyId);
  if (!data.length) {
    tb.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--g300)">Sin pedidos en esta página</td></tr>`;
    return;
  }
  tb.innerHTML = data.map(o => {
    const isCancelled = o.status === 'cancelled';
    const isPending   = o.status === 'pending';
    const statusColor = isCancelled ? '#fee2e2' : (isPending ? '#fef3c7' : '#d1fae5');
    const statusText  = isCancelled ? '#dc2626'  : (isPending ? '#d97706' : '#059669');
    return `
    <tr data-fid="${o.firestoreId}" ${isCancelled ? 'style="opacity:.6"' : ''}>
      <td><b style="color:var(--b600)">${o.code || '—'}</b></td>
      <td>${o.name || '—'}</td>
      <td>${o.grade || '—'}</td>
      <td><span style="background:var(--b100);color:var(--b600);border-radius:999px;padding:2px 9px;font-size:.72rem;font-weight:600">${o.section || '—'}</span></td>
      <td>
        <button onclick="showOrderDetail('${o.firestoreId}')" style="background:var(--b50);color:var(--b600);border:1.5px solid var(--b200);border-radius:7px;padding:3px 9px;font-size:.72rem;font-weight:600;cursor:pointer;white-space:nowrap">
          🔍 Ver (${(o.items||[]).length})
        </button>
      </td>
      <td style="font-weight:700;color:var(--b600)">$${(typeof o.totalConDescuento === 'number' ? o.totalConDescuento : (o.total || 0)).toFixed(2)}</td>
      <td style="font-size:.75rem;white-space:nowrap;color:var(--g500)">${fmtDate(o.createdAt)}</td>
      <td style="font-size:.75rem;white-space:nowrap;color:var(--g500)">${o.deliveredAt ? fmtDate(o.deliveredAt) : '<span style="color:var(--g300)">—</span>'}</td>
      <td>
        ${isCancelled
          ? `<span style="font-size:.72rem;color:var(--g300)">—</span>`
          : `<select class="stsel" onchange="changeSucursal('${o.firestoreId}', this.value)"
              style="background:var(--b50);color:var(--b600)">
              <option value="" ${!o.sucursal ? 'selected' : ''}>Elegir...</option>
              <option value="cdb"   ${o.sucursal === 'cdb'   ? 'selected' : ''}>🏫 CDB</option>
              <option value="exsal" ${o.sucursal === 'exsal' ? 'selected' : ''}>🏢 EXSAL</option>
            </select>`
        }
      </td>
      <td>
        ${isCancelled
          ? `<span class="sbadge sc">❌ Cancelado</span>`
          : `<select class="stsel" onchange="changeStatus('${o.firestoreId}', this.value)"
              style="background:${statusColor};color:${statusText}">
              <option value="pending" ${isPending ? 'selected' : ''}>⏳ Pendiente</option>
              <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>✅ Entregado</option>
            </select>`
        }
      </td>
      <td>
        ${isCancelled
          ? `<span style="font-size:.72rem;color:var(--g300)">—</span>`
          : `<button class="btn-cancel-order" onclick="adminCancelOrder('${o.firestoreId}', '${o.code}')"
              ${(o.status === 'delivered' || o.status === 'sold') ? 'disabled title="Pedido ya entregado"' : ''}>
              ✕ Cancelar
            </button>`
        }
      </td>
    </tr>`;
  }).join('');
}

async function changeSucursal(firestoreId, val) {
  try {
    await db.collection('pedidos').doc(firestoreId).update({ sucursal: val || null });
    // Actualizar en memoria local
    const o = findLoadedOrder(firestoreId);
    if (o) o.sucursal = val || null;
    showToast(val ? `🏫 Sucursal asignada: ${val.toUpperCase()}` : '↩️ Sucursal eliminada');
  } catch (err) {
    showToast('❌ Error: ' + err.message);
  }
}

// Revierte una entrega: restaura stock, borra los registros de "ventas" del pedido
// y resta las estadísticas SOLO si la entrega fue del mes actual. Deja el pedido como pendiente.
async function revertDelivery(firestoreId, data) {
  const sucursal = data.sucursal === 'cdb' ? 'cdb' : 'exsal';
  const stockField = sucursal === 'cdb' ? 'stockCdb' : 'stockExsal';
  const statDocId = sucursal === 'cdb' ? 'ColegioDonBosco' : 'ColegioExsal';

  // ¿La entrega fue de este mes? (las estadísticas de meses cerrados ya fueron archivadas)
  const now = new Date();
  const mesActual = now.getFullYear() + '-' + String(now.getMonth()).padStart(2, '0');
  let mesEntrega = null;
  if (data.deliveredAt) {
    const dd = data.deliveredAt.toDate ? data.deliveredAt.toDate() : new Date(data.deliveredAt);
    mesEntrega = dd.getFullYear() + '-' + String(dd.getMonth()).padStart(2, '0');
  }
  const revertStats = mesEntrega === mesActual;

  // Recalcular totales del pedido (precios/costos congelados, igual que al entregar)
  const discFactor = data.discountPct ? ((100 - data.discountPct) / 100) : 1;
  let totalUnidades = 0, totalVentasEfectivo = 0, costTotal = 0;
  for (const item of data.items) {
    const qty = item.qty || 1;
    const unitCost  = typeof item.cost  === 'number' ? item.cost  : 0;
    const unitPrice = typeof item.price === 'number' ? item.price : 0;
    totalUnidades += qty;
    totalVentasEfectivo += +(unitPrice * qty * discFactor).toFixed(2);
    costTotal += unitCost * qty;
  }
  const totalEfectivo = typeof data.totalConDescuento === 'number' ? data.totalConDescuento : totalVentasEfectivo;

  const batch = db.batch();

  // NOTA: el stock NO se restaura al volver a pendiente. El stock sigue descontado
  // mientras el pedido exista (solo se devuelve al cancelar). Aquí solo se revierten
  // los registros de "ventas" y las estadísticas de la entrega.

  // 1) Borrar los registros de "ventas" creados para este pedido (siempre)
  const ventasSnap = await db.collection('ventas').where('fromOrder', '==', firestoreId).get();
  ventasSnap.forEach(doc => batch.delete(doc.ref));

  // 2) Revertir estadísticas SOLO si la entrega fue de este mes
  const statUpdate = {
    'pedidosPendientes': firebase.firestore.FieldValue.increment(1)
  };
  if (revertStats) {
    statUpdate['pedidosEntregados'] = firebase.firestore.FieldValue.increment(-1);
    statUpdate['ventas']            = firebase.firestore.FieldValue.increment(-totalVentasEfectivo);
    statUpdate['unidades vendidas'] = firebase.firestore.FieldValue.increment(-totalUnidades);
    statUpdate['numero de ventas']  = firebase.firestore.FieldValue.increment(-data.items.length);
    statUpdate['ingresosPedidos']   = firebase.firestore.FieldValue.increment(-(+totalEfectivo.toFixed(2)));
    statUpdate['costosPedidos']     = firebase.firestore.FieldValue.increment(-(+costTotal.toFixed(2)));
  }
  batch.set(db.collection('estadisticas').doc(statDocId), statUpdate, { merge: true });

  // 3) Volver el pedido a pendiente y limpiar marcas de entrega.
  //    stockDeducted se mantiene true: el stock sigue descontado mientras el pedido exista.
  //    saleRecorded vuelve a false: la venta dejó de estar registrada.
  batch.update(db.collection('pedidos').doc(firestoreId), {
    status: 'pending',
    stockDeducted: true,
    saleRecorded: false,
    deliveredAt: null,
    costTotal: firebase.firestore.FieldValue.delete()
  });

  await batch.commit();
}

async function changeStatus(firestoreId, val) {
  try {
    // ── VOLVER A PENDIENTE: revertir la entrega (ventas y estadísticas; el stock NO se toca) ──
    if (val === 'pending') {
      const freshSnap = await db.collection('pedidos').doc(firestoreId).get();
      const fresh = freshSnap.data() || {};
      // Solo hay algo que revertir si la venta fue registrada (estaba entregado)
      if (fresh.saleRecorded && fresh.items) {
        await revertDelivery(firestoreId, fresh);
        renderProducts();
        refreshAdminAfterChange();
        showToast('🔄 Pedido devuelto a pendiente — entrega revertida');
        return;
      }
      // Si no estaba entregado realmente, solo cambiar el estado
      await db.collection('pedidos').doc(firestoreId).update({ status: 'pending', deliveredAt: null });
      refreshAdminAfterChange();
      showToast('🔄 Marcado como pendiente');
      return;
    }

    const update = { status: val };
    if (val === 'delivered') update.deliveredAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('pedidos').doc(firestoreId).update(update);

    // Al confirmar entrega: registrar venta y estadísticas (el stock ya se descontó al crear el pedido)
    if (val === 'delivered') {
      const freshSnap = await db.collection('pedidos').doc(firestoreId).get();
      const freshData = freshSnap.data() || {};
      if (freshData.items && !freshData.saleRecorded) {
        const sucursal = freshData.sucursal; // 'cdb' | 'exsal' | null
        if (!sucursal) {
          showToast('⚠️ Asigna una sucursal antes de marcar como entregado');
          // Revertir el cambio de estado
          await db.collection('pedidos').doc(firestoreId).update({ status: 'pending', deliveredAt: null });
          return;
        }
        const stockField = sucursal === 'cdb' ? 'stockCdb' : 'stockExsal';
        const stockBatch = db.batch();
        let costTotal = 0;
        let priceTotal = 0;
        // Bug 3 fix: usar precios congelados en el item (no los actuales de Firestore)
        // discFactor para aplicar descuento proporcional en los registros de ventas
        const discFactor = freshData.discountPct ? ((100 - freshData.discountPct) / 100) : 1;
        const user = firebase.auth().currentUser;
        const sellerEmail = user ? user.email : 'admin';

        // Helper: clave "YYYY-MM" para el mes actual (igual que en inventario)
        const now = new Date();
        const mesKey = now.getFullYear() + '-' + String(now.getMonth()).padStart(2, '0');

        let totalUnidades = 0;
        let totalVentasEfectivo = 0;

        for (const item of freshData.items) {
          const qty = item.qty || 1;

          // Priorizar costo/precio congelado en el item al momento del pedido
          const unitCost  = typeof item.cost  === 'number' ? item.cost  : 0;
          const unitPrice = typeof item.price === 'number' ? item.price : 0;
          costTotal  += unitCost  * qty;
          priceTotal += unitPrice * qty;

          // NOTA: el stock ya se descontó al crear el pedido. Al entregar NO se toca el stock.

          // Crear registro en "ventas" con descuento proporcional aplicado
          const itemTotal = +(unitPrice * qty * discFactor).toFixed(2);
          totalUnidades += qty;
          totalVentasEfectivo += itemTotal;
          stockBatch.set(db.collection('ventas').doc(), {
            orderNumber: 'PED-' + Date.now().toString().slice(-6) + '-' + Math.random().toString(36).slice(-3),
            productName: item.name,
            qty,
            costTotal: +(unitCost * qty).toFixed(2),
            total: itemTotal,
            seller: sellerEmail,
            sucursal,
            date: new Date().toLocaleDateString('es'),
            timestamp: Date.now(),
            mes: mesKey,          // ✅ necesario para el panel de ventas del inventario
            fromOrder: firestoreId,
            ...(freshData.discountPct ? { discountName: freshData.discountName, discountPct: freshData.discountPct } : {})
          });
        }

        // Total efectivo: respetar totalConDescuento guardado; si no existe, calcular desde precios del pedido
        const totalEfectivo = typeof freshData.totalConDescuento === 'number'
          ? freshData.totalConDescuento
          : +(priceTotal * discFactor).toFixed(2);

        stockBatch.update(db.collection('pedidos').doc(firestoreId), {
          status: 'delivered',
          stockDeducted: true,
          saleRecorded: true,
          costTotal: +costTotal.toFixed(2),
          totalConDescuento: +totalEfectivo.toFixed(2),
          deliveredAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // ✅ Actualizar estadisticas acumuladas (igual que en inventario al registrar venta directa)
        const statDocId = sucursal === 'cdb' ? 'ColegioDonBosco' : 'ColegioExsal';
        stockBatch.set(db.collection('estadisticas').doc(statDocId), {
          'ventas':            firebase.firestore.FieldValue.increment(totalVentasEfectivo),
          'unidades vendidas': firebase.firestore.FieldValue.increment(totalUnidades),
          'numero de ventas':  firebase.firestore.FieldValue.increment(freshData.items.length),
          // Contadores de pedidos (mensuales salvo pedidosPendientes)
          'pedidosEntregados': firebase.firestore.FieldValue.increment(1),
          'ingresosPedidos':   firebase.firestore.FieldValue.increment(+totalEfectivo.toFixed(2)),
          'costosPedidos':     firebase.firestore.FieldValue.increment(+costTotal.toFixed(2)),
          'pedidosPendientes': firebase.firestore.FieldValue.increment(-1)
        }, { merge: true });

        await stockBatch.commit();
        renderProducts();
        refreshAdminAfterChange();
        showToast('✅ Pedido marcado como entregado');
        return;
      }
    }
    refreshAdminAfterChange();
    showToast('✅ Marcado como entregado');
  } catch (err) {
    showToast('❌ Error: ' + err.message);
  }
}

async function adminCancelOrder(firestoreId, code) {
  const order = findLoadedOrder(firestoreId);
  // No se permite cancelar entregados: primero hay que volverlos a pendiente
  if (order && (order.status === 'delivered' || order.status === 'sold')) {
    showToast('Primero vuelve el pedido a pendiente para poder cancelarlo');
    return;
  }
  if (!confirm(`¿Cancelar el pedido ${code}? Esta acción no se puede deshacer.`)) return;
  try {
    const batch = db.batch();
    // Marcar pedido como cancelado
    batch.update(db.collection('pedidos').doc(firestoreId), {
      status: 'cancelled',
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
      cancelledBy: 'admin',
      stockDeducted: false
    });
    // Ajustar contadores de pedidos en estadísticas según el estado previo
    if (order) {
      const sucC = order.sucursal === 'cdb' ? 'ColegioDonBosco' : 'ColegioExsal';
      const statUpdate = { 'pedidosCancelados': firebase.firestore.FieldValue.increment(1) };
      if (order.status === 'pending') {
        statUpdate['pedidosPendientes'] = firebase.firestore.FieldValue.increment(-1);
      }
      batch.set(db.collection('estadisticas').doc(sucC), statUpdate, { merge: true });
    }
    // Restaurar stock en Firebase (atómico) si el pedido tenía stock descontado.
    // Todo pedido activo (creado con la lógica nueva) tiene stockDeducted=true.
    if (order && order.items && order.stockDeducted) {
      const sucursal   = order.sucursal;
      const stockField = sucursal === 'exsal' ? 'stockExsal' : 'stockCdb';
      for (const item of order.items) {
        batch.update(db.collection('productos').doc(item.id), {
          [stockField]: firebase.firestore.FieldValue.increment(item.qty || 0),
          updatedAt: Date.now()   // marca cambio para el caché incremental
        });
      }
    }
    await batch.commit();
    // El caché eterno se conserva; la próxima carga releerá solo lo cambiado.
    // Restaurar stock visual local
    if (order && order.items && order.stockDeducted) {
      for (const item of order.items) {
        stockMap[item.id] = (stockMap[item.id] || 0) + (item.qty || 0);
      }
      renderProducts();
    }
    refreshAdminAfterChange();
    showToast('✅ Pedido cancelado — stock restaurado en Firebase');
  } catch (err) {
    showToast('❌ Error al cancelar: ' + err.message);
  }
}

function showOrderDetail(firestoreId) {
  const o = findLoadedOrder(firestoreId);
  if (!o) return;
  document.getElementById('orderDetailTitle').textContent = `📦 Pedido ${o.code || ''}`;
  const items = (o.items || []).map(i => `
    <div class="odetail-item">
      <div>
        <div class="odetail-item-name">${i.name}</div>
        <div class="odetail-item-sub">$${(i.price||0).toFixed(2)} × ${i.qty}</div>
      </div>
      <div class="odetail-item-price">$${((i.price||0) * i.qty).toFixed(2)}</div>
    </div>`).join('');
  document.getElementById('orderDetailBody').innerHTML = `
    <div style="font-size:.78rem;color:var(--g400);margin-bottom:10px">
      <b style="color:var(--g700)">${o.name}</b> · ${o.grade} – ${o.section}<br>
      ${fmtDate(o.createdAt)}
    </div>
    <div class="odetail-list">${items}</div>
    <div class="odetail-subtotal">
      <span>Subtotal</span>
      <span>$${(o.total||0).toFixed(2)}</span>
    </div>`;
  openModal('orderDetailModal');
}

function filterAdminTable(section, q) {
  renderAdminSection(section, q);
}

function highlightOrder(firestoreId) {
  const row = document.querySelector(`[data-fid="${firestoreId}"]`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('highlighted-row');
    setTimeout(() => row.classList.remove('highlighted-row'), 4000);
  }
}
