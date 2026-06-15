// ════════════════════════════════════════════════════════════════
// PICO · Inicialización (se ejecuta al final)
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
// loadProducts() se llama desde onAuthStateChanged para garantizar
// que el stockMap se ajuste según el estado de sesión.
loadCart();
updateNavAuth();
updateCartUI();
// Obligar a elegir sucursal antes de continuar
if (!selectedSucursal) showSucursalGate();

// ═══════════════════════════════════════════════════
//  RETORNO DE STRIPE CHECKOUT (?pago=ok | ?pago=cancel)
// ═══════════════════════════════════════════════════
// Stripe solo redirige a success_url cuando el pago se completó. Al volver,
// marcamos el pedido con paymentReturnAck=true; una Cloud Function VERIFICA
// el pago con Stripe (no confía en el cliente) y recién entonces registra las
// estadísticas y marca el pago como confirmado.
(function handleStripeReturn() {
  try {
    const params = new URLSearchParams(location.search);
    const pago  = params.get('pago');
    const order = params.get('order');
    if (!pago) return;

    if (pago === 'ok') {
      showToast('✅ Pago recibido — confirmando tu pedido...');
      if (order) {
        const doAck = () => db.collection('pedidos').doc(order).update({
          paymentReturnAck: true,
          paymentReturnAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.warn('No se pudo marcar el retorno del pago:', e));
        // Asegurar que haya sesión antes de escribir (las reglas requieren auth)
        if (typeof currentUser !== 'undefined' && currentUser) {
          doAck();
        } else if (firebase.auth) {
          const off = firebase.auth().onAuthStateChanged(u => { if (u) { off(); doAck(); } });
        }
      }
    } else if (pago === 'cancel') {
      showToast('⚠️ Pago cancelado — tu pedido sigue pendiente, puedes reintentar el pago');
    }
    // Limpiar los parámetros de la URL sin recargar
    history.replaceState({}, '', location.pathname);
  } catch (e) {
    console.warn('No se pudo procesar el retorno de Stripe:', e);
  }
})();
