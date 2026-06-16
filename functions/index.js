// ════════════════════════════════════════════════════════════════
// PICO · Cloud Functions
//
//  Objetivo: cuando un pedido con TARJETA se paga en Stripe, registrar las
//  estadísticas de venta (ventas, ingresos, costos) + la comisión de Stripe
//  (2.9% + $0.30) como costo. El stock ya se descontó al crear el pedido.
//
//  ¿Por qué verificamos con Stripe? Porque la extensión no siempre crea el
//  documento de pago en customers/{uid}/payments. Así que al volver del
//  checkout marcamos el pedido (paymentReturnAck) y aquí RETRIEVE-amos la
//  sesión en Stripe para confirmar que payment_status === 'paid' antes de
//  tocar cualquier estadística. Nunca confiamos en el cliente.
//
//  Dos disparadores, ambos idempotentes (usan el mismo helper):
//   1) confirmStripeOnAck  → onUpdate de pedidos/{id} (verifica con Stripe).
//   2) onStripePaymentSucceeded → backup, por si la extensión SÍ sincroniza
//      el pago en customers/{uid}/payments/{id}.
//
//  Requiere el secreto STRIPE_SECRET_KEY (Secret Manager):
//     firebase functions:secrets:set STRIPE_SECRET_KEY
// ════════════════════════════════════════════════════════════════

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const STRIPE_FEE_PCT = 0.029;   // 2.9%
const STRIPE_FEE_FIXED = 0.30;  // + $0.30

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// ── Helper compartido: registra estadísticas de venta de un pedido con tarjeta ──
// Idempotente: si el pedido ya tiene statsRecorded o paymentStatus 'paid', no hace nada.
async function recordCardPaymentStats(orderId, stripePaymentId) {
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

    // Comisión de Stripe sobre el total realmente cobrado (productos con descuento + envío)
    const baseCobro = typeof o.totalConEnvio === 'number' ? o.totalConEnvio : totalEfectivo;
    const comisionStripe = round2(baseCobro * STRIPE_FEE_PCT + STRIPE_FEE_FIXED);

    const now = new Date();
    const mesKey = now.getFullYear() + '-' + String(now.getMonth()).padStart(2, '0');

    // 1) Documento de venta (la comisión se incluye en costTotal → reduce la ganancia de la venta)
    const ventaRef = db.collection('ventas').doc();
    tx.set(ventaRef, {
      orderNumber: 'PED-' + Date.now().toString().slice(-6) + '-' + Math.random().toString(36).slice(-3),
      items: ventaItems,
      qty: totalUnidades,
      costProductos: round2(productCost),
      comisionStripe: comisionStripe,
      costTotal: round2(productCost + comisionStripe),
      total: round2(totalVentasEfectivo),
      seller: 'stripe',
      sucursal: ventaSucursal,
      date: now.toLocaleDateString('es'),
      timestamp: Date.now(),
      mes: mesKey,
      fromOrder: orderId,
      facturaId:  o.facturaId  || null,
      facturaNum: o.facturaNum || null,
      ...(o.discountPct ? { descuentoAplicado: { nombre: o.discountName, porcentaje: o.discountPct } } : {})
    });

    // 2) Estadísticas acumuladas (la comisión va en costosPedidos → baja la ganancia)
    const statPayload = {
      'ventas':            admin.firestore.FieldValue.increment(round2(totalVentasEfectivo)),
      'unidades vendidas': admin.firestore.FieldValue.increment(totalUnidades),
      'numero de ventas':  admin.firestore.FieldValue.increment(1),
      'ingresosPedidos':   admin.firestore.FieldValue.increment(round2(totalEfectivo)),
      'costosPedidos':     admin.firestore.FieldValue.increment(round2(productCost + comisionStripe)),
      'comisionesStripe':  admin.firestore.FieldValue.increment(comisionStripe)
      // NOTA: pedidosEntregados / pedidosPendientes NO se tocan aquí (eso ocurre al ENTREGAR).
    };
    tx.set(db.collection('estadisticas').doc(statDocId), statPayload, { merge: true });

    // 3) Marcar el pedido como pagado y con estadísticas registradas
    tx.update(orderRef, {
      paymentStatus: 'paid',
      statsRecorded: true,
      comisionStripe: comisionStripe,
      costTotalProductos: round2(productCost),
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(stripePaymentId ? { stripePaymentId } : {})
    });
  });

  console.log('✅ Estadísticas registradas para pedido', orderId);
}

// ════════════════════════════════════════════════════════════════
//  1) Confirmación al volver del checkout (verifica con Stripe)
// ════════════════════════════════════════════════════════════════
exports.confirmStripeOnAck = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .firestore.document('pedidos/{orderId}')
  .onUpdate(async (change, context) => {
    const after = change.after.data() || {};
    const orderId = context.params.orderId;

    // Solo nos interesa: tarjeta, marcado de retorno, aún no pagado/registrado
    if (after.metodoPago !== 'tarjeta') return null;
    if (after.paymentReturnAck !== true) return null;
    if (after.paymentStatus === 'paid' || after.statsRecorded === true) return null;
    if (!after.stripeSessionId) {
      console.warn('Pedido sin stripeSessionId, no se puede verificar:', orderId);
      return null;
    }

    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(after.stripeSessionId);
      if (session.payment_status !== 'paid') {
        console.log('La sesión aún no está pagada:', orderId, session.payment_status);
        return null;
      }
      const pid = (session.payment_intent && typeof session.payment_intent === 'string')
        ? session.payment_intent : null;
      await recordCardPaymentStats(orderId, pid);
    } catch (err) {
      console.error('Error verificando/registrando el pago del pedido', orderId, err);
    }
    return null;
  });

// ════════════════════════════════════════════════════════════════
//  2) Backup: si la extensión SÍ sincroniza el pago en Firestore
// ════════════════════════════════════════════════════════════════
exports.onStripePaymentSucceeded = functions
  .firestore.document('customers/{uid}/payments/{paymentId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after) return null;
    if (after.status !== 'succeeded') return null;
    const orderId = (after.metadata && after.metadata.orderId) || null;
    if (!orderId) return null;
    try {
      await recordCardPaymentStats(orderId, context.params.paymentId);
    } catch (err) {
      console.error('Error (backup) registrando pago del pedido', orderId, err);
    }
    return null;
  });
