// ════════════════════════════════════════════════════════════════
// PICO · Créditos de tienda (saldo por correo)
// 1 crédito = $1. No se combina con descuentos/códigos/sellos.
// Caducidad configurable al otorgar. Compras con créditos: sin sellos.
// ════════════════════════════════════════════════════════════════

let userCredits = null;       // { email, saldo, venceAt, ... } | null
let unsubCredits = null;
let creditsToUse = 0;         // monto a aplicar en el carrito (cliente)

function creditsDocId(email) {
  return String(email || '').trim().toLowerCase();
}

function creditsSaldoDisponible(doc) {
  if (!doc) return 0;
  const saldo = Number(doc.saldo) || 0;
  if (saldo <= 0) return 0;
  if (doc.venceAt != null) {
    const ms = typeof doc.venceAt === 'number' ? doc.venceAt
      : (doc.venceAt.toMillis ? doc.venceAt.toMillis() : Date.parse(doc.venceAt));
    if (ms && Date.now() > ms) return 0;
  }
  return +saldo.toFixed(2);
}

function creditsVencidos(doc) {
  if (!doc || doc.venceAt == null) return false;
  const ms = typeof doc.venceAt === 'number' ? doc.venceAt
    : (doc.venceAt.toMillis ? doc.venceAt.toMillis() : Date.parse(doc.venceAt));
  return !!(ms && Date.now() > ms && (Number(doc.saldo) || 0) > 0);
}

function startCreditsListener(email) {
  stopCreditsListener();
  const id = creditsDocId(email);
  if (!id) return;
  unsubCredits = db.collection('creditos').doc(id).onSnapshot(snap => {
    userCredits = snap.exists ? { id: snap.id, ...snap.data() } : null;
    const avail = creditsSaldoDisponible(userCredits);
    if (creditsToUse > avail) creditsToUse = avail;
    if (typeof renderCartDiscountSelector === 'function') renderCartDiscountSelector();
    if (typeof updateCartUI === 'function') updateCartUI();
  }, err => {
    console.warn('credits listener:', err);
    userCredits = null;
  });
}

function stopCreditsListener() {
  if (unsubCredits) { unsubCredits(); unsubCredits = null; }
  userCredits = null;
  creditsToUse = 0;
}

/** Monto de créditos a aplicar ahora (cap al subtotal de productos). */
function getCreditsAppliedAmount(productTotal) {
  const avail = creditsSaldoDisponible(userCredits);
  const want = Math.max(0, Number(creditsToUse) || 0);
  const cap = Math.max(0, Number(productTotal) || 0);
  return +Math.min(avail, want, cap).toFixed(2);
}

function setCreditsToUse(val) {
  const avail = creditsSaldoDisponible(userCredits);
  let n = parseFloat(val);
  if (isNaN(n) || n < 0) n = 0;
  creditsToUse = +Math.min(avail, n).toFixed(2);
  // No combinar con descuentos de carrito
  if (creditsToUse > 0 && selectedDiscount) {
    selectedDiscount = null;
    showToast('⚠️ Los créditos no se combinan con otros descuentos');
  }
  if (typeof renderCartDiscountSelector === 'function') renderCartDiscountSelector();
  if (typeof updateCartUI === 'function') updateCartUI();
}

function toggleUseAllCredits() {
  const raw = (typeof getCartRawTotal === 'function') ? getCartRawTotal() : 0;
  // Subtotal sin descuento de carrito si vamos a usar créditos
  const productTotal = (typeof getCartListTotal === 'function' && !PRODUCT_DISCOUNTS_LIVE)
    ? (typeof getCartRawTotal === 'function' ? getCartRawTotal() : raw)
    : raw;
  const avail = creditsSaldoDisponible(userCredits);
  if (creditsToUse > 0) setCreditsToUse(0);
  else setCreditsToUse(Math.min(avail, productTotal));
}

function renderCreditsCartBlock(productTotal) {
  const avail = creditsSaldoDisponible(userCredits);
  const expired = creditsVencidos(userCredits);
  if (!currentUser) {
    return `<div class="cart-credits-box cart-credits-muted">Inicia sesión para usar créditos PICO.</div>`;
  }
  if (expired) {
    return `<div class="cart-credits-box cart-credits-muted">Tus créditos vencieron. Escribe a soporte si necesitas renovarlos.</div>`;
  }
  if (avail <= 0) return '';

  const applied = getCreditsAppliedAmount(productTotal);
  const venceTxt = userCredits && userCredits.venceAt
    ? (() => {
        const ms = typeof userCredits.venceAt === 'number' ? userCredits.venceAt
          : (userCredits.venceAt.toMillis ? userCredits.venceAt.toMillis() : Date.parse(userCredits.venceAt));
        return ms ? ` · vencen ${new Date(ms).toLocaleDateString('es-SV')}` : '';
      })()
    : '';

  return `<div class="cart-credits-box">
    <div class="cart-credits-hd">
      <span>💎 Créditos PICO</span>
      <b>$${avail.toFixed(2)}</b>
    </div>
    <div class="cart-credits-sub">Saldo disponible${venceTxt}. No se combina con descuentos ni suma sellos.</div>
    <div class="cart-credits-row">
      <label>Usar $</label>
      <input type="number" id="creditsUseInput" min="0" max="${avail}" step="0.01"
        value="${applied ? applied.toFixed(2) : ''}" placeholder="0.00"
        onchange="setCreditsToUse(this.value)" oninput="setCreditsToUse(this.value)">
      <button type="button" class="nbtn nbtn-ghost" style="flex:none;padding:6px 10px;font-size:.78rem"
        onclick="toggleUseAllCredits()">${applied > 0 ? 'Quitar' : 'Usar máx.'}</button>
    </div>
    ${applied > 0 ? `<div class="cart-credits-applied">Se aplicarán <b>$${applied.toFixed(2)}</b> en créditos</div>` : ''}
  </div>`;
}

/** Tras crear el pedido: descuenta créditos en servidor (autoritativo). */
async function aplicarCreditosAlPedido(orderId, monto) {
  const m = +Number(monto || 0).toFixed(2);
  if (!(m > 0) || !orderId) return { ok: true, creditsUsed: 0 };
  const fn = firebase.functions().httpsCallable('aplicarCreditosAPedido');
  try {
    const res = await fn({ orderId, monto: m });
    return (res && res.data) || { ok: true, creditsUsed: 0 };
  } catch (e) {
    // Preferir mensaje de la CF (no el genérico "internal")
    const msg = (e && e.message) ? String(e.message).replace(/^Firebase:\s*/i, '').replace(/\s*\(.*\)$/, '') : 'Error interno';
    const err = new Error(msg);
    err.code = e && e.code;
    throw err;
  }
}
