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
