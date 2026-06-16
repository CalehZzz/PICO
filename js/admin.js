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
    // Activos = pendientes + confirmados (domicilio con guía generada, aún no entregados).
    return base.where('status', 'in', ['pending', 'confirmado']).orderBy('createdAt', 'desc');
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
    const isConfirmado = o.status === 'confirmado';
    const isDomicilio = o.tipoEntrega === 'domicilio';
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
          : isDomicilio
          ? `<span style="background:#ede9fe;color:#7c3aed;border-radius:999px;padding:3px 10px;font-size:.72rem;font-weight:600;white-space:nowrap">🚚 Domicilio</span>`
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
          : isDomicilio
          ? (isPending
              ? `<span class="sbadge sp">⏳ Pendiente</span>`
              : isConfirmado
              ? `<span class="sbadge si">📦 Confirmado</span>`
              : `<span class="sbadge ss">✅ Entregado</span>`)
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
  const sucursal = (data.sucursal === 'cdb' || data.sucursal === 'domicilio') ? 'cdb' : 'exsal';
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

  // En tarjeta, la venta se registró al PAGAR (no al entregar): no se revierte aquí.
  const statsAtPayment = data.metodoPago === 'tarjeta' && data.statsRecorded === true;

  // 1) Borrar los registros de "ventas" solo si se crearon al ENTREGAR (efectivo)
  if (!statsAtPayment) {
    const ventasSnap = await db.collection('ventas').where('fromOrder', '==', firestoreId).get();
    ventasSnap.forEach(doc => batch.delete(doc.ref));
  }

  // 2) Revertir estadísticas SOLO si la entrega fue de este mes
  const statUpdate = {
    'pedidosPendientes': firebase.firestore.FieldValue.increment(1)
  };
  if (revertStats) {
    statUpdate['pedidosEntregados'] = firebase.firestore.FieldValue.increment(-1);

    // Envío (modelo BRUTO, igual que al entregar)
    const esDom = data.tipoEntrega === 'domicilio';
    const envioCobrado = esDom ? (typeof data.envioCosto === 'number' ? data.envioCosto : 0) : 0;
    const envioReal    = esDom ? (typeof data.costoEnvioReal === 'number' ? data.costoEnvioReal : 0) : 0;
    // La comisión Stripe solo se sumó al entregar si la venta NO se había contado al pagar.
    const comisionStripe = (!statsAtPayment && typeof data.comisionStripe === 'number') ? data.comisionStripe : 0;

    // Productos: solo se revierten si se contabilizaron al ENTREGAR (efectivo).
    // En tarjeta quedan registrados (el pago sigue siendo válido).
    const revProdIngreso = statsAtPayment ? 0 : totalEfectivo;
    const revProdCosto   = statsAtPayment ? 0 : costTotal;

    statUpdate['ingresosPedidos'] = firebase.firestore.FieldValue.increment(-(+((revProdIngreso + envioCobrado)).toFixed(2)));
    statUpdate['costosPedidos']   = firebase.firestore.FieldValue.increment(-(+((revProdCosto + envioReal + comisionStripe)).toFixed(2)));

    if (!statsAtPayment) {
      statUpdate['ventas']            = firebase.firestore.FieldValue.increment(-totalVentasEfectivo);
      statUpdate['unidades vendidas'] = firebase.firestore.FieldValue.increment(-totalUnidades);
      statUpdate['numero de ventas']  = firebase.firestore.FieldValue.increment(-1);
    }
    if (esDom) {
      statUpdate['ingresosEnvio'] = firebase.firestore.FieldValue.increment(-(+envioCobrado.toFixed(2)));
      statUpdate['costosEnvio']   = firebase.firestore.FieldValue.increment(-(+envioReal.toFixed(2)));
    }
    if (comisionStripe > 0) {
      statUpdate['comisionesStripe'] = firebase.firestore.FieldValue.increment(-(+comisionStripe.toFixed(2)));
    }
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
        const sucursal = freshData.sucursal; // 'cdb' | 'exsal' | 'domicilio' | null
        // Sucursal contable: 'domicilio' vive bajo CDB. La VENTA se guarda con esta sucursal
        // para que aparezca en la lista de ventas (que solo filtra por 'exsal' | 'cdb').
        const ventaSucursal = (sucursal === 'exsal') ? 'exsal' : 'cdb';
        if (!sucursal) {
          showToast('⚠️ Asigna una sucursal antes de marcar como entregado');
          // Revertir el cambio de estado
          await db.collection('pedidos').doc(firestoreId).update({ status: 'pending', deliveredAt: null });
          return;
        }
        const stockField = (sucursal === 'cdb' || sucursal === 'domicilio') ? 'stockCdb' : 'stockExsal';
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
        const ventaItems = [];

        for (const item of freshData.items) {
          const qty = item.qty || 1;

          // Priorizar costo/precio congelado en el item al momento del pedido
          const unitCost  = typeof item.cost  === 'number' ? item.cost  : 0;
          const unitPrice = typeof item.price === 'number' ? item.price : 0;
          costTotal  += unitCost  * qty;
          priceTotal += unitPrice * qty;

          // NOTA: el stock ya se descontó al crear el pedido. Al entregar NO se toca el stock.

          // Línea de la venta con descuento proporcional aplicado
          const itemTotal = +(unitPrice * qty * discFactor).toFixed(2);
          totalUnidades += qty;
          totalVentasEfectivo += itemTotal;
          ventaItems.push({
            pid: item.id || null,
            productName: item.name,
            qty,
            precioUnit: unitPrice,
            costTotal: +(unitCost * qty).toFixed(2),
            total: itemTotal,
            descPct: freshData.discountPct || 0,
            descNombre: freshData.discountName || ''
          });
        }

        // ¿Las estadísticas de venta ya se registraron al confirmar el pago con tarjeta?
        const alreadyCounted = freshData.statsRecorded === true;

        // Un solo documento de venta con todos los productos del pedido (lógica nueva).
        // Solo se crea si NO se creó ya al pagar (tarjeta). Vinculado a su factura y al pedido.
        if (!alreadyCounted) stockBatch.set(db.collection('ventas').doc(), {
          orderNumber: 'PED-' + Date.now().toString().slice(-6) + '-' + Math.random().toString(36).slice(-3),
          items: ventaItems,
          qty: totalUnidades,
          costTotal: +costTotal.toFixed(2),
          total: +totalVentasEfectivo.toFixed(2),
          seller: sellerEmail,
          sucursal: ventaSucursal,
          date: new Date().toLocaleDateString('es'),
          timestamp: Date.now(),
          mes: mesKey,          // ✅ necesario para el panel de ventas del inventario
          fromOrder: firestoreId,
          facturaId:  freshData.facturaId  || null,
          facturaNum: freshData.facturaNum || null,
          ...(freshData.discountPct ? { descuentoAplicado: { nombre: freshData.discountName, porcentaje: freshData.discountPct } } : {})
        });

        // Total efectivo: respetar totalConDescuento guardado; si no existe, calcular desde precios del pedido
        const totalEfectivo = typeof freshData.totalConDescuento === 'number'
          ? freshData.totalConDescuento
          : +(priceTotal * discFactor).toFixed(2);

        // ── Envío (solo domicilio): modelo BRUTO ──
        //   • el envío que paga el cliente (envioCobrado) entra como INGRESO
        //   • el costo real de envío que registra el admin (envioReal) entra como COSTO
        //   • el fee de Stripe (solo tarjeta) entra como COSTO
        const esDom = freshData.tipoEntrega === 'domicilio';
        const envioCobrado = esDom ? (typeof freshData.envioCosto === 'number' ? freshData.envioCosto : 0) : 0;
        const envioReal    = esDom ? (typeof freshData.costoEnvioReal === 'number' ? freshData.costoEnvioReal : 0) : 0;
        // Comisión Stripe: si la venta ya se contabilizó al pagar (Cloud Function), allí ya se sumó → aquí no se repite.
        const comisionStripe = (!alreadyCounted && typeof freshData.comisionStripe === 'number') ? freshData.comisionStripe : 0;

        // Guardar trazabilidad en el pedido
        stockBatch.update(db.collection('pedidos').doc(firestoreId), {
          status: 'delivered',
          stockDeducted: true,
          saleRecorded: true,
          costTotal: +costTotal.toFixed(2),
          totalConDescuento: +totalEfectivo.toFixed(2),
          envioCobrado: +envioCobrado.toFixed(2),
          envioReal: +envioReal.toFixed(2),
          margenEnvio: +(envioCobrado - envioReal).toFixed(2),   // positivo = ganamos en el envío
          deliveredAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // ✅ Estadísticas acumuladas
        const statDocId = (sucursal === 'cdb' || sucursal === 'domicilio') ? 'ColegioDonBosco' : 'ColegioExsal';
        const statPayload = {
          'pedidosEntregados': firebase.firestore.FieldValue.increment(1),
          'pedidosPendientes': firebase.firestore.FieldValue.increment(-1),
          // INGRESOS = productos (si no se contó ya) + envío cobrado al cliente
          'ingresosPedidos':   firebase.firestore.FieldValue.increment(+(((alreadyCounted ? 0 : totalEfectivo)) + envioCobrado).toFixed(2)),
          // COSTOS = costo productos (si no se contó ya) + envío real + comisión Stripe
          'costosPedidos':     firebase.firestore.FieldValue.increment(+(((alreadyCounted ? 0 : costTotal)) + envioReal + comisionStripe).toFixed(2))
        };
        if (!alreadyCounted) {
          statPayload['ventas']            = firebase.firestore.FieldValue.increment(totalVentasEfectivo);
          statPayload['unidades vendidas'] = firebase.firestore.FieldValue.increment(totalUnidades);
          statPayload['numero de ventas']  = firebase.firestore.FieldValue.increment(1);
        }
        // Campos dedicados (transparencia)
        if (esDom) {
          statPayload['ingresosEnvio'] = firebase.firestore.FieldValue.increment(+envioCobrado.toFixed(2));
          statPayload['costosEnvio']   = firebase.firestore.FieldValue.increment(+envioReal.toFixed(2));
        }
        if (comisionStripe > 0) {
          statPayload['comisionesStripe'] = firebase.firestore.FieldValue.increment(+comisionStripe.toFixed(2));
        }
        stockBatch.set(db.collection('estadisticas').doc(statDocId), statPayload, { merge: true });

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
    // Las facturas NUNCA se borran: se marcan como ANULADAS para conservar el historial contable.
    try {
      const facSnap = await db.collection('facturas').where('fromOrder', '==', firestoreId).get();
      facSnap.forEach(d => batch.update(d.ref, {
        anulada: true,
        anuladaAt: firebase.firestore.FieldValue.serverTimestamp(),
        anuladaBy: 'admin'
      }));
    } catch (e) { console.warn('No se pudo marcar la factura del pedido como anulada:', e); }
    // Marcar pedido como cancelado
    batch.update(db.collection('pedidos').doc(firestoreId), {
      status: 'cancelled',
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
      cancelledBy: 'admin',
      stockDeducted: false
    });
    // Ajustar contadores de pedidos en estadísticas según el estado previo
    if (order) {
      const sucC = (order.sucursal === 'cdb' || order.sucursal === 'domicilio') ? 'ColegioDonBosco' : 'ColegioExsal';
      const statUpdate = { 'pedidosCancelados': firebase.firestore.FieldValue.increment(1) };
      // Un pedido 'confirmado' (domicilio con guía) sigue contando como pendiente en el
      // acumulado (solo deja de serlo al ENTREGAR). Por eso también se descuenta aquí.
      if (order.status === 'pending' || order.status === 'confirmado') {
        statUpdate['pedidosPendientes'] = firebase.firestore.FieldValue.increment(-1);
      }

      // Si la venta ya se registró al pagar (tarjeta), revertir productos + comisión Stripe + borrar la venta.
      // (Un pedido entregado no se puede cancelar directo; primero se vuelve a pendiente, así que aquí
      //  el margen de envío todavía no está aplicado.)
      if (order.statsRecorded === true && order.items) {
        const discFactor = order.discountPct ? ((100 - order.discountPct) / 100) : 1;
        let totalUnidades = 0, productCost = 0, priceTotal = 0, totalVentasEfectivo = 0;
        for (const item of order.items) {
          const qty = item.qty || 1;
          const unitCost  = typeof item.cost  === 'number' ? item.cost  : 0;
          const unitPrice = typeof item.price === 'number' ? item.price : 0;
          productCost += unitCost * qty;
          priceTotal  += unitPrice * qty;
          totalUnidades += qty;
          totalVentasEfectivo += +(unitPrice * qty * discFactor).toFixed(2);
        }
        const totalEfectivo = typeof order.totalConDescuento === 'number'
          ? order.totalConDescuento : +(priceTotal * discFactor).toFixed(2);
        const comision = typeof order.comisionStripe === 'number' ? order.comisionStripe : 0;

        statUpdate['ventas']            = firebase.firestore.FieldValue.increment(-totalVentasEfectivo);
        statUpdate['unidades vendidas'] = firebase.firestore.FieldValue.increment(-totalUnidades);
        statUpdate['numero de ventas']  = firebase.firestore.FieldValue.increment(-1);
        statUpdate['ingresosPedidos']   = firebase.firestore.FieldValue.increment(-(+totalEfectivo.toFixed(2)));
        statUpdate['costosPedidos']     = firebase.firestore.FieldValue.increment(-(+(productCost + comision).toFixed(2)));
        statUpdate['comisionesStripe']  = firebase.firestore.FieldValue.increment(-comision);

        try {
          const ventasSnap = await db.collection('ventas').where('fromOrder', '==', firestoreId).get();
          ventasSnap.forEach(d => batch.delete(d.ref));
        } catch (e) { console.warn('No se pudieron borrar las ventas del pedido al cancelar:', e); }
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

function copyToClipboard(text, btn) {
  const done = () => {
    if (btn) {
      const prev = btn.innerHTML;
      btn.innerHTML = '✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.innerHTML = prev; btn.classList.remove('copied'); }, 1200);
    }
    showToast('📋 Copiado al portapapeles');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch (e) {
    showToast('❌ No se pudo copiar');
  }
}

// Fila de dato de envío con botón para copiar al portapapeles (para crear la guía manualmente)
function copyFieldRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  const safe = String(value).replace(/'/g, "\\'").replace(/"/g, '&quot;');
  return `
    <div class="copy-row">
      <div class="copy-row-main">
        <div class="copy-row-label">${label}</div>
        <div class="copy-row-value">${value}</div>
      </div>
      <button class="copy-btn" title="Copiar" onclick="copyToClipboard('${safe}', this)">📋</button>
    </div>`;
}

// Asignar ID de rastreo + costo real del envío → el pedido pasa a 'confirmado'
async function setTrackingId(firestoreId) {
  const input = document.getElementById('trackingInput');
  const envioInput = document.getElementById('envioRealInput');
  const tid = (input?.value || '').trim();
  if (!tid) { showToast('⚠️ Ingresa un ID de rastreo'); return; }

  const rawEnvio = (envioInput?.value || '').trim();
  if (rawEnvio === '') { showToast('⚠️ Ingresa el costo real del envío'); return; }
  const costoEnvioReal = parseFloat(rawEnvio);
  if (isNaN(costoEnvioReal) || costoEnvioReal < 0) { showToast('⚠️ Costo de envío inválido'); return; }

  const o = findLoadedOrder(firestoreId);
  const cobrado = (o && typeof o.envioCosto === 'number') ? o.envioCosto : 0;
  const diff = +(costoEnvioReal - cobrado).toFixed(2);
  const aviso = diff > 0
    ? `El envío costó $${diff.toFixed(2)} más de lo cobrado → se cargará a costos.`
    : diff < 0
    ? `El envío costó $${(-diff).toFixed(2)} menos de lo cobrado → se sumará a la ganancia.`
    : 'El costo del envío coincide con lo cobrado.';
  if (!confirm(`¿Confirmar el pedido?\n\nID de rastreo: ${tid}\nCosto real del envío: $${costoEnvioReal.toFixed(2)}\n${aviso}\n\nEl cliente podrá ver el ID de rastreo.`)) return;

  try {
    await db.collection('pedidos').doc(firestoreId).update({
      trackingId: tid,
      costoEnvioReal: +costoEnvioReal.toFixed(2),
      status: 'confirmado',
      confirmedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (o) { o.trackingId = tid; o.costoEnvioReal = +costoEnvioReal.toFixed(2); o.status = 'confirmado'; }
    closeModal('orderDetailModal');
    refreshAdminAfterChange();
    showToast('📦 Pedido confirmado — ID de rastreo y costo de envío guardados');
  } catch (err) {
    showToast('❌ Error: ' + err.message);
  }
}

// Marcar un pedido a domicilio como entregado (reutiliza el flujo estándar de entrega)
async function adminMarkDelivered(firestoreId) {
  if (!confirm('¿Marcar este pedido como entregado?')) return;
  closeModal('orderDetailModal');
  await changeStatus(firestoreId, 'delivered');
}

function showOrderDetail(firestoreId) {
  const o = findLoadedOrder(firestoreId);
  if (!o) return;
  const isDomicilio = o.tipoEntrega === 'domicilio';
  document.getElementById('orderDetailTitle').textContent = `📦 Pedido ${o.code || ''}`;
  const items = (o.items || []).map(i => `
    <div class="odetail-item">
      <div>
        <div class="odetail-item-name">${i.name}</div>
        <div class="odetail-item-sub">$${(i.price||0).toFixed(2)} × ${i.qty}</div>
      </div>
      <div class="odetail-item-price">$${((i.price||0) * i.qty).toFixed(2)}</div>
    </div>`).join('');

  // ── Bloque de envío a domicilio (datos + copiar + pago + rastreo + acciones) ──
  let domicilioBlock = '';
  if (isDomicilio) {
    const e = o.envio || {};
    const pagoLabel = o.metodoPago === 'tarjeta' ? '💳 Tarjeta' : '💵 Efectivo';
    const pagoEstado = o.paymentStatus === 'pending' ? 'Pendiente de pago'
                     : o.paymentStatus === 'paid'    ? 'Pagado'
                     : o.paymentStatus === 'efectivo'? 'Contra entrega'
                     : (o.paymentStatus || '—');

    const copyRows = [
      copyFieldRow('Nombre completo', e.nombre || o.name),
      copyFieldRow('Teléfono', e.telefono),
      copyFieldRow('Teléfono adicional', e.telefono2),
      copyFieldRow('Departamento', e.departamento),
      copyFieldRow('Municipio', e.municipio),
      copyFieldRow('Dirección', e.direccion),
      copyFieldRow('Punto de referencia', e.referencia),
      copyFieldRow('Indicaciones', e.indicaciones)
    ].join('');

    // Acción según el estado del pedido
    let accionBlock = '';
    if (o.status === 'pending') {
      // Con tarjeta, solo se puede confirmar/enviar una vez Stripe confirmó el pago.
      const esperaPago = o.metodoPago === 'tarjeta' && o.paymentStatus !== 'paid';
      if (esperaPago) {
        accionBlock = `
        <div class="odetail-track-box">
          <div class="odetail-track-label">⏳ Esperando confirmación de pago</div>
          <p class="odetail-track-hint">Este pedido se paga con tarjeta. Cuando Stripe confirme el pago,
          podrás ingresar el costo del envío y asignar el ID de rastreo.</p>
        </div>`;
      } else {
        accionBlock = `
        <div class="odetail-track-box">
          <label class="odetail-track-label">Costo real del envío (lo que te cobró el courier)</label>
          <div class="odetail-track-row">
            <input id="envioRealInput" type="number" step="0.01" min="0" inputmode="decimal"
                   placeholder="Ej. 4.50" value="${o.costoEnvioReal != null ? o.costoEnvioReal : ''}"
                   autocomplete="off">
          </div>
          <label class="odetail-track-label" style="margin-top:12px">ID de rastreo</label>
          <div class="odetail-track-row">
            <input id="trackingInput" type="text" placeholder="Ej. PICO-123456" autocomplete="off">
            <button class="odetail-confirm-btn" onclick="setTrackingId('${o.firestoreId}')">📦 Confirmar pedido</button>
          </div>
          <p class="odetail-track-hint">El cliente pagó <b>$${(o.envioCosto || 0).toFixed(2)}</b> de envío.
          Si el costo real es <b>mayor</b>, la diferencia se carga a <b>costos</b>; si es <b>menor</b>, la diferencia se suma a la <b>ganancia</b> del pedido.
          Al confirmar, el pedido pasa a <b>Confirmado</b> y el cliente verá el ID de rastreo.</p>
        </div>`;
      }
    } else if (o.status === 'confirmado') {
      const envioRealTxt = (typeof o.costoEnvioReal === 'number')
        ? `<div class="odetail-track-hint" style="margin-top:0;margin-bottom:8px">Costo real del envío: <b>$${o.costoEnvioReal.toFixed(2)}</b> (cliente pagó $${(o.envioCosto||0).toFixed(2)})</div>`
        : '';
      accionBlock = `
        <div class="odetail-track-box confirmed">
          <div class="odetail-track-label">📦 ID de rastreo asignado</div>
          <div class="odetail-track-id">
            <span>${o.trackingId || '—'}</span>
            <button class="copy-btn" title="Copiar" onclick="copyToClipboard('${(o.trackingId||'').replace(/'/g,"\\'")}', this)">📋</button>
          </div>
          ${envioRealTxt}
          <button class="odetail-deliver-btn" onclick="adminMarkDelivered('${o.firestoreId}')">✅ Marcar como entregado</button>
        </div>`;
    } else if (o.status === 'delivered' || o.status === 'sold') {
      accionBlock = `
        <div class="odetail-track-box confirmed">
          <div class="odetail-track-label">✅ Entregado</div>
          ${o.trackingId ? `<div class="odetail-track-id"><span>${o.trackingId}</span></div>` : ''}
        </div>`;
    }

    domicilioBlock = `
      <div class="odetail-domicilio">
        <div class="odetail-section-title">🚚 Datos de envío</div>
        ${copyRows}
        <div class="odetail-pago">
          <span><b>Método de pago:</b> ${pagoLabel}</span>
          <span><b>Estado:</b> ${pagoEstado}</span>
        </div>
        ${accionBlock}
      </div>`;
  }

  const subtotalProductos = (typeof o.totalConDescuento === 'number' ? o.totalConDescuento : (o.total || 0));
  const envioRow = isDomicilio
    ? `<div class="odetail-subtotal"><span>🚚 Envío a domicilio</span><span>$${(o.envioCosto || 0).toFixed(2)}</span></div>
       <div class="odetail-subtotal" style="font-weight:700;border-top:2px solid var(--g200);padding-top:8px">
         <span>Total con envío</span>
         <span>$${(typeof o.totalConEnvio === 'number' ? o.totalConEnvio : subtotalProductos).toFixed(2)}</span>
       </div>`
    : '';

  const comisionRow = (typeof o.comisionStripe === 'number' && o.comisionStripe > 0)
    ? `<div class="odetail-subtotal" style="color:var(--g400)">
         <span>💳 Comisión Stripe (2.9% + $0.30) · solo admin</span>
         <span>-$${o.comisionStripe.toFixed(2)}</span>
       </div>`
    : '';

  document.getElementById('orderDetailBody').innerHTML = `
    <div style="font-size:.78rem;color:var(--g400);margin-bottom:10px">
      <b style="color:var(--g700)">${o.name}</b>${isDomicilio ? '' : ` · ${o.grade} – ${o.section}`}<br>
      ${fmtDate(o.createdAt)}
    </div>
    ${domicilioBlock}
    <div class="odetail-list">${items}</div>
    <div class="odetail-subtotal">
      <span>Subtotal productos</span>
      <span>$${subtotalProductos.toFixed(2)}</span>
    </div>
    ${envioRow}
    ${comisionRow}`;
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
