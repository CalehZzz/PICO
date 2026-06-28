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
    const statPayload = {
      'ventas':            admin.firestore.FieldValue.increment(round2(totalVentasEfectivo + envioCobrado)),
      'unidades vendidas': admin.firestore.FieldValue.increment(totalUnidades),
      'numero de ventas':  admin.firestore.FieldValue.increment(1),
      'ingresosPedidos':   admin.firestore.FieldValue.increment(round2(totalEfectivo + envioCobrado)),
      'costosPedidos':     admin.firestore.FieldValue.increment(round2(productCost + comisionWompi)),
      'comisionesWompi':   admin.firestore.FieldValue.increment(comisionWompi)
    };
    if (envioCobrado > 0) {
      statPayload['ingresosEnvio'] = admin.firestore.FieldValue.increment(round2(envioCobrado));
    }
    tx.set(db.collection('estadisticas').doc(statDocId), statPayload, { merge: true });

    // 3) Marcar el pedido como pagado y con estadísticas registradas
    tx.update(orderRef, {
      paymentStatus: 'paid',
      statsRecorded: true,
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

    // Descuento: releer el porcentaje real desde 'descuentos' (no confiar en el pedido)
    let pct = 0;
    if (o.discountId) {
      try {
        const dSnap = await db.collection('descuentos').doc(String(o.discountId)).get();
        if (dSnap.exists) {
          const p = Number(dSnap.data().porcentaje);
          if (p > 0 && p <= 100) pct = p;
        }
      } catch (_) {}
    }
    const conDescuento = pct ? subtotal * (1 - pct / 100) : subtotal;
    const envioCosto = (o.tipoEntrega === 'domicilio') ? SHIPPING_COST : 0;
    const monto = round2(conDescuento + envioCosto);

    if (!monto || monto <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Monto del pedido inválido.');
    }

    // Si el monto guardado no coincide con el recalculado, "sanamos" el pedido con el
    // valor autoritativo para que el webhook (que compara contra totalConEnvio) cuadre.
    if (typeof o.totalConEnvio !== 'number' || Math.abs(o.totalConEnvio - monto) > 0.01) {
      console.warn('Monto del pedido', orderId, 'corregido de', o.totalConEnvio, 'a', monto);
      await orderRef.update({
        total: round2(subtotal),
        totalConDescuento: pct ? round2(conDescuento) : null,
        discountPct: pct || null,
        totalConEnvio: monto,
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
   'calebrenebr@gmail.com',
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
