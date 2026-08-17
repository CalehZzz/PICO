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
  startAdminsListener();
  initQrDesignSection();
  // Reiniciar a la primera página de cada sección y cargar
  adminPaging.active = { page: 0, cursors: [], docs: [], atEnd: false, loading: false };
  adminPaging.done   = { page: 0, cursors: [], docs: [], atEnd: false, loading: false };
  loadAdminSection('active');
  loadAdminSection('done');
}

// ═══════════════════════════════════════════════════
//  DISEÑO DE QR (GeneraQR) — solo calebrenebr@gmail.com
// ═══════════════════════════════════════════════════
function initQrDesignSection() {
  const section = document.getElementById('qrDesignSection');
  if (!section) return;
  const allowed = typeof QrDesignAPI !== 'undefined'
    && currentUser && currentUser.email === QrDesignAPI.ADMIN_EMAIL;
  section.hidden = !allowed;
  if (!allowed) return;

  const msg = document.getElementById('qrDesignMsg');
  msg.textContent = 'Verificando sesión de GeneraQR...';
  QrDesignAPI.waitForAuthReady().then((user) => {
    msg.textContent = '';
    if (user) {
      document.getElementById('qrDesignConnectBtn').style.display = 'none';
      loadQrDesignsList();
    } else {
      document.getElementById('qrDesignConnectBtn').style.display = '';
    }
  });
  refreshActiveQrDesignLabel();
}

async function connectGeneraQR() {
  const msg = document.getElementById('qrDesignMsg');
  msg.textContent = 'Conectando...';
  try {
    await QrDesignAPI.signInAdmin();
    document.getElementById('qrDesignConnectBtn').style.display = 'none';
    msg.textContent = '';
    loadQrDesignsList();
  } catch (e) {
    msg.textContent = e && e.message ? e.message : 'No se pudo conectar con GeneraQR.';
  }
}

async function refreshActiveQrDesignLabel() {
  const el = document.getElementById('qrDesignActive');
  if (!el) return;
  try {
    const design = await QrDesignAPI.getActiveDesign({ force: true });
    el.textContent = 'Diseño activo en PICO: ' + (design.name || 'Sin nombre');
  } catch (e) {
    el.textContent = 'Aún no has publicado ningún diseño (los pedidos usan el QR clásico mientras tanto).';
  }
}

async function loadQrDesignsList() {
  const wrap = document.getElementById('qrDesignList');
  const msg  = document.getElementById('qrDesignMsg');
  wrap.style.display = 'grid';
  wrap.innerHTML = '<p style="font-size:.82rem;color:var(--g400)">Cargando tus diseños...</p>';
  try {
    const designs = await QrDesignAPI.listMyDesigns();
    if (!designs.length) {
      wrap.innerHTML = '<p style="font-size:.82rem;color:var(--g400)">No tienes diseños guardados en GeneraQR todavía.</p>';
      return;
    }
    wrap.innerHTML = '';
    for (const d of designs) {
      const card = document.createElement('div');
      card.style.cssText = 'border:1.5px solid var(--g200);border-radius:12px;padding:12px;text-align:center;background:#fff';
      const canvasHolder = document.createElement('div');
      canvasHolder.style.cssText = 'width:100px;height:100px;margin:0 auto 8px;display:flex;align-items:center;justify-content:center';
      card.appendChild(canvasHolder);
      const name = document.createElement('div');
      name.style.cssText = 'font-size:.8rem;font-weight:600;color:var(--g900);margin-bottom:8px;word-break:break-word';
      name.textContent = d.name || 'Sin nombre';
      card.appendChild(name);
      const btn = document.createElement('button');
      btn.className = 'btn-sec';
      btn.style.cssText = 'font-size:.76rem;padding:6px 10px;width:100%';
      btn.textContent = 'Usar este diseño';
      btn.onclick = () => useQrDesign(d.id, btn);
      card.appendChild(btn);
      wrap.appendChild(card);

      // Vista previa del QR con este estilo (sin logo, para no pedir el asset aparte)
      GeneraQRRender.renderQrCanvas(GeneraQRRender.optionsFromStyle(d, {
        data: 'https://picosv.com', size: 200
      })).then(canvas => {
        canvas.style.width = '100px';
        canvas.style.height = '100px';
        canvasHolder.appendChild(canvas);
      }).catch(() => {});
    }
  } catch (e) {
    msg.textContent = e && e.message ? e.message : 'No se pudieron cargar tus diseños.';
    wrap.style.display = 'none';
  }
}

async function useQrDesign(presetId, btn) {
  const msg = document.getElementById('qrDesignMsg');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Publicando...';
  try {
    await QrDesignAPI.setActiveDesign(presetId);
    msg.textContent = 'Diseño publicado. Los próximos QR de pedidos lo usarán.';
    refreshActiveQrDesignLabel();
  } catch (e) {
    msg.textContent = e && e.message ? e.message : 'No se pudo publicar el diseño.';
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ═══════════════════════════════════════════════════
//  LECTOR DE QR INTERNO (abrir pedido escaneando su código)
//  Usa BarcodeDetector nativo si el navegador lo soporta
//  (Chrome/Edge/Android); si no, cae a la librería jsQR.
// ═══════════════════════════════════════════════════
let qrScanStream  = null;
let qrScanRAF     = null;
let qrScanBusy    = false;
let qrScanCanvas  = null;

async function openQrScanner() {
  openModal('qrScanModal');
  const video = document.getElementById('qrScanVideo');
  const msg   = document.getElementById('qrScanMsg');
  msg.textContent = 'Apunta la cámara al código QR del pedido.';
  try {
    qrScanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
  } catch (e) {
    msg.textContent = 'No se pudo acceder a la cámara. Revisa los permisos del navegador.';
    return;
  }
  video.srcObject = qrScanStream;
  await video.play().catch(() => {});
  qrScanBusy = false;
  runQrScanLoop(video, msg);
}

function closeQrScanner() {
  closeModal('qrScanModal');
  if (qrScanRAF) cancelAnimationFrame(qrScanRAF);
  qrScanRAF = null;
  if (qrScanStream) {
    qrScanStream.getTracks().forEach(t => t.stop());
    qrScanStream = null;
  }
}

function runQrScanLoop(video, msg) {
  const useNative = typeof BarcodeDetector !== 'undefined';
  const detector  = useNative ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
  if (!useNative && typeof jsQR === 'undefined') {
    msg.textContent = 'Este navegador no puede leer códigos QR. Prueba con Chrome o Edge.';
    return;
  }
  if (!qrScanCanvas) qrScanCanvas = document.createElement('canvas');

  async function tick() {
    if (!qrScanStream) return; // el modal se cerró
    if (video.readyState === video.HAVE_ENOUGH_DATA && !qrScanBusy) {
      try {
        let text = null;
        if (useNative) {
          const codes = await detector.detect(video);
          if (codes.length) text = codes[0].rawValue;
        } else {
          qrScanCanvas.width  = video.videoWidth;
          qrScanCanvas.height = video.videoHeight;
          const ctx = qrScanCanvas.getContext('2d');
          ctx.drawImage(video, 0, 0, qrScanCanvas.width, qrScanCanvas.height);
          const imgData = ctx.getImageData(0, 0, qrScanCanvas.width, qrScanCanvas.height);
          const result = jsQR(imgData.data, imgData.width, imgData.height);
          if (result) text = result.data;
        }
        if (text) {
          qrScanBusy = true;
          await handleQrScanResult(text, msg);
        }
      } catch (_) { /* frame sin código, seguimos */ }
    }
    qrScanRAF = requestAnimationFrame(tick);
  }
  qrScanRAF = requestAnimationFrame(tick);
}

async function handleQrScanResult(text, msg) {
  let pedidoId = null;
  try {
    const url = new URL(text);
    pedidoId = url.searchParams.get('pedido');
  } catch (_) {
    // No es una URL completa; probamos por si el texto es directamente el ID.
  }
  if (!pedidoId) {
    msg.textContent = 'Ese código no es un QR de pedido de PICO.';
    qrScanBusy = false;
    return;
  }
  msg.textContent = 'Pedido encontrado, abriendo...';
  closeQrScanner();
  await openScannedOrder(pedidoId);
}

// Abre el detalle de un pedido a partir de su ID, sin depender de que ya
// esté cargado en la tabla paginada (lo trae de Firestore si hace falta).
async function openScannedOrder(firestoreId) {
  if (findLoadedOrder(firestoreId)) {
    showOrderDetail(firestoreId);
    return;
  }
  try {
    const snap = await db.collection('pedidos').doc(firestoreId).get();
    if (!snap.exists) { showToast('Ese pedido no existe.'); return; }
    window._qrScanCache = window._qrScanCache || [];
    window._qrScanCache = window._qrScanCache.filter(o => o.firestoreId !== firestoreId);
    window._qrScanCache.push({ firestoreId: snap.id, ...snap.data() });
    showOrderDetail(firestoreId);
  } catch (e) {
    showToast('No se pudo abrir el pedido escaneado.');
  }
}

// ═══════════════════════════════════════════════════
//  GESTIÓN DE ADMINISTRADORES (rol real · custom claims)
//  El rol se otorga/quita con la Cloud Function 'setAdminRole'.
//  La colección 'admins/{uid}' es solo un espejo para listarlos aquí.
// ═══════════════════════════════════════════════════
let unsubAdmins = null;

function startAdminsListener() {
  if (!isAdmin || unsubAdmins) return;
  unsubAdmins = db.collection('admins').orderBy('since', 'asc').onSnapshot(
    snap => {
      const list = [];
      snap.forEach(d => list.push({ uid: d.id, ...d.data() }));
      renderAdminsList(list);
    },
    err => {
      console.warn('admins listener:', err);
      const el = document.getElementById('adminsListSection');
      if (el) el.innerHTML = '<p style="font-size:.82rem;color:var(--g400)">No se pudo cargar la lista de administradores.</p>';
    }
  );
}

function renderAdminsList(list) {
  const el = document.getElementById('adminsListSection');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<p style="font-size:.82rem;color:var(--g400)">Aún no hay administradores en la lista.</p>';
    return;
  }
  el.innerHTML = list.map(a => {
    const safeEmail = _pdEsc(a.email || a.uid);
    const onclickEmail = _pdEsc(a.email || '').replace(/'/g, "\\'");
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border:1px solid var(--g100);border-radius:9px;margin-bottom:7px">
      <div style="min-width:0">
        <div style="font-weight:600;color:var(--g900);font-size:.88rem;overflow:hidden;text-overflow:ellipsis">${safeEmail}</div>
        ${a.since ? `<div style="font-size:.72rem;color:var(--g400)">desde ${new Date(a.since).toLocaleDateString('es-SV')}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function setUserAdmin(makeAdmin) {
  const input = document.getElementById('adminRoleEmail');
  const msg   = document.getElementById('adminRoleMsg');
  if (!input || !msg) return;
  const email = (input.value || '').trim().toLowerCase();
  if (!email) { msg.style.color = '#ef4444'; msg.textContent = 'Escribe un correo.'; return; }
  if (!makeAdmin) {
    const conf = prompt('Para confirmar que quitas el admin, vuelve a escribir el correo exactamente:');
    if ((conf || '').trim().toLowerCase() !== email) {
      msg.style.color = '#ef4444';
      msg.textContent = 'Cancelado: el correo no coincide.';
      return;
    }
  }
  msg.style.color = 'var(--g400)';
  msg.textContent = 'Procesando...';
  try {
    const fn  = firebase.functions().httpsCallable('setAdminRole');
    const res = await fn({ email, makeAdmin });
    msg.style.color = 'var(--green)';
    msg.textContent = makeAdmin
      ? `✓ ${email} ahora es administrador. Deberá volver a iniciar sesión para que se aplique.`
      : `✓ Se quitó el rol de administrador a ${email}.`;
    input.value = '';
    // Si me cambié el rol a mí mismo, refresco mi token para que aplique de inmediato
    if (currentUser && email === (currentUser.email || '').toLowerCase() && auth.currentUser) {
      await auth.currentUser.getIdToken(true);
    }
  } catch (e) {
    msg.style.color = '#ef4444';
    msg.textContent = (e && e.message ? e.message : 'No se pudo completar la acción.');
  }
}

function quickRemoveAdmin(email) {
  // Deshabilitado a propósito: solo se quita escribiendo el correo en el campo.
  const input = document.getElementById('adminRoleEmail');
  if (input && email) input.value = email;
  showToast('Escribe el correo y usa “Quitar admin” (con confirmación)');
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
          Ver (${(o.items||[]).length})
        </button>
      </td>
      <td style="font-weight:700;color:var(--b600)">$${(typeof o.totalConDescuento === 'number' ? o.totalConDescuento : (o.total || 0)).toFixed(2)}</td>
      <td style="font-size:.75rem;white-space:nowrap;color:var(--g500)">${fmtDate(o.createdAt)}</td>
      <td style="font-size:.75rem;white-space:nowrap;color:var(--g500)">${o.deliveredAt ? fmtDate(o.deliveredAt) : '<span style="color:var(--g300)">—</span>'}</td>
      <td>
        ${isCancelled
          ? `<span style="font-size:.72rem;color:var(--g300)">—</span>`
          : isDomicilio
          ? `<span style="background:#ede9fe;color:#7c3aed;border-radius:999px;padding:3px 10px;font-size:.72rem;font-weight:600;white-space:nowrap">Domicilio</span>`
          : `<select class="stsel" onchange="changeSucursal('${o.firestoreId}', this.value)"
              style="background:var(--b50);color:var(--b600)">
              <option value="" ${!o.sucursal ? 'selected' : ''}>Elegir...</option>
              <option value="cdb" ${o.sucursal === 'cdb' ? 'selected' : ''}>Colegio Don Bosco</option>
              <option value="udb" ${o.sucursal === 'udb' ? 'selected' : ''}>Universidad Don Bosco</option>
              ${o.sucursal === 'exsal' ? `<option value="exsal" selected>EXSAL (histórico)</option>` : ''}
            </select>`
        }
      </td>
      <td>
        ${isCancelled
          ? `<span class="sbadge sc">Cancelado</span>`
          : isDomicilio
          ? (isPending
              ? `<span class="sbadge sp">Pendiente</span>`
              : isConfirmado
              ? `<span class="sbadge si">Confirmado</span>`
              : `<span class="sbadge ss">Entregado</span>`)
          : `<select class="stsel" onchange="changeStatus('${o.firestoreId}', this.value)"
              style="background:${statusColor};color:${statusText}">
              <option value="pending" ${isPending ? 'selected' : ''}>Pendiente</option>
              <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>Entregado</option>
            </select>`
        }
      </td>
      <td>
        ${isCancelled
          ? `<span style="font-size:.72rem;color:var(--g300)">—</span>`
          : `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              ${(isDomicilio && isConfirmado)
                ? `<button class="btn-deliver-order" onclick="adminMarkDelivered('${o.firestoreId}')" title="Confirmar entrega">Entregar</button>`
                : ''}
              <button class="btn-cancel-order" onclick="adminCancelOrder('${o.firestoreId}', '${o.code}')"
                ${(o.status === 'delivered' || o.status === 'sold') ? 'disabled title="Pedido ya entregado"' : ''}>
                ✕ Cancelar
              </button>
            </div>`
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
    showToast(val ? `Entrega asignada: ${(typeof sucursalInternalLabel === 'function') ? sucursalInternalLabel(val) : val.toUpperCase()}` : 'Entrega eliminada');
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

// Revierte una entrega: restaura stock, borra los registros de "ventas" del pedido
// y resta las estadísticas SOLO si la entrega fue del mes actual. Deja el pedido como pendiente.
async function revertDelivery(firestoreId, data) {
  const sucursal = (data.sucursal === 'exsal') ? 'exsal' : 'cdb';
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

  // 2) Revertir estadísticas SOLO si la entrega fue de este mes.
  //    Se revierte SOLO lo que se registró AL ENTREGAR. El envío real se registró al
  //    ASIGNARLO (confirmar) → se mantiene hasta que el pedido se cancele.
  const statUpdate = {
    'pedidosPendientes': firebase.firestore.FieldValue.increment(1)
  };
  let limpiarIngresoEnvio = false;
  if (revertStats) {
    statUpdate['pedidosEntregados'] = firebase.firestore.FieldValue.increment(-1);

    const esDom = data.tipoEntrega === 'domicilio';
    const envioCobrado = esDom ? (typeof data.envioCosto === 'number' ? data.envioCosto : 0) : 0;
    // Ingreso por envío: solo se revierte si se registró AL ENTREGAR (efectivo).
    const revIngresoEnvio = (esDom && !statsAtPayment && data.ingresoEnvioRegistrado === true) ? envioCobrado : 0;
    limpiarIngresoEnvio = revIngresoEnvio > 0;
    // Comisión Wompi: solo se sumó al entregar si la venta NO se contó al pagar (caso raro).
    const comisionWompi = (!statsAtPayment && typeof data.comisionWompi === 'number') ? data.comisionWompi : 0;

    // Productos: solo se revierten si se contabilizaron al ENTREGAR (efectivo).
    const revProdIngreso = statsAtPayment ? 0 : totalEfectivo;
    const revProdCosto   = statsAtPayment ? 0 : costTotal;

    statUpdate['ingresosPedidos'] = firebase.firestore.FieldValue.increment(-(+((revProdIngreso + revIngresoEnvio)).toFixed(2)));
    statUpdate['costosPedidos']   = firebase.firestore.FieldValue.increment(-(+((revProdCosto + comisionWompi)).toFixed(2)));

    if (!statsAtPayment) {
      // 'ventas' incluye productos + envío cobrado (lo que entró al entregar en efectivo)
      statUpdate['ventas']            = firebase.firestore.FieldValue.increment(-(+((totalVentasEfectivo + revIngresoEnvio)).toFixed(2)));
      statUpdate['unidades vendidas'] = firebase.firestore.FieldValue.increment(-totalUnidades);
      statUpdate['numero de ventas']  = firebase.firestore.FieldValue.increment(-1);
    }
    // La comisión ya no entra a 'costos' al entregar (entra al confirmar) → aquí solo el campo informativo.
    if (comisionWompi > 0) {
      statUpdate['comisionesWompi']  = firebase.firestore.FieldValue.increment(-(+comisionWompi.toFixed(2)));
    }
    if (revIngresoEnvio > 0) {
      statUpdate['ingresosEnvio'] = firebase.firestore.FieldValue.increment(-(+revIngresoEnvio.toFixed(2)));
    }
  }
  batch.set(db.collection('estadisticas').doc(statDocId), statUpdate, { merge: true });

  // 3) Volver el pedido a pendiente y limpiar marcas de entrega.
  //    stockDeducted se mantiene true: el stock sigue descontado mientras el pedido exista.
  //    saleRecorded vuelve a false: la venta dejó de estar registrada.
  //    costoEnvioRegistrado se MANTIENE (el envío real sigue contabilizado).
  const pedUpdate = {
    status: 'pending',
    stockDeducted: true,
    saleRecorded: false,
    deliveredAt: null,
    costTotal: firebase.firestore.FieldValue.delete()
  };
  if (limpiarIngresoEnvio) pedUpdate.ingresoEnvioRegistrado = false;
  batch.update(db.collection('pedidos').doc(firestoreId), pedUpdate);

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
        showToast('Pedido devuelto a pendiente — entrega revertida');
        return;
      }
      // Si no estaba entregado realmente, solo cambiar el estado
      await db.collection('pedidos').doc(firestoreId).update({ status: 'pending', deliveredAt: null });
      refreshAdminAfterChange();
      showToast('Marcado como pendiente');
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
          showToast('Asigna una sucursal antes de marcar como entregado');
          // Revertir el cambio de estado
          await db.collection('pedidos').doc(firestoreId).update({ status: 'pending', deliveredAt: null });
          return;
        }
        const stockField = (sucursal === 'exsal') ? 'stockExsal' : 'stockCdb';
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
            productName: (typeof orderItemDisplayName === 'function') ? orderItemDisplayName(item) : item.name,
            qty,
            precioUnit: unitPrice,
            costTotal: +(unitCost * qty).toFixed(2),
            total: itemTotal,
            descPct: freshData.discountPct || 0,
            descNombre: freshData.discountName || '',
            colorId: item.colorId || null,
            colorLabel: item.colorLabel || null,
            color: item.color || null
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
          mes: mesKey,          // necesario para el panel de ventas del inventario
          fromOrder: firestoreId,
          facturaId:  freshData.facturaId  || null,
          facturaNum: freshData.facturaNum || null,
          ...(freshData.discountPct ? { descuentoAplicado: { nombre: freshData.discountName, porcentaje: freshData.discountPct } } : {})
        });

        // Total efectivo: respetar totalConDescuento guardado; si no existe, calcular desde precios del pedido
        const totalEfectivo = typeof freshData.totalConDescuento === 'number'
          ? freshData.totalConDescuento
          : +(priceTotal * discFactor).toFixed(2);

        // ── Envío (solo domicilio) · modelo MEZCLADO con CDB ──
        //   • El envío cobrado al cliente entra a INGRESOS y a 'ventas'.
        //   • El envío real ya se registró al ASIGNARLO (setTrackingId) → aquí no se repite.
        //   • La comisión Wompi ya se sumó al PAGAR (Cloud Function) → aquí no se repite.
        const esDom = freshData.tipoEntrega === 'domicilio';
        const envioCobrado = esDom ? (typeof freshData.envioCosto === 'number' ? freshData.envioCosto : 0) : 0;
        const envioReal    = esDom ? (typeof freshData.costoEnvioReal === 'number' ? freshData.costoEnvioReal : 0) : 0;
        // ¿El ingreso por envío ya se registró antes (tarjeta: al pagar)? Si no, se registra ahora (efectivo).
        const ingresoEnvioYa = freshData.ingresoEnvioRegistrado === true;
        const addIngresoEnvio = (esDom && !ingresoEnvioYa) ? envioCobrado : 0;
        // El costo real del envío normalmente ya se registró al confirmar. Fallback por si no.
        const costoEnvioYa = freshData.costoEnvioRegistrado === true;
        const addCostoEnvio = (esDom && !costoEnvioYa) ? envioReal : 0;
        // Comisión Wompi: si la venta ya se contabilizó al pagar, allí ya se sumó → aquí no se repite.
        const comisionWompi = (!alreadyCounted && typeof freshData.comisionWompi === 'number') ? freshData.comisionWompi : 0;

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
          ingresoEnvioRegistrado: (esDom ? true : freshData.ingresoEnvioRegistrado || false),
          costoEnvioRegistrado:   (esDom ? true : freshData.costoEnvioRegistrado || false),
          ...(comisionWompi > 0 ? { comisionCostoRegistrada: true } : {}),
          ...((!alreadyCounted && (Number(freshData.creditsUsed) || 0) > 0) ? { creditsStatsRecorded: true } : {}),
          deliveredAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Costo de promo por créditos (solo doc de créditos; no va a estadisticas.costos)
        if (!alreadyCounted && (Number(freshData.creditsUsed) || 0) > 0 && freshData.creditsEmail) {
          const cCosto = Number(freshData.creditsCosto) || 0;
          if (cCosto > 0) {
            stockBatch.set(db.collection('creditos').doc(String(freshData.creditsEmail).toLowerCase()), {
              costoInvertido: firebase.firestore.FieldValue.increment(+cCosto.toFixed(2)),
              updatedAt: Date.now()
            }, { merge: true });
          }
        }

        // Estadísticas acumuladas (mezcladas con CDB)
        const statDocId = (sucursal === 'exsal') ? 'ColegioExsal' : 'ColegioDonBosco';
        const statPayload = {
          'pedidosEntregados': firebase.firestore.FieldValue.increment(1),
          'pedidosPendientes': firebase.firestore.FieldValue.increment(-1),
          // INGRESOS = productos (si no se contó ya) + envío cobrado (si no se registró ya)
          'ingresosPedidos':   firebase.firestore.FieldValue.increment(+(((alreadyCounted ? 0 : totalEfectivo)) + addIngresoEnvio).toFixed(2)),
          // COSTOS pedidos = costo productos (si no se contó ya) + envío real pendiente + comisión pendiente
          'costosPedidos':     firebase.firestore.FieldValue.increment(+(((alreadyCounted ? 0 : costTotal)) + addCostoEnvio + comisionWompi).toFixed(2))
        };
        if (!alreadyCounted) {
          statPayload['ventas']            = firebase.firestore.FieldValue.increment(+(totalVentasEfectivo + addIngresoEnvio).toFixed(2));
          statPayload['unidades vendidas'] = firebase.firestore.FieldValue.increment(totalUnidades);
          statPayload['numero de ventas']  = firebase.firestore.FieldValue.increment(1);
          const credUsed = Number(freshData.creditsUsed) || 0;
          if (credUsed > 0) {
            statPayload['ventasCreditos'] = firebase.firestore.FieldValue.increment(+credUsed.toFixed(2));
          }
        } else if (addIngresoEnvio > 0) {
          // Caso raro: producto ya contado pero el envío aún no → solo el envío entra a 'ventas'.
          statPayload['ventas'] = firebase.firestore.FieldValue.increment(+addIngresoEnvio.toFixed(2));
        }
        // 'costos' (principal) = SOLO base (inventario/restock + gastos). El envío real va a
        // 'costosEnvio' y la comisión a 'comisionesWompi'; el acumulado los suma en el panel.
        // Campos dedicados (transparencia)
        if (addIngresoEnvio > 0) statPayload['ingresosEnvio'] = firebase.firestore.FieldValue.increment(+addIngresoEnvio.toFixed(2));
        if (addCostoEnvio   > 0) statPayload['costosEnvio']   = firebase.firestore.FieldValue.increment(+addCostoEnvio.toFixed(2));
        if (comisionWompi  > 0) statPayload['comisionesWompi'] = firebase.firestore.FieldValue.increment(+comisionWompi.toFixed(2));
        stockBatch.set(db.collection('estadisticas').doc(statDocId), statPayload, { merge: true });

        await stockBatch.commit();
        // Sello de tarjeta de fidelidad (idempotente, no revierte la entrega si falla)
        if (typeof añadirSelloTrasEntrega === 'function') {
          añadirSelloTrasEntrega(firestoreId).catch(e => console.warn('Sello:', e));
        }
        renderProducts();
        refreshAdminAfterChange();
        showToast('Pedido marcado como entregado');
        return;
      }
    }
    refreshAdminAfterChange();
    showToast('Marcado como entregado');
  } catch (err) {
    showToast('Error: ' + err.message);
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
      const sucC = (order.sucursal === 'exsal') ? 'ColegioExsal' : 'ColegioDonBosco';
      const statUpdate = { 'pedidosCancelados': firebase.firestore.FieldValue.increment(1) };
      // Un pedido 'confirmado' (domicilio con guía) sigue contando como pendiente en el
      // acumulado (solo deja de serlo al ENTREGAR). Por eso también se descuenta aquí.
      if (order.status === 'pending' || order.status === 'confirmado') {
        statUpdate['pedidosPendientes'] = firebase.firestore.FieldValue.increment(-1);
      }

      // Acumuladores numéricos (un campo puede tocarse por comisión y por envío real).
      let decCostos = 0, decCostosPedidos = 0;

      // Si la venta ya se registró al pagar (tarjeta), revertir productos + comisión + envío cobrado + borrar la venta.
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
        const comision = typeof order.comisionWompi === 'number' ? order.comisionWompi : 0;
        // Envío cobrado que se sumó a ventas/ingresos al pagar (tarjeta = domicilio).
        const envioCobrado = (order.ingresoEnvioRegistrado === true)
          ? (typeof order.envioCosto === 'number' ? order.envioCosto : 0) : 0;

        statUpdate['ventas']            = firebase.firestore.FieldValue.increment(-(+((totalVentasEfectivo + envioCobrado)).toFixed(2)));
        statUpdate['unidades vendidas'] = firebase.firestore.FieldValue.increment(-totalUnidades);
        statUpdate['numero de ventas']  = firebase.firestore.FieldValue.increment(-1);
        statUpdate['ingresosPedidos']   = firebase.firestore.FieldValue.increment(-(+((totalEfectivo + envioCobrado)).toFixed(2)));
        statUpdate['comisionesWompi']  = firebase.firestore.FieldValue.increment(-comision);
        // 'costos' (principal) NO contiene la comisión → no se toca aquí.
        decCostosPedidos += productCost + comision;  // en 'costosPedidos' la comisión siempre estuvo (función)
        if (envioCobrado > 0) statUpdate['ingresosEnvio'] = firebase.firestore.FieldValue.increment(-(+envioCobrado.toFixed(2)));

        try {
          const ventasSnap = await db.collection('ventas').where('fromOrder', '==', firestoreId).get();
          ventasSnap.forEach(d => batch.delete(d.ref));
        } catch (e) { console.warn('No se pudieron borrar las ventas del pedido al cancelar:', e); }
      }

      // Envío real: se registró en 'costosEnvio' (y 'costosPedidos') al confirmar → revertir al cancelar.
      // 'costos' (principal) NO contiene el envío → no se toca aquí.
      if (order.costoEnvioRegistrado === true) {
        const envioReal = typeof order.costoEnvioReal === 'number' ? order.costoEnvioReal : 0;
        if (envioReal > 0) {
          decCostosPedidos += envioReal;
          statUpdate['costosEnvio'] = firebase.firestore.FieldValue.increment(-(+envioReal.toFixed(2)));
        }
      }

      if (decCostos > 0)        statUpdate['costos']        = firebase.firestore.FieldValue.increment(-(+decCostos.toFixed(2)));
      if (decCostosPedidos > 0) statUpdate['costosPedidos'] = firebase.firestore.FieldValue.increment(-(+decCostosPedidos.toFixed(2)));
      if (order.statsRecorded === true && (Number(order.creditsUsed) || 0) > 0) {
        statUpdate['ventasCreditos'] = firebase.firestore.FieldValue.increment(-(+Number(order.creditsUsed).toFixed(2)));
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
    // Restaurar créditos PICO (saldo) si el pedido los usó
    try {
      const fn = firebase.functions().httpsCallable('restaurarCreditosPedido');
      await fn({ orderId: firestoreId });
    } catch (e) { console.warn('No se pudieron restaurar créditos:', e); }
    // El caché eterno se conserva; la próxima carga releerá solo lo cambiado.
    // Restaurar stock visual local
    if (order && order.items && order.stockDeducted) {
      for (const item of order.items) {
        stockMap[item.id] = (stockMap[item.id] || 0) + (item.qty || 0);
      }
      renderProducts();
    }
    refreshAdminAfterChange();
    showToast('Pedido cancelado — stock restaurado en Firebase');
  } catch (err) {
    showToast('Error al cancelar: ' + err.message);
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
    showToast('Copiado al portapapeles');
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
    showToast('No se pudo copiar');
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
      <button class="copy-btn" title="Copiar" onclick="copyToClipboard('${safe}', this)"></button>
    </div>`;
}

// Asignar ID de rastreo + costo real del envío → el pedido pasa a 'confirmado'
async function setTrackingId(firestoreId) {
  const input = document.getElementById('trackingInput');
  const envioInput = document.getElementById('envioRealInput');
  const tid = (input?.value || '').trim();
  if (!tid) { showToast('Ingresa un ID de rastreo'); return; }

  const rawEnvio = (envioInput?.value || '').trim();
  if (rawEnvio === '') { showToast('Ingresa el costo real del envío'); return; }
  const costoEnvioReal = parseFloat(rawEnvio);
  if (isNaN(costoEnvioReal) || costoEnvioReal < 0) { showToast('Costo de envío inválido'); return; }

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
    const fresh = (await db.collection('pedidos').doc(firestoreId).get()).data() || {};
    const yaRegistrado = fresh.costoEnvioRegistrado === true;
    const envioRealNum = +costoEnvioReal.toFixed(2);
    const statDocId = (fresh.sucursal === 'exsal') ? 'ColegioExsal' : 'ColegioDonBosco';

    // Al CONFIRMAR registramos el envío real en 'costosEnvio' (y detalle en 'costosPedidos').
    // 'costos' (principal) queda SOLO con base (inventario/gastos); el envío se suma en el panel.
    // La comisión Wompi ya vive en 'comisionesWompi' (la registra la función al pagar).
    const pedFlags = {};
    const registrarEnvio = (!yaRegistrado && envioRealNum > 0);
    if (registrarEnvio) pedFlags.costoEnvioRegistrado = true;

    const batch = db.batch();
    batch.update(db.collection('pedidos').doc(firestoreId), {
      trackingId: tid,
      costoEnvioReal: envioRealNum,
      status: 'confirmado',
      confirmedAt: firebase.firestore.FieldValue.serverTimestamp(),
      // El costo real ya quedó contabilizado → no se vuelve a sumar al entregar.
      costoEnvioRegistrado: true,
      ...pedFlags
    });
    // Envío real → 'costosEnvio' + 'costosPedidos' (NO 'costos' principal).
    if (registrarEnvio) {
      batch.set(db.collection('estadisticas').doc(statDocId), {
        'costosEnvio':   firebase.firestore.FieldValue.increment(envioRealNum),
        'costosPedidos': firebase.firestore.FieldValue.increment(envioRealNum)
      }, { merge: true });
    }
    await batch.commit();
    if (o) {
      o.trackingId = tid; o.costoEnvioReal = envioRealNum; o.status = 'confirmado';
      o.costoEnvioRegistrado = true;
    }
    closeModal('orderDetailModal');
    refreshAdminAfterChange();
    showToast('Pedido confirmado — envío real registrado');
  } catch (err) {
    showToast('Error: ' + err.message);
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
  document.getElementById('orderDetailTitle').textContent = `Pedido ${o.code || ''}`;
  const items = (o.items || []).map(i => `
    <div class="odetail-item">
      <div>
        <div class="odetail-item-name">${_pdEsc(i.name || '')}${(typeof orderItemColorBadgeHtml === 'function') ? orderItemColorBadgeHtml(i) : ''}</div>
        <div class="odetail-item-sub">$${(i.price||0).toFixed(2)} × ${i.qty}</div>
      </div>
      <div class="odetail-item-price">$${((i.price||0) * i.qty).toFixed(2)}</div>
    </div>`).join('');

  // ── Bloque de envío a domicilio (datos + copiar + pago + rastreo + acciones) ──
  let domicilioBlock = '';
  if (isDomicilio) {
    const e = o.envio || {};
    const credUsed = Number(o.creditsUsed) || 0;
    let pagoLabel = o.metodoPago === 'tarjeta' ? 'Tarjeta' : (o.metodoPago === 'efectivo' ? 'Efectivo' : '—');
    if (credUsed > 0 && o.creditsFullyPaid) pagoLabel = 'Créditos PICO (100%)';
    else if (credUsed > 0) pagoLabel = `Créditos $${credUsed.toFixed(2)} + ` + pagoLabel;
    const pagoEstado = o.paymentStatus === 'pending' ? 'Pendiente de pago'
                     : o.paymentStatus === 'paid'    ? 'Pagado'
                     : o.paymentStatus === 'credits' ? 'Pagado con créditos'
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
      // Con tarjeta, solo se puede confirmar/enviar una vez se confirmó el pago
      // (salvo que ya quedó cubierto con créditos).
      const esperaPago = o.metodoPago === 'tarjeta'
        && o.paymentStatus !== 'paid'
        && o.paymentStatus !== 'credits'
        && !o.creditsFullyPaid;
      if (esperaPago) {
        accionBlock = `
        <div class="odetail-track-box">
          <div class="odetail-track-label">Esperando confirmación de pago</div>
          <p class="odetail-track-hint">Este pedido se paga con tarjeta. Cuando se confirme el pago,
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
            <button class="odetail-confirm-btn" onclick="setTrackingId('${o.firestoreId}')">Confirmar pedido</button>
          </div>
          <p class="odetail-track-hint">El cliente pagó <b>$${(o.envioCosto || 0).toFixed(2)}</b> de envío (se suma a <b>ventas</b> de CDB).
          Al confirmar, el <b>costo real</b> del envío se registra en <b>costos</b> de CDB en este momento.
          La ganancia neta del envío = lo cobrado − el costo real. El pedido pasa a <b>Confirmado</b> y el cliente verá el ID de rastreo.</p>
        </div>`;
      }
    } else if (o.status === 'confirmado') {
      const envioRealTxt = (typeof o.costoEnvioReal === 'number')
        ? `<div class="odetail-track-hint" style="margin-top:0;margin-bottom:8px">Costo real del envío: <b>$${o.costoEnvioReal.toFixed(2)}</b> (cliente pagó $${(o.envioCosto||0).toFixed(2)})</div>`
        : '';
      accionBlock = `
        <div class="odetail-track-box confirmed">
          <div class="odetail-track-label">ID de rastreo asignado</div>
          <div class="odetail-track-id">
            <span>${o.trackingId || '—'}</span>
            <button class="copy-btn" title="Copiar" onclick="copyToClipboard('${(o.trackingId||'').replace(/'/g,"\\'")}', this)"></button>
          </div>
          ${envioRealTxt}
          <button class="odetail-deliver-btn" onclick="adminMarkDelivered('${o.firestoreId}')">Marcar como entregado</button>
        </div>`;
    } else if (o.status === 'delivered' || o.status === 'sold') {
      accionBlock = `
        <div class="odetail-track-box confirmed">
          <div class="odetail-track-label">Entregado</div>
          ${o.trackingId ? `<div class="odetail-track-id"><span>${o.trackingId}</span></div>` : ''}
        </div>`;
    }

    domicilioBlock = `
      <div class="odetail-domicilio">
        <div class="odetail-section-title">Datos de envío</div>
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
    ? `<div class="odetail-subtotal"><span>Envío a domicilio</span><span>$${(o.envioCosto || 0).toFixed(2)}</span></div>
       <div class="odetail-subtotal" style="font-weight:700;border-top:2px solid var(--g200);padding-top:8px">
         <span>Total con envío</span>
         <span>$${(typeof o.totalConEnvio === 'number' ? o.totalConEnvio : subtotalProductos).toFixed(2)}</span>
       </div>`
    : '';

  const comisionRow = (typeof o.comisionWompi === 'number' && o.comisionWompi > 0)
    ? `<div class="odetail-subtotal" style="color:var(--g400)">
         <span>Comisión Wompi (3.5%) · solo admin</span>
         <span>-$${o.comisionWompi.toFixed(2)}</span>
       </div>`
    : '';

  document.getElementById('orderDetailBody').innerHTML = `
    <div style="font-size:.78rem;color:var(--g400);margin-bottom:10px">
      <b style="color:var(--g700)">${o.name}</b>${isDomicilio
        ? (o.visitaInstitucion ? ` · visita: ${o.visitaInstitucion}` : '')
        : ` · ${(typeof sucursalInternalLabel === 'function') ? sucursalInternalLabel(o.sucursal) : 'Retiro'}${(o.grade || o.section) ? ` (${o.grade || ''} – ${o.section || ''})` : ''}${(o.uniTelefono || o.cdbTelefono) ? ` · ${o.uniTelefono || o.cdbTelefono}` : ''}`}<br>
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
