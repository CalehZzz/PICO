// ════════════════════════════════════════════════════════════════
// PICO · Página pública de tarjeta de sellos: /tarjetas/CODIGO
// ════════════════════════════════════════════════════════════════

const STAMP_QR_COLOR = '#1E72B0';
const STAMP_LOGO_URL = 'https://picosv.com/logo.png';

function getStampCodeFromUrl() {
  try {
    const params = new URLSearchParams(location.search);
    const q = (params.get('c') || params.get('codigo') || '').trim();
    if (q) return q.toUpperCase();
    // /tarjetas/CODIGO o /tarjetas/CODIGO/
    const parts = location.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p.toLowerCase() === 'tarjetas');
    if (idx >= 0 && parts[idx + 1]) {
      return decodeURIComponent(parts[idx + 1]).trim().toUpperCase();
    }
  } catch (_) {}
  return '';
}

function escStamp(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatStampDate(v) {
  if (v == null || v === '') return '—';
  try {
    const ms = (typeof v.toMillis === 'function') ? v.toMillis()
      : (typeof v === 'number' ? v : Date.parse(v));
    if (!ms || isNaN(ms)) return String(v);
    return new Date(ms).toLocaleDateString('es-SV', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_) { return '—'; }
}

let _stampUnsub = null;
let _stampData = null;
let _stampCode = '';

function initStampCardPage() {
  if (document.body.dataset.page !== 'stampCard') return;
  _stampCode = getStampCodeFromUrl();
  const root = document.getElementById('stampCardRoot');
  if (!_stampCode) {
    root.innerHTML = `
      <div class="stamp-card-view">
        <h1>Tarjeta de sellos</h1>
        <p class="stamp-sub">No se indicó un código. Escanea el QR de tu tarjeta o abre el enlace completo.</p>
      </div>`;
    return;
  }
  if (_stampUnsub) { _stampUnsub(); _stampUnsub = null; }
  _stampUnsub = db.collection('stamp-cards').doc(_stampCode).onSnapshot(snap => {
    if (!snap.exists) {
      _stampData = null;
      root.innerHTML = `
        <div class="stamp-card-view">
          <h1>Tarjeta no encontrada</h1>
          <p class="stamp-sub">El código <b>${escStamp(_stampCode)}</b> no existe.</p>
        </div>`;
      return;
    }
    _stampData = { code: snap.id, ...snap.data() };
    renderStampCardView();
  }, err => {
    console.error(err);
    root.innerHTML = `<div class="stamp-card-view"><p class="stamp-sub" style="color:#dc2626">No se pudo cargar la tarjeta. ${escStamp(err.message)}</p></div>`;
  });
}

function renderStampSlots(sellos) {
  const n = Math.max(0, Math.min(8, Number(sellos) || 0));
  let html = '<div class="stamp-slots" aria-label="Progreso de sellos">';
  for (let i = 1; i <= 8; i++) {
    html += `<div class="stamp-slot ${i <= n ? 'filled' : ''}" title="Sello ${i}">${i <= n ? '✓' : i}</div>`;
  }
  html += '</div>';
  return html;
}

function renderStampCardView() {
  const root = document.getElementById('stampCardRoot');
  if (!root || !_stampData) return;
  const c = _stampData;
  const sellos = Number(c.sellos) || 0;
  const faltan = Math.max(0, 8 - sellos);
  const status = c.status || 'active';
  const rewardReady = status === 'active' && (c.rewardAvailable === true || sellos >= 8) && c.rewardUsed !== true;

  let statusBadge = '';
  if (status === 'completed') {
    statusBadge = '<span class="stamp-badge done">Terminada</span>';
  } else if (status === 'cancelled') {
    statusBadge = '<span class="stamp-badge cancel">Cancelada</span>';
  } else if (rewardReady) {
    statusBadge = '<span class="stamp-badge ready">40% disponible</span>';
  } else {
    statusBadge = '<span class="stamp-badge active">Activa</span>';
  }

  let progressMsg = '';
  if (status === 'completed') {
    progressMsg = c.rewardUsedInPerson
      ? 'Esta tarjeta ya se canjeó en persona. Se archivó; hay que crear una nueva en el inventario.'
      : 'Esta tarjeta ya se canjeó online. Se archivó; hay que crear una nueva en el inventario.';
  } else if (rewardReady) {
    progressMsg = '¡Completaste 8 sellos! Tienes <b>40% disponible</b> en tu próxima compra online (o pídelo en persona).';
  } else {
    progressMsg = `Te faltan <b>${faltan}</b> sello${faltan === 1 ? '' : 's'} para el 40% de descuento.`;
  }

  const adminPanel = isAdmin ? renderStampAdminPanel(c) : '';

  root.innerHTML = `
    <div class="stamp-card-view">
      <div class="stamp-card-header">
        <div>
          <p class="stamp-eyebrow">Tarjeta de fidelidad PICO</p>
          <h1>${escStamp(c.nombre || 'Tarjeta de sellos')}</h1>
          <p class="stamp-meta">Código <b>${escStamp(c.code || _stampCode)}</b> · ${statusBadge}</p>
        </div>
      </div>
      ${renderStampSlots(sellos)}
      <p class="stamp-progress-text">${sellos}/8 sellos</p>
      <p class="stamp-sub">${progressMsg}</p>
      <div class="stamp-info-grid">
        <div><span>Correo</span><b>${escStamp(c.email || '—')}</b></div>
        <div><span>Creada</span><b>${escStamp(formatStampDate(c.createdAt || c.fecha))}</b></div>
      </div>
      <div id="stampQrBox" class="stamp-qr-box"></div>
      ${adminPanel}
    </div>
  `;

  renderStampQr(c.code || _stampCode);
}

function renderStampAdminPanel(c) {
  const status = c.status || 'active';
  const disabled = status !== 'active' ? 'disabled' : '';
  return `
    <div class="stamp-admin">
      <h3>Gestión (admin)</h3>
      <p class="stamp-admin-help">Edita datos, suma/resta sellos o marca el 40% como usado en persona (archiva la tarjeta).</p>
      <div class="stamp-admin-grid">
        <label>Nombre<input id="saNombre" class="finput" value="${escStamp(c.nombre || '')}" ${disabled}></label>
        <label>Correo<input id="saEmail" type="email" class="finput" value="${escStamp(c.email || '')}" ${disabled}></label>
        <label>Fecha (opcional)<input id="saFecha" type="date" class="finput" value="${stampDateInputValue(c.fecha || c.createdAt)}" ${disabled}></label>
        <label>Sellos (0–8)<input id="saSellos" type="number" min="0" max="8" class="finput" value="${Number(c.sellos) || 0}" ${disabled}></label>
      </div>
      <div class="stamp-admin-actions">
        <button class="nbtn" ${disabled} onclick="stampAdminAdjust(-1)">−1 sello</button>
        <button class="nbtn" ${disabled} onclick="stampAdminAdjust(1)">+1 sello</button>
        <button class="nbtn" ${disabled} onclick="stampAdminSave()">Guardar datos</button>
        <button class="nbtn nbtn-outline" ${disabled} onclick="stampAdminMarkUsedInPerson()" style="border-color:#dc2626;color:#dc2626">Marcar 40% usado en persona</button>
      </div>
      <div id="stampAdminMsg" class="stamp-admin-msg"></div>
    </div>
  `;
}

function stampDateInputValue(v) {
  try {
    const ms = (v && typeof v.toMillis === 'function') ? v.toMillis()
      : (typeof v === 'number' ? v : Date.parse(v));
    if (!ms || isNaN(ms)) return '';
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch (_) { return ''; }
}

async function stampAdminSave() {
  if (!isAdmin || !_stampCode) return;
  const msg = document.getElementById('stampAdminMsg');
  const nombre = (document.getElementById('saNombre').value || '').trim();
  const email = (document.getElementById('saEmail').value || '').trim();
  const fechaStr = document.getElementById('saFecha').value;
  let sellos = parseInt(document.getElementById('saSellos').value, 10);
  if (isNaN(sellos)) sellos = 0;
  sellos = Math.max(0, Math.min(8, sellos));
  const emailLower = email.toLowerCase();
  const patch = {
    nombre,
    email,
    emailLower,
    sellos,
    rewardAvailable: sellos >= 8 && !(_stampData && _stampData.rewardUsed),
    updatedAt: Date.now()
  };
  if (fechaStr) patch.fecha = Date.parse(fechaStr + 'T12:00:00');
  try {
    // Una sola tarjeta activa por correo
    if (emailLower && _stampData && _stampData.status === 'active') {
      const other = await db.collection('stamp-cards')
        .where('emailLower', '==', emailLower)
        .where('status', '==', 'active')
        .limit(2)
        .get();
      const conflict = other.docs.some(d => d.id !== _stampCode);
      if (conflict) {
        if (msg) { msg.style.color = '#dc2626'; msg.textContent = 'Ese correo ya tiene otra tarjeta activa.'; }
        return;
      }
    }
    await db.collection('stamp-cards').doc(_stampCode).update(patch);
    if (msg) { msg.style.color = 'var(--green)'; msg.textContent = '✅ Guardado.'; }
  } catch (e) {
    if (msg) { msg.style.color = '#dc2626'; msg.textContent = 'Error: ' + e.message; }
  }
}

async function stampAdminAdjust(delta) {
  if (!isAdmin || !_stampCode || !_stampData) return;
  const cur = Number(_stampData.sellos) || 0;
  const next = Math.max(0, Math.min(8, cur + delta));
  const el = document.getElementById('saSellos');
  if (el) el.value = String(next);
  try {
    await db.collection('stamp-cards').doc(_stampCode).update({
      sellos: next,
      rewardAvailable: next >= 8 && _stampData.rewardUsed !== true,
      updatedAt: Date.now()
    });
  } catch (e) {
    const msg = document.getElementById('stampAdminMsg');
    if (msg) { msg.style.color = '#dc2626'; msg.textContent = 'Error: ' + e.message; }
  }
}

async function stampAdminMarkUsedInPerson() {
  if (!isAdmin || !_stampCode) return;
  if (!confirm('¿Marcar el 40% como usado en persona? La tarjeta pasará a terminadas y ya no se podrá usar online.')) return;
  const msg = document.getElementById('stampAdminMsg');
  try {
    await db.collection('stamp-cards').doc(_stampCode).update({
      rewardUsed: true,
      rewardAvailable: false,
      rewardUsedInPerson: true,
      rewardUsedAt: Date.now(),
      status: 'completed',
      completedAt: Date.now(),
      updatedAt: Date.now()
    });
    if (msg) { msg.style.color = 'var(--green)'; msg.textContent = '✅ Tarjeta archivada (usada en persona).'; }
  } catch (e) {
    if (msg) { msg.style.color = '#dc2626'; msg.textContent = 'Error: ' + e.message; }
  }
}

function renderStampQr(code) {
  const box = document.getElementById('stampQrBox');
  if (!box || typeof QRCodeStyling === 'undefined') return;
  const url = 'https://picosv.com/tarjetas/' + encodeURIComponent(code);
  box.innerHTML = '';
  const qr = new QRCodeStyling({
    width: 220,
    height: 220,
    type: 'canvas',
    data: url,
    image: STAMP_LOGO_URL,
    dotsOptions: { type: 'rounded', color: STAMP_QR_COLOR },
    cornersSquareOptions: { type: 'extra-rounded', color: STAMP_QR_COLOR },
    cornersDotOptions: { type: 'dot', color: STAMP_QR_COLOR },
    backgroundOptions: { color: '#ffffff' },
    imageOptions: {
      crossOrigin: 'anonymous',
      margin: 8,
      imageSize: 0.3,   // zona limpia ~30%; el logo.png debe verse ~15% (con padding blanco)
      hideBackgroundDots: true
    },
    qrOptions: { errorCorrectionLevel: 'H' }
  });
  // Fondo redondeado ~30%: la lib usa imageSize para el logo; envoltorio CSS para el “pad” 30%
  const wrap = document.createElement('div');
  wrap.className = 'stamp-qr-wrap';
  box.appendChild(wrap);
  qr.append(wrap);
  const link = document.createElement('p');
  link.className = 'stamp-qr-link';
  link.innerHTML = `<a href="${escStamp(url)}" target="_blank" rel="noopener">${escStamp(url)}</a>`;
  box.appendChild(link);
}

// Re-render admin panel when auth state settles
auth.onAuthStateChanged(() => {
  if (document.body.dataset.page === 'stampCard' && _stampData) {
    setTimeout(renderStampCardView, 200);
  }
});

document.addEventListener('DOMContentLoaded', initStampCardPage);
// Por si components/init ya corrieron
if (document.readyState !== 'loading') initStampCardPage();
