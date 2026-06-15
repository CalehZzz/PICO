// ════════════════════════════════════════════════════════════════
// PICO · Cloud Functions
//
//  onStripePaymentSucceeded
//  ─────────────────────────
//  La extensión "Run Payments with Stripe" sincroniza cada pago en
//  customers/{uid}/payments/{paymentId} (objeto PaymentIntent de Stripe).
//  Cuando el pago llega a status "succeeded", esta función:
//    1) Lee el orderId desde metadata (lo mandamos en payment_intent_data.metadata).
//    2) Descuenta el stock del pedido de forma atómica (domicilio usa stockCdb).
//    3) Marca el pedido como paymentStatus:'paid' y stockDeducted:true.
//
//  Es idempotente: si el pedido ya tiene stockDeducted=true o paymentStatus='paid',
//  no vuelve a descontar (la extensión puede escribir el doc más de una vez).
// ════════════════════════════════════════════════════════════════

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

exports.onStripePaymentSucceeded = functions.firestore
  .document('customers/{uid}/payments/{paymentId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after) return null;

    // Solo nos interesa el pago cuando está completado
    if (after.status !== 'succeeded') return null;

    // El orderId viaja en metadata (lo seteamos en el checkout_session → payment_intent_data.metadata)
    const orderId = (after.metadata && after.metadata.orderId) || null;
    if (!orderId) {
      console.warn('Pago succeeded sin orderId en metadata:', context.params.uid, context.params.paymentId);
      return null;
    }

    const orderRef = db.collection('pedidos').doc(orderId);

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(orderRef);
        if (!snap.exists) {
          console.warn('El pedido no existe:', orderId);
          return;
        }
        const order = snap.data();

        // Idempotencia: si ya se procesó el pago o ya se descontó el stock, no hacer nada
        if (order.paymentStatus === 'paid' || order.stockDeducted === true) {
          console.log('Pedido ya procesado, se omite:', orderId);
          return;
        }

        // Descontar stock de la sucursal correcta (domicilio = stock de CDB)
        const sucursal = order.sucursal;
        const stockField = (sucursal === 'cdb' || sucursal === 'domicilio') ? 'stockCdb' : 'stockExsal';

        for (const item of (order.items || [])) {
          if (!item || !item.id) continue;
          tx.update(db.collection('productos').doc(item.id), {
            [stockField]: admin.firestore.FieldValue.increment(-(item.qty || 0)),
            updatedAt: Date.now()   // sello para el caché incremental del front
          });
        }

        // Confirmar el pago en el pedido
        tx.update(orderRef, {
          paymentStatus: 'paid',
          stockDeducted: true,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          stripePaymentId: context.params.paymentId
        });
      });

      console.log('✅ Pago confirmado y stock descontado para pedido', orderId);
    } catch (err) {
      console.error('❌ Error procesando el pago del pedido', orderId, err);
    }

    return null;
  });
