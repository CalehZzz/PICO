// ════════════════════════════════════════════════════════════════
// PICO · Cloud Functions  ·  PASARELA: WOMPI EL SALVADOR
//
//  Objetivo: cuando un pedido a domicilio con TARJETA se paga vía Wompi,
//  registrar las estadísticas de venta (ventas, ingresos, costos) + la
//  comisión de Wompi (3.5% fijo, SIN cargo fijo) como costo. El stock ya
//  se descontó al crear el pedido (lado cliente, atómico).
//
//  Flujo (ENLACE DE PAGO · la tarjeta se captura EN WOMPI, nunca en PICO):
//   1) crearEnlaceWompi (callable): el servidor autentica con Wompi (OAuth
//      client_credentials), llama a POST /EnlacePago con
//      identificadorEnlaceComercio = orderId y monto = total del pedido, y
//      devuelve 'urlEnlace' (la pantalla de pago alojada por Wompi).
//   2) El navegador se redirige a urlEnlace; el cliente paga en Wompi.
//   3) CONFIRMACIÓN (nunca confiamos en el cliente):
//        • wompiWebhook (HTTP)  → principal. Wompi nos hace POST al terminar;
//          trae EnlacePago.IdentificadorEnlaceComercio (= orderId).
//        • confirmWompiOnAck (onUpdate) → respaldo, al volver del checkout
//          re-consultamos la transacción en Wompi por si el webhook falla.
//      Ambos re-consultan GET /TransaccionCompra/{id} y solo registran
//      estadísticas si la transacción está APROBADA y el monto coincide.
//
//  Secretos requeridos (Secret Manager):
//     firebase functions:secrets:set WOMPI_APP_ID
//     firebase functions:secrets:set WOMPI_API_SECRET
// ════════════════════════════════════════════════════════════════

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// ── Configuración Wompi ──
const WOMPI_ID_BASE  = 'https://id.wompi.sv';   // OAuth (token)
const WOMPI_API_BASE = 'https://api.wompi.sv';  // API de pagos
const WOMPI_FEE_PCT  = 0.035;                    // 3.5% fijo, SIN cargo fijo
const SHIPPING_COST  = 3.49;                     // costo de envío a domicilio (debe coincidir con el cliente)
const SECRETS = ['WOMPI_APP_ID', 'WOMPI_API_SECRET'];

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

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
//  Helper compartido: registra estadísticas de venta de un pedido con tarjeta
//  Idempotente: si el pedido ya tiene statsRecorded o paymentStatus 'paid', no hace nada.
// ════════════════════════════════════════════════════════════════
async function recordCardPaymentStats(orderId, wompiTxId) {
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
    if (o.metodoPago !== 'tarjeta') {
      console.log('Pedido no es de tarjeta, se omite:', orderId);
      return;
    }

    const sucursal = o.sucursal;
    const statDocId = (sucursal === 'cdb' || sucursal === 'domicilio') ? 'ColegioDonBosco' : 'ColegioExsal';
    // Sucursal contable: 'domicilio' vive bajo CDB. La VENTA se guarda con esta sucursal para
    // que aparezca en la lista de ventas del inventario (que solo filtra por 'exsal' | 'cdb').
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
        pid: item.id || null,
        productName: item.name,
        qty,
        precioUnit: unitPrice,
        costTotal: round2(unitCost * qty),
        total: itemTotal,
        descPct: o.discountPct || 0,
        descNombre: o.discountName || ''
      });
    }

    const totalEfectivo = typeof o.totalConDescuento === 'number'
      ? o.totalConDescuento
      : round2(priceTotal * discFactor);

    // Comisión de Wompi sobre el total realmente cobrado (productos con descuento + envío)
    const baseCobro = typeof o.totalConEnvio === 'number' ? o.totalConEnvio : totalEfectivo;
    const comisionWompi = round2(baseCobro * WOMPI_FEE_PCT);   // 3.5% fijo, sin cargo fijo

    // Envío cobrado al cliente (solo domicilio; los pedidos con tarjeta SIEMPRE son a domicilio).
    const esDom = o.tipoEntrega === 'domicilio';
    const envioCobrado = esDom ? (typeof o.envioCosto === 'number' ? o.envioCosto : 0) : 0;

    const now = new Date();
    const mesKey = now.getFullYear() + '-' + String(now.getMonth()).padStart(2, '0');

    // 1) Documento de venta (la comisión se incluye en costTotal → reduce la ganancia de la venta)
    const ventaRef = db.collection('ventas').doc();
    tx.set(ventaRef, {
      orderNumber: 'PED-' + Date.now().toString().slice(-6) + '-' + Math.random().toString(36).slice(-3),
      items: ventaItems,
      qty: totalUnidades,
      costProductos: round2(productCost),
      comisionWompi: comisionWompi,
      costTotal: round2(productCost + comisionWompi),
      total: round2(totalVentasEfectivo),
      seller: 'wompi',
      sucursal: ventaSucursal,
      date: now.toLocaleDateString('es'),
      timestamp: Date.now(),
      mes: mesKey,
      fromOrder: orderId,
      facturaId:  o.facturaId  || null,
      facturaNum: o.facturaNum || null,
      ...(o.discountPct ? { descuentoAplicado: { nombre: o.discountName, porcentaje: o.discountPct } } : {})
    });

    // 2) Estadísticas acumuladas (modelo MEZCLADO con CDB · mismo stock):
    //    • El envío cobrado al cliente se suma a 'ventas' e 'ingresosPedidos'.
    //    • La comisión Wompi se suma a 'costosPedidos' y a 'comisionesWompi'.
    //    • El costo de los PRODUCTOS ya está en 'costos' desde el reabastecimiento → no se re-suma.
    const creditsUsed = Math.max(0, Number(o.creditsUsed) || 0);
    const creditsCosto = Math.max(0, Number(o.creditsCosto) || 0);
    const statPayload = {
      'ventas':            admin.firestore.FieldValue.increment(round2(totalVentasEfectivo + envioCobrado)),
      'unidades vendidas': admin.firestore.FieldValue.increment(totalUnidades),
      'numero de ventas':  admin.firestore.FieldValue.increment(1),
      'ingresosPedidos':   admin.firestore.FieldValue.increment(round2(totalEfectivo + envioCobrado)),
      'costosPedidos':     admin.firestore.FieldValue.increment(round2(productCost + comisionWompi)),
      'comisionesWompi':   admin.firestore.FieldValue.increment(comisionWompi)
    };
    if (creditsUsed > 0) {
      statPayload['ventasCreditos'] = admin.firestore.FieldValue.increment(round2(creditsUsed));
    }
    if (envioCobrado > 0) {
      statPayload['ingresosEnvio'] = admin.firestore.FieldValue.increment(round2(envioCobrado));
    }
    tx.set(db.collection('estadisticas').doc(statDocId), statPayload, { merge: true });

    // Costo de promo (créditos): solo en el doc de créditos, NO en estadisticas.costos
    if (creditsUsed > 0 && creditsCosto > 0 && o.creditsEmail) {
      const credRef = db.collection('creditos').doc(String(o.creditsEmail).toLowerCase());
      tx.set(credRef, {
        costoInvertido: admin.firestore.FieldValue.increment(round2(creditsCosto)),
        updatedAt: Date.now()
      }, { merge: true });
    }

    // 3) Marcar el pedido como pagado y con estadísticas registradas
    tx.update(orderRef, {
      paymentStatus: 'paid',
      statsRecorded: true,
      creditsStatsRecorded: creditsUsed > 0,
      ingresoEnvioRegistrado: true,
      comisionWompi: comisionWompi,
      costTotalProductos: round2(productCost),
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(wompiTxId ? { wompiTxId } : {})
    });
  });

  console.log('✅ Estadísticas registradas para pedido', orderId);
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
    if (o.uid && o.uid !== uid) {
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
    const envioCosto = (o.tipoEntrega === 'domicilio') ? SHIPPING_COST : 0;
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

// 👉 PON AQUÍ TU CORREO para poder crear el primer administrador.
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
    <h2 style="margin:0 0 8px">🏫 Visita desde institución no listada</h2>
    <p style="margin:0 0 16px;color:#64748b">${cuando}</p>
    <p style="font-size:16px;margin:0 0 12px">Un visitante indicó que nos visita desde:</p>
    <p style="font-size:20px;font-weight:700;color:#0071e3;margin:0 0 16px">${safe}</p>
    <p style="font-size:13px;color:#94a3b8;margin:0">Se redirigió automáticamente a <b>envío a domicilio</b>. Si hace un pedido, el aviso de pedido incluirá esta institución.</p>
  </div>`;
  await db.collection('mail').add({
    to: NOTIFY_EMAIL,
    message: {
      subject: `🏫 Visita desde: ${institucion}`,
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
    <h2 style="margin:0 0 8px">💎 Solicitud de créditos por patrocinio</h2>
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
      subject: `💎 Patrocinio créditos: ${proyecto} · ${instFinal}`,
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

  const result = await db.runTransaction(async (tx) => {
    const [oSnap, cSnap] = await Promise.all([tx.get(orderRef), tx.get(credRef)]);
    if (!oSnap.exists) throw new functions.https.HttpsError('not-found', 'Pedido no encontrado.');
    const o = oSnap.data();
    if (o.userId && o.userId !== context.auth.uid && context.auth.token.admin !== true) {
      throw new functions.https.HttpsError('permission-denied', 'Este pedido no es tuyo.');
    }
    if (o.creditsApplied === true) {
      return { ok: true, creditsUsed: Number(o.creditsUsed) || 0, already: true };
    }
    // No combinar con descuentos de carrito
    if (o.discountPct || o.discountId || o.discountCode || o.stampCardCode) {
      throw new functions.https.HttpsError('failed-precondition', 'Los créditos no se combinan con otros descuentos.');
    }
    if (!cSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'No tienes créditos disponibles.');
    }
    const c = cSnap.data();
    let saldo = Number(c.saldo) || 0;
    if (c.venceAt != null) {
      const ms = c.venceAt.toMillis ? c.venceAt.toMillis()
        : (typeof c.venceAt === 'number' ? c.venceAt : Date.parse(c.venceAt));
      if (ms && Date.now() > ms) {
        throw new functions.https.HttpsError('failed-precondition', 'Tus créditos ya vencieron.');
      }
    }
    const productTotal = typeof o.totalConDescuento === 'number' ? o.totalConDescuento
      : (typeof o.total === 'number' ? o.total : 0);
    const use = round2(Math.min(saldo, requested, productTotal));
    if (!(use > 0)) return { ok: true, creditsUsed: 0 };

    // Costo proporcional de productos cubiertos por créditos (inversión promo)
    let costTotal = 0;
    for (const it of (o.items || [])) {
      costTotal += (Number(it.cost) || 0) * (it.qty || 1);
    }
    const creditsCosto = productTotal > 0 ? round2(costTotal * (use / productTotal)) : 0;

    const payableProducts = round2(Math.max(0, productTotal - use));
    const ship = (o.tipoEntrega === 'domicilio')
      ? (typeof o.envioCosto === 'number' ? o.envioCosto : 0) : 0;

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
    tx.update(orderRef, {
      creditsApplied: true,
      creditsUsed: use,
      creditsEmail: email,
      creditsCosto,
      payableAfterCredits: payableProducts,
      totalConEnvio: round2(payableProducts + ship),
      // totalConDescuento sigue siendo el subtotal de productos (antes de créditos)
      // para no romper desgloses; el cobro real usa payableAfterCredits / totalConEnvio.
      stampSkipReason: 'credits',
      stampApplied: true
    });
    return { ok: true, creditsUsed: use, creditsCosto, payableAfterCredits: payableProducts };
  });

  return result;
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
