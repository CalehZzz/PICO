// ════════════════════════════════════════════════════════════════
// PICO · Carrito y checkout
// ════════════════════════════════════════════════════════════════

// Tarifa de envío a domicilio POR TRAMOS, según el subtotal de productos (lo que
// paga el cliente por los productos, ya con descuento aplicado). El envío se SUMA al
// total, pero NO se mezcla con 'total'/'totalConDescuento' para que las estadísticas
// y el stock se comporten igual que un pedido normal.
//
//   subtotal  <  $13         → $3.49
//   $13 ≤ subtotal <  $20     → $2.49
//   $20 ≤ subtotal <  $24     → $1.99
//   subtotal  ≥  $24         → GRATIS ($0)
//
// (Los umbrales se eligieron en $13 / $20 / $24 para no solapar el centavo de
//  $19.99 ↔ $20.00. Si querés que el salto a $1.99 sea exactamente en $19.99,
//  cambiá el 'min' del tercer tramo a 19.99.)
const SHIPPING_TIERS = [
  { min: 0,  cost: 3.49 },
  { min: 13, cost: 2.49 },
  { min: 20, cost: 1.99 },
  { min: 24, cost: 0    }
];
// Umbral para envío gratis (último tramo). Se usa para la barra de progreso.
const FREE_SHIPPING_AT = SHIPPING_TIERS[SHIPPING_TIERS.length - 1].min; // 24
// Costo base (tramo más bajo). Se conserva el nombre por compatibilidad.
const SHIPPING_COST = SHIPPING_TIERS[0].cost;

// Costo de envío que paga el cliente para un subtotal de productos dado.
function getShippingCost(subtotal) {
  let cost = SHIPPING_TIERS[0].cost;
  for (const t of SHIPPING_TIERS) if (subtotal >= t.min) cost = t.cost;
  return cost;
}

// Información del progreso de envío para un subtotal: costo actual, siguiente meta
// (umbral + costo de ese tramo) y cuánto falta para alcanzarla.
function getShippingProgress(subtotal) {
  const currentCost = getShippingCost(subtotal);
  const next = SHIPPING_TIERS.find(t => t.min > subtotal) || null; // próximo umbral
  return {
    subtotal,
    currentCost,
    isFree:    currentCost === 0,
    nextMin:   next ? next.min  : null,
    nextCost:  next ? next.cost : null,
    remaining: next ? +(next.min - subtotal).toFixed(2) : 0
  };
}

// Pagos con tarjeta vía Wompi El Salvador (Enlace de Pago · la tarjeta se ingresa en Wompi).
// La creación del enlace de pago ocurre en la Cloud Function 'crearEnlaceWompi'.

// ═══════════════════════════════════════════════════
//  CART  (con persistencia en localStorage)
// ═══════════════════════════════════════════════════

// ── Aviso por correo de cada pedido (vía extensión Trigger Email) ──
function sendOrderEmail(orderId, d) {
  const NOTIFY_EMAIL = 'picosvsupport@gmail.com'; // ← correo donde quieres recibir el aviso
  const sucLabel = d.tipoEntrega === 'domicilio' ? '🚚 Envío a domicilio'
                 : d.sucursal === 'cdb' ? 'Colegio Don Bosco (CDB)'
                 : 'Colegio Exsal (EXSAL)';
  const finalTotal = d.totalConDescuento != null ? d.totalConDescuento : d.total;

  const rows = d.items.map(i => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${i.name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">$${i.price.toFixed(2)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">$${(i.qty * i.price).toFixed(2)}</td>
    </tr>`).join('');

  const descuento = d.totalConDescuento != null ? `
    <tr><td colspan="3" style="padding:6px 10px;text-align:right">Subtotal</td>
        <td style="padding:6px 10px;text-align:right">$${d.total.toFixed(2)}</td></tr>
    <tr><td colspan="3" style="padding:6px 10px;text-align:right;color:#16a34a">Descuento (${d.discountName || ''} ${d.discountPct || 0}%)</td>
        <td style="padding:6px 10px;text-align:right;color:#16a34a">−$${(d.total - finalTotal).toFixed(2)}</td></tr>` : '';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
      <h2 style="margin:0 0 4px">🛒 Nuevo pedido · ${d.code}</h2>
      <p style="margin:0 0 16px;color:#64748b">${new Date().toLocaleString('es-SV')}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <tr><td style="padding:4px 0;color:#64748b">Cliente</td><td style="padding:4px 0;font-weight:600">${d.name}</td></tr>
        ${d.tipoEntrega === 'domicilio' ? '' : `<tr><td style="padding:4px 0;color:#64748b">Grado / Sección</td><td style="padding:4px 0;font-weight:600">${d.grade} - ${d.section}</td></tr>`}
        <tr><td style="padding:4px 0;color:#64748b">Sucursal</td><td style="padding:4px 0;font-weight:600">${sucLabel}</td></tr>
        ${d.tipoEntrega === 'domicilio' && d.envio ? `
        <tr><td style="padding:4px 0;color:#64748b">Departamento</td><td style="padding:4px 0;font-weight:600">${d.envio.departamento || ''}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Municipio</td><td style="padding:4px 0;font-weight:600">${d.envio.municipio || ''}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Dirección</td><td style="padding:4px 0;font-weight:600">${d.envio.direccion || ''}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Teléfono</td><td style="padding:4px 0;font-weight:600">${d.envio.telefono || ''}</td></tr>
        ${d.envio.telefono2 ? `<tr><td style="padding:4px 0;color:#64748b">Tel. adicional</td><td style="padding:4px 0;font-weight:600">${d.envio.telefono2}</td></tr>` : ''}
        ${d.envio.referencia ? `<tr><td style="padding:4px 0;color:#64748b">Referencia</td><td style="padding:4px 0;font-weight:600">${d.envio.referencia}</td></tr>` : ''}
        ${d.envio.indicaciones ? `<tr><td style="padding:4px 0;color:#64748b">Indicaciones</td><td style="padding:4px 0;font-weight:600">${d.envio.indicaciones}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#64748b">Método de pago</td><td style="padding:4px 0;font-weight:600">${d.metodoPago === 'tarjeta' ? '💳 Tarjeta' : '💵 Efectivo'}</td></tr>` : ''}
        ${d.email ? `<tr><td style="padding:4px 0;color:#64748b">Correo cliente</td><td style="padding:4px 0;font-weight:600">${d.email}</td></tr>` : ''}
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="background:#f1f5f9">
          <th style="padding:8px 10px;text-align:left">Producto</th>
          <th style="padding:8px 10px;text-align:center">Cant.</th>
          <th style="padding:8px 10px;text-align:right">Precio</th>
          <th style="padding:8px 10px;text-align:right">Subtotal</th>
        </tr>
        ${rows}
        ${descuento}
        ${d.tipoEntrega === 'domicilio' && d.envioCosto ? `
        <tr><td colspan="3" style="padding:6px 10px;text-align:right">🚚 Envío a domicilio</td>
            <td style="padding:6px 10px;text-align:right">$${(d.envioCosto).toFixed(2)}</td></tr>` : ''}
        <tr><td colspan="3" style="padding:10px;text-align:right;font-weight:700;font-size:16px;border-top:2px solid #0f172a">TOTAL</td>
            <td style="padding:10px;text-align:right;font-weight:700;font-size:16px;border-top:2px solid #0f172a">$${(d.tipoEntrega === 'domicilio' && d.totalConEnvio != null ? d.totalConEnvio : finalTotal).toFixed(2)}</td></tr>
      </table>
      <p style="margin-top:16px;color:#94a3b8;font-size:12px">ID del pedido: ${orderId}</p>
    </div>`;

  return db.collection('mail').add({
    to: NOTIFY_EMAIL,
    message: {
      subject: `🛒 Nuevo pedido ${d.code} — ${d.name} (${sucLabel})`,
      html
    }
  });
}

// ════════════════════════════════════════════════════════════════
//  FACTURA DEL PEDIDO  (PDF + correo al cliente vía Trigger Email)
// ════════════════════════════════════════════════════════════════
// Clave de mes "YYYY-MM" (mes 0-indexado, igual que el inventario para que
// las facturas de tienda e inventario compartan formato y se listen juntas).
function picoMonthKey(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.getFullYear() + '-' + String(d.getMonth()).padStart(2, '0');
}

// Crea la factura del pedido (colección 'facturas', SOLO datos — sin imágenes ni
// PDF) usando el mismo contador '_meta.facturaSeq' que el inventario, y envía al
// cliente un correo con el detalle. El PDF se genera bajo demanda desde el
// inventario a partir de estos datos. No bloquea el pedido.
async function crearYEnviarFacturaPedido(orderId, d) {
  const ts = Date.now();
  const mes = picoMonthKey(ts);
  const fecha = new Date().toLocaleDateString('es');
  const discPct = d.discountPct || 0;
  const discFactor = discPct ? ((100 - discPct) / 100) : 1;

  const items = (d.items || []).map(it => {
    const sub = +((it.price || 0) * (it.qty || 0)).toFixed(2);
    return {
      productName: it.name, qty: it.qty,
      precioUnit: +(it.price || 0).toFixed(2),
      subtotal: sub,
      total: +(sub * discFactor).toFixed(2),
      descPct: discPct, descNombre: d.discountName || ''
    };
  });
  const unidades = items.reduce((s, it) => s + (it.qty || 0), 0);
  const subtotal = +(d.total).toFixed(2);
  // Total de productos (con descuento si aplica), SIN envío.
  const totalProductos = (typeof d.totalConDescuento === 'number') ? +d.totalConDescuento.toFixed(2) : subtotal;
  // Envío cobrado (solo domicilio): se SUMA al total de la factura, igual que lo paga el cliente.
  const envioCosto = (d.tipoEntrega === 'domicilio' && typeof d.envioCosto === 'number') ? +d.envioCosto.toFixed(2) : 0;
  // Total de la factura = productos (con descuento) + envío cobrado.
  const total = +(totalProductos + envioCosto).toFixed(2);
  // El stock y las estadísticas de 'domicilio' viven en CDB → su factura va bajo CDB.
  const facSucursal = (d.sucursal === 'exsal') ? 'exsal' : 'cdb';

  const facRef  = db.collection('facturas').doc();
  const metaRef = db.collection('estadisticas').doc('_meta');
  let seq = 0, numFactura = '';

  await db.runTransaction(async t => {
    const metaSnap = await t.get(metaRef);
    seq = ((metaSnap.exists && metaSnap.data().facturaSeq) || 0) + 1;
    numFactura = 'FAC-' + String(seq).padStart(5, '0');
    t.set(facRef, {
      numero: seq, numFactura, sucursal: facSucursal,
      cliente: d.name || '', clienteEmail: d.email || '',
      seller: 'tienda-online',
      date: fecha, timestamp: ts, mes,
      subtotal, totalProductos, envioCosto, total, unidades, items,
      tipoEntrega: d.tipoEntrega || 'pickup',
      fromOrder: orderId, origen: 'tienda',
      anulada: false   // Las facturas NUNCA se borran; al cancelar el pedido se marcan como anuladas.
    });
    t.set(metaRef, { facturaSeq: seq, updatedAt: ts }, { merge: true });
    t.update(db.collection('pedidos').doc(orderId), { facturaId: facRef.id, facturaNum: numFactura });
  });

  // Correo al cliente con los DATOS de la factura (sin adjuntos ni imágenes).
  if (d.email) {
    const sedeLabel = facSucursal === 'exsal' ? 'EXSAL' : 'CDB';
    const filas = items.map(i => `<tr>
        <td style="padding:7px 0;border-bottom:1px solid #eef5fb">${i.productName}</td>
        <td style="padding:7px 0;border-bottom:1px solid #eef5fb;text-align:center">${i.qty}</td>
        <td style="padding:7px 0;border-bottom:1px solid #eef5fb;text-align:right">$${i.total.toFixed(2)}</td>
      </tr>`).join('');
    const descRow = subtotal !== totalProductos
      ? `<p style="margin:10px 0 0;text-align:right;color:#4a89b0;font-size:13px">Subtotal: $${subtotal.toFixed(2)} &middot; Descuento: -$${(subtotal-totalProductos).toFixed(2)}</p>`
      : '';
    const envioRowMail = envioCosto
      ? `<p style="margin:6px 0 0;text-align:right;color:#4a89b0;font-size:13px">🚚 Envío a domicilio: $${envioCosto.toFixed(2)}</p>`
      : '';
    try {
      await db.collection('mail').add({
        to: d.email,
        from: 'PICO Electrónica <pedidos@picosv.com>',
        replyTo: 'noreply@picosv.com',
        message: {
          subject: `🧾 Factura ${numFactura} — PICO Electrónica`,
          html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#0f3f63">
  <div style="background:#4aa8e8;color:#fff;padding:18px 20px;border-radius:10px 10px 0 0">
    <div style="font-size:20px;font-weight:700">PICO Electrónica</div>
    <div style="font-size:13px;opacity:.92">Factura ${numFactura}</div>
  </div>
  <div style="border:1px solid #e2eef7;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px">
    <p style="margin:0 0 4px">¡Gracias por tu compra, <b>${d.name || ''}</b>!</p>
    <p style="margin:0 0 14px;color:#4a89b0;font-size:13px">Pedido <b>${d.code}</b> &middot; ${fecha} &middot; Sede ${sedeLabel}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="color:#4a89b0;font-size:12px">
        <th style="padding:6px 0;border-bottom:2px solid #e2eef7;text-align:left">Producto</th>
        <th style="padding:6px 0;border-bottom:2px solid #e2eef7;text-align:center">Cant.</th>
        <th style="padding:6px 0;border-bottom:2px solid #e2eef7;text-align:right">Total</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>
    ${descRow}
    ${envioRowMail}
    <p style="margin:8px 0 0;text-align:right;font-size:17px;font-weight:700">TOTAL: $${total.toFixed(2)}</p>
    <p style="margin:18px 0 0;color:#94a3b8;font-size:12px">Este es un correo automático, por favor no respondas a esta dirección.</p>
  </div>
</div>`
        }
      });
    } catch (e) { console.warn('No se pudo encolar el correo de la factura al cliente:', e); }
  }
  return { numFactura, facturaId: facRef.id };
}

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

  // Barra de progreso de envío + recomendaciones (solo entrega a domicilio)
  renderShippingProgress();

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

// ═══════════════════════════════════════════════════
//  BARRA DE PROGRESO DE ENVÍO + RECOMENDACIONES
// ═══════════════════════════════════════════════════
// Muestra, dentro del carrito, una barra que se va llenando hacia el envío gratis
// ($24) y, según el tramo actual, recomienda productos en stock para alcanzar el
// siguiente nivel de envío. Solo aplica a entrega a domicilio (en retiro CDB/EXSAL
// no se cobra envío).
function renderShippingProgress() {
  const el = document.getElementById('cartShipProgress');
  if (!el) return;

  const esDomicilio = selectedSucursal === 'domicilio';
  const subtotal    = getCartTotal(); // total de productos con descuento → define el tramo
  if (!esDomicilio || subtotal <= 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'block';

  const pg  = getShippingProgress(subtotal);
  const pct = Math.max(0, Math.min(100, (subtotal / FREE_SHIPPING_AT) * 100));

  // Mensaje principal según el tramo
  let headline;
  if (pg.isFree) {
    headline = `<span class="ship-free">🎉 ¡Ya tenés envío <b>GRATIS</b>!</span>`;
  } else if (pg.nextCost === 0) {
    headline = `Te falta <b>$${pg.remaining.toFixed(2)}</b> para <b class="ship-hl">envío GRATIS</b>`;
  } else {
    headline = `Te falta <b>$${pg.remaining.toFixed(2)}</b> para bajar el envío a <b class="ship-hl">$${pg.nextCost.toFixed(2)}</b>`;
  }

  // Marcadores (dots) en los umbrales de cada tramo
  const marks = SHIPPING_TIERS
    .filter(t => t.min > 0)
    .map(t => {
      const left    = Math.min(100, (t.min / FREE_SHIPPING_AT) * 100);
      const reached = subtotal >= t.min;
      return `<span class="ship-mark ${reached ? 'reached' : ''}" style="left:${left}%"></span>`;
    }).join('');

  // Recomendaciones para alcanzar el siguiente tramo
  const recsHtml = pg.nextMin ? renderShipRecs(pg.remaining) : '';

  el.innerHTML = `
    <div class="ship-progress">
      <div class="ship-top">
        <span class="ship-ico">🚚</span>
        <span class="ship-msg">${headline}</span>
        <span class="ship-cost ${pg.isFree ? 'free' : ''}">${pg.isFree ? 'GRATIS' : '$' + pg.currentCost.toFixed(2)}</span>
      </div>
      <div class="ship-track">
        <div class="ship-fill" style="width:${pct}%"></div>
        ${marks}
      </div>
      ${recsHtml}
    </div>`;
}

// Sugiere hasta 3 productos en stock para alcanzar el siguiente tramo de envío.
function renderShipRecs(gap) {
  if (!Array.isArray(products) || !products.length || gap <= 0) return '';
  // Disponibles: con stock libre (descontando lo que ya está en el carrito).
  const avail = products.filter(p => {
    const stock  = stockMap[p.id] || 0;
    const inCart = cart[p.id]     || 0;
    return (stock - inCart) > 0 && p.price > 0;
  });
  if (!avail.length) return '';
  // 1) Los que cruzan el umbral de un solo golpe (precio ≥ falta), del más barato al más caro.
  const crossers = avail.filter(p => p.price >= gap).sort((a, b) => a.price - b.price);
  // 2) Rellenadores (precio < falta), del más caro al más barato (acercan más rápido).
  const fillers  = avail.filter(p => p.price <  gap).sort((a, b) => b.price - a.price);
  const recs = [...crossers, ...fillers].slice(0, 3);
  if (!recs.length) return '';

  const chips = recs.map(p => {
    const thumb = p.img
      ? `<span class="ship-rec-thumb" style="padding:0"><img src="${p.img}" alt="" onerror="this.parentElement.innerHTML='${p.e || '⚡'}'"></span>`
      : `<span class="ship-rec-thumb">${p.e || '⚡'}</span>`;
    const nameShort = p.name.length > 20 ? p.name.slice(0, 19) + '…' : p.name;
    return `<button class="ship-rec" onclick="shipRecAdd('${p.id}')" title="Agregar ${p.name} · $${p.price.toFixed(2)}">
        ${thumb}
        <span class="ship-rec-info">
          <span class="ship-rec-name">${nameShort}</span>
          <span class="ship-rec-price">$${p.price.toFixed(2)}</span>
        </span>
        <span class="ship-rec-add">+</span>
      </button>`;
  }).join('');

  return `<div class="ship-recs-lbl">💡 Agregá y ahorrá en envío</div>
          <div class="ship-recs">${chips}</div>`;
}

// Agregar (o incrementar) un producto recomendado desde la barra de envío.
function shipRecAdd(id) {
  if (cart[id]) cartInc(id);
  else          addToCart(id);
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
  const rawTotal    = getCartRawTotal();
  const finalTotal  = getCartTotal();
  const esDomicilio = getSavedProfile().sucursal === 'domicilio';
  const envioCosto  = esDomicilio ? getShippingCost(finalTotal) : 0;
  const grandTotal  = +(finalTotal + envioCosto).toFixed(2);
  const discountRow = selectedDiscount
    ? `<div class="odetail-subtotal" style="color:var(--green)">
         <span>🏷️ Descuento (${selectedDiscount.nombre} −${selectedDiscount.porcentaje}%)</span>
         <span>−$${(rawTotal - finalTotal).toFixed(2)}</span>
       </div>`
    : '';
  // Subtotal de productos (se muestra si hay descuento o envío, para que el desglose quede claro)
  const subtotalRow = (selectedDiscount || esDomicilio)
    ? `<div class="odetail-subtotal"><span>Subtotal productos</span><span>$${rawTotal.toFixed(2)}</span></div>`
    : '';
  const subDescRow = (selectedDiscount && esDomicilio)
    ? `<div class="odetail-subtotal"><span>Subtotal con descuento</span><span>$${finalTotal.toFixed(2)}</span></div>`
    : '';
  const envioRow = esDomicilio
    ? `<div class="odetail-subtotal"><span>🚚 Envío a domicilio</span><span>$${envioCosto.toFixed(2)}</span></div>`
    : '';

  document.getElementById('checkoutSummary').innerHTML = `
    <div class="osumtitle">Resumen del pedido</div>
    <div class="odetail-list" style="gap:4px">${items}
      ${subtotalRow}
      ${discountRow}
      ${subDescRow}
      ${envioRow}
      <div class="odetail-subtotal" style="font-weight:700;color:var(--b600)">
        <span>Total${esDomicilio ? ' con envío' : (selectedDiscount ? ' con descuento' : '')}</span><span>$${grandTotal.toFixed(2)}</span>
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
    const esDomicilio = saved.sucursal === 'domicilio';
    const label = saved.sucursal === 'cdb' ? '🏫 CDB'
                : saved.sucursal === 'exsal' ? '🏢 EXSAL'
                : '🚚 Envío a domicilio';
    sucursalInfoEl.innerHTML = esDomicilio
      ? `🚚 <b>Entrega:</b> ${label} <span style="font-size:.75rem;color:var(--g400)">(puedes cambiarlo en tu perfil)</span>`
      : `🏫 <b>Sucursal:</b> ${label} <span style="font-size:.75rem;color:var(--g400)">(puedes cambiarlo en tu perfil)</span>`;
    sucursalInfoEl.style.background = '';
    sucursalInfoEl.style.borderColor = '';
    sucursalInfoEl.style.color = '';
    document.getElementById('placeOrderBtn').disabled = false;
  }

  // Mostrar/ocultar datos de envío + método de pago según el tipo de entrega
  toggleDeliveryFields(saved.sucursal === 'domicilio');

  openModal('checkoutModal');
}

// ── Tipo de entrega: alterna las secciones de envío y pago ──
let selectedPayment = 'tarjeta'; // 'tarjeta' | 'efectivo'

function toggleDeliveryFields(esDomicilio) {
  const ship = document.getElementById('shippingSection');
  const pay  = document.getElementById('paymentSection');
  const academic = document.getElementById('academicFields');
  if (ship) ship.style.display = esDomicilio ? '' : 'none';
  if (pay)  pay.style.display  = esDomicilio ? '' : 'none';
  // Grado y sección no aplican al envío a domicilio.
  if (academic) academic.style.display = esDomicilio ? 'none' : '';
  if (esDomicilio) {
    // Prefijar datos de envío guardados (si existen)
    const saved = getSavedProfile();
    if (saved.shipPhone)      document.getElementById('shipPhone').value      = saved.shipPhone;
    if (saved.shipPhone2)     document.getElementById('shipPhone2').value     = saved.shipPhone2;
    if (saved.shipDepartment) document.getElementById('shipDepartment').value = saved.shipDepartment;
    if (saved.shipCity)       document.getElementById('shipCity').value       = saved.shipCity;
    if (saved.shipAddress)    document.getElementById('shipAddress').value    = saved.shipAddress;
    if (saved.shipRef)        document.getElementById('shipRef').value        = saved.shipRef;
    if (saved.shipNotes)      document.getElementById('shipNotes').value      = saved.shipNotes;
    selectPayment(selectedPayment); // re-aplicar estado visual del método de pago
  }
}

// ── Selección de método de pago (tarjeta / efectivo) ──
function selectPayment(method) {
  selectedPayment = method;
  const card = document.getElementById('payCard');
  const cash = document.getElementById('payCash');
  const cardFields = document.getElementById('cardFields');
  const cashNote   = document.getElementById('cashNote');
  if (!card || !cash) return;
  card.classList.toggle('active', method === 'tarjeta');
  cash.classList.toggle('active', method === 'efectivo');
  if (cardFields) cardFields.style.display = method === 'tarjeta' ? '' : 'none';
  if (cashNote)   cashNote.style.display   = method === 'efectivo' ? '' : 'none';
}

async function placeOrder() {
  const name    = document.getElementById('studentName').value.trim();

  // Sucursal desde perfil (obligatoria)
  const savedProfile = getSavedProfile();
  const sucursal = savedProfile.sucursal || null;
  if (!sucursal) {
    showToast('⚠️ Configura tu sucursal en tu perfil');
    closeModal('checkoutModal');
    showPage('profile');
    return;
  }

  // Grado y sección solo se piden para retiro en sucursal (no para domicilio).
  const esDomicilioEntrega = sucursal === 'domicilio';
  const grade   = esDomicilioEntrega ? '' : document.getElementById('studentGrade').value;
  const section = esDomicilioEntrega ? '' : document.getElementById('studentSection').value;
  if (!name) { showToast('⚠️ Ingresa tu nombre completo'); return; }
  if (!esDomicilioEntrega && (!grade || !section)) { showToast('⚠️ Completa todos los campos'); return; }

  // ── Datos de envío + método de pago (solo entrega a domicilio) ──
  const esDomicilio = sucursal === 'domicilio';
  let envio = null;
  let metodoPago = null;
  if (esDomicilio) {
    const telefono     = document.getElementById('shipPhone').value.trim();
    const telefono2    = document.getElementById('shipPhone2').value.trim();
    const departamento = document.getElementById('shipDepartment').value;
    const municipio    = document.getElementById('shipCity').value.trim();
    const direccion    = document.getElementById('shipAddress').value.trim();
    const referencia   = document.getElementById('shipRef').value.trim();
    const indicaciones = document.getElementById('shipNotes').value.trim();
    if (!telefono || !departamento || !municipio || !direccion || !referencia) {
      showToast('⚠️ Completa todos los datos de envío obligatorios');
      return;
    }
    envio = { nombre: name, telefono, telefono2, departamento, municipio, direccion, referencia, indicaciones };
    metodoPago = selectedPayment; // 'tarjeta' | 'efectivo'
    // Con Enlace de Pago la tarjeta se ingresa EN WOMPI, no aquí. No recogemos datos de tarjeta.
    // Guardar los datos de envío en el perfil para futuros pedidos
    try {
      const key   = 'el_profile_' + currentUser.uid;
      const prof  = JSON.parse(localStorage.getItem(key) || '{}');
      prof.shipPhone = telefono;       prof.shipPhone2 = telefono2;
      prof.shipDepartment = departamento; prof.shipCity = municipio;
      prof.shipAddress = direccion;    prof.shipRef = referencia;
      prof.shipNotes = indicaciones;
      localStorage.setItem(key, JSON.stringify(prof));
    } catch (_) {}
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

  // Capturamos el % de descuento ANTES de resetear selectedDiscount (se usa más abajo en el pago).
  const pagoDiscPct = selectedDiscount ? selectedDiscount.porcentaje : 0;

  // Costo de envío por tramos (según el subtotal con descuento). Solo a domicilio.
  const shipCost = esDomicilio ? getShippingCost(finalTotal) : 0;

  try {
    const stockField = (sucursal === 'cdb' || sucursal === 'domicilio') ? 'stockCdb' : 'stockExsal';

    // ── Verificar que haya stock suficiente y descontarlo de forma ATÓMICA, justo antes de crear el pedido ──
    // (aplica a TODO tipo de pedido: tarjeta, efectivo, sucursal o domicilio). Si no alcanza, no se crea el pedido.
    await db.runTransaction(async (tx) => {
      const ids = Object.keys(cart);
      const snaps = await Promise.all(ids.map(id => tx.get(db.collection('productos').doc(id))));
      // 1) Validar disponibilidad de cada producto
      for (let k = 0; k < ids.length; k++) {
        const snap = snaps[k];
        const need = cart[ids[k]] || 0;
        const data = snap.exists ? snap.data() : null;
        const have = data && typeof data[stockField] === 'number' ? data[stockField] : 0;
        if (!snap.exists || have < need) {
          const nombre = (data && data.name) ? data.name : 'un producto';
          throw new Error('STOCK_INSUFICIENTE:: No hay stock suficiente de "' + nombre + '" (disponible: ' + have + ', solicitado: ' + need + ')');
        }
      }
      // 2) Descontar el stock
      for (let k = 0; k < ids.length; k++) {
        tx.update(db.collection('productos').doc(ids[k]), {
          [stockField]: firebase.firestore.FieldValue.increment(-(cart[ids[k]] || 0)),
          updatedAt: Date.now()   // marca el producto como cambiado para el caché incremental
        });
      }
    });

    const docRef = await db.collection('pedidos').add({
      code, name, grade, section, items,
      total:               +rawTotal.toFixed(2),
      totalConDescuento:   selectedDiscount ? finalTotal : null,
      discountId:          selectedDiscount ? selectedDiscount.id        : null,
      discountName:        selectedDiscount ? selectedDiscount.nombre    : null,
      discountPct:         selectedDiscount ? selectedDiscount.porcentaje: null,
      sucursal:    sucursal,
      tipoEntrega: esDomicilio ? 'domicilio' : 'pickup',
      envio:       envio,        // {nombre, telefono, telefono2, departamento, municipio, direccion, referencia, indicaciones} o null
      // Costo de envío y total que paga el cliente (NO afectan stats: 'total' sigue siendo solo productos)
      envioCosto:    shipCost,
      costoEnvioReal: null,      // lo ingresa el admin al confirmar (costo real del courier) — SOLO admin
      totalConEnvio: +(((selectedDiscount ? finalTotal : +rawTotal.toFixed(2))) + shipCost).toFixed(2),
      metodoPago:  metodoPago,   // 'tarjeta' | 'efectivo' | null
      paymentStatus: esDomicilio ? (metodoPago === 'tarjeta' ? 'pending' : 'efectivo') : null,
      comisionWompi: null,       // la calcula el servidor al confirmar el pago (solo tarjeta) — SOLO admin
      statsRecorded: false,      // estadísticas de venta registradas (tarjeta: al pagar / efectivo: al entregar)
      ingresoEnvioRegistrado: false, // envío cobrado ya sumado a ventas/ingresos (tarjeta: al pagar / efectivo: al entregar)
      costoEnvioRegistrado:   false, // envío real ya sumado a costos (al confirmar/asignar guía)
      trackingId:  null,         // lo asigna el admin; al asignarlo el pedido pasa a 'confirmado'
      confirmedAt: null,
      status:      'pending',
      // El stock se descuenta SIEMPRE al crear el pedido (transacción de arriba).
      stockDeducted: true,
      createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
      deliveredAt: null,
      userId:      currentUser?.uid   || null,
      email:       currentUser?.email || null
    });

    // Aviso por correo al dueño (no bloquea el pedido si algo falla)
    sendOrderEmail(docRef.id, {
      code, name, grade, section, items,
      total: +rawTotal.toFixed(2),
      totalConDescuento: selectedDiscount ? finalTotal : null,
      discountName: selectedDiscount ? selectedDiscount.nombre : null,
      discountPct:  selectedDiscount ? selectedDiscount.porcentaje : null,
      sucursal,
      tipoEntrega: esDomicilio ? 'domicilio' : 'pickup',
      envio,
      envioCosto:    shipCost,
      totalConEnvio: +(((selectedDiscount ? finalTotal : +rawTotal.toFixed(2))) + shipCost).toFixed(2),
      metodoPago,
      email: currentUser?.email || null
    }).catch(e => console.warn('No se pudo encolar el correo de aviso:', e));

    // Generar la factura del pedido y enviarla al cliente (PDF adjunto). No bloquea el pedido.
    crearYEnviarFacturaPedido(docRef.id, {
      code, name, items,
      total: +rawTotal.toFixed(2),
      totalConDescuento: selectedDiscount ? finalTotal : null,
      discountName: selectedDiscount ? selectedDiscount.nombre : null,
      discountPct:  selectedDiscount ? selectedDiscount.porcentaje : null,
      sucursal,
      tipoEntrega: esDomicilio ? 'domicilio' : 'pickup',
      envioCosto: shipCost,
      email: currentUser?.email || null
    }).catch(e => console.warn('No se pudo crear/enviar la factura del pedido:', e));

    // El stock ya se verificó y descontó en la transacción de arriba (antes de crear el pedido).

    // Incrementar contador de pedidos pendientes en estadísticas (tiempo real, NO se resetea por mes)
    try {
      const statDocId = (sucursal === 'cdb' || sucursal === 'domicilio') ? 'ColegioDonBosco' : 'ColegioExsal';
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

    // Mensaje según el tipo de entrega
    const hintEl = document.getElementById('successHint');
    if (hintEl) hintEl.textContent = esDomicilio
      ? 'Te enviaremos el ID de rastreo cuando confirmemos tu pedido.'
      : 'Preséntate en el laboratorio con este código o escanea el QR.';

    // Pago con tarjeta a domicilio → crear enlace de pago Wompi y redirigir.
    if (esDomicilio && metodoPago === 'tarjeta') {
      btn.textContent = 'Redirigiendo al pago...';
      try {
        await startWompiCheckout(docRef.id);
        return; // la página se redirige a Wompi; el pedido quedó pendiente
      } catch (e) {
        console.error('Wompi checkout:', e);
        showToast('⚠️ ' + (e && e.message ? e.message : 'No se pudo iniciar el pago con tarjeta.') + ' Tu pedido quedó pendiente.');
        openModal('successModal');
      }
    } else {
      openModal('successModal');
    }
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    if (msg.indexOf('STOCK_INSUFICIENTE::') === 0) {
      showToast('⚠️ ' + msg.replace('STOCK_INSUFICIENTE:: ', ''));
    } else {
      showToast('❌ Error al guardar el pedido: ' + msg);
    }
    console.error('placeOrder:', err);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Realizar Pedido ✓';
  }
}

// ════════════════════════════════════════════════════════════════
//  PAGO CON TARJETA · WOMPI EL SALVADOR (Enlace de Pago)
// ════════════════════════════════════════════════════════════════
// La Cloud Function 'crearEnlaceWompi' crea un enlace de pago y devuelve la
// URL de la pantalla de pago alojada por Wompi. El cliente ingresa su tarjeta
// EN WOMPI (nunca en PICO). La confirmación del pago es 100% del lado servidor
// (webhook + verificación), nunca se confía en el cliente.

// ── Pantalla de carga a pantalla completa mientras se inicia el pago ──
function showWompiLoadingOverlay() {
  if (document.getElementById('wompi-loading-overlay')) return;
  if (!document.getElementById('wompi-loading-style')) {
    const st = document.createElement('style');
    st.id = 'wompi-loading-style';
    st.textContent = '@keyframes wompiSpin{to{transform:rotate(360deg)}}@keyframes wompiFade{from{opacity:0}to{opacity:1}}';
    document.head.appendChild(st);
  }
  const ov = document.createElement('div');
  ov.id = 'wompi-loading-overlay';
  ov.setAttribute('role', 'alert');
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:rgba(8,30,52,.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:wompiFade .25s ease;padding:24px;text-align:center';
  ov.innerHTML = `
    <div style="width:62px;height:62px;border:5px solid rgba(255,255,255,.22);border-top-color:#fff;border-radius:50%;animation:wompiSpin .8s linear infinite"></div>
    <div style="color:#fff;font-family:inherit">
      <div style="font-size:1.18rem;font-weight:800;letter-spacing:.2px">Procesando pago en Wompi…</div>
      <div style="font-size:.92rem;opacity:.82;margin-top:7px;max-width:340px;line-height:1.45">Te estamos redirigiendo a la pasarela segura de pago. No cierres ni recargues esta ventana.</div>
    </div>`;
  document.body.appendChild(ov);
}
function hideWompiLoadingOverlay() {
  const ov = document.getElementById('wompi-loading-overlay');
  if (ov) ov.remove();
}

// Crea el enlace de pago vía Cloud Function y redirige a la pantalla de Wompi.
async function startWompiCheckout(orderId) {
  if (!currentUser || !currentUser.uid) throw new Error('No hay sesión activa');
  showWompiLoadingOverlay();
  try {
    const fn = firebase.functions().httpsCallable('crearEnlaceWompi');
    const res = await fn({ orderId, origin: location.origin });
    const url = res && res.data && res.data.url;
    if (!url) { hideWompiLoadingOverlay(); throw new Error('Wompi no devolvió la URL de pago'); }
    window.location.assign(url); // → pantalla de pago alojada por Wompi
  } catch (e) {
    hideWompiLoadingOverlay();
    throw new Error(e && e.message ? e.message : 'No se pudo iniciar el pago con Wompi');
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
