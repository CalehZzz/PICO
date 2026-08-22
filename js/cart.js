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
// Disponible en domicilio y en retiro en sucursal. Cloud Function: 'crearEnlaceWompi'.

// ═══════════════════════════════════════════════════
//  CART  (con persistencia en localStorage)
// ═══════════════════════════════════════════════════
// Claves: productId  ó  productId::colorId  (colores con stock compartido del raíz).
const CART_COLOR_SEP = '::';

function makeCartKey(productId, colorId) {
  if (!colorId) return productId;
  return productId + CART_COLOR_SEP + colorId;
}
function parseCartKey(key) {
  const s = String(key == null ? '' : key);
  const i = s.indexOf(CART_COLOR_SEP);
  if (i < 0) return { productId: s, colorId: null };
  return { productId: s.slice(0, i), colorId: s.slice(i + CART_COLOR_SEP.length) || null };
}
function _cartKeyAttr(key) {
  return String(key).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
/** Suma de unidades en carrito de un producto raíz (todos sus colores). */
function cartQtyForProduct(productId) {
  let sum = 0;
  Object.keys(cart || {}).forEach(k => {
    if (parseCartKey(k).productId === productId) sum += (cart[k] || 0);
  });
  return sum;
}
/** Máximo de unidades que puede tener esta línea sin pasar el stock compartido. */
function cartLineMax(productId, cartKey) {
  const stock = stockMap[productId] || 0;
  const others = cartQtyForProduct(productId) - (cart[cartKey] || 0);
  return Math.max(0, stock - others);
}
function findCartColor(productId, colorId) {
  if (!colorId) return null;
  const p = (products || []).find(x => x.id === productId);
  if (!p) return null;
  return (p.groupColors || []).find(c => c && c.id === colorId) || null;
}
/** Nombre para mostrar en admin / pedidos / correos: "LED · Rojo". */
function orderItemDisplayName(item) {
  if (!item) return '';
  const label = item.colorLabel || item.colorName || '';
  return label ? ((item.name || '') + ' · ' + label) : (item.name || '');
}
/** Badge HTML con circulito + etiqueta de color (para detalle de pedido). */
function orderItemColorBadgeHtml(item) {
  if (!item || !(item.colorLabel || item.colorName)) return '';
  const label = item.colorLabel || item.colorName;
  const hex = item.color || '#9ca3af';
  const esc = (typeof _pdEsc === 'function') ? _pdEsc : (s => String(s == null ? '' : s));
  return `<span class="odetail-color"><span class="odetail-swatch" style="--swatch:${esc(hex)}"></span>${esc(label)}</span>`;
}
/** Necesidad de stock agregada por producto raíz (varias líneas color → un doc). */
function cartStockNeedsByProduct() {
  const need = {};
  Object.keys(cart || {}).forEach(k => {
    const { productId } = parseCartKey(k);
    need[productId] = (need[productId] || 0) + (cart[k] || 0);
  });
  return need;
}

// ── Aviso por correo de cada pedido (vía extensión Trigger Email) ──
function sendOrderEmail(orderId, d) {
  const NOTIFY_EMAIL = 'picosvsupport@gmail.com'; // ← correo donde quieres recibir el aviso
  // Etiqueta INTERNA (para el equipo): sí nombra la institución del retiro.
  const _sucInternal = (typeof sucursalInternalLabel === 'function')
    ? sucursalInternalLabel(d.sucursal)
    : (d.sucursal === 'cdb' ? 'Colegio Don Bosco' : d.sucursal === 'udb' ? 'Universidad Don Bosco' : 'Retiro en sucursal');
  const sucLabel = d.tipoEntrega === 'domicilio' ? 'Envío a domicilio' : _sucInternal;
  const finalTotal = d.totalConDescuento != null ? d.totalConDescuento : d.total;

  const rows = d.items.map(i => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${orderItemDisplayName(i)}${i.color ? ` <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${i.color};border:1px solid rgba(0,0,0,.15);vertical-align:middle;margin-left:4px"></span>` : ''}</td>
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
      <h2 style="margin:0 0 4px">Nuevo pedido · ${d.code}</h2>
      <p style="margin:0 0 16px;color:#64748b">${new Date().toLocaleString('es-SV')}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <tr><td style="padding:4px 0;color:#64748b">Cliente</td><td style="padding:4px 0;font-weight:600">${d.name}</td></tr>
        ${d.tipoEntrega === 'domicilio' ? '' : `<tr><td style="padding:4px 0;color:#64748b">Grado / Sección</td><td style="padding:4px 0;font-weight:600">${d.grade} - ${d.section}</td></tr>`}
        ${d.tipoEntrega !== 'domicilio' && d.telefonoRetiro ? `<tr><td style="padding:4px 0;color:#64748b">Teléfono</td><td style="padding:4px 0;font-weight:600">${d.telefonoRetiro}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#64748b">Entrega</td><td style="padding:4px 0;font-weight:600">${sucLabel}</td></tr>
        ${d.visitaInstitucion ? `<tr><td style="padding:4px 0;color:#64748b">Nos visita desde</td><td style="padding:4px 0;font-weight:700;color:#0071e3">${d.visitaInstitucion}</td></tr>` : ''}
        ${d.tipoEntrega === 'domicilio' && d.envio ? `
        <tr><td style="padding:4px 0;color:#64748b">Departamento</td><td style="padding:4px 0;font-weight:600">${d.envio.departamento || ''}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Municipio</td><td style="padding:4px 0;font-weight:600">${d.envio.municipio || ''}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Dirección</td><td style="padding:4px 0;font-weight:600">${d.envio.direccion || ''}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Teléfono</td><td style="padding:4px 0;font-weight:600">${d.envio.telefono || ''}</td></tr>
        ${d.envio.telefono2 ? `<tr><td style="padding:4px 0;color:#64748b">Tel. adicional</td><td style="padding:4px 0;font-weight:600">${d.envio.telefono2}</td></tr>` : ''}
        ${d.envio.referencia ? `<tr><td style="padding:4px 0;color:#64748b">Referencia</td><td style="padding:4px 0;font-weight:600">${d.envio.referencia}</td></tr>` : ''}
        ${d.envio.indicaciones ? `<tr><td style="padding:4px 0;color:#64748b">Indicaciones</td><td style="padding:4px 0;font-weight:600">${d.envio.indicaciones}</td></tr>` : ''}` : ''}
        ${d.metodoPago ? `<tr><td style="padding:4px 0;color:#64748b">Método de pago</td><td style="padding:4px 0;font-weight:600">${d.metodoPago === 'tarjeta' ? 'Tarjeta' : 'Efectivo'}</td></tr>` : ''}
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
        <tr><td colspan="3" style="padding:6px 10px;text-align:right">Envío a domicilio</td>
            <td style="padding:6px 10px;text-align:right">$${(d.envioCosto).toFixed(2)}</td></tr>` : ''}
        <tr><td colspan="3" style="padding:10px;text-align:right;font-weight:700;font-size:16px;border-top:2px solid #0f172a">TOTAL</td>
            <td style="padding:10px;text-align:right;font-weight:700;font-size:16px;border-top:2px solid #0f172a">$${(d.tipoEntrega === 'domicilio' && d.totalConEnvio != null ? d.totalConEnvio : finalTotal).toFixed(2)}</td></tr>
      </table>
      <p style="margin-top:16px;color:#94a3b8;font-size:12px">ID del pedido: ${orderId}</p>
    </div>`;

  return db.collection('mail').add({
    to: NOTIFY_EMAIL,
    message: {
      subject: `Nuevo pedido ${d.code} — ${d.name} (${sucLabel})${d.visitaInstitucion ? ' · visita: ' + d.visitaInstitucion : ''}`,
      html,
      text: `Nuevo pedido ${d.code} — ${d.name}${d.visitaInstitucion ? ' · visita: ' + d.visitaInstitucion : ''}`
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
  const creditsUsed = Math.max(0, Number(d.creditsUsed) || 0);

  const items = (d.items || []).map(it => {
    const sub = +((it.price || 0) * (it.qty || 0)).toFixed(2);
    return {
      productName: orderItemDisplayName(it),
      qty: it.qty,
      precioUnit: +(it.price || 0).toFixed(2),
      subtotal: sub,
      total: +(sub * discFactor).toFixed(2),
      descPct: discPct, descNombre: d.discountName || '',
      colorId: it.colorId || null,
      colorLabel: it.colorLabel || null,
      color: it.color || null
    };
  });
  const unidades = items.reduce((s, it) => s + (it.qty || 0), 0);
  const subtotal = +(d.total).toFixed(2);
  // Total de productos (con descuento si aplica), SIN envío.
  const totalProductos = (typeof d.totalConDescuento === 'number') ? +d.totalConDescuento.toFixed(2) : subtotal;
  // Créditos restan del total de productos (1 crédito = $1).
  const totalTrasCreditos = +Math.max(0, totalProductos - creditsUsed).toFixed(2);
  // Envío cobrado (solo domicilio): se SUMA al total de la factura, igual que lo paga el cliente.
  const envioCosto = (d.tipoEntrega === 'domicilio' && typeof d.envioCosto === 'number') ? +d.envioCosto.toFixed(2) : 0;
  // Total de la factura = productos (con descuento − créditos) + envío cobrado.
  const total = +(totalTrasCreditos + envioCosto).toFixed(2);
  // El stock y las estadísticas de 'domicilio' viven en CDB → su factura va bajo CDB.
  const facSucursal = (d.sucursal === 'exsal') ? 'exsal' : 'cdb';

  const facRef  = db.collection('facturas').doc();
  const metaRef = db.collection('estadisticas').doc('_meta');
  let seq = 0, numFactura = '';

  await db.runTransaction(async t => {
    const metaSnap = await t.get(metaRef);
    const orderSnap = await t.get(db.collection('pedidos').doc(orderId));
    // Idempotencia: si el pedido ya tiene factura, no crear otra.
    if (orderSnap.exists) {
      const od = orderSnap.data() || {};
      if (od.facturaId && od.facturaNum) {
        seq = null;
        numFactura = od.facturaNum;
        return;
      }
    }
    seq = ((metaSnap.exists && metaSnap.data().facturaSeq) || 0) + 1;
    numFactura = 'FAC-' + String(seq).padStart(5, '0');
    t.set(facRef, {
      numero: seq, numFactura, sucursal: facSucursal,
      cliente: d.name || '', clienteEmail: d.email || '',
      seller: 'tienda-online',
      date: fecha, timestamp: ts, mes,
      subtotal, totalProductos, creditsUsed, envioCosto, total, unidades, items,
      tipoEntrega: d.tipoEntrega || 'pickup',
      fromOrder: orderId, origen: 'tienda',
      anulada: false   // Las facturas NUNCA se borran; al cancelar el pedido se marcan como anuladas.
    });
    t.set(metaRef, { facturaSeq: seq, updatedAt: ts }, { merge: true });
    t.update(db.collection('pedidos').doc(orderId), { facturaId: facRef.id, facturaNum: numFactura });
  });

  if (seq == null) {
    return { numFactura, facturaId: null, already: true };
  }

  // Correo al cliente con los DATOS de la factura (sin adjuntos ni imágenes).
  if (d.email) {
    const filas = items.map(i => `<tr>
        <td style="padding:7px 0;border-bottom:1px solid #eef5fb">${i.productName}</td>
        <td style="padding:7px 0;border-bottom:1px solid #eef5fb;text-align:center">${i.qty}</td>
        <td style="padding:7px 0;border-bottom:1px solid #eef5fb;text-align:right">$${i.total.toFixed(2)}</td>
      </tr>`).join('');
    const descRow = subtotal !== totalProductos
      ? `<p style="margin:10px 0 0;text-align:right;color:#4a89b0;font-size:13px">Subtotal: $${subtotal.toFixed(2)} &middot; Descuento: -$${(subtotal-totalProductos).toFixed(2)}</p>`
      : '';
    const creditsRowMail = creditsUsed
      ? `<p style="margin:6px 0 0;text-align:right;color:#0d9488;font-size:13px">Créditos PICO: -$${creditsUsed.toFixed(2)}</p>`
      : '';
    const envioRowMail = envioCosto
      ? `<p style="margin:6px 0 0;text-align:right;color:#4a89b0;font-size:13px">Envío a domicilio: $${envioCosto.toFixed(2)}</p>`
      : '';
    try {
      await db.collection('mail').add({
        to: d.email,
        message: {
          subject: `Factura ${numFactura} — PICO Electrónica`,
          html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#0f3f63">
  <div style="background:#4aa8e8;color:#fff;padding:18px 20px;border-radius:10px 10px 0 0">
    <div style="font-size:20px;font-weight:700">PICO Electrónica</div>
    <div style="font-size:13px;opacity:.92">Factura ${numFactura}</div>
  </div>
  <div style="border:1px solid #e2eef7;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px">
    <p style="margin:0 0 4px">¡Gracias por tu compra, <b>${d.name || ''}</b>!</p>
    <p style="margin:0 0 14px;color:#4a89b0;font-size:13px">Pedido <b>${d.code}</b> &middot; ${fecha}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="color:#4a89b0;font-size:12px">
        <th style="padding:6px 0;border-bottom:2px solid #e2eef7;text-align:left">Producto</th>
        <th style="padding:6px 0;border-bottom:2px solid #e2eef7;text-align:center">Cant.</th>
        <th style="padding:6px 0;border-bottom:2px solid #e2eef7;text-align:right">Total</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>
    ${descRow}
    ${creditsRowMail}
    ${envioRowMail}
    <p style="margin:8px 0 0;text-align:right;font-size:17px;font-weight:700">TOTAL: $${total.toFixed(2)}</p>
    <p style="margin:18px 0 0;color:#94a3b8;font-size:12px">Este es un correo automático, por favor no respondas a esta dirección.</p>
  </div>
</div>`,
          text: `Factura ${numFactura} — Pedido ${d.code} — Total $${total.toFixed(2)}`
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

function addToCart(id, colorId) {
  if (typeof requireSucursalForCart === 'function' && !requireSucursalForCart()) return;
  const p = products.find(x => x.id === id);
  if (!p) return;
  // Productos con groupColors: hace falta elegir color (modal) si no viene.
  const hasColors = p.groupColors && p.groupColors.length > 0;
  if (hasColors && !colorId) {
    if (typeof openProductDetail === 'function') openProductDetail(id);
    else showToast('Elegí un color');
    return;
  }
  if (hasColors && colorId) {
    const c = findCartColor(id, colorId);
    if (!c || c.enabled === false) { showToast('Color no disponible'); return; }
  }
  const key = makeCartKey(id, colorId || null);
  const lineMax = cartLineMax(id, key);
  if (lineMax < 1) { showToast('Sin stock disponible'); return; }
  const prodPct = (typeof getProductDiscountPct === 'function') ? getProductDiscountPct(p) : 0;
  // No combinar oferta de producto con descuento de carrito (código/asignado/sellos)
  if (prodPct > 0 && selectedDiscount) {
    selectedDiscount = null;
    showToast('Se quitó el descuento del carrito: no se combina con ofertas');
  } else if (prodPct <= 0 && selectedDiscount && typeof cartHasProductDiscount === 'function' && cartHasProductDiscount()) {
    showToast('No se puede combinar descuento de carrito con ofertas de producto');
    return;
  }
  const fromBtn = document.querySelector('#addZone_' + id + ' .add-btn')
    || document.querySelector('#addZoneModal_' + id + ' .add-btn');
  if (!cart[key]) cart[key] = 1;
  saveCart();
  updateCartUI();
  // Animación de vuelo solo en modo Descuentos
  if (typeof discountMode !== 'undefined' && discountMode && fromBtn) {
    playAddToCartAnim(fromBtn);
  }
  updateAddZone(id, colorId || null);
  const cLabel = hasColors ? (findCartColor(id, colorId) || {}).label : '';
  showToast(cLabel ? ('Agregado: ' + cLabel) : 'Agregado al carrito');
}

/** Animación dopamínica: el + vuela al botón del carrito y este hace bump. */
function playAddToCartAnim(fromEl) {
  const cartBtn = document.querySelector('.cart-btn');
  if (!fromEl || !cartBtn) return;
  const a = fromEl.getBoundingClientRect();
  const b = cartBtn.getBoundingClientRect();
  if (!a.width || !b.width) return;

  const flyer = document.createElement('div');
  flyer.className = 'cart-flyer';
  flyer.textContent = '+';
  flyer.setAttribute('aria-hidden', 'true');
  const x0 = a.left + a.width / 2;
  const y0 = a.top + a.height / 2;
  const x1 = b.left + b.width / 2;
  const y1 = b.top + b.height / 2;
  flyer.style.left = x0 + 'px';
  flyer.style.top = y0 + 'px';
  document.body.appendChild(flyer);

  // Forzar layout y luego volar
  void flyer.offsetWidth;
  flyer.style.transform = 'translate(' + (x1 - x0) + 'px,' + (y1 - y0) + 'px) scale(.4)';
  flyer.style.opacity = '0.15';

  window.setTimeout(function () {
    flyer.remove();
    cartBtn.classList.remove('cart-btn-bump');
    void cartBtn.offsetWidth;
    cartBtn.classList.add('cart-btn-bump');
    window.setTimeout(function () { cartBtn.classList.remove('cart-btn-bump'); }, 560);
  }, 560);
}

function cartInc(key) {
  const { productId, colorId } = parseCartKey(key);
  const max = cartLineMax(productId, key);
  if ((cart[key] || 0) >= max) { showToast('Stock máximo alcanzado'); return; }
  cart[key] = (cart[key] || 0) + 1;
  saveCart(); updateCartUI(); updateAddZone(productId, colorId);
}

function cartDec(key) {
  const { productId, colorId } = parseCartKey(key);
  cart[key] = (cart[key] || 0) - 1;
  if (cart[key] <= 0) delete cart[key];
  saveCart(); updateCartUI(); updateAddZone(productId, colorId);
}

function cartSetVal(key, val) {
  const { productId, colorId } = parseCartKey(key);
  const n = parseInt(val);
  if (isNaN(n) || n <= 0) { delete cart[key]; }
  else { cart[key] = Math.min(n, cartLineMax(productId, key)); }
  saveCart(); updateCartUI(); updateAddZone(productId, colorId);
}

// oninput: actualiza la cantidad EN VIVO mientras se teclea, SIN re-renderizar el
// selector de cantidad (así el <input> no se destruye y no se pierde el foco tras
// escribir un dígito). La normalización final (clamp + re-render) ocurre en el
// evento 'change' (blur / Enter) vía cartSetVal.
function cartTypeVal(key, val) {
  const { productId } = parseCartKey(key);
  const raw = String(val).trim();
  if (raw === '') return;                 // permitir borrar para reescribir sin sacar el producto
  let n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return;          // ignorar estados intermedios inválidos mientras teclea
  const max = cartLineMax(productId, key);
  if (max > 0 && n > max) n = max;        // no exceder el stock compartido
  cart[key] = n;
  saveCart();
  updateCartUI();                          // actualiza badge/total/envío/lista, pero NO toca las add-zones
}

function changeQty(key, d) {
  const { productId, colorId } = parseCartKey(key);
  // Al incrementar desde el carrito, respetar el stock compartido del raíz
  if (d > 0 && (cart[key] || 0) + d > cartLineMax(productId, key)) {
    showToast('Stock máximo alcanzado');
    return;
  }
  cart[key] = (cart[key] || 0) + d;
  if (cart[key] <= 0) delete cart[key];
  if (!Object.keys(cart).length) selectedDiscount = null;
  saveCart(); updateCartUI(); updateAddZone(productId, colorId);
}

function removeFromCart(key) {
  const { productId, colorId } = parseCartKey(key);
  delete cart[key];
  if (!Object.keys(cart).length) selectedDiscount = null;
  saveCart(); updateCartUI(); updateAddZone(productId, colorId);
}

function updateCartUI() {
  const rawTotal = getCartRawTotal();
  const total    = getCartTotal();
  const count = Object.values(cart).reduce((s, n) => s + n, 0);

  const badge = document.getElementById('cartBadge');
  badge.textContent = count;
  count > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');

  // Mostrar precio original tachado si hay descuento (créditos solo en checkout)
  const totalEl = document.getElementById('cartTotal');
  const listTotal = (typeof getCartListTotal === 'function') ? getCartListTotal() : rawTotal;
  // En el carrito NO mostramos créditos: solo descuento de productos/códigos ya reflejado en total.
  // El payable con créditos se ve en checkout.
  const cartDisplayTotal = total;
  if (listTotal > cartDisplayTotal + 0.001) {
    totalEl.innerHTML = `<span style="text-decoration:line-through;color:var(--g400);font-size:.88rem;font-weight:500">$${listTotal.toFixed(2)}</span> <span style="color:var(--b600)">$${cartDisplayTotal.toFixed(2)}</span>`;
  } else {
    totalEl.textContent = '$' + cartDisplayTotal.toFixed(2);
  }
  // Quitar nota de créditos del carrito (viven solo en checkout)
  const credNote = document.getElementById('cartCreditsNote');
  if (credNote) credNote.remove();

  // Barra de progreso de envío + recomendaciones (solo entrega a domicilio)
  renderShippingProgress();
  // Línea explícita del envío que se paga AHORA + total con envío (solo domicilio)
  renderCartShippingLine();

  const el = document.getElementById('cartItems');
  if (!Object.keys(cart).length) {
    el.innerHTML = `<div class="empty-cart"><div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg></div><p>Tu carrito está vacío</p></div>`;
    return;
  }
  el.innerHTML = Object.keys(cart).map(key => {
    const { productId, colorId } = parseCartKey(key);
    const p = products.find(x => x.id === productId);
    if (!p) return '';
    const qty = cart[key] || 0;
    const color = colorId ? findCartColor(productId, colorId) : null;
    const colorLabel = color ? color.label : '';
    const thumbSrc = (color && color.imageUrl) || p.img || '';
    const unitSale = (typeof getProductSalePrice === 'function') ? getProductSalePrice(p) : p.price;
    const prodPct = (typeof getProductDiscountPct === 'function') ? getProductDiscountPct(p) : 0;
    const priceHtml = prodPct > 0
      ? `<div class="citem-price"><span style="text-decoration:line-through;color:var(--g400);font-size:.78rem;font-weight:500;margin-right:6px">$${(p.price * qty).toFixed(2)}</span>$${(unitSale * qty).toFixed(2)}</div>`
      : `<div class="citem-price">$${(unitSale * qty).toFixed(2)}</div>`;
    const thumbHtml = thumbSrc
      ? `<div class="citem-emoji" style="overflow:hidden;padding:0"><img src="${thumbSrc}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:9px" onerror="this.parentElement.innerHTML='${p.e}'"></div>`
      : `<div class="citem-emoji">${p.e}</div>`;
    const colorHtml = colorLabel
      ? `<div class="citem-color"><span class="citem-swatch" style="--swatch:${color.color || '#9ca3af'}"></span>${colorLabel}</div>`
      : '';
    const kAttr = _cartKeyAttr(key);
    return `<div class="citem">
      ${thumbHtml}
      <div class="citem-info">
        <div class="citem-name">${p.name}${prodPct > 0 ? ` <span style="color:#e57373;font-size:.72rem;font-weight:800">−${prodPct}%</span>` : ''}</div>
        ${colorHtml}
        ${priceHtml}
      </div>
      <div class="cqty">
        <button class="cqbtn" onclick="changeQty('${kAttr}', -1)">−</button>
        <span class="cqval">${qty}</span>
        <button class="cqbtn" onclick="changeQty('${kAttr}', +1)">+</button>
      </div>
      <button class="rmbtn" onclick="removeFromCart('${kAttr}')"></button>
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
    headline = `<span class="ship-free">¡Ya tenés envío <b>GRATIS</b>!</span>`;
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

  // Recomendaciones compactas (máx. 2) para no comerse el preview en móvil
  const recsHtml = pg.nextMin ? renderShipRecs(pg.remaining) : '';

  el.innerHTML = `
    <div class="ship-progress ship-progress-compact">
      <div class="ship-top">
        <span class="ship-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span>
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
  // Disponibles: con stock libre (descontando lo que ya está en el carrito, todos los colores).
  const avail = products.filter(p => {
    const stock  = stockMap[p.id] || 0;
    const inCart = cartQtyForProduct(p.id);
    return (stock - inCart) > 0 && p.price > 0;
  });
  if (!avail.length) return '';
  // 1) Los que cruzan el umbral de un solo golpe (precio ≥ falta), del más barato al más caro.
  const crossers = avail.filter(p => p.price >= gap).sort((a, b) => a.price - b.price);
  // 2) Rellenadores (precio < falta), del más caro al más barato (acercan más rápido).
  const fillers  = avail.filter(p => p.price <  gap).sort((a, b) => b.price - a.price);
  const recs = [...crossers, ...fillers].slice(0, 2);
  if (!recs.length) return '';

  const chips = recs.map(p => {
    const thumb = p.img
      ? `<span class="ship-rec-thumb" style="padding:0"><img src="${p.img}" alt="" onerror="this.parentElement.innerHTML='${p.e || ''}'"></span>`
      : `<span class="ship-rec-thumb">${p.e || ''}</span>`;
    const nameShort = p.name.length > 16 ? p.name.slice(0, 15) + '…' : p.name;
    return `<button class="ship-rec" onclick="shipRecAdd('${p.id}')" title="Agregar ${p.name} · $${p.price.toFixed(2)}">
        ${thumb}
        <span class="ship-rec-info">
          <span class="ship-rec-name">${nameShort}</span>
          <span class="ship-rec-price">$${p.price.toFixed(2)}</span>
        </span>
        <span class="ship-rec-add">+</span>
      </button>`;
  }).join('');

  return `<div class="ship-recs-lbl">+ para bajar envío</div>
          <div class="ship-recs">${chips}</div>`;
}

// Agregar (o incrementar) un producto recomendado desde la barra de envío.
function shipRecAdd(id) {
  const p = products.find(x => x.id === id);
  // Con colores: abrir modal para elegir (pueden pedirse varios a la vez).
  if (p && p.groupColors && p.groupColors.length) {
    if (typeof openProductDetail === 'function') openProductDetail(id);
    return;
  }
  const key = makeCartKey(id, null);
  if (cart[key]) cartInc(key);
  else addToCart(id);
}

// Línea clara del envío que se paga AHORA + total con envío (solo domicilio).
// Aparece en el pie del carrito, debajo del subtotal, para que no haya dudas
// de cuánto se cobra de envío en este momento.
function renderCartShippingLine() {
  const el = document.getElementById('cartShippingLine');
  if (!el) return;
  const esDomicilio = selectedSucursal === 'domicilio';
  const subtotal    = getCartTotal();
  if (!esDomicilio || subtotal <= 0) { el.style.display = 'none'; el.innerHTML = ''; return; }

  const envio         = getShippingCost(subtotal);
  const totalConEnvio = +(subtotal + envio).toFixed(2);
  const esGratis      = envio === 0;

  el.style.display = 'block';
  el.innerHTML = `
    <div class="cship-line">
      <span class="cship-line-lbl">Envío actual</span>
      <span class="cship-line-val ${esGratis ? 'free' : ''}">${esGratis ? '¡GRATIS!' : '$' + envio.toFixed(2)}</span>
    </div>
    <div class="cship-line cship-total-line">
      <span class="cship-line-lbl">Total con envío</span>
      <span class="cship-line-val total">$${totalConEnvio.toFixed(2)}</span>
    </div>`;
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
function refreshCheckoutSummary() {
  const el = document.getElementById('checkoutSummary');
  if (!el || !Object.keys(cart).length) return;

  const items = Object.keys(cart).map(key => {
    const { productId, colorId } = parseCartKey(key);
    const p = products.find(x => x.id === productId);
    if (!p) return '';
    const color = colorId ? findCartColor(productId, colorId) : null;
    const colorBadge = color
      ? `<span class="odetail-color"><span class="odetail-swatch" style="--swatch:${color.color || '#9ca3af'}"></span>${color.label || ''}</span>`
      : '';
    const unitSale = (typeof getProductSalePrice === 'function') ? getProductSalePrice(p) : p.price;
    return `<div class="odetail-item">
      <div>
        <div class="odetail-item-name">${p.e} ${p.name}${colorBadge}</div>
        <div class="odetail-item-sub">$${unitSale.toFixed(2)} × ${cart[key]}</div>
      </div>
      <div class="odetail-item-price">$${(unitSale * cart[key]).toFixed(2)}</div>
    </div>`;
  }).join('');

  const listTotal   = (typeof getCartListTotal === 'function') ? getCartListTotal() : getCartRawTotal();
  const rawTotal    = getCartRawTotal();
  const finalTotal  = getCartTotal();
  const esDomicilio = (getSavedProfile().sucursal || selectedSucursal) === 'domicilio';
  const creditsAmt  = (!selectedDiscount && typeof getCreditsAppliedAmount === 'function')
    ? getCreditsAppliedAmount(finalTotal) : 0;
  const payableProducts = +Math.max(0, finalTotal - creditsAmt).toFixed(2);
  const envioCosto  = esDomicilio ? getShippingCost(finalTotal) : 0;
  const grandTotal  = +(payableProducts + envioCosto).toFixed(2);

  const discountRow = selectedDiscount
    ? `<div class="odetail-subtotal" style="color:var(--green)">
         <span>Descuento (${selectedDiscount.nombre} −${selectedDiscount.porcentaje}%)</span>
         <span>−$${(rawTotal - finalTotal).toFixed(2)}</span>
       </div>`
    : '';
  const creditsRow = creditsAmt > 0
    ? `<div class="odetail-subtotal" style="color:#0d9488">
         <span>Créditos PICO</span>
         <span>−$${creditsAmt.toFixed(2)}</span>
       </div>`
    : '';
  const subtotalRow = (selectedDiscount || creditsAmt > 0 || esDomicilio || listTotal > rawTotal + 0.001)
    ? `<div class="odetail-subtotal"><span>Subtotal productos</span><span>$${rawTotal.toFixed(2)}</span></div>`
    : '';
  const subDescRow = (selectedDiscount && esDomicilio)
    ? `<div class="odetail-subtotal"><span>Subtotal con descuento</span><span>$${finalTotal.toFixed(2)}</span></div>`
    : '';
  const envioRow = esDomicilio
    ? `<div class="odetail-subtotal"><span>Envío a domicilio</span><span>${envioCosto === 0 ? 'GRATIS' : '$' + envioCosto.toFixed(2)}</span></div>`
    : '';

  el.innerHTML = `
    <div class="osumtitle">Resumen del pedido</div>
    <div class="odetail-list" style="gap:4px">${items}
      ${subtotalRow}
      ${discountRow}
      ${subDescRow}
      ${creditsRow}
      ${envioRow}
      <div class="odetail-subtotal" style="font-weight:700;color:var(--b600)">
        <span>Total${esDomicilio ? ' con envío' : ((selectedDiscount || creditsAmt) ? ' a pagar' : '')}</span><span>$${grandTotal.toFixed(2)}</span>
      </div>
    </div>`;
}

function openCheckout() {
  if (!currentUser) {
    closeCart();
    toggleAuth();
    showToast('Inicia sesión para hacer un pedido');
    return;
  }
  if (!Object.keys(cart).length) { showToast('El carrito está vacío'); return; }
  closeCart();

  refreshCheckoutSummary();
  if (typeof renderCheckoutPromo === 'function') renderCheckoutPromo();
  else if (typeof renderCartDiscountSelector === 'function') renderCartDiscountSelector();

  document.getElementById('studentName').value = currentUser.name || '';
  const saved = getSavedProfile();
  if (saved.grade)   document.getElementById('studentGrade').value   = saved.grade;
  if (saved.section) document.getElementById('studentSection').value = saved.section;

  // Entrega obligatoria (elegida en el modal de entrada / perfil)
  const sucursalInfoEl = document.getElementById('checkoutSucursalInfo');
  if (!saved.sucursal) {
    sucursalInfoEl.innerHTML = `<b>Entrega no configurada.</b> Elegí cómo recibir tu pedido <a href="#" onclick="closeModal('checkoutModal');reopenSucursalGate();return false" style="color:var(--b600);font-weight:600">aquí</a> antes de continuar.`;
    sucursalInfoEl.style.background = '#fee2e2';
    sucursalInfoEl.style.borderColor = '#fca5a5';
    sucursalInfoEl.style.color = '#dc2626';
    document.getElementById('placeOrderBtn').disabled = true;
  } else {
    const esDomicilio = saved.sucursal === 'domicilio';
    // Texto PÚBLICO: genérico, sin nombrar la institución.
    sucursalInfoEl.innerHTML = esDomicilio
      ? `<b>Entrega:</b> Envío a domicilio <span style="font-size:.75rem;color:var(--g400)">(podés cambiarlo con el botón de entrega)</span>`
      : `<b>Entrega:</b> Retiro en sucursal <span style="font-size:.75rem;color:var(--g400)">(podés cambiarlo con el botón de entrega)</span>`;
    sucursalInfoEl.style.background = '';
    sucursalInfoEl.style.borderColor = '';
    sucursalInfoEl.style.color = '';
    document.getElementById('placeOrderBtn').disabled = false;
  }

  // Mostrar/ocultar campos según el tipo de entrega ('domicilio' | 'cdb' | 'udb')
  toggleDeliveryFields(saved.sucursal);

  openModal('checkoutModal');
}

// ── Tipo de entrega: alterna las secciones de envío y pago ──
let selectedPayment = 'tarjeta'; // 'tarjeta' | 'efectivo'

// Alterna los campos del checkout según la entrega:
//   'domicilio' → datos de envío + método de pago
//   'cdb' / 'udb' / retiro → datos académicos/teléfono + método de pago
function toggleDeliveryFields(sucursal) {
  const esDomicilio   = sucursal === 'domicilio';
  const esColegio     = sucursal === 'cdb';
  const esUniversidad = sucursal === 'udb';
  const tieneEntrega  = !!sucursal;
  const ship = document.getElementById('shippingSection');
  const pay  = document.getElementById('paymentSection');
  const academic   = document.getElementById('academicFields');
  const university = document.getElementById('universityFields');
  const cdbPhone   = document.getElementById('cdbPhoneField');
  if (ship) ship.style.display = esDomicilio ? '' : 'none';
  // Método de pago: domicilio y retiro en sucursal
  if (pay)  pay.style.display  = tieneEntrega ? '' : 'none';
  if (academic)   academic.style.display   = esColegio     ? '' : 'none';
  if (cdbPhone)   cdbPhone.style.display   = esColegio     ? '' : 'none';
  if (university) university.style.display = esUniversidad ? '' : 'none';
  const saved = getSavedProfile();
  if (esColegio) {
    const cp = document.getElementById('cdbPhone');
    if (cp && saved.cdbPhone) cp.value = saved.cdbPhone;
  }
  if (esUniversidad) {
    const up = document.getElementById('uniPhone');
    if (up && saved.uniPhone) up.value = saved.uniPhone;
  }
  if (esDomicilio) {
    // Prefijar datos de envío guardados (si existen)
    if (saved.shipPhone)      document.getElementById('shipPhone').value      = saved.shipPhone;
    if (saved.shipPhone2)     document.getElementById('shipPhone2').value     = saved.shipPhone2;
    if (saved.shipDepartment) document.getElementById('shipDepartment').value = saved.shipDepartment;
    if (saved.shipCity)       document.getElementById('shipCity').value       = saved.shipCity;
    if (saved.shipAddress)    document.getElementById('shipAddress').value    = saved.shipAddress;
    if (saved.shipRef)        document.getElementById('shipRef').value        = saved.shipRef;
    if (saved.shipNotes)      document.getElementById('shipNotes').value      = saved.shipNotes;
  }
  if (tieneEntrega) selectPayment(selectedPayment); // re-aplicar estado visual del método de pago
}

// ── Selección de método de pago (tarjeta / efectivo) ──
function selectPayment(method) {
  selectedPayment = method;
  const card = document.getElementById('payCard');
  const cash = document.getElementById('payCash');
  const cardFields = document.getElementById('cardFields');
  const cashNote   = document.getElementById('cashNote');
  const cashText   = document.getElementById('cashNoteText');
  if (!card || !cash) return;
  card.classList.toggle('active', method === 'tarjeta');
  cash.classList.toggle('active', method === 'efectivo');
  if (cardFields) cardFields.style.display = method === 'tarjeta' ? '' : 'none';
  if (cashNote)   cashNote.style.display   = method === 'efectivo' ? '' : 'none';
  if (cashText) {
    const esDom = (typeof getSavedProfile === 'function' && getSavedProfile().sucursal === 'domicilio');
    cashText.textContent = esDom
      ? 'Pagarás en efectivo al momento de recibir tu pedido.'
      : 'Pagarás en efectivo al retirar tu pedido en sucursal.';
  }
}

async function placeOrder() {
  const name    = document.getElementById('studentName').value.trim();

  // Sucursal desde perfil (obligatoria)
  const savedProfile = getSavedProfile();
  const sucursal = savedProfile.sucursal || null;
  if (!sucursal) {
    showToast('Configura tu sucursal en tu perfil');
    closeModal('checkoutModal');
    showPage('profile');
    return;
  }

  // Campos por tipo de entrega:
  //   Colegio Don Bosco ('cdb') → Grado + Sección
  //   Universidad Don Bosco ('udb') → Teléfono
  //   Domicilio → datos de envío (más abajo)
  const esDomicilioEntrega = sucursal === 'domicilio';
  const esColegio     = sucursal === 'cdb';
  const esUniversidad = sucursal === 'udb';
  const grade    = esColegio ? document.getElementById('studentGrade').value   : '';
  const section  = esColegio ? document.getElementById('studentSection').value : '';
  const cdbPhone = esColegio ? (document.getElementById('cdbPhone').value || '').trim() : '';
  const uniPhone = esUniversidad ? (document.getElementById('uniPhone').value || '').trim() : '';
  if (!name) { showToast('Ingresa tu nombre completo'); return; }
  if (esColegio && (!grade || !section || !cdbPhone)) { showToast('Completa grado, sección y teléfono'); return; }
  if (esUniversidad && !uniPhone) { showToast('Ingresa tu teléfono'); return; }
  // Institución de "Otros" (se atiende como domicilio): viaja en el correo al equipo.
  const visitaInstitucion = esDomicilioEntrega
    ? ((savedProfile.visitaInstitucion || '').trim() || (function(){ try { return localStorage.getItem(OTROS_KEY) || ''; } catch(_) { return ''; } })())
    : '';
  // Guardar el teléfono de universidad en el perfil para futuros pedidos
  if (esUniversidad && uniPhone) {
    try {
      const k = 'el_profile_' + currentUser.uid;
      const pf = JSON.parse(localStorage.getItem(k) || '{}');
      pf.uniPhone = uniPhone;
      localStorage.setItem(k, JSON.stringify(pf));
      if (typeof saveProfileToCloud === 'function') saveProfileToCloud({ uniPhone });
    } catch (_) {}
  }
  // Guardar el teléfono de Colegio Don Bosco en el perfil para futuros pedidos
  if (esColegio && cdbPhone) {
    try {
      const k = 'el_profile_' + currentUser.uid;
      const pf = JSON.parse(localStorage.getItem(k) || '{}');
      pf.cdbPhone = cdbPhone;
      localStorage.setItem(k, JSON.stringify(pf));
      if (typeof saveProfileToCloud === 'function') saveProfileToCloud({ cdbPhone });
    } catch (_) {}
  }

  // ── Datos de envío (solo domicilio) + método de pago (todos los tipos) ──
  const esDomicilio = sucursal === 'domicilio';
  let envio = null;
  let metodoPago = selectedPayment; // 'tarjeta' | 'efectivo'
  if (!['tarjeta', 'efectivo'].includes(metodoPago)) {
    showToast('Selecciona un método de pago');
    return;
  }
  if (esDomicilio) {
    const telefono     = document.getElementById('shipPhone').value.trim();
    const telefono2    = document.getElementById('shipPhone2').value.trim();
    const departamento = document.getElementById('shipDepartment').value;
    const municipio    = document.getElementById('shipCity').value.trim();
    const direccion    = document.getElementById('shipAddress').value.trim();
    const referencia   = document.getElementById('shipRef').value.trim();
    const indicaciones = document.getElementById('shipNotes').value.trim();
    if (!telefono || !departamento || !municipio || !direccion || !referencia) {
      showToast('Completa todos los datos de envío obligatorios');
      return;
    }
    envio = { nombre: name, telefono, telefono2, departamento, municipio, direccion, referencia, indicaciones };
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
      // Guardar también en la nube (cross-device)
      if (typeof saveProfileToCloud === 'function') saveProfileToCloud({
        shipPhone: telefono, shipPhone2: telefono2,
        shipDepartment: departamento, shipCity: municipio,
        shipAddress: direccion, shipRef: referencia, shipNotes: indicaciones
      });
    } catch (_) {}
  }

  // Validar stock local (agregado por producto raíz: colores comparten stock)
  const localNeed = cartStockNeedsByProduct();
  for (const id of Object.keys(localNeed)) {
    if ((stockMap[id] || 0) < (localNeed[id] || 0)) {
      const p = products.find(x => x.id === id);
      showToast('Stock insuficiente: ' + (p?.name || id));
      return;
    }
  }

  const btn = document.getElementById('placeOrderBtn');
  btn.disabled    = true;
  btn.textContent = 'Guardando...';

  const code  = genCode();
  const items = Object.keys(cart).map(key => {
    const { productId, colorId } = parseCartKey(key);
    const p = products.find(x => x.id === productId);
    const prodPct = (typeof getProductDiscountPct === 'function') ? getProductDiscountPct(p) : 0;
    const unit = (typeof getProductSalePrice === 'function') ? getProductSalePrice(p) : p.price;
    const color = colorId ? findCartColor(productId, colorId) : null;
    const line = {
      id: productId,
      name: p.name,
      qty: cart[key],
      price: unit,
      listPrice: p.price,
      productDiscPct: prodPct > 0 ? prodPct : null,
      cost: p.cost
    };
    // Color pedido (stock compartido del raíz): lo ve el admin en el detalle.
    if (color) {
      line.colorId = color.id;
      line.colorLabel = color.label || '';
      line.color = color.color || '';
    }
    return line;
  });
  const listTotal  = items.reduce((s, i) => s + i.qty * (i.listPrice != null ? i.listPrice : i.price), 0);
  const rawTotal   = items.reduce((s, i) => s + i.qty * i.price, 0); // tras oferta de producto
  const finalTotal = (typeof getCartTotal === 'function')
    ? getCartTotal()
    : (selectedDiscount
      ? +(rawTotal * (1 - selectedDiscount.porcentaje / 100)).toFixed(2)
      : +rawTotal.toFixed(2));

  // Capturamos el % de descuento ANTES de resetear selectedDiscount (se usa más abajo en el pago).
  const pagoDiscPct = selectedDiscount ? selectedDiscount.porcentaje : 0;
  const discFields  = (typeof buildDiscountOrderFields === 'function')
    ? buildDiscountOrderFields()
    : {
        totalConDescuento: selectedDiscount ? finalTotal : null,
        discountId: selectedDiscount ? selectedDiscount.id : null,
        discountName: selectedDiscount ? selectedDiscount.nombre : null,
        discountPct: selectedDiscount ? selectedDiscount.porcentaje : null,
        discountCode: null, discountCodeId: null, stampCardCode: null, discountSource: null
      };
  if (selectedDiscount) discFields.totalConDescuento = finalTotal;
  else discFields.totalConDescuento = null;

  // Revalidar código/sellos justo antes de crear el pedido (evita canjes inválidos)
  try {
    if (selectedDiscount && selectedDiscount.source === 'code') {
      await validarCodigoDescuento(selectedDiscount.code, rawTotal);
    }
    if (selectedDiscount && selectedDiscount.source === 'stamp') {
      if (!stampRewardAvailable(userStampCard) || userStampCard.code !== selectedDiscount.id) {
        throw new Error('Tu tarjeta de sellos ya no tiene el 40% disponible.');
      }
    }
  } catch (e) {
    selectedDiscount = null;
    if (typeof renderCartDiscountSelector === 'function') renderCartDiscountSelector();
    btn.disabled = false;
    btn.textContent = 'Confirmar Pedido';
    showToast(e.message || 'Descuento no válido');
    return;
  }

  // Costo de envío por tramos (según el subtotal de productos, antes de créditos). Solo a domicilio.
  const shipCost = esDomicilio ? getShippingCost(finalTotal) : 0;
  const creditsAmt = (!selectedDiscount && typeof getCreditsAppliedAmount === 'function')
    ? getCreditsAppliedAmount(finalTotal) : 0;
  const payableProducts = +Math.max(0, finalTotal - creditsAmt).toFixed(2);

  try {
    // Inventario ÚNICO: todo descuenta de 'stockCdb' (solo el legado 'exsal' usa stockExsal).
    const stockField = (sucursal === 'exsal') ? 'stockExsal' : 'stockCdb';

    // ── Verificar que haya stock suficiente y descontarlo de forma ATÓMICA, justo antes de crear el pedido ──
    // (aplica a TODO tipo de pedido: tarjeta, efectivo, sucursal o domicilio). Si no alcanza, no se crea el pedido.
    await db.runTransaction(async (tx) => {
      // Una sola resta por producto raíz (varios colores → stock compartido).
      const needById = cartStockNeedsByProduct();
      const ids = Object.keys(needById);
      const snaps = await Promise.all(ids.map(id => tx.get(db.collection('productos').doc(id))));
      // 1) Validar disponibilidad de cada producto
      for (let k = 0; k < ids.length; k++) {
        const snap = snaps[k];
        const need = needById[ids[k]] || 0;
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
          [stockField]: firebase.firestore.FieldValue.increment(-(needById[ids[k]] || 0)),
          updatedAt: Date.now()   // marca el producto como cambiado para el caché incremental
        });
      }
    });

    const docRef = await db.collection('pedidos').add({
      code, name, grade, section, items,
      total:               +rawTotal.toFixed(2),
      totalConDescuento:   discFields.totalConDescuento,
      discountId:          discFields.discountId,
      discountName:        discFields.discountName,
      discountPct:         discFields.discountPct,
      discountCode:        discFields.discountCode,
      discountCodeId:      discFields.discountCodeId,
      stampCardCode:       discFields.stampCardCode,
      discountSource:      discFields.discountSource,
      descuentoConsumido:  false,
      stampApplied:        false,
      sucursal:    sucursal,
      tipoEntrega: esDomicilio ? 'domicilio' : 'pickup',
      uniTelefono: uniPhone || null,               // teléfono para retiro en Universidad Don Bosco
      cdbTelefono: cdbPhone || null,               // teléfono para retiro en Colegio Don Bosco
      visitaInstitucion: visitaInstitucion || null, // institución "Otros" (se atiende como domicilio)
      envio:       envio,        // {nombre, telefono, telefono2, departamento, municipio, direccion, referencia, indicaciones} o null
      // Costo de envío y total que paga el cliente (NO afectan stats: 'total' sigue siendo solo productos)
      envioCosto:    shipCost,
      costoEnvioReal: null,      // lo ingresa el admin al confirmar (costo real del courier) — SOLO admin
      totalConEnvio: +(payableProducts + shipCost).toFixed(2),
      payableAfterCredits: payableProducts,
      creditsRequested: creditsAmt > 0 ? creditsAmt : null,
      metodoPago:  metodoPago,   // 'tarjeta' | 'efectivo'
      paymentStatus: metodoPago === 'tarjeta' ? 'pending' : 'efectivo',
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

    // Aplicar créditos en servidor (autoritativo). Si falla, el pedido queda sin créditos.
    let creditsUsedFinal = 0;
    if (creditsAmt > 0 && typeof aplicarCreditosAlPedido === 'function') {
      try {
        const credRes = await aplicarCreditosAlPedido(docRef.id, creditsAmt);
        creditsUsedFinal = Math.max(0, Number(credRes && credRes.creditsUsed) || 0);
      } catch (e) {
        console.warn('aplicarCreditos:', e);
        showToast('No se pudieron aplicar los créditos: ' + (e.message || 'error'));
      }
    }
    creditsToUse = 0;

    // Consumir código promocional / archivar tarjeta de sellos (servidor). No bloquea el pedido.
    if (typeof consumirDescuentoTrasPedido === 'function') {
      consumirDescuentoTrasPedido(docRef.id).catch(e => console.warn('consumirDescuento:', e));
    }

    // Aviso por correo al dueño (no bloquea el pedido si algo falla)
    sendOrderEmail(docRef.id, {
      code, name, grade, section, items,
      total: +rawTotal.toFixed(2),
      totalConDescuento: discFields.totalConDescuento,
      discountName: discFields.discountName,
      discountPct:  discFields.discountPct,
      sucursal,
      tipoEntrega: esDomicilio ? 'domicilio' : 'pickup',
      visitaInstitucion: visitaInstitucion || null,
      telefonoRetiro: cdbPhone || uniPhone || null,
      envio,
      envioCosto:    shipCost,
      totalConEnvio: +(payableProducts + shipCost).toFixed(2),
      creditsUsed: creditsUsedFinal || null,
      metodoPago,
      email: currentUser?.email || null
    }).catch(e => console.warn('No se pudo encolar el correo de aviso:', e));

    // Factura: ESPERAR antes de redirigir a Wompi (domicilio/tarjeta). Antes era fire-and-forget
    // y al navegar se abortaba la escritura → no se creaban facturas de envío a domicilio.
    try {
      await crearYEnviarFacturaPedido(docRef.id, {
        code, name, items,
        total: +rawTotal.toFixed(2),
        totalConDescuento: discFields.totalConDescuento,
        discountName: discFields.discountName,
        discountPct:  discFields.discountPct,
        sucursal,
        tipoEntrega: esDomicilio ? 'domicilio' : 'pickup',
        envioCosto: shipCost,
        creditsUsed: creditsUsedFinal || 0,
        email: currentUser?.email || null
      });
    } catch (e) {
      console.warn('No se pudo crear/enviar la factura del pedido:', e);
    }

    // El stock ya se verificó y descontó en la transacción de arriba (antes de crear el pedido).

    // Incrementar contador de pedidos pendientes en estadísticas (tiempo real, NO se resetea por mes)
    try {
      const statDocId = (sucursal === 'exsal') ? 'ColegioExsal' : 'ColegioDonBosco';
      await db.collection('estadisticas').doc(statDocId).set({
        pedidosPendientes: firebase.firestore.FieldValue.increment(1)
      }, { merge: true });
    } catch (e) { console.warn('No se pudo incrementar pedidosPendientes:', e); }

    // Reflejar el descuento en el stockMap local (agregado por raíz)
    const needLocal = cartStockNeedsByProduct();
    Object.keys(needLocal).forEach(id => {
      stockMap[id] = Math.max(0, (stockMap[id] || 0) - (needLocal[id] || 0));
    });

    cart = {};
    myOrdersPaging.page = 0; myOrdersPaging.cursors = []; myOrdersPaging.atEnd = false; // refrescar al crear pedido
    selectedDiscount = null; // Bug 1 fix: resetear descuento seleccionado al completar pedido
    try { localStorage.removeItem('pico_cart'); } catch(_) {}
    if (typeof renderCartDiscountSelector === 'function') renderCartDiscountSelector();
    updateCartUI();
    renderProducts();
    closeModal('checkoutModal');
    document.getElementById('studentGrade').value   = '';
    document.getElementById('studentSection').value = '';
    { const _up = document.getElementById('uniPhone'); if (_up) _up.value = ''; }
    document.getElementById('generatedCode').textContent = code;

    // ─── GENERAR QR (con el diseño publicado en GeneraQR; cae a QR clásico si falla) ───
    const qrContainer = document.getElementById('qr-pedido');
    qrContainer.innerHTML = '';
    const urlQR = `https://picosv.com/?pedido=${docRef.id}`;
    if (typeof QrDesignAPI !== 'undefined') {
      QrDesignAPI.renderStyledQr(qrContainer, urlQR, { size: 140 });
    } else {
      new QRCode(qrContainer, {
        text:         urlQR,
        width:        140,
        height:       140,
        colorDark:    '#0f172a',
        colorLight:   '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    }

    // Mensaje según el tipo de entrega
    const hintEl = document.getElementById('successHint');
    if (hintEl) hintEl.textContent = esDomicilio
      ? 'Te enviaremos el ID de rastreo cuando confirmemos tu pedido.'
      : 'Preséntate en el laboratorio con este código o escanea el QR.';

    // Pago con tarjeta (domicilio o retiro) → crear enlace Wompi y redirigir.
    if (metodoPago === 'tarjeta') {
      btn.textContent = 'Redirigiendo al pago...';
      try {
        const w = await startWompiCheckout(docRef.id);
        if (w && w.fullyCoveredByCredits) {
          openModal('successModal');
        } else {
          return; // la página se redirige a Wompi
        }
      } catch (e) {
        console.error('Wompi checkout:', e);
        showToast((e && e.message ? e.message : 'No se pudo iniciar el pago con tarjeta.') + ' Tu pedido quedó pendiente.');
        openModal('successModal');
      }
    } else {
      openModal('successModal');
    }
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    if (msg.indexOf('STOCK_INSUFICIENTE::') === 0) {
      showToast(msg.replace('STOCK_INSUFICIENTE:: ', ''));
    } else {
      showToast('Error al guardar el pedido: ' + msg);
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
    const data = (res && res.data) || {};
    if (data.fullyCoveredByCredits) {
      hideWompiLoadingOverlay();
      return { fullyCoveredByCredits: true };
    }
    const url = data.url;
    if (!url) { hideWompiLoadingOverlay(); throw new Error('Wompi no devolvió la URL de pago'); }
    window.location.assign(url); // → pantalla de pago alojada por Wompi
    return { redirected: true };
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
  const urlQR = `https://picosv.com/?pedido=${firestoreId}`;
  if (typeof QrDesignAPI !== 'undefined') {
    QrDesignAPI.renderStyledQr(container, urlQR, { size: 160 });
  } else {
    new QRCode(container, {
      text:         urlQR,
      width:        160,
      height:       160,
      colorDark:    '#0f172a',
      colorLight:   '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  }
  openModal('qrViewerModal');
}
