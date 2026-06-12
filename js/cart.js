// ════════════════════════════════════════════════════════════════
// PICO · Carrito y checkout
// ════════════════════════════════════════════════════════════════

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
        <tr><td style="padding:4px 0;color:#64748b">Dirección</td><td style="padding:4px 0;font-weight:600">${d.envio.direccion}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Ciudad</td><td style="padding:4px 0;font-weight:600">${d.envio.ciudad}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Teléfono</td><td style="padding:4px 0;font-weight:600">${d.envio.telefono}</td></tr>
        ${d.envio.referencia ? `<tr><td style="padding:4px 0;color:#64748b">Referencia</td><td style="padding:4px 0;font-weight:600">${d.envio.referencia}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#64748b">Método de pago</td><td style="padding:4px 0;font-weight:600">${d.metodoPago === 'tarjeta' ? '💳 Tarjeta (simulado)' : '💵 Efectivo'}</td></tr>` : ''}
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
        <tr><td colspan="3" style="padding:10px;text-align:right;font-weight:700;font-size:16px;border-top:2px solid #0f172a">TOTAL</td>
            <td style="padding:10px;text-align:right;font-weight:700;font-size:16px;border-top:2px solid #0f172a">$${finalTotal.toFixed(2)}</td></tr>
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

// Carga el logo (mismo origen) como dataURI reducido (máx ~150px) una sola vez,
// para que el PDF pese poco y el documento de correo no supere el límite de Firestore.
let _picoLogoData = null, _picoLogoTried = false;
function loadLogoDataURI() {
  if (_picoLogoData || _picoLogoTried) return Promise.resolve(_picoLogoData);
  return new Promise(resolve => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const max = 150;
          const ow = img.naturalWidth || max, oh = img.naturalHeight || max;
          const scale = Math.min(1, max / Math.max(ow, oh));
          const w = Math.max(1, Math.round(ow * scale));
          const h = Math.max(1, Math.round(oh * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#4aa8e8'; ctx.fillRect(0, 0, w, h); // fondo (el header es azul)
          ctx.drawImage(img, 0, 0, w, h);
          _picoLogoData = c.toDataURL('image/jpeg', 0.82);
        } catch (_) { _picoLogoData = null; }
        _picoLogoTried = true; resolve(_picoLogoData);
      };
      img.onerror = () => { _picoLogoTried = true; resolve(null); };
      img.src = '/logo.png';
    } catch (_) { _picoLogoTried = true; resolve(null); }
  });
}

// Construye el PDF de la factura (mismo diseño que el panel de inventario).
function buildFacturaPDF(doc, fac, logoData) {
  const W = 210, pad = 18;
  const azul = [74,168,232], azulOsc = [23,118,176], gris = [240,248,253], grisL = [197,227,249];
  const negro = [15,63,99], grisT = [74,137,176], blanco = [255,255,255];
  const items = fac.items || [];
  const numFactura = fac.numFactura || ('FAC-' + (fac.numero || ''));
  const fechaHoy = fac.date || new Date().toLocaleDateString('es');
  const sucursalLabel = fac.sucursal === 'exsal' ? 'EXSAL' : fac.sucursal === 'cdb' ? 'CDB' : '—';
  const vendedor = fac.seller || 'Tienda en línea';

  doc.setFillColor(...azul); doc.rect(0, 0, W, 42, 'F');
  if (logoData) { try { doc.addImage(logoData, 'JPEG', pad, 6, 28, 28); } catch (e) {} }
  doc.setFont('helvetica','bold'); doc.setFontSize(22); doc.setTextColor(...blanco);
  doc.text('FACTURA', W - pad, 18, { align:'right' });
  doc.setFontSize(10); doc.setFont('helvetica','normal');
  doc.text(numFactura, W - pad, 25, { align:'right' });
  doc.text('Fecha: ' + fechaHoy, W - pad, 31, { align:'right' });
  doc.text('Sede: ' + sucursalLabel, W - pad, 37, { align:'right' });
  doc.setFontSize(13); doc.setFont('helvetica','bold');
  doc.text('PICO Electrónica', pad + 32, 17);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text('Tienda en línea', pad + 32, 23);

  let y = 52;
  doc.setFillColor(...gris); doc.roundedRect(pad, y, W - pad*2, 32, 3, 3, 'F');
  doc.setDrawColor(...grisL); doc.setLineWidth(0.4); doc.roundedRect(pad, y, W - pad*2, 32, 3, 3, 'S');
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...grisT);
  doc.text('CLIENTE', pad + 5, y + 7); doc.text('ENTREGA', W/2 + 5, y + 7);
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...negro);
  doc.text(fac.cliente || 'Consumidor final', pad + 5, y + 14);
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...grisT);
  if (fac.clienteEmail) doc.text(fac.clienteEmail, pad + 5, y + 20);
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...negro);
  doc.text(fac.tipoEntrega === 'domicilio' ? 'Envío a domicilio' : 'Retiro en sucursal', W/2 + 5, y + 14);
  doc.setFontSize(8); doc.setTextColor(...grisT);
  doc.text('N° ' + numFactura, W/2 + 5, y + 20);
  y += 38;

  const cols = [10, 84, 22, 34, 40];
  const headers = ['#', 'Producto', 'Cant.', 'Precio/ud', 'Subtotal'];
  const colX = [pad, pad+cols[0], pad+cols[0]+cols[1], pad+cols[0]+cols[1]+cols[2], pad+cols[0]+cols[1]+cols[2]+cols[3]];
  function drawHead() {
    doc.setFillColor(...azul); doc.rect(pad, y, W - pad*2, 8, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...blanco);
    headers.forEach((h, i) => { const align = i >= 2 ? 'right' : 'left'; const x = i >= 2 ? colX[i]+cols[i]-2 : colX[i]+2; doc.text(h, x, y + 5.5, { align }); });
    y += 8;
  }
  drawHead();
  items.forEach((it, idx) => {
    if (y > 262) { doc.addPage(); y = 20; drawHead(); }
    const rowBg = idx % 2 === 0 ? blanco : gris;
    doc.setFillColor(...rowBg); doc.rect(pad, y, W - pad*2, 7, 'F');
    doc.setDrawColor(...grisL); doc.setLineWidth(0.2); doc.line(pad, y + 7, W - pad, y + 7);
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...negro);
    doc.text(String(idx + 1), colX[0] + 2, y + 5);
    let nm = it.productName || '';
    if (it.descPct > 0) nm += ' (-' + it.descPct + '%)';
    if (nm.length > 46) nm = nm.slice(0, 44) + '…';
    doc.text(nm, colX[1] + 2, y + 5);
    doc.text(String(it.qty), colX[2] + cols[2] - 2, y + 5, { align:'right' });
    doc.text('$' + (+(it.precioUnit || 0)).toFixed(2), colX[3] + cols[3] - 2, y + 5, { align:'right' });
    doc.text('$' + (+(it.total || 0)).toFixed(2), colX[4] + cols[4] - 2, y + 5, { align:'right' });
    y += 7;
  });

  if (y > 250) { doc.addPage(); y = 20; }
  const hayDesc = (+(fac.subtotal || 0)).toFixed(2) !== (+(fac.total || 0)).toFixed(2);
  if (hayDesc) {
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...grisT);
    doc.text('Subtotal: $' + (+(fac.subtotal || 0)).toFixed(2) + '   ·   Descuentos: -$' + (+((fac.subtotal || 0) - (fac.total || 0))).toFixed(2), W - pad, y + 4, { align:'right' });
    y += 6;
  }
  doc.setFillColor(...azulOsc); doc.rect(pad, y, W - pad*2, 9, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...blanco);
  doc.text('TOTAL', colX[3] + cols[3] - 2, y + 6, { align:'right' });
  doc.text('$' + (+(fac.total || 0)).toFixed(2), colX[4] + cols[4] - 2, y + 6, { align:'right' });
  y += 18;

  if (y > 262) { doc.addPage(); y = 20; }
  doc.setFillColor(...gris); doc.roundedRect(pad, y, W - pad*2, 22, 3, 3, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(...azul);
  doc.text('¡Gracias por tu compra!', W/2, y + 9, { align:'center' });
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...grisT);
  doc.text('En PICO Electrónica valoramos tu confianza. Ante cualquier consulta, contáctanos.', W/2, y + 16, { align:'center' });
  doc.setFontSize(7.5); doc.setTextColor(...grisT);
  doc.text('Documento generado el ' + new Date().toLocaleString('es') + ' · Factura ' + numFactura, W/2, 290, { align:'center' });
}

// Crea la factura secuencial del pedido (colección 'facturas', mismo contador
// '_meta.facturaSeq' que el inventario) y la envía al cliente como PDF adjunto.
// NO bloquea el pedido: cualquier fallo solo se registra en consola.
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
  const total    = (typeof d.totalConDescuento === 'number') ? +d.totalConDescuento.toFixed(2) : subtotal;
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
      subtotal, total, unidades, items,
      tipoEntrega: d.tipoEntrega || 'pickup',
      fromOrder: orderId, origen: 'tienda'
    });
    t.set(metaRef, { facturaSeq: seq, updatedAt: ts }, { merge: true });
    t.update(db.collection('pedidos').doc(orderId), { facturaId: facRef.id, facturaNum: numFactura });
  });

  // Enviar la factura al cliente por correo (Trigger Email). El correo se envía
  // SIEMPRE que haya email; el PDF se adjunta solo si se generó y no excede el
  // límite de tamaño de documento de Firestore (~1 MiB).
  if (d.email) {
    let attachments = [];
    try {
      if (window.jspdf && window.jspdf.jsPDF) {
        const logoData = await loadLogoDataURI();
        const { jsPDF } = window.jspdf;
        const docPdf = new jsPDF({ orientation:'p', unit:'mm', format:'a4' });
        buildFacturaPDF(docPdf, {
          numero: seq, numFactura, sucursal: facSucursal, cliente: d.name,
          clienteEmail: d.email, seller: 'Tienda en línea', date: fecha,
          tipoEntrega: d.tipoEntrega, subtotal, total, items
        }, logoData);
        const base64 = docPdf.output('datauristring').split(',')[1];
        if (base64 && base64.length < 900000) {
          attachments = [{ filename: numFactura + '.pdf', content: base64, encoding: 'base64' }];
        } else {
          console.warn('Factura PDF demasiado grande para adjuntar; se envía el correo sin adjunto.');
        }
      }
    } catch (e) { console.warn('No se pudo generar el PDF de la factura (se envía el correo igual):', e); }

    try {
      const mailDoc = {
        to: d.email,
        from: 'PICO Electrónica <pedidos@picosv.com>',
        replyTo: 'noreply@picosv.com',
        message: {
          subject: `🧾 Tu factura ${numFactura} — PICO Electrónica`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
            <h2 style="margin:0 0 6px">¡Gracias por tu compra, ${d.name || ''}!</h2>
            <p style="margin:0 0 14px;color:#475569">Tu factura <b>${numFactura}</b> del pedido <b>${d.code}</b>${attachments.length ? ' va adjunta en PDF.' : '.'}</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px">
              ${items.map(i => `<tr>
                <td style="padding:5px 0;border-bottom:1px solid #eee">${i.productName} × ${i.qty}</td>
                <td style="padding:5px 0;border-bottom:1px solid #eee;text-align:right">$${i.total.toFixed(2)}</td></tr>`).join('')}
              <tr><td style="padding:8px 0;font-weight:700">TOTAL</td>
                  <td style="padding:8px 0;font-weight:700;text-align:right">$${total.toFixed(2)}</td></tr>
            </table>
            <p style="margin:0;color:#94a3b8;font-size:12px">Este es un correo automático, por favor no respondas a esta dirección.</p>
          </div>`
        }
      };
      if (attachments.length) mailDoc.message.attachments = attachments;
      await db.collection('mail').add(mailDoc);
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
    if (saved.shipAddress) document.getElementById('shipAddress').value = saved.shipAddress;
    if (saved.shipPhone)   document.getElementById('shipPhone').value   = saved.shipPhone;
    if (saved.shipCity)    document.getElementById('shipCity').value    = saved.shipCity;
    if (saved.shipRef)     document.getElementById('shipRef').value     = saved.shipRef;
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
    const direccion  = document.getElementById('shipAddress').value.trim();
    const telefono   = document.getElementById('shipPhone').value.trim();
    const ciudad     = document.getElementById('shipCity').value.trim();
    const referencia = document.getElementById('shipRef').value.trim();
    if (!direccion || !telefono || !ciudad) {
      showToast('⚠️ Completa los datos de envío');
      return;
    }
    envio = { direccion, telefono, ciudad, referencia };
    metodoPago = selectedPayment; // 'tarjeta' | 'efectivo' (pago simulado)
    // Guardar la dirección en el perfil para futuros pedidos
    try {
      const key   = 'el_profile_' + currentUser.uid;
      const prof  = JSON.parse(localStorage.getItem(key) || '{}');
      prof.shipAddress = direccion; prof.shipPhone = telefono;
      prof.shipCity = ciudad;       prof.shipRef = referencia;
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

  try {
    const stockField = (sucursal === 'cdb' || sucursal === 'domicilio') ? 'stockCdb' : 'stockExsal';

    const docRef = await db.collection('pedidos').add({
      code, name, grade, section, items,
      total:               +rawTotal.toFixed(2),
      totalConDescuento:   selectedDiscount ? finalTotal : null,
      discountId:          selectedDiscount ? selectedDiscount.id        : null,
      discountName:        selectedDiscount ? selectedDiscount.nombre    : null,
      discountPct:         selectedDiscount ? selectedDiscount.porcentaje: null,
      sucursal:    sucursal,
      tipoEntrega: esDomicilio ? 'domicilio' : 'pickup',
      envio:       envio,        // {direccion, telefono, ciudad, referencia} o null
      metodoPago:  metodoPago,   // 'tarjeta' | 'efectivo' | null (pago simulado)
      status:      'pending',
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
      email: currentUser?.email || null
    }).catch(e => console.warn('No se pudo crear/enviar la factura del pedido:', e));

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
