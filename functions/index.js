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

    // Envío cobrado al cliente (solo domicilio; los pedidos con tarjeta SIEMPRE son a domicilio).
    // Se reconoce como INGRESO en el mismo momento del pago.
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

    // 2) Estadísticas acumuladas. Modelo MEZCLADO con CDB (mismo stock):
    //    • El envío cobrado al cliente se suma a 'ventas' e 'ingresosPedidos'.
    //    • La comisión Stripe se suma a 'costosPedidos' (vista pedidos) y a 'comisionesStripe'.
    //      La comisión se suma a 'costos' (principal) al CONFIRMAR el pedido en el panel admin
    //      (lado cliente, junto con el envío real) → no depende del despliegue de la función.
    //    • El costo de los PRODUCTOS ya está en 'costos' desde el reabastecimiento → no se re-suma.
    const statPayload = {
      'ventas':            admin.firestore.FieldValue.increment(round2(totalVentasEfectivo + envioCobrado)),
      'unidades vendidas': admin.firestore.FieldValue.increment(totalUnidades),
      'numero de ventas':  admin.firestore.FieldValue.increment(1),
      'ingresosPedidos':   admin.firestore.FieldValue.increment(round2(totalEfectivo + envioCobrado)),
      'costosPedidos':     admin.firestore.FieldValue.increment(round2(productCost + comisionStripe)),
      'comisionesStripe':  admin.firestore.FieldValue.increment(comisionStripe)
      // NOTA: pedidosEntregados / pedidosPendientes NO se tocan aquí (eso ocurre al ENTREGAR).
    };
    if (envioCobrado > 0) {
      statPayload['ingresosEnvio'] = admin.firestore.FieldValue.increment(round2(envioCobrado));
    }
    tx.set(db.collection('estadisticas').doc(statDocId), statPayload, { merge: true });

    // 3) Marcar el pedido como pagado y con estadísticas registradas
    tx.update(orderRef, {
      paymentStatus: 'paid',
      statsRecorded: true,
      // El envío cobrado ya quedó registrado en ingresos/ventas → no se vuelve a sumar al entregar.
      ingresoEnvioRegistrado: true,
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

// ════════════════════════════════════════════════════════════════
//  3) Sincronización de productos con Stripe (catálogo + precios)
//
//  Disparador: onWrite de productos/{productId}.
//   • Crear producto  → crea Product + Price en Stripe; guarda
//     stripeProductId / stripePriceId / stripePriceAmount en el doc.
//   • Editar precio    → los Price de Stripe son INMUTABLES, así que
//     se crea un Price nuevo, se deja como default_price del producto
//     y se archiva el anterior.
//   • Editar nombre/desc → actualiza el Product en Stripe.
//   • Borrar/purgar     → archiva (active:false) el Product en Stripe.
//
//  A prueba de bucles y de cambios irrelevantes (stock/restock):
//  sale temprano si ya está sincronizado y no cambió name/desc/price.
//  Requiere el secreto STRIPE_SECRET_KEY (ya configurado).
// ════════════════════════════════════════════════════════════════
exports.syncProductToStripe = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .firestore.document('productos/{productId}')
  .onWrite(async (change, context) => {
    const productId = context.params.productId;
    const before = change.before.exists ? change.before.data() : null;
    const after  = change.after.exists  ? change.after.data()  : null;
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // ── BORRADO / PURGA: archivar el producto en Stripe ──
    if (!after) {
      const prodId = before && before.stripeProductId;
      if (prodId) {
        try { await stripe.products.update(prodId, { active: false }); }
        catch (err) { console.error('No se pudo archivar el producto en Stripe', productId, err); }
      }
      return null;
    }

    // ── Salida temprana: ya sincronizado y sin cambios relevantes ──
    // (Evita bucles tras nuestro propio write-back y evita trabajo en
    //  cambios de stock/restock que no tocan name/desc/price.)
    if (before && after.stripeProductId && after.stripePriceId &&
        before.name === after.name &&
        (before.desc || '') === (after.desc || '') &&
        before.price === after.price &&
        after.stripePriceAmount === after.price) {
      return null;
    }

    const name  = (after.name || 'Producto').toString();
    const desc  = (after.desc || '').toString();
    const price = (typeof after.price === 'number') ? after.price : parseFloat(after.price);
    if (isNaN(price) || price < 0) {
      console.warn('Producto con precio inválido; no se sincroniza:', productId, after.price);
      return null;
    }
    const amount = Math.round(price * 100); // centavos USD

    try {
      // ── 1) Asegurar que existe el Product en Stripe ──
      let stripeProductId = after.stripeProductId || null;

      // Recuperar el product de un precio migrado a mano (solo trae stripePriceId).
      if (!stripeProductId && after.stripePriceId) {
        try {
          const existing = await stripe.prices.retrieve(after.stripePriceId);
          if (existing && existing.product) {
            stripeProductId = (typeof existing.product === 'string')
              ? existing.product : existing.product.id;
          }
        } catch (e) { /* el precio viejo ya no existe; crearemos uno nuevo */ }
      }

      if (!stripeProductId) {
        const product = await stripe.products.create({
          name,
          ...(desc ? { description: desc } : {}),
          metadata: { firestoreId: productId }
        });
        stripeProductId = product.id;
      } else if (before && (before.name !== after.name || (before.desc || '') !== (after.desc || ''))) {
        // Actualizar nombre/descripción si cambiaron
        await stripe.products.update(stripeProductId, {
          name,
          description: desc || null
        });
      }

      // ── 2) Precio: crear uno nuevo si cambió el monto o aún no existe ──
      // Los Price de Stripe son inmutables; "editar precio" = nuevo Price
      // como default + archivar el anterior.
      let stripePriceId = after.stripePriceId || null;
      const needsPrice = !stripePriceId || (after.stripePriceAmount !== price);

      if (needsPrice) {
        const newPrice = await stripe.prices.create({
          product: stripeProductId,
          currency: 'usd',
          unit_amount: amount
        });
        await stripe.products.update(stripeProductId, { default_price: newPrice.id });
        if (stripePriceId && stripePriceId !== newPrice.id) {
          try { await stripe.prices.update(stripePriceId, { active: false }); }
          catch (err) { console.warn('No se pudo archivar el precio anterior', stripePriceId, err); }
        }
        stripePriceId = newPrice.id;
      }

      // ── 3) Guardar IDs en Firestore (solo si cambió algo: no re-dispara) ──
      const patch = {};
      if (after.stripeProductId   !== stripeProductId) patch.stripeProductId   = stripeProductId;
      if (after.stripePriceId     !== stripePriceId)   patch.stripePriceId     = stripePriceId;
      if (after.stripePriceAmount !== price)           patch.stripePriceAmount = price;
      if (Object.keys(patch).length) {
        await db.collection('productos').doc(productId).set(patch, { merge: true });
      }
    } catch (err) {
      console.error('Error sincronizando producto con Stripe', productId, err);
    }
    return null;
  });
