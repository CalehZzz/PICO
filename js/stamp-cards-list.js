// ════════════════════════════════════════════════════════════════
// PICO · Listado Mis tarjetas (cliente) / Tarjetas (admin)
// ════════════════════════════════════════════════════════════════

let _stampListUnsub = null;
let _stampListDocs = []; // [{code, ...data}]
let _stampListFilter = 'active'; // admin: active | done | all
let _stampListInited = false;

function escStampList(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function stampCardDisplayName(c) {
  const n = (c.nombre || '').trim();
  return n || 'Sin nombre';
}

function stampCardBadge(c) {
  const status = c.status || 'active';
  const sellos = Number(c.sellos) || 0;
  const rewardReady = status === 'active' && (c.rewardAvailable === true || sellos >= 8) && c.rewardUsed !== true;
  if (status === 'completed') return '<span class="stamp-badge done">Terminada</span>';
  if (status === 'cancelled') return '<span class="stamp-badge cancel">Eliminada</span>';
  if (rewardReady) return '<span class="stamp-badge ready">40% disponible</span>';
  return '<span class="stamp-badge active">Activa</span>';
}

function stampCardViewUrl(code) {
  return '/tarjetas/?c=' + encodeURIComponent(code);
}

function initStampCardsListPage() {
  if (document.body.dataset.page !== 'stampCards') return;
  if (!currentUser) return;

  const title = document.getElementById('stampListTitle');
  const help = document.getElementById('stampListHelp');
  const adminBar = document.getElementById('stampListAdminBar');

  if (isAdmin) {
    if (title) title.textContent = 'Tarjetas';
    if (help) help.textContent = 'Gestioná todas las tarjetas de sellos. Tocá una para editar, sumar sellos o eliminarla.';
    if (adminBar) adminBar.classList.remove('hidden');
  } else {
    if (title) title.textContent = 'Mis tarjetas';
    if (help) help.textContent = 'Cada 8 compras (≥ $1) sumás 1 sello. Con 8 sellos tenés 40% en una compra.';
    if (adminBar) adminBar.classList.add('hidden');
  }

  if (_stampListUnsub) { _stampListUnsub(); _stampListUnsub = null; }

  const root = document.getElementById('stampListRoot');
  if (root) root.innerHTML = '<p class="stamp-loading">Cargando…</p>';

  if (isAdmin) {
    // Todas las tarjetas (admin). Orden local por updatedAt.
    _stampListUnsub = db.collection('stamp-cards').onSnapshot(snap => {
      _stampListDocs = [];
      snap.forEach(doc => _stampListDocs.push({ code: doc.id, ...doc.data() }));
      _stampListDocs.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
      renderStampCardsList();
    }, err => {
      console.error(err);
      if (root) root.innerHTML = `<p style="color:#dc2626">Error al cargar: ${escStampList(err.message)}</p>`;
    });
  } else {
    const emailLower = String(currentUser.email || '').trim().toLowerCase();
    if (!emailLower) {
      if (root) root.innerHTML = '<p class="stamp-list-empty">No hay correo en tu cuenta.</p>';
      return;
    }
    _stampListUnsub = db.collection('stamp-cards')
      .where('emailLower', '==', emailLower)
      .onSnapshot(snap => {
        _stampListDocs = [];
        snap.forEach(doc => _stampListDocs.push({ code: doc.id, ...doc.data() }));
        _stampListDocs.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
        renderStampCardsList();
      }, err => {
        console.error(err);
        if (root) root.innerHTML = `<p style="color:#dc2626">Error al cargar: ${escStampList(err.message)}</p>`;
      });
  }
  _stampListInited = true;
}

function setStampListFilter(f) {
  _stampListFilter = f || 'active';
  document.querySelectorAll('.stamp-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === _stampListFilter);
  });
  renderStampCardsList();
}

function stampListMatchesSearch(c, q) {
  if (!q) return true;
  const hay = [c.code, c.nombre, c.email, c.emailLower].map(x => String(x || '').toLowerCase()).join(' ');
  return hay.includes(q);
}

function renderStampCardRow(c) {
  const sellos = Number(c.sellos) || 0;
  const email = (c.email || '').trim() || 'Sin asignar';
  return `
    <a class="stamp-list-card" href="${stampCardViewUrl(c.code)}">
      <div class="stamp-list-card-top">
        <div>
          <div class="stamp-list-card-name">${escStampList(stampCardDisplayName(c))}</div>
          <div class="stamp-list-card-code">${escStampList(c.code)}</div>
        </div>
        ${stampCardBadge(c)}
      </div>
      <div class="stamp-list-card-meta">
        <span>${sellos}/8 sellos</span>
        <span>${escStampList(email)}</span>
      </div>
      <span class="stamp-list-card-cta">Ver →</span>
    </a>
  `;
}

function renderStampCardsList() {
  const root = document.getElementById('stampListRoot');
  if (!root) return;

  if (isAdmin) {
    const q = ((document.getElementById('stampListSearch') || {}).value || '').trim().toLowerCase();
    const active = _stampListDocs.filter(c => (c.status || 'active') === 'active');
    const done = _stampListDocs.filter(c => {
      const s = c.status || 'active';
      return s === 'completed' || s === 'cancelled';
    });
    const counts = document.getElementById('stampListCounts');
    if (counts) counts.textContent = `${active.length} activas · ${done.length} terminadas`;

    let list = _stampListDocs;
    if (_stampListFilter === 'active') list = active;
    else if (_stampListFilter === 'done') list = done;
    list = list.filter(c => stampListMatchesSearch(c, q));

    if (!list.length) {
      root.innerHTML = `<p class="stamp-list-empty">${q ? 'Sin resultados para esa búsqueda.' : 'No hay tarjetas en este filtro.'}</p>`;
      return;
    }
    root.innerHTML = `<div class="stamp-list-grid">${list.map(renderStampCardRow).join('')}</div>`;
    return;
  }

  // Cliente: activas + terminadas
  const active = _stampListDocs.filter(c => (c.status || 'active') === 'active');
  const done = _stampListDocs.filter(c => {
    const s = c.status || 'active';
    return s === 'completed' || s === 'cancelled';
  });

  if (!active.length && !done.length) {
    root.innerHTML = `
      <div class="stamp-list-empty-box">
        <p class="stamp-list-empty">Todavía no tenés tarjeta. Pedila en sucursal o al admin.</p>
      </div>`;
    return;
  }

  let html = '';
  html += '<section class="stamp-list-section"><h3>Activas</h3>';
  if (active.length) html += `<div class="stamp-list-grid">${active.map(renderStampCardRow).join('')}</div>`;
  else html += '<p class="stamp-list-empty">No tenés tarjetas activas.</p>';
  html += '</section>';

  html += '<section class="stamp-list-section"><h3>Terminadas / archivadas</h3>';
  if (done.length) html += `<div class="stamp-list-grid">${done.map(renderStampCardRow).join('')}</div>`;
  else html += '<p class="stamp-list-empty">Ninguna todavía.</p>';
  html += '</section>';

  root.innerHTML = html;
}
