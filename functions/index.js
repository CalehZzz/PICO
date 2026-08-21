// ════════════════════════════════════════════════════════════════
// PICO · Cloud Functions  ·  PASARELAS: WOMPI (tarjeta) + OPENNODE (Bitcoin)
//
//  WOMPI EL SALVADOR (tarjeta):
//   1) crearEnlaceWompi (callable) → URL de pago alojada por Wompi
//   2) wompiWebhook (HTTP) → confirma pago y registra estadísticas
//   3) confirmWompiOnAck (onUpdate) → respaldo al volver del checkout
//
//  OPENNODE (Bitcoin Lightning · sandbox/dev o producción):
//   1) crearCargoOpenNode (callable) → factura Lightning + montos USD/BTC
//   2) opennodeWebhook (HTTP) → confirma pago y registra estadísticas
//   3) consultarCargoOpenNode (callable) → respaldo / poll desde el cliente
//   4) getOpenNodeRate (callable) → cotización BTC/USD en tiempo real
//
//  Secretos (Secret Manager):
//     firebase functions:secrets:set WOMPI_APP_ID
//     firebase functions:secrets:set WOMPI_API_SECRET
//     firebase functions:secrets:set OPENNODE_API_KEY
//  Opcional (config/env, no secreto):
//     OPENNODE_ENV = 'dev' (default, sandbox/testnet) | 'live' (mainnet)
// ════════════════════════════════════════════════════════════════

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

// ── Configuración Wompi ──
const WOMPI_ID_BASE  = 'https://id.wompi.sv';   // OAuth (token)
const WOMPI_API_BASE = 'https://api.wompi.sv';  // API de pagos
const WOMPI_FEE_PCT  = 0.035;                    // 3.5% fijo, SIN cargo fijo
const SECRETS = ['WOMPI_APP_ID', 'WOMPI_API_SECRET'];

// ── Configuración OpenNode (Bitcoin Lightning) ──
// Dev: https://dev-api.opennode.com  ·  Live: https://api.opennode.com
const OPENNODE_SECRETS = ['OPENNODE_API_KEY'];
const OPENNODE_FEE_PCT = 0.01; // fallback ~1% si el webhook no trae fee

// Misma tarifa por tramos que el cliente (js/cart.js)
const SHIPPING_TIERS = [
  { min: 0,  cost: 3.49 },
  { min: 13, cost: 2.49 },
  { min: 20, cost: 1.99 },
  { min: 24, cost: 0    }
];
function getShippingCostServer(subtotal) {
  let cost = SHIPPING_TIERS[0].cost;
  for (const t of SHIPPING_TIERS) if (subtotal >= t.min) cost = t.cost;
  return cost;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function creditsUsoBloqueado(c) {
  if (!c) return true;
  if (c.congelado === true || c.bloqueado === true) return true;
  if (c.activo === false || c.usoPermitido === false) return true;
  const est = String(c.estado || '').toLowerCase();
  return est === 'congelado' || est === 'bloqueado';
}

/** Crea factura del pedido si aún no tiene (idempotente). Usado como respaldo
 *  cuando el cliente no alcanzó a escribirla (p. ej. redirect a Wompi). */
async function ensurePedidoFactura(orderId, orderData) {
  const o = orderData || {};
  if (o.facturaId && o.facturaNum) {
    return { already: true, facturaId: o.facturaId, facturaNum: o.facturaNum };
  }
  const orderRef = db.collection('pedidos').doc(orderId);
  const facRef = db.collection('facturas').doc();
  const metaRef = db.collection('estadisticas').doc('_meta');
  const ts = Date.now();
  const d = new Date(ts);
  const mes = d.getFullYear() + '-' + String(d.getMonth()).padStart(2, '0');
  const fecha = d.toLocaleDateString('es');
  const discPct = o.discountPct || 0;
  const discFactor = discPct ? ((100 - discPct) / 100) : 1;
  const creditsUsed = Math.max(0, Number(o.creditsUsed) || 0);

  const items = (o.items || []).map(it => {
    const sub = round2((it.price || 0) * (it.qty || 0));
    return {
      productName: it.colorLabel ? ((it.name || '') + ' · ' + it.colorLabel) : (it.name || ''),
      qty: it.qty,
      precioUnit: round2(it.price || 0),
      subtotal: sub,
      total: round2(sub * discFactor),
      descPct: discPct,
      descNombre: o.discountName || '',
      colorId: it.colorId || null,
      colorLabel: it.colorLabel || null,
      color: it.color || null
    };
  });
  const unidades = items.reduce((s, it) => s + (it.qty || 0), 0);
  const subtotal = round2(typeof o.total === 'number' ? o.total : 0);
  const totalProductos = typeof o.totalConDescuento === 'number' ? round2(o.totalConDescuento) : subtotal;
  const totalTrasCreditos = round2(Math.max(0, totalProductos - creditsUsed));
  const esDom = o.tipoEntrega === 'domicilio';
  const envioCosto = esDom && typeof o.envioCosto === 'number' ? round2(o.envioCosto) : 0;
  const total = round2(totalTrasCreditos + envioCosto);
  const facSucursal = (o.sucursal === 'exsal') ? 'exsal' : 'cdb';

  let numFactura = '';
  let facturaId = facRef.id;
  let already = false;

  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const metaSnap = await tx.get(metaRef);
    if (!orderSnap.exists) return;
    const cur = orderSnap.data() || {};
    if (cur.facturaId && cur.facturaNum) {
      already = true;
      facturaId = cur.facturaId;
      numFactura = cur.facturaNum;
      return;
    }
    const seq = ((metaSnap.exists && metaSnap.data().facturaSeq) || 0) + 1;
    numFactura = 'FAC-' + String(seq).padStart(5, '0');
    tx.set(facRef, {
      numero: seq, numFactura, sucursal: facSucursal,
      cliente: o.name || '', clienteEmail: o.email || '',
      seller: 'tienda-online',
      date: fecha, timestamp: ts, mes,
      subtotal, totalProductos, creditsUsed, envioCosto, total, unidades, items,
      tipoEntrega: o.tipoEntrega || 'pickup',
      fromOrder: orderId, origen: 'tienda',
      anulada: false
    });
    tx.set(metaRef, { facturaSeq: seq, updatedAt: ts }, { merge: true });
    tx.update(orderRef, { facturaId: facRef.id, facturaNum: numFactura });
  });

  return { already, facturaId, facturaNum: numFactura };
}

// ════════════════════════════════════════════════════════════════
//  Autenticación OAuth 2.0 (Client Credentials) con caché en memoria
// ════════════════════════════════════════════════════════════════
let _tokenCache = { value: null, exp: 0 };

async function getWompiToken() {
  const now = Date.now();
  if (_tokenCache.value && now < _tokenCache.exp) return _tokenCache.value;

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.WOMPI_APP_ID,
    client_secret: process.env.WOMPI_API_SECRET,
    audience:      'wompi_api'
  });

  const res = await fetch(WOMPI_ID_BASE + '/connect/token', {
    method:  'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('Wompi token error ' + res.status + ': ' + txt);
  }
  const data = await res.json();
  // Renovamos 60s antes de que expire para evitar usar un token al borde.
  _tokenCache = {
    value: data.access_token,
    exp:   now + ((data.expires_in || 3600) - 60) * 1000
  };
  return _tokenCache.value;
}

async function wompiApi(path, { method = 'GET', token, json } = {}) {
  const t = token || await getWompiToken();
  const res = await fetch(WOMPI_API_BASE + path, {
    method,
    headers: {
      'authorization': 'Bearer ' + t,
      'content-type':  'application/json'
    },
    ...(json ? { body: JSON.stringify(json) } : {})
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = text; }
  if (!res.ok) {
    const err = new Error('Wompi API ' + method + ' ' + path + ' → ' + res.status);
    err.status = res.status; err.body = parsed;
    throw err;
  }
  return parsed;
}

// ¿La transacción consultada está aprobada? (defensivo ante variaciones de shape)
function isApproved(tx) {
  if (!tx) return false;
  if (tx.esAprobada === true) return true;
  const r = (tx.resultadoTransaccion || tx.ResultadoTransaccion || '').toString().toLowerCase();
  return r.includes('aprobada') || r.includes('exitosa');
}
function txAmount(tx) {
  const m = (tx && (tx.monto ?? tx.Monto));
  return typeof m === 'number' ? m : parseFloat(m);
}

// ════════════════════════════════════════════════════════════════
//  Helper compartido: registra estadísticas de venta de un pedido online
//  (tarjeta Wompi o Bitcoin OpenNode). Idempotente.
// ════════════════════════════════════════════════════════════════
async function recordOnlinePaymentStats(orderId, opts = {}) {
  const provider = opts.provider || 'wompi'; // 'wompi' | 'opennode'
  const txId = opts.txId || null;
  const feeUsdOpt = (typeof opts.feeUsd === 'number' && isFinite(opts.feeUsd)) ? opts.feeUsd : null;
  const feePct = typeof opts.feePct === 'number' ? opts.feePct
    : (provider === 'opennode' ? OPENNODE_FEE_PCT : WOMPI_FEE_PCT);
  const allowedMetodos = opts.allowedMetodos || (provider === 'opennode' ? ['bitcoin'] : ['tarjeta']);
  const orderRef = db.collection('pedidos').doc(orderId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) { console.warn('Pedido no existe:', orderId); return; }
    const o = snap.data();

    // Idempotencia
    if (o.statsRecorded === true || o.paymentStatus === 'paid') {
      console.log('Pedido ya tenía estadísticas registradas, se omite:', orderId);
      return;
    }
    if (!allowedMetodos.includes(o.metodoPago)) {
      console.log('Pedido metodoPago no coincide, se omite:', orderId, o.metodoPago);
      return;
    }

    const sucursal = o.sucursal;
    const statDocId = (sucursal === 'cdb' || sucursal === 'domicilio' || sucursal === 'udb') ? 'ColegioDonBosco' : 'ColegioExsal';
    // Sucursal contable: 'domicilio' / 'udb' viven bajo CDB.
    const ventaSucursal = (sucursal === 'exsal') ? 'exsal' : 'cdb';
    const discFactor = o.discountPct ? ((100 - o.discountPct) / 100) : 1;

    let totalUnidades = 0, productCost = 0, priceTotal = 0, totalVentasEfectivo = 0;
    const ventaItems = [];
    for (const item of (o.items || [])) {
      const qty = item.qty || 1;
      const unitCost  = typeof item.cost  === 'number' ? item.cost  : 0;
      const unitPrice = typeof item.price === 'number' ? item.price : 0;
      productCost += unitCost * qty;
      priceTotal  += unitPrice * qty;
      const itemTotal = round2(unitPrice * qty * discFactor);
      totalUnidades += qty;
      totalVentasEfectivo += itemTotal;
      ventaItems.push({
        productName: item.name,
        qty,
        precioUnit: unitPrice,
        costTotal: round2(unitCost * qty),
        total: itemTotal,
        descPct: o.discountPct || 0,
        descNombre: o.discountName || '',
        pid: item.id || null
      });
    }

    const totalEfectivo = typeof o.totalConDescuento === 'number'
      ? o.totalConDescuento
      : round2(priceTotal * discFactor);

    // Comisión sobre el total realmente cobrado (productos con descuento − créditos + envío)
    const creditsUsed = Math.max(0, Number(o.creditsUsed) || 0);
    const baseCobro = typeof o.totalConEnvio === 'number'
      ? o.totalConEnvio
      : round2(Math.max(0, totalEfectivo - creditsUsed) + ((o.tipoEntrega === 'domicilio' && typeof o.envioCosto === 'number') ? o.envioCosto : 0));
    const comision = feeUsdOpt != null ? round2(feeUsdOpt) : round2(baseCobro * feePct);

    const esDom = o.tipoEntrega === 'domicilio';
    const envioCobrado = esDom ? (typeof o.envioCosto === 'number' ? o.envioCosto : 0) : 0;

    const now = new Date();
    const mesKey = now.getFullYear() + '-' + String(now.getMonth()).padStart(2, '0');
    const seller = provider === 'opennode' ? 'opennode' : 'wompi';

    const ventaRef = db.collection('ventas').doc();
    const ventaDoc = {
      orderNumber: 'PED-' + Date.now().toString().slice(-6) + '-' + Math.random().toString(36).slice(-3),
      items: ventaItems,
      qty: totalUnidades,
      costProductos: round2(productCost),
      costTotal: round2(productCost + comision),
      total: round2(totalVentasEfectivo),
      seller,
      sucursal: ventaSucursal,
      date: now.toLocaleDateString('es'),
      timestamp: Date.now(),
      mes: mesKey,
      fromOrder: orderId,
      facturaId:  o.facturaId  || null,
      facturaNum: o.facturaNum || null,
      ...(o.discountPct ? { descuentoAplicado: { nombre: o.discountName, porcentaje: o.discountPct } } : {})
    };
    if (provider === 'opennode') ventaDoc.comisionOpenNode = comision;
    else ventaDoc.comisionWompi = comision;
    tx.set(ventaRef, ventaDoc);

    const creditsCosto = Math.max(0, Number(o.creditsCosto) || 0);
    const statPayload = {
      'ventas':            admin.firestore.FieldValue.increment(round2(totalVentasEfectivo + envioCobrado)),
      'unidades vendidas': admin.firestore.FieldValue.increment(totalUnidades),
      'numero de ventas':  admin.firestore.FieldValue.increment(1),
      'ingresosPedidos':   admin.firestore.FieldValue.increment(round2(totalEfectivo + envioCobrado)),
      'costosPedidos':     admin.firestore.FieldValue.increment(round2(productCost + comision))
    };
    if (provider === 'opennode') {
      statPayload['comisionesOpenNode'] = admin.firestore.FieldValue.increment(comision);
    } else {
      statPayload['comisionesWompi'] = admin.firestore.FieldValue.increment(comision);
    }
    if (creditsUsed > 0) {
      statPayload['ventasCreditos'] = admin.firestore.FieldValue.increment(round2(creditsUsed));
    }
    if (envioCobrado > 0) {
      statPayload['ingresosEnvio'] = admin.firestore.FieldValue.increment(round2(envioCobrado));
    }
    tx.set(db.collection('estadisticas').doc(statDocId), statPayload, { merge: true });

    if (creditsUsed > 0 && creditsCosto > 0 && o.creditsEmail) {
      const credRef = db.collection('creditos').doc(String(o.creditsEmail).toLowerCase());
      tx.set(credRef, {
        costoInvertido: admin.firestore.FieldValue.increment(round2(creditsCosto)),
        updatedAt: Date.now()
      }, { merge: true });
    }

    const orderPatch = {
      paymentStatus: 'paid',
      statsRecorded: true,
      creditsStatsRecorded: creditsUsed > 0,
      ingresoEnvioRegistrado: true,
      costTotalProductos: round2(productCost),
      paidAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (provider === 'opennode') {
      orderPatch.comisionOpenNode = comision;
      if (txId) orderPatch.opennodeChargeId = txId;
    } else {
      orderPatch.comisionWompi = comision;
      if (txId) orderPatch.wompiTxId = txId;
    }
    tx.update(orderRef, orderPatch);
  });

  try {
    const fresh = await orderRef.get();
    if (fresh.exists) {
      await ensurePedidoFactura(orderId, fresh.data());
    }
  } catch (e) {
    console.warn('ensurePedidoFactura falló para', orderId, e && e.message);
  }

  console.log('Estadísticas registradas para pedido', orderId, '(' + provider + ')');
}

/** Compat: Wompi / tarjeta */
async function recordCardPaymentStats(orderId, wompiTxId) {
  return recordOnlinePaymentStats(orderId, {
    provider: 'wompi',
    txId: wompiTxId,
    feePct: WOMPI_FEE_PCT,
    allowedMetodos: ['tarjeta']
  });
}

// ════════════════════════════════════════════════════════════════
//  1) crearEnlaceWompi  (callable)
//     Crea un ENLACE DE PAGO en Wompi y devuelve la URL de la pantalla de
//     pago alojada por Wompi. El cliente ingresa su tarjeta EN WOMPI, no en
//     nuestro sitio (la tarjeta nunca toca nuestro servidor → PCI SAQ-A).
//     El monto se toma del pedido en Firestore, nunca del cliente.
// ════════════════════════════════════════════════════════════════
exports.crearEnlaceWompi = functions
  .runWith({ secrets: SECRETS })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const uid = context.auth.uid;
    const orderId = (data && data.orderId || '').toString();
    if (!orderId) {
      throw new functions.https.HttpsError('invalid-argument', 'Falta orderId.');
    }

    const orderRef = db.collection('pedidos').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Pedido no encontrado.');
    }
    const o = snap.data();
    if (o.userId && o.userId !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Este pedido no es tuyo.');
    }
    if (o.metodoPago !== 'tarjeta') {
      throw new functions.https.HttpsError('failed-precondition', 'El pedido no es de tarjeta.');
    }
    if (o.paymentStatus === 'paid' || o.statsRecorded === true) {
      throw new functions.https.HttpsError('failed-precondition', 'El pedido ya fue pagado.');
    }

    // ── Recalcular el monto del lado SERVIDOR (autoritativo) ──
    // No confiamos en 'totalConEnvio' del pedido: un usuario podría haberlo editado
    // en Firestore. Releemos los precios reales desde 'productos' y el descuento real
    // desde 'descuentos', y sumamos el envío con la constante del servidor.
    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) {
      throw new functions.https.HttpsError('failed-precondition', 'El pedido no tiene productos.');
    }
    const prodSnaps = await Promise.all(
      items.map(it => db.collection('productos').doc(String(it.id)).get())
    );
    let subtotal = 0;
    for (let k = 0; k < items.length; k++) {
      const psnap = prodSnaps[k];
      if (!psnap.exists) {
        throw new functions.https.HttpsError('failed-precondition', 'Un producto del pedido ya no existe.');
      }
      const price = Number(psnap.data().price);
      const qty = Math.max(1, parseInt(items[k].qty, 10) || 0);
      if (!(price >= 0)) {
        throw new functions.https.HttpsError('failed-precondition', 'Precio de producto inválido.');
      }
      subtotal += price * qty;
    }

    // Descuento: releer el % real (asignado / código / tarjeta de sellos). No confiar en el pedido.
    let pct = 0;
    let resolvedName = o.discountName || null;
    if (o.discountId) {
      try {
        const dSnap = await db.collection('descuentos').doc(String(o.discountId)).get();
        if (dSnap.exists) {
          const p = Number(dSnap.data().porcentaje);
          if (p > 0 && p <= 100) {
            pct = p;
            resolvedName = dSnap.data().nombre || resolvedName;
          }
        }
      } catch (_) {}
    } else if (o.discountCodeId || o.discountCode) {
      try {
        let dSnap = null;
        if (o.discountCodeId) {
          dSnap = await db.collection('discount-codes').doc(String(o.discountCodeId)).get();
        }
        if ((!dSnap || !dSnap.exists) && o.discountCode) {
          const q = await db.collection('discount-codes')
            .where('code', '==', String(o.discountCode).toUpperCase()).limit(1).get();
          if (!q.empty) dSnap = q.docs[0];
        }
        if (dSnap && dSnap.exists) {
          const d = dSnap.data();
          const p = Number(d.porcentaje);
          const activo = d.activo !== false;
          let vigente = true;
          if (d.venceAt != null) {
            const ms = d.venceAt.toMillis ? d.venceAt.toMillis()
              : (typeof d.venceAt === 'number' ? d.venceAt : Date.parse(d.venceAt));
            if (ms && Date.now() > ms) vigente = false;
          }
          // Aceptar si el código sigue válido O si este pedido ya lo consumió
          const yaConsumido = o.descuentoConsumido === true;
          if (activo && vigente && p > 0 && p <= 100) {
            pct = p;
            resolvedName = d.nombre || o.discountCode || resolvedName;
          } else if (yaConsumido && p > 0 && p <= 100) {
            pct = p;
            resolvedName = d.nombre || o.discountCode || resolvedName;
          }
        }
      } catch (_) {}
    } else if (o.stampCardCode) {
      try {
        const cSnap = await db.collection('stamp-cards').doc(String(o.stampCardCode)).get();
        if (cSnap.exists) {
          const c = cSnap.data();
          const emailOk = !o.email || String(c.emailLower || '').toLowerCase() === String(o.email).toLowerCase();
          const available = c.rewardAvailable === true || (Number(c.sellos) || 0) >= 8;
          const usedByThis = c.rewardUsed === true && c.rewardUsedOrderId === orderId;
          if (emailOk && (available || usedByThis)) {
            pct = Number(c.rewardPct) > 0 ? Number(c.rewardPct) : 40;
            resolvedName = c.nombre || 'Tarjeta de sellos';
          }
        }
      } catch (_) {}
    }
    // Créditos no se combinan con descuentos de carrito
    const creditsUsed = Math.max(0, Number(o.creditsUsed) || 0);
    if (creditsUsed > 0) pct = 0;
    const conDescuento = pct ? subtotal * (1 - pct / 100) : subtotal;
    const afterCredits = Math.max(0, conDescuento - creditsUsed);
    // Envío por tramos (igual que el cliente). Pickup = 0.
    const envioCosto = (o.tipoEntrega === 'domicilio')
      ? getShippingCostServer(round2(conDescuento))
      : 0;
    const monto = round2(afterCredits + envioCosto);

    // Cubierto 100% con créditos (y sin envío): no hay cobro Wompi
    if (monto <= 0) {
      return { ok: true, url: null, fullyCoveredByCredits: true, amount: 0 };
    }

    // Si el monto guardado no coincide con el recalculado, "sanamos" el pedido con el
    // valor autoritativo para que el webhook (que compara contra totalConEnvio) cuadre.
    if (typeof o.totalConEnvio !== 'number' || Math.abs(o.totalConEnvio - monto) > 0.01) {
      console.warn('Monto del pedido', orderId, 'corregido de', o.totalConEnvio, 'a', monto);
      await orderRef.update({
        total: round2(subtotal),
        totalConDescuento: pct ? round2(conDescuento) : (creditsUsed > 0 ? round2(conDescuento) : null),
        discountPct: pct || null,
        discountName: resolvedName,
        envioCosto: envioCosto,
        totalConEnvio: monto,
        payableAfterCredits: round2(afterCredits),
        montoVerificadoServidor: true
      }).catch(e => console.warn('No se pudo sanar el monto:', e));
    }

    const base = (data && data.origin) ? data.origin.toString() : 'https://picosv.com';
    const webhookUrl = process.env.WOMPI_WEBHOOK_URL ||
      ('https://us-central1-' + process.env.GCLOUD_PROJECT + '.cloudfunctions.net/wompiWebhook');

    const nProductos = Array.isArray(o.items) ? o.items.reduce((s, i) => s + (i.qty || 1), 0) : 1;
    const nombreProducto = 'Pedido PICO ' + (o.code || orderId) +
      (nProductos > 1 ? (' (' + nProductos + ' productos)') : '');

    const payload = {
      // ↓ Este identificador vuelve a nosotros en el WEBHOOK y en la URL de retorno.
      identificadorEnlaceComercio: orderId,
      monto: round2(monto),
      nombreProducto: nombreProducto.slice(0, 500),
      formaPago: {
        permitirTarjetaCreditoDebido: true,
        permitirPagoConPuntoAgricola: false,
        permitirPagoEnCuotasAgricola: false,
        permitirPagoEnBitcoin: false,
        permitePagoQuickPay: false
      },
      configuracion: {
        urlRedirect: base + '/?pago=ok&order=' + orderId,   // a dónde vuelve el cliente tras pagar
        urlRetorno:  base + '/?pago=cancel&order=' + orderId, // botón "regresar" de la pantalla de Wompi
        esMontoEditable: false,
        esCantidadEditable: false,
        cantidadPorDefecto: 1,
        urlWebhook: webhookUrl,            // confirmación principal (obligatorio tener webhook o email)
        notificarTransaccionCliente: true  // Wompi le envía el comprobante al cliente
      },
      limitesDeUso: {
        // El enlace es de un solo uso: 1 pago exitoso lo cierra.
        cantidadMaximaPagosExitosos: 1
      }
    };

    let resp;
    try {
      resp = await wompiApi('/EnlacePago', { method: 'POST', json: payload });
    } catch (err) {
      console.error('Error creando enlace Wompi para', orderId, err.status, err.body);
      throw new functions.https.HttpsError('internal', 'No se pudo iniciar el pago con Wompi.');
    }

    const url = resp && (resp.urlEnlace || resp.UrlEnlace);
    const idEnlace = resp && (resp.idEnlace ?? resp.IdEnlace);
    if (!url) {
      console.error('Respuesta Wompi sin urlEnlace:', resp);
      throw new functions.https.HttpsError('internal', 'Wompi no devolvió la URL de pago.');
    }

    await orderRef.update({
      wompiEnlaceId: (idEnlace ?? null),
      wompiEnlaceCreatedAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(e => console.warn('No se pudo guardar wompiEnlaceId:', e));

    return { url, idEnlace: (idEnlace ?? null) };
  });

// ════════════════════════════════════════════════════════════════
//  2) wompiWebhook  (HTTP)  ·  CONFIRMACIÓN PRINCIPAL
//     Wompi hace POST aquí al terminar la transacción. Re-consultamos la
//     transacción en el API (autoritativo) antes de tocar estadísticas.
// ════════════════════════════════════════════════════════════════
exports.wompiWebhook = functions
  .runWith({ secrets: SECRETS })
  .https.onRequest(async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }
    try {
      const body = req.body || {};
      const idTx = body.IdTransaccion || body.idTransaccion ||
                   (body.transaccionCompra && body.transaccionCompra.idTransaccion);
      if (!idTx) { console.warn('Webhook sin IdTransaccion'); res.status(200).send('ok'); return; }

      // Re-consultar la transacción en Wompi (no confiamos en el cuerpo del webhook)
      const tx = await wompiApi('/TransaccionCompra/' + idTx);
      if (!isApproved(tx)) {
        console.log('Webhook: transacción no aprobada', idTx);
        res.status(200).send('ok'); return;
      }

      // Localizar el pedido. Con Enlace de Pago, nuestro orderId vuelve en
      // EnlacePago.IdentificadorEnlaceComercio. Dejamos respaldos por si acaso.
      const enlace = body.EnlacePago || body.enlacePago || {};
      let orderId = enlace.IdentificadorEnlaceComercio || enlace.identificadorEnlaceComercio || null;
      if (!orderId && body.datosAdicionales && body.datosAdicionales.orderId) {
        orderId = body.datosAdicionales.orderId;
      }
      if (!orderId) {
        // Último recurso: buscar por el idEnlace si vino en el cuerpo.
        const idEnlace = enlace.Id ?? enlace.id ?? null;
        if (idEnlace != null) {
          const q = await db.collection('pedidos').where('wompiEnlaceId', '==', idEnlace).limit(1).get();
          if (!q.empty) orderId = q.docs[0].id;
        }
      }
      if (!orderId) { console.warn('Webhook: no se encontró pedido para', idTx); res.status(200).send('ok'); return; }

      // Guardamos el idTransaccion en el pedido (referencia / respaldo)
      await db.collection('pedidos').doc(orderId)
        .update({ wompiTxId: idTx })
        .catch(() => {});

      // Validar que el monto cobrado coincida con el del pedido (anti-fraude)
      const orderSnap = await db.collection('pedidos').doc(orderId).get();
      if (orderSnap.exists) {
        const expected = orderSnap.data().totalConEnvio;
        const got = txAmount(tx);
        if (typeof expected === 'number' && typeof got === 'number' && Math.abs(expected - got) > 0.01) {
          console.error('Webhook: monto no coincide', orderId, 'esperado', expected, 'recibido', got);
          res.status(200).send('ok'); return;
        }
      }

      await recordCardPaymentStats(orderId, idTx);
      res.status(200).send('ok');
    } catch (err) {
      console.error('Error en wompiWebhook:', err.status || '', err.body || err);
      // Respondemos 200 para que Wompi no reintente en bucle ante errores no recuperables.
      res.status(200).send('ok');
    }
  });

// ════════════════════════════════════════════════════════════════
//  3) confirmWompiOnAck  (onUpdate)  ·  CONFIRMACIÓN DE RESPALDO
//     Al volver del checkout el cliente marca paymentReturnAck=true; aquí
//     re-consultamos la transacción en Wompi por si el webhook no llegó.
// ════════════════════════════════════════════════════════════════
exports.confirmWompiOnAck = functions
  .runWith({ secrets: SECRETS })
  .firestore.document('pedidos/{orderId}')
  .onUpdate(async (change, context) => {
    const after = change.after.data() || {};
    const orderId = context.params.orderId;

    if (after.metodoPago !== 'tarjeta') return null;
    if (after.paymentReturnAck !== true) return null;
    if (after.paymentStatus === 'paid' || after.statsRecorded === true) return null;
    if (!after.wompiTxId) {
      console.warn('Pedido sin wompiTxId, no se puede verificar:', orderId);
      return null;
    }
    try {
      const tx = await wompiApi('/TransaccionCompra/' + after.wompiTxId);
      if (!isApproved(tx)) {
        console.log('Respaldo: transacción aún no aprobada:', orderId);
        return null;
      }
      const expected = after.totalConEnvio;
      const got = txAmount(tx);
      if (typeof expected === 'number' && typeof got === 'number' && Math.abs(expected - got) > 0.01) {
        console.error('Respaldo: monto no coincide', orderId);
        return null;
      }
      await recordCardPaymentStats(orderId, after.wompiTxId);
    } catch (err) {
      console.error('Error verificando/registrando pago (respaldo) del pedido', orderId, err.status || err);
    }
    return null;
  });


// ════════════════════════════════════════════════════════════════
//  OPENNODE · Bitcoin Lightning
// ════════════════════════════════════════════════════════════════

function opennodeApiBase() {
  const env = String(process.env.OPENNODE_ENV || 'dev').toLowerCase();
  if (env === 'live' || env === 'prod' || env === 'production') {
    return 'https://api.opennode.com';
  }
  return 'https://dev-api.opennode.com';
}

async function opennodeApi(path, { method = 'GET', json } = {}) {
  const key = process.env.OPENNODE_API_KEY;
  if (!key) {
    const err = new Error('OPENNODE_API_KEY no configurada');
    err.status = 500;
    throw err;
  }
  const res = await fetch(opennodeApiBase() + path, {
    method,
    headers: {
      Authorization: key,
      'Content-Type': 'application/json'
    },
    ...(json ? { body: JSON.stringify(json) } : {})
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = text; }
  if (!res.ok) {
    const err = new Error('OpenNode API ' + method + ' ' + path + ' → ' + res.status);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

function verifyOpenNodeWebhook(chargeId, hashedOrder) {
  const key = process.env.OPENNODE_API_KEY || '';
  const calculated = crypto.createHmac('sha256', key).update(String(chargeId)).digest('hex');
  const a = Buffer.from(String(hashedOrder || ''));
  const b = Buffer.from(calculated);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (_) { return false; }
}

/** Recalcula el monto a cobrar (USD) desde Firestore — no confiar en el cliente. */
async function computeOrderPayableUsd(orderId, o) {
  const items = Array.isArray(o.items) ? o.items : [];
  if (!items.length) {
    throw new functions.https.HttpsError('failed-precondition', 'El pedido no tiene productos.');
  }
  const prodSnaps = await Promise.all(
    items.map(it => db.collection('productos').doc(String(it.id)).get())
  );
  let subtotal = 0;
  for (let k = 0; k < items.length; k++) {
    const psnap = prodSnaps[k];
    if (!psnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Un producto del pedido ya no existe.');
    }
    const price = Number(psnap.data().price);
    const qty = Math.max(1, parseInt(items[k].qty, 10) || 0);
    if (!(price >= 0)) {
      throw new functions.https.HttpsError('failed-precondition', 'Precio de producto inválido.');
    }
    subtotal += price * qty;
  }

  let pct = 0;
  let resolvedName = o.discountName || null;
  if (o.discountId) {
    try {
      const dSnap = await db.collection('descuentos').doc(String(o.discountId)).get();
      if (dSnap.exists) {
        const p = Number(dSnap.data().porcentaje);
        if (p > 0 && p <= 100) {
          pct = p;
          resolvedName = dSnap.data().nombre || resolvedName;
        }
      }
    } catch (_) {}
  } else if (o.discountCodeId || o.discountCode) {
    try {
      let dSnap = null;
      if (o.discountCodeId) {
        dSnap = await db.collection('discount-codes').doc(String(o.discountCodeId)).get();
      }
      if ((!dSnap || !dSnap.exists) && o.discountCode) {
        const q = await db.collection('discount-codes')
          .where('code', '==', String(o.discountCode).toUpperCase()).limit(1).get();
        if (!q.empty) dSnap = q.docs[0];
      }
      if (dSnap && dSnap.exists) {
        const d = dSnap.data();
        const p = Number(d.porcentaje);
        const activo = d.activo !== false;
        let vigente = true;
        if (d.venceAt != null) {
          const ms = d.venceAt.toMillis ? d.venceAt.toMillis()
            : (typeof d.venceAt === 'number' ? d.venceAt : Date.parse(d.venceAt));
          if (ms && Date.now() > ms) vigente = false;
        }
        const yaConsumido = o.descuentoConsumido === true;
        if (((activo && vigente) || yaConsumido) && p > 0 && p <= 100) {
          pct = p;
          resolvedName = d.nombre || o.discountCode || resolvedName;
        }
      }
    } catch (_) {}
  } else if (o.stampCardCode) {
    try {
      const cSnap = await db.collection('stamp-cards').doc(String(o.stampCardCode)).get();
      if (cSnap.exists) {
        const c = cSnap.data();
        const emailOk = !o.email || String(c.emailLower || '').toLowerCase() === String(o.email).toLowerCase();
        const available = c.rewardAvailable === true || (Number(c.sellos) || 0) >= 8;
        const usedByThis = c.rewardUsed === true && c.rewardUsedOrderId === orderId;
        if (emailOk && (available || usedByThis)) {
          pct = Number(c.rewardPct) > 0 ? Number(c.rewardPct) : 40;
          resolvedName = c.nombre || 'Tarjeta de sellos';
        }
      }
    } catch (_) {}
  }

  const creditsUsed = Math.max(0, Number(o.creditsUsed) || 0);
  if (creditsUsed > 0) pct = 0;
  const conDescuento = pct ? subtotal * (1 - pct / 100) : subtotal;
  const afterCredits = Math.max(0, conDescuento - creditsUsed);
  const envioCosto = (o.tipoEntrega === 'domicilio')
    ? getShippingCostServer(round2(conDescuento))
    : 0;
  const monto = round2(afterCredits + envioCosto);
  return {
    subtotal: round2(subtotal),
    pct,
    resolvedName,
    conDescuento: round2(conDescuento),
    afterCredits: round2(afterCredits),
    creditsUsed,
    envioCosto,
    monto
  };
}

function feeUsdFromOpenNodeCharge(charge, fiatUsd) {
  if (!charge) return null;
  const feeRaw = charge.fee != null ? Number(charge.fee) : NaN;
  const amountSats = Number(charge.amount);
  const fiat = typeof fiatUsd === 'number' ? fiatUsd
    : (Number(charge.fiat_value) || Number(charge.source_fiat_value) || NaN);
  // fee suele venir en sats
  if (isFinite(feeRaw) && feeRaw > 0 && isFinite(amountSats) && amountSats > 0 && isFinite(fiat) && fiat > 0) {
    return round2((feeRaw / amountSats) * fiat);
  }
  if (isFinite(feeRaw) && feeRaw > 0 && feeRaw < 100 && isFinite(fiat) && feeRaw <= fiat) {
    // por si viniera ya en USD
    return round2(feeRaw);
  }
  return null;
}

async function markOpenNodePaid(orderId, charge) {
  const fiat = Number(charge && (charge.fiat_value ?? charge.source_fiat_value));
  const feeUsd = feeUsdFromOpenNodeCharge(charge, isFinite(fiat) ? fiat : null);
  await recordOnlinePaymentStats(orderId, {
    provider: 'opennode',
    txId: charge && charge.id ? String(charge.id) : null,
    feeUsd: feeUsd,
    feePct: OPENNODE_FEE_PCT,
    allowedMetodos: ['bitcoin']
  });
}

// ── crearCargoOpenNode (callable) ──
exports.crearCargoOpenNode = functions
  .runWith({ secrets: OPENNODE_SECRETS })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const uid = context.auth.uid;
    const orderId = (data && data.orderId || '').toString();
    if (!orderId) {
      throw new functions.https.HttpsError('invalid-argument', 'Falta orderId.');
    }

    const orderRef = db.collection('pedidos').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Pedido no encontrado.');
    }
    const o = snap.data();
    if (o.userId && o.userId !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Este pedido no es tuyo.');
    }
    if (o.metodoPago !== 'bitcoin') {
      throw new functions.https.HttpsError('failed-precondition', 'El pedido no es de Bitcoin.');
    }
    if (o.paymentStatus === 'paid' || o.statsRecorded === true) {
      throw new functions.https.HttpsError('failed-precondition', 'El pedido ya fue pagado.');
    }

    // Reutilizar cargo unpaid existente (evitar duplicar facturas al reintentar)
    if (o.opennodeChargeId && o.paymentStatus === 'pending') {
      try {
        const existing = await opennodeApi('/v1/charge/' + o.opennodeChargeId);
        const ch = existing && existing.data ? existing.data : existing;
        if (ch && (ch.status === 'unpaid' || ch.status === 'processing')) {
          const li = ch.lightning_invoice || {};
          return {
            ok: true,
            chargeId: ch.id,
            amountSats: Number(ch.amount) || 0,
            fiatValue: Number(ch.fiat_value ?? ch.source_fiat_value) || 0,
            currency: ch.currency || 'USD',
            lightningInvoice: li.payreq || null,
            uri: ch.uri || null,
            address: (ch.chain_invoice && ch.chain_invoice.address) || ch.address || null,
            expiresAt: li.expires_at || null,
            hostedCheckoutUrl: ch.hosted_checkout_url || null,
            reused: true
          };
        }
        if (ch && ch.status === 'paid') {
          await markOpenNodePaid(orderId, ch);
          return { ok: true, alreadyPaid: true, chargeId: ch.id };
        }
      } catch (e) {
        console.warn('No se pudo reutilizar cargo OpenNode:', e && e.message);
      }
    }

    const payable = await computeOrderPayableUsd(orderId, o);
    if (payable.monto <= 0) {
      return { ok: true, fullyCoveredByCredits: true, amount: 0 };
    }

    if (typeof o.totalConEnvio !== 'number' || Math.abs(o.totalConEnvio - payable.monto) > 0.01) {
      await orderRef.update({
        total: payable.subtotal,
        totalConDescuento: payable.pct ? payable.conDescuento : (payable.creditsUsed > 0 ? payable.conDescuento : null),
        discountPct: payable.pct || null,
        discountName: payable.resolvedName,
        envioCosto: payable.envioCosto,
        totalConEnvio: payable.monto,
        payableAfterCredits: payable.afterCredits,
        montoVerificadoServidor: true
      }).catch(e => console.warn('No se pudo sanar monto OpenNode:', e));
    }

    const webhookUrl = process.env.OPENNODE_WEBHOOK_URL ||
      ('https://us-central1-' + process.env.GCLOUD_PROJECT + '.cloudfunctions.net/opennodeWebhook');
    const base = (data && data.origin) ? data.origin.toString() : 'https://picosv.com';

    let resp;
    try {
      resp = await opennodeApi('/v1/charges', {
        method: 'POST',
        json: {
          amount: payable.monto,
          currency: 'USD',
          description: 'Pedido PICO ' + (o.code || orderId),
          order_id: orderId,
          customer_name: o.name || '',
          customer_email: o.email || '',
          callback_url: webhookUrl,
          success_url: base + '/?btc=ok&order=' + orderId,
          auto_settle: false,
          ttl: 60 // minutos — suficiente para Lightning en checkout
        }
      });
    } catch (err) {
      console.error('Error creando cargo OpenNode para', orderId, err.status, err.body);
      throw new functions.https.HttpsError('internal', 'No se pudo crear la factura Bitcoin. ¿Configuraste OPENNODE_API_KEY?');
    }

    const ch = resp && resp.data ? resp.data : resp;
    if (!ch || !ch.id) {
      console.error('Respuesta OpenNode sin cargo:', resp);
      throw new functions.https.HttpsError('internal', 'OpenNode no devolvió la factura.');
    }

    const li = ch.lightning_invoice || {};
    await orderRef.update({
      opennodeChargeId: ch.id,
      opennodeCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      opennodeAmountSats: Number(ch.amount) || null,
      opennodeFiatValue: Number(ch.fiat_value ?? ch.source_fiat_value) || payable.monto,
      paymentStatus: 'pending'
    }).catch(e => console.warn('No se pudo guardar opennodeChargeId:', e));

    return {
      ok: true,
      chargeId: ch.id,
      amountSats: Number(ch.amount) || 0,
      fiatValue: Number(ch.fiat_value ?? ch.source_fiat_value) || payable.monto,
      currency: ch.currency || 'USD',
      lightningInvoice: li.payreq || null,
      uri: ch.uri || null,
      address: (ch.chain_invoice && ch.chain_invoice.address) || ch.address || null,
      expiresAt: li.expires_at || null,
      hostedCheckoutUrl: ch.hosted_checkout_url || null
    };
  });

// ── opennodeWebhook (HTTP) ──
exports.opennodeWebhook = functions
  .runWith({ secrets: OPENNODE_SECRETS })
  .https.onRequest(async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }
    try {
      const body = req.body || {};
      // OpenNode envía application/x-www-form-urlencoded; Functions lo parsea a objeto.
      const chargeId = body.id || body.charge_id;
      const status = String(body.status || '').toLowerCase();
      const orderId = body.order_id || body.orderId || null;
      const hashed = body.hashed_order;

      if (!chargeId) {
        console.warn('OpenNode webhook sin id');
        res.status(200).send('ok');
        return;
      }

      if (hashed && !verifyOpenNodeWebhook(chargeId, hashed)) {
        console.error('OpenNode webhook firma inválida', chargeId);
        res.status(401).send('invalid signature');
        return;
      }

      // Re-consultar el cargo (autoritativo)
      let charge = null;
      try {
        const got = await opennodeApi('/v1/charge/' + chargeId);
        charge = got && got.data ? got.data : got;
      } catch (e) {
        console.error('No se pudo re-consultar cargo OpenNode', chargeId, e && e.message);
        // Si la firma es válida y status=paid, aún así intentamos con el body
        charge = { id: chargeId, status, fee: body.fee, amount: body.price || body.amount, fiat_value: null };
      }

      const st = String((charge && charge.status) || status).toLowerCase();
      if (st !== 'paid') {
        console.log('OpenNode webhook: status no paid', chargeId, st);
        res.status(200).send('ok');
        return;
      }

      let oid = orderId || (charge && charge.order_id) || null;
      if (!oid) {
        const q = await db.collection('pedidos').where('opennodeChargeId', '==', chargeId).limit(1).get();
        if (!q.empty) oid = q.docs[0].id;
      }
      if (!oid) {
        console.warn('OpenNode webhook: pedido no encontrado para', chargeId);
        res.status(200).send('ok');
        return;
      }

      // Validar monto fiat si está disponible
      const orderSnap = await db.collection('pedidos').doc(oid).get();
      if (orderSnap.exists) {
        const expected = orderSnap.data().totalConEnvio;
        const gotFiat = Number(charge.fiat_value ?? charge.source_fiat_value);
        if (typeof expected === 'number' && isFinite(gotFiat) && Math.abs(expected - gotFiat) > 0.05) {
          console.error('OpenNode webhook: monto no coincide', oid, 'esperado', expected, 'recibido', gotFiat);
          // Aun así, si OpenNode marcó paid con nuestro order_id, registramos (el monto lo fijamos nosotros al crear).
        }
      }

      await markOpenNodePaid(oid, charge);
      res.status(200).send('ok');
    } catch (err) {
      console.error('Error en opennodeWebhook:', err);
      res.status(200).send('ok');
    }
  });

// ── consultarCargoOpenNode (callable) · poll de respaldo ──
exports.consultarCargoOpenNode = functions
  .runWith({ secrets: OPENNODE_SECRETS })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const uid = context.auth.uid;
    const orderId = (data && data.orderId || '').toString();
    if (!orderId) {
      throw new functions.https.HttpsError('invalid-argument', 'Falta orderId.');
    }
    const snap = await db.collection('pedidos').doc(orderId).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Pedido no encontrado.');
    }
    const o = snap.data();
    if (o.userId && o.userId !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Este pedido no es tuyo.');
    }
    if (o.paymentStatus === 'paid' || o.statsRecorded === true) {
      return { status: 'paid', paymentStatus: 'paid' };
    }
    const chargeId = o.opennodeChargeId;
    if (!chargeId) {
      return { status: 'missing', paymentStatus: o.paymentStatus || null };
    }
    try {
      const got = await opennodeApi('/v1/charge/' + chargeId);
      const ch = got && got.data ? got.data : got;
      const st = String(ch.status || '').toLowerCase();
      if (st === 'paid') {
        await markOpenNodePaid(orderId, ch);
        return { status: 'paid', paymentStatus: 'paid', chargeId };
      }
      return {
        status: st || 'unknown',
        paymentStatus: o.paymentStatus || 'pending',
        chargeId,
        amountSats: Number(ch.amount) || null,
        fiatValue: Number(ch.fiat_value ?? ch.source_fiat_value) || null
      };
    } catch (err) {
      console.error('consultarCargoOpenNode:', err.status || '', err.body || err);
      throw new functions.https.HttpsError('internal', 'No se pudo consultar el cargo Bitcoin.');
    }
  });

// ── getOpenNodeRate (callable) · cotización BTC/USD para la UI ──
exports.getOpenNodeRate = functions
  .runWith({ secrets: OPENNODE_SECRETS })
  .https.onCall(async (_data, context) => {
    // Público autenticado (checkout); no exponemos la API key
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    try {
      const got = await opennodeApi('/v1/rates');
      const data = got && got.data ? got.data : got;
      // Formas habituales: { USD: { BTC: 1.2e-5, SATS: 1200 } } o anidado
      let usdPerBtc = null;
      let btcPerUsd = null;
      if (data && data.USD) {
        if (typeof data.USD.BTC === 'number') btcPerUsd = data.USD.BTC;
        // A veces traen BTCUSD
      }
      if (data && data.BTCUSD && typeof data.BTCUSD === 'number') {
        usdPerBtc = data.BTCUSD;
      }
      if (btcPerUsd && btcPerUsd > 0) {
        usdPerBtc = 1 / btcPerUsd;
      }
      // Alternativa: data.USD.SATS → sats por 1 USD
      if (!usdPerBtc && data && data.USD && typeof data.USD.SATS === 'number' && data.USD.SATS > 0) {
        usdPerBtc = 1e8 / data.USD.SATS;
      }
      return {
        ok: true,
        usdPerBtc: usdPerBtc ? round2(usdPerBtc) : null,
        btcPerUsd: btcPerUsd || null,
        env: String(process.env.OPENNODE_ENV || 'dev')
      };
    } catch (err) {
      console.warn('getOpenNodeRate:', err && err.message);
      return { ok: false, usdPerBtc: null };
    }
  });


// ════════════════════════════════════════════════════════════════
//  ROL DE ADMINISTRADOR  (Custom Claims)
//
//  El rol "admin" se guarda como custom claim en el token del usuario
//  (admin === true). Es la fuente de verdad y se verifica en las reglas
//  de Firestore con request.auth.token.admin == true.
//
//  setAdminRole (callable): otorga o quita el rol a un usuario por correo.
//   - Solo puede llamarla alguien que YA es admin...
//   - ...EXCEPTO los correos en BOOTSTRAP_ADMINS, que pueden usarla para
//     crear el PRIMER admin (resuelve el problema del huevo y la gallina).
//
//  Espeja además el admin en la colección 'admins/{uid}' para poder
//  listarlos en la interfaz (la fuente de verdad sigue siendo el claim).
// ════════════════════════════════════════════════════════════════

// PON AQUÍ TU CORREO para poder crear el primer administrador.
//    Después de tener tu primer admin, puedes vaciar esta lista y volver a desplegar.
const BOOTSTRAP_ADMINS = [
  '',
];

exports.setAdminRole = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const callerEmail      = String(context.auth.token.email || '').toLowerCase();
  const callerIsAdmin    = context.auth.token.admin === true;
  const bootstrapList    = BOOTSTRAP_ADMINS.map(e => String(e).toLowerCase());
  const callerIsBootstrap = bootstrapList.includes(callerEmail);

  if (!callerIsAdmin && !callerIsBootstrap) {
    throw new functions.https.HttpsError('permission-denied', 'Solo un administrador puede gestionar roles.');
  }

  const email = String((data && data.email) || '').trim().toLowerCase();
  // makeAdmin: true (otorgar) por defecto; false para quitar el rol
  const makeAdmin = !(data && data.makeAdmin === false);
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'Falta el correo del usuario.');
  }

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (e) {
    throw new functions.https.HttpsError('not-found',
      'No existe un usuario con ese correo. Pídele que inicie sesión en PICO al menos una vez.');
  }

  // Evitar que un admin se quite el rol a sí mismo por accidente
  if (!makeAdmin && userRecord.uid === context.auth.uid) {
    throw new functions.https.HttpsError('failed-precondition',
      'No puedes quitarte el rol de administrador a ti mismo.');
  }

  const existing = userRecord.customClaims || {};
  await admin.auth().setCustomUserClaims(userRecord.uid, { ...existing, admin: makeAdmin });

  // Espejo para listar admins en la UI
  const ref = db.collection('admins').doc(userRecord.uid);
  if (makeAdmin) {
    await ref.set({ email, since: Date.now(), by: callerEmail }, { merge: true });
  } else {
    await ref.delete().catch(() => {});
  }

  // Forzar refresco de tokens del usuario afectado (para que el claim aplique pronto)
  await admin.auth().revokeRefreshTokens(userRecord.uid).catch(() => {});

  return { ok: true, uid: userRecord.uid, email, admin: makeAdmin };
});

// ════════════════════════════════════════════════════════════════
//  AVISO: visitante desde institución "Otros" (colegio/universidad no listada)
//  Se llama desde el modal de entrada SIN necesidad de iniciar sesión.
//  Escribe en la colección 'mail' con privilegios de servidor → Trigger Email.
// ════════════════════════════════════════════════════════════════
const NOTIFY_EMAIL = 'picosvsupport@gmail.com';

exports.notificarVisitaOtros = functions.https.onCall(async (data) => {
  const institucion = String((data && data.institucion) || '').trim();
  if (!institucion || institucion.length < 2 || institucion.length > 200) {
    throw new functions.https.HttpsError('invalid-argument', 'Nombre de institución inválido.');
  }
  const safe = institucion.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cuando = new Date().toLocaleString('es-SV');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
    <h2 style="margin:0 0 8px">Visita desde institución no listada</h2>
    <p style="margin:0 0 16px;color:#64748b">${cuando}</p>
    <p style="font-size:16px;margin:0 0 12px">Un visitante indicó que nos visita desde:</p>
    <p style="font-size:20px;font-weight:700;color:#0071e3;margin:0 0 16px">${safe}</p>
    <p style="font-size:13px;color:#94a3b8;margin:0">Se redirigió automáticamente a <b>envío a domicilio</b>. Si hace un pedido, el aviso de pedido incluirá esta institución.</p>
  </div>`;
  await db.collection('mail').add({
    to: NOTIFY_EMAIL,
    message: {
      subject: `Visita desde: ${institucion}`,
      html,
      text: `Visita desde institución no listada: ${institucion} (${cuando})`
    }
  });
  return { ok: true };
});

// ════════════════════════════════════════════════════════════════
//  consumirDescuentoPedido (callable)
//  Tras crear un pedido con código promocional o tarjeta de sellos:
//  incrementa usos / escribe redención / archiva la tarjeta.
//  Idempotente vía pedidos.descuentoConsumido.
// ════════════════════════════════════════════════════════════════
exports.consumirDescuentoPedido = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const orderId = String((data && data.orderId) || '');
  if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'Falta orderId.');

  const orderRef = db.collection('pedidos').doc(orderId);
  const uid = context.auth.uid;
  const email = (context.auth.token.email || '').toLowerCase();

  // Resolver ref del código ANTES de la transacción (evita query dentro del tx)
  const orderPeek = await orderRef.get();
  if (!orderPeek.exists) throw new functions.https.HttpsError('not-found', 'Pedido no encontrado.');
  const peek = orderPeek.data();
  let codeRefResolved = null;
  if (peek.discountCodeId) {
    codeRefResolved = db.collection('discount-codes').doc(String(peek.discountCodeId));
  } else if (peek.discountCode) {
    const q = await db.collection('discount-codes')
      .where('code', '==', String(peek.discountCode).toUpperCase()).limit(1).get();
    if (!q.empty) codeRefResolved = q.docs[0].ref;
  }

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Pedido no encontrado.');
    const o = snap.data();
    if (o.userId && o.userId !== uid && context.auth.token.admin !== true) {
      throw new functions.https.HttpsError('permission-denied', 'Este pedido no es tuyo.');
    }
    if (o.descuentoConsumido === true) return;

    // ── Código promocional ──
    if (codeRefResolved) {
      const cSnap = await tx.get(codeRefResolved);
      if (cSnap.exists) {
        const c = cSnap.data();
        const maxUsos = c.maxUsos == null ? null : Number(c.maxUsos);
        const usos = Number(c.usosActuales) || 0;
        if (c.unSoloUsoPorUsuario) {
          const redRef = codeRefResolved.collection('redenciones').doc(uid);
          const redSnap = await tx.get(redRef);
          if (redSnap.exists && redSnap.data().orderId !== orderId) {
            throw new functions.https.HttpsError('failed-precondition', 'Ya usaste este código.');
          }
          if (!redSnap.exists) {
            tx.set(redRef, {
              usedAt: Date.now(),
              orderId,
              email: email || o.email || null
            });
          }
        }
        if (!(maxUsos != null && !isNaN(maxUsos) && usos >= maxUsos)) {
          tx.update(codeRefResolved, {
            usosActuales: usos + 1,
            updatedAt: Date.now()
          });
        }
      }
    }

    // ── Tarjeta de sellos (40%) ──
    if (o.stampCardCode) {
      const cardRef = db.collection('stamp-cards').doc(String(o.stampCardCode));
      const cardSnap = await tx.get(cardRef);
      if (cardSnap.exists) {
        const c = cardSnap.data();
        const cardEmail = String(c.emailLower || '').toLowerCase();
        const orderEmail = String(o.email || email || '').toLowerCase();
        if (cardEmail && orderEmail && cardEmail !== orderEmail && context.auth.token.admin !== true) {
          throw new functions.https.HttpsError('permission-denied', 'La tarjeta no pertenece a este correo.');
        }
        if (c.rewardUsed === true && c.rewardUsedOrderId && c.rewardUsedOrderId !== orderId) {
          throw new functions.https.HttpsError('failed-precondition', 'El 40% de la tarjeta ya fue usado.');
        }
        if (c.rewardUsed !== true || c.rewardUsedOrderId !== orderId) {
          tx.update(cardRef, {
            rewardUsed: true,
            rewardAvailable: false,
            rewardUsedAt: Date.now(),
            rewardUsedInPerson: false,
            rewardUsedOrderId: orderId,
            status: 'completed',
            completedAt: Date.now(),
            updatedAt: Date.now()
          });
        }
      }
    }

    tx.update(orderRef, { descuentoConsumido: true });
  });

  return { ok: true };
});

// ════════════════════════════════════════════════════════════════
//  añadirSelloPorPedido (callable)
//  Al marcar un pedido como ENTREGADO: +1 sello si total productos >= $1.
//  Idempotente vía pedidos.stampApplied + stampOrderIds en la tarjeta.
//  Solo admin. Si falla, el llamador NO debe revertir la entrega.
// ════════════════════════════════════════════════════════════════
exports.anadirSelloPorPedido = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Solo administradores.');
  }
  const orderId = String((data && data.orderId) || '');
  if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'Falta orderId.');

  const STAMP_TARGET = 8;
  const STAMP_MIN = 1;
  const orderRef = db.collection('pedidos').doc(orderId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return { ok: false, reason: 'not-found' };
    const o = snap.data();
    if (o.stampApplied === true) return { ok: true, reason: 'already' };

    // Compras con créditos PICO no suman sellos
    if ((Number(o.creditsUsed) || 0) > 0) {
      tx.update(orderRef, { stampApplied: true, stampSkipReason: 'credits' });
      return { ok: false, reason: 'credits' };
    }

    const emailLower = String(o.email || '').trim().toLowerCase();
    if (!emailLower) {
      tx.update(orderRef, { stampApplied: true, stampSkipReason: 'no-email' });
      return { ok: false, reason: 'no-email' };
    }

    const totalProd = typeof o.totalConDescuento === 'number'
      ? o.totalConDescuento
      : (typeof o.total === 'number' ? o.total : 0);
    if (!(totalProd >= STAMP_MIN)) {
      tx.update(orderRef, { stampApplied: true, stampSkipReason: 'below-min' });
      return { ok: false, reason: 'below-min' };
    }

    const q = db.collection('stamp-cards')
      .where('emailLower', '==', emailLower)
      .where('status', '==', 'active')
      .limit(1);
    const qSnap = await tx.get(q);
    if (qSnap.empty) {
      tx.update(orderRef, { stampApplied: true, stampSkipReason: 'no-card' });
      return { ok: false, reason: 'no-card' };
    }

    const cardDoc = qSnap.docs[0];
    const cardRef = cardDoc.ref;
    const c = cardDoc.data();
    const ids = Array.isArray(c.stampOrderIds) ? c.stampOrderIds.slice() : [];
    if (ids.includes(orderId)) {
      tx.update(orderRef, { stampApplied: true });
      return { ok: true, reason: 'already-on-card' };
    }

    let sellos = Number(c.sellos) || 0;
    if (sellos >= STAMP_TARGET) {
      tx.update(orderRef, { stampApplied: true, stampSkipReason: 'full' });
      return { ok: false, reason: 'full' };
    }

    sellos = Math.min(STAMP_TARGET, sellos + 1);
    ids.push(orderId);
    const rewardAvailable = sellos >= STAMP_TARGET && c.rewardUsed !== true;

    tx.update(cardRef, {
      sellos,
      stampOrderIds: ids,
      rewardAvailable,
      updatedAt: Date.now()
    });
    tx.update(orderRef, {
      stampApplied: true,
      stampCardCode: cardDoc.id,
      stampSellosAfter: sellos
    });
    return { ok: true, sellos, rewardAvailable };
  });

  return result;
});

// ════════════════════════════════════════════════════════════════
//  Patrocinio feria / CREAJ → email a soporte (sin auth)
// ════════════════════════════════════════════════════════════════
function _escMail(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

exports.solicitarPatrocinioCreditos = functions.https.onCall(async (data) => {
  const schoolKind = String((data && data.schoolKind) || '').trim();
  const institucion = String((data && data.institucion) || '').trim();
  const feria = String((data && data.feria) || '').trim();
  const proyecto = String((data && data.proyecto) || '').trim();
  const descripcion = String((data && data.descripcion) || '').trim();
  const integrantes = String((data && data.integrantes) || '').trim();
  const grado = String((data && data.grado) || '').trim();
  const seccion = String((data && data.seccion) || '').trim();
  const telefono = String((data && data.telefono) || '').trim();

  if (!['cdb', 'otros'].includes(schoolKind)) {
    throw new functions.https.HttpsError('invalid-argument', 'Colegio inválido.');
  }
  if (proyecto.length < 2 || proyecto.length > 160) {
    throw new functions.https.HttpsError('invalid-argument', 'Nombre de proyecto inválido.');
  }
  if (descripcion.length < 5 || descripcion.length > 2000) {
    throw new functions.https.HttpsError('invalid-argument', 'Descripción inválida.');
  }
  if (integrantes.length < 2 || integrantes.length > 1000) {
    throw new functions.https.HttpsError('invalid-argument', 'Integrantes inválidos.');
  }
  if (!grado || !seccion) {
    throw new functions.https.HttpsError('invalid-argument', 'Grado y sección obligatorios.');
  }
  if (telefono.length < 8 || telefono.length > 30) {
    throw new functions.https.HttpsError('invalid-argument', 'Teléfono inválido.');
  }
  const instFinal = schoolKind === 'cdb' ? 'Colegio Don Bosco' : institucion;
  const feriaFinal = schoolKind === 'cdb' ? 'CREAJ' : feria;
  if (instFinal.length < 2 || feriaFinal.length < 2) {
    throw new functions.https.HttpsError('invalid-argument', 'Institución / feria inválidas.');
  }

  const cuando = new Date().toLocaleString('es-SV');
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
    <h2 style="margin:0 0 8px">Solicitud de créditos por patrocinio</h2>
    <p style="margin:0 0 16px;color:#64748b">${cuando}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#64748b">Institución</td><td style="padding:6px 0;font-weight:700">${_escMail(instFinal)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Feria</td><td style="padding:6px 0;font-weight:700">${_escMail(feriaFinal)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Proyecto</td><td style="padding:6px 0;font-weight:700">${_escMail(proyecto)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Descripción</td><td style="padding:6px 0">${_escMail(descripcion)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Integrantes</td><td style="padding:6px 0">${_escMail(integrantes)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Grado / Sección</td><td style="padding:6px 0">${_escMail(grado)} · ${_escMail(seccion)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">WhatsApp / Tel</td><td style="padding:6px 0;font-weight:700">${_escMail(telefono)}</td></tr>
    </table>
    <p style="font-size:13px;color:#94a3b8;margin:18px 0 0">Continuar por WhatsApp. Al confirmar el cartel en el stand, otorgar créditos desde Inventario → Créditos.</p>
  </div>`;

  await db.collection('mail').add({
    to: NOTIFY_EMAIL,
    message: {
      subject: `Patrocinio créditos: ${proyecto} · ${instFinal}`,
      html,
      text: `Patrocinio créditos\nInstitución: ${instFinal}\nFeria: ${feriaFinal}\nProyecto: ${proyecto}\nIntegrantes: ${integrantes}\nGrado/Sección: ${grado} ${seccion}\nTel: ${telefono}\n${descripcion}`
    }
  });

  // Registro ligero para seguimiento (opcional)
  await db.collection('patrocinio-solicitudes').add({
    schoolKind,
    institucion: instFinal,
    feria: feriaFinal,
    proyecto,
    descripcion,
    integrantes,
    grado,
    seccion,
    telefono,
    createdAt: Date.now(),
    status: 'pendiente'
  }).catch(() => {});

  return { ok: true };
});

// ════════════════════════════════════════════════════════════════
//  Créditos: aplicar a un pedido (auth). 1 crédito = $1.
// ════════════════════════════════════════════════════════════════
exports.aplicarCreditosAPedido = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const orderId = String((data && data.orderId) || '');
  const requested = round2(Number((data && data.monto) || 0));
  if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'Falta orderId.');
  if (!(requested > 0)) return { ok: true, creditsUsed: 0 };

  const email = String(context.auth.token.email || '').trim().toLowerCase();
  if (!email) throw new functions.https.HttpsError('failed-precondition', 'Tu cuenta no tiene correo.');

  const orderRef = db.collection('pedidos').doc(orderId);
  const credRef = db.collection('creditos').doc(email);

  // No lanzar HttpsError DENTRO de la transacción (Firestore lo convierte en INTERNAL).
  let failCode = null;
  let failMsg = null;

  const result = await db.runTransaction(async (tx) => {
    // Lecturas secuenciales (Promise.all + tx.get rompe la transacción → INTERNAL)
    const oSnap = await tx.get(orderRef);
    const cSnap = await tx.get(credRef);

    if (!oSnap.exists) {
      failCode = 'not-found'; failMsg = 'Pedido no encontrado.';
      return null;
    }
    const o = oSnap.data();
    const ownerUid = o.userId || o.uid || null;
    if (ownerUid && ownerUid !== context.auth.uid && context.auth.token.admin !== true) {
      failCode = 'permission-denied'; failMsg = 'Este pedido no es tuyo.';
      return null;
    }
    if (o.creditsApplied === true) {
      return { ok: true, creditsUsed: Number(o.creditsUsed) || 0, already: true };
    }
    // No combinar con descuentos de carrito
    if (o.discountPct || o.discountId || o.discountCode || o.stampCardCode) {
      failCode = 'failed-precondition';
      failMsg = 'Los créditos no se combinan con otros descuentos.';
      return null;
    }
    if (!cSnap.exists) {
      failCode = 'failed-precondition'; failMsg = 'No tienes créditos disponibles.';
      return null;
    }
    const c = cSnap.data() || {};
    if (creditsUsoBloqueado(c)) {
      failCode = 'failed-precondition';
      failMsg = 'Tus créditos están pausados o bloqueados.';
      return null;
    }
    const saldo = Number(c.saldo) || 0;
    if (c.venceAt != null) {
      const ms = c.venceAt.toMillis ? c.venceAt.toMillis()
        : (typeof c.venceAt === 'number' ? c.venceAt : Date.parse(c.venceAt));
      if (ms && Date.now() > ms) {
        failCode = 'failed-precondition'; failMsg = 'Tus créditos ya vencieron.';
        return null;
      }
    }
    const productTotal = typeof o.totalConDescuento === 'number' ? o.totalConDescuento
      : (typeof o.total === 'number' ? o.total : 0);
    const use = round2(Math.min(saldo, requested, productTotal));
    if (!(use > 0)) {
      failCode = 'failed-precondition';
      failMsg = 'Saldo insuficiente o monto inválido.';
      return null;
    }

    let costTotal = 0;
    for (const it of (o.items || [])) {
      costTotal += (Number(it.cost) || 0) * (it.qty || 1);
    }
    const creditsCosto = productTotal > 0 ? round2(costTotal * (use / productTotal)) : 0;
    const payableProducts = round2(Math.max(0, productTotal - use));
    const ship = (o.tipoEntrega === 'domicilio')
      ? (typeof o.envioCosto === 'number' ? o.envioCosto : 0) : 0;
    const payableTotal = round2(payableProducts + ship);

    const mov = Array.isArray(c.movimientos) ? c.movimientos.slice(-39) : [];
    mov.push({
      tipo: 'uso',
      monto: use,
      at: Date.now(),
      orderId,
      costo: creditsCosto,
      nota: 'Pedido ' + (o.code || orderId)
    });

    tx.update(credRef, {
      saldo: round2(saldo - use),
      totalUsado: round2((Number(c.totalUsado) || 0) + use),
      movimientos: mov,
      updatedAt: Date.now()
    });

    const orderPatch = {
      creditsApplied: true,
      creditsUsed: use,
      creditsEmail: email,
      creditsCosto,
      payableAfterCredits: payableProducts,
      totalConEnvio: payableTotal,
      stampSkipReason: 'credits',
      stampApplied: true
    };
    // Cubierto al 100% con créditos (sin saldo a pagar)
    if (payableTotal <= 0) {
      orderPatch.paymentStatus = 'credits';
      orderPatch.creditsFullyPaid = true;
    } else if (use > 0) {
      // Pago mixto: queda saldo (tarjeta/efectivo/retiro)
      orderPatch.creditsPartial = true;
    }
    tx.update(orderRef, orderPatch);
    return { ok: true, creditsUsed: use, creditsCosto, payableAfterCredits: payableProducts, payableTotal };
  });

  if (failCode) {
    throw new functions.https.HttpsError(failCode, failMsg || 'No se pudieron aplicar los créditos.');
  }
  return result || { ok: true, creditsUsed: 0 };
});

// ════════════════════════════════════════════════════════════════
//  Créditos: restaurar al cancelar pedido (admin)
// ════════════════════════════════════════════════════════════════
exports.restaurarCreditosPedido = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Solo administradores.');
  }
  const orderId = String((data && data.orderId) || '');
  if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'Falta orderId.');

  const orderRef = db.collection('pedidos').doc(orderId);
  const result = await db.runTransaction(async (tx) => {
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists) return { ok: false, reason: 'not-found' };
    const o = oSnap.data();
    if (o.creditsRestored === true) return { ok: true, reason: 'already' };
    const used = Number(o.creditsUsed) || 0;
    if (!(used > 0) || !o.creditsApplied) {
      tx.update(orderRef, { creditsRestored: true });
      return { ok: true, reason: 'none' };
    }
    const email = String(o.creditsEmail || o.email || '').toLowerCase();
    if (!email) {
      tx.update(orderRef, { creditsRestored: true });
      return { ok: false, reason: 'no-email' };
    }
    const credRef = db.collection('creditos').doc(email);
    const cSnap = await tx.get(credRef);
    const costo = Number(o.creditsCosto) || 0;
    const statsDone = o.creditsStatsRecorded === true || (o.statsRecorded === true && used > 0);

    if (cSnap.exists) {
      const c = cSnap.data();
      const mov = Array.isArray(c.movimientos) ? c.movimientos.slice(-39) : [];
      mov.push({ tipo: 'reverso', monto: used, at: Date.now(), orderId, costo, nota: 'Cancelación pedido' });
      const patch = {
        saldo: round2((Number(c.saldo) || 0) + used),
        totalUsado: round2(Math.max(0, (Number(c.totalUsado) || 0) - used)),
        movimientos: mov,
        updatedAt: Date.now()
      };
      // Solo revertir costoInvertido si ya se había contabilizado en stats
      if (statsDone && costo > 0) {
        patch.costoInvertido = round2(Math.max(0, (Number(c.costoInvertido) || 0) - costo));
      }
      tx.update(credRef, patch);
    }
    tx.update(orderRef, { creditsRestored: true });
    return { ok: true, restored: used };
  });
  return result;
});
