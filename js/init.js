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
//  RETORNO DEL PAGO WOMPI (?pago=ok&order=...)
// ═══════════════════════════════════════════════════
// Wompi redirige a urlRedirect tras el reto 3DS, agregando sus propios
// parámetros (idTransaccion, esAprobada, hash...). NO confiamos en ellos para
// las estadísticas: solo marcamos paymentReturnAck=true; una Cloud Function
// (confirmWompiOnAck) RE-CONSULTA la transacción en Wompi —además del webhook—
// y recién entonces registra las estadísticas y marca el pago como confirmado.
(function handleWompiReturn() {
  try {
    const params = new URLSearchParams(location.search);
    const pago  = params.get('pago');
    const order = params.get('order');
    // Wompi añade 'esAprobada' (True/False) a la URL de retorno.
    const aprobada = (params.get('esAprobada') || '').toLowerCase();
    if (!pago && !order) return;

    if (order && aprobada !== 'false') {
      // Wompi añade 'idTransaccion' a la URL de retorno: lo guardamos para que
      // la confirmación de respaldo (confirmWompiOnAck) pueda re-consultarlo.
      const idTx = params.get('idTransaccion') || params.get('IdTransaccion') || null;
      const doAck = () => db.collection('pedidos').doc(order).update({
        paymentReturnAck: true,
        paymentReturnAt: firebase.firestore.FieldValue.serverTimestamp(),
        ...(idTx ? { wompiTxId: idTx } : {})
      }).catch(e => console.warn('No se pudo marcar el retorno del pago:', e));
      if (typeof currentUser !== 'undefined' && currentUser) {
        doAck();
      } else if (firebase.auth) {
        const off = firebase.auth().onAuthStateChanged(u => { if (u) { off(); doAck(); } });
      }
      // Mostrar al cliente la confirmación del pago (con su código de seguimiento)
      showPaymentConfirmed(order);
    } else if (aprobada === 'false' || pago === 'cancel') {
      showToast('⚠️ El pago no se completó — tu pedido sigue pendiente, puedes reintentarlo');
    }
    // Limpiar los parámetros de la URL sin recargar
    history.replaceState({}, '', location.pathname);
  } catch (e) {
    console.warn('No se pudo procesar el retorno del pago:', e);
  }
})();

// Modal de "Pago confirmado" tras volver de Wompi. Se construye aparte para no
// depender del estado del carrito (la página se recargó al volver de la pasarela).
function showPaymentConfirmed(orderId) {
  const build = (code) => {
    // Evitar duplicados si ya existe
    const prev = document.getElementById('paymentConfirmedModal');
    if (prev) prev.remove();
    const html =
      '<div class="moverlay" id="paymentConfirmedModal" style="z-index:700">' +
        '<div class="modal" style="max-width:420px">' +
          '<div class="mbody" style="text-align:center;padding:30px 26px 8px">' +
            '<div class="sicon" style="margin:0 auto 14px">✓</div>' +
            '<h2 style="font-size:1.25rem;font-weight:700;color:var(--g900);letter-spacing:-.01em;margin-bottom:6px">¡Pago confirmado!</h2>' +
            '<p style="color:var(--g400);font-size:.85rem;line-height:1.5;margin-bottom:6px">Tu pago se procesó correctamente y tu pedido ya está en preparación.</p>' +
            '<div style="display:flex;align-items:center;justify-content:center;gap:8px;background:#ecfdf5;border:1.5px solid #a7f3d0;border-radius:9px;padding:10px 14px;margin:12px 0">' +
              '<span>📦</span>' +
              '<p style="margin:0;font-size:.84rem;color:#065f46">Tu entrega llegará <b>aproximadamente mañana</b> (1 día hábil).</p>' +
            '</div>' +
            (code ? (
              '<div class="scode-box">' +
                '<div class="scode-lbl">Tu código de seguimiento</div>' +
                '<div class="scode">' + code + '</div>' +
              '</div>') : '') +
          '</div>' +
          '<div class="mfoot" style="padding-bottom:24px">' +
            '<button class="btn-pri" style="flex:none;width:100%" onclick="(function(){var m=document.getElementById(\'paymentConfirmedModal\');if(m)m.remove();if(typeof showPage===\'function\')showPage(\'myOrders\');})()">Ver Mis Pedidos</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    const m = document.getElementById('paymentConfirmedModal');
    if (m) m.classList.add('active'); // por si el CSS usa .active para mostrar
    if (m) m.style.display = 'flex';
  };

  // Intentamos traer el código del pedido para mostrarlo; si falla, igual mostramos la confirmación.
  try {
    db.collection('pedidos').doc(orderId).get()
      .then(snap => build(snap.exists ? (snap.data().code || '') : ''))
      .catch(() => build(''));
  } catch (_) {
    build('');
  }
}
