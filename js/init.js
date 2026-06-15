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
// Tras el pago con tarjeta, Stripe redirige de vuelta con ?pago=ok|cancel.
// Mostramos un aviso y limpiamos la URL (el pedido ya fue creado como 'pending').
(function handleStripeReturn() {
  try {
    const params = new URLSearchParams(location.search);
    const pago = params.get('pago');
    if (!pago) return;
    if (pago === 'ok') {
      showToast('✅ Pago recibido — tu pedido quedó registrado como pendiente');
    } else if (pago === 'cancel') {
      showToast('⚠️ Pago cancelado — tu pedido sigue pendiente, puedes reintentar el pago');
    }
    // Limpiar los parámetros de la URL sin recargar
    const clean = location.pathname;
    history.replaceState({}, '', clean);
  } catch (e) {
    console.warn('No se pudo procesar el retorno de Stripe:', e);
  }
})();
