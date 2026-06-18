// ════════════════════════════════════════════════════════════════
// PICO · Render del catálogo (paginación / lazy)
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  PRODUCTS RENDER  (lazy — IntersectionObserver)
// ═══════════════════════════════════════════════════
function stockClass(s) { return s === 0 ? 'stock-none' : s <= 5 ? 'stock-low' : 'stock-ok'; }
function stockLabel(s) { return s === 0 ? 'Sin stock'  : s <= 5 ? `Pocas (${s})` : `${s} disp.`; }

function renderProducts() {
  updateSucursalBadge();
  // En páginas sin catálogo no hay grid que renderizar.
  if (!document.getElementById('productsGrid')) return;
  // Cada vez que cambia el filtro/búsqueda, volver a la primera página
  currentPage = 1;
  currentFiltered = products.filter(p => {
    const mc = currentCat === 'Todos' || p.cat === currentCat;
    const ms = p.name.toLowerCase().includes(currentSearch) ||
               p.cat.toLowerCase().includes(currentSearch)  ||
               (p.desc || '').toLowerCase().includes(currentSearch);
    return mc && ms;
  });
  // Ordenar: primero lo más popular/útil, luego alfabético.
  currentFiltered.sort((a, b) => _pop(b) - _pop(a) || a.name.localeCompare(b.name, 'es'));
  _renderVisibleSlice();
}

// Navega a una página concreta del catálogo (paginación 100% local, sin lecturas extra)
function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(currentFiltered.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, page), totalPages);
  _renderVisibleSlice();
  // Subir al inicio del catálogo al cambiar de página
  const wrap = document.querySelector('.catalog-wrap');
  if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _renderVisibleSlice() {
  const grid   = document.getElementById('productsGrid');
  const noRes  = document.getElementById('noResults');

  if (!currentFiltered.length) {
    grid.innerHTML = '';
    noRes.classList.remove('hidden');
    _updatePagers(false);
    return;
  }
  noRes.classList.add('hidden');

  const totalPages = Math.max(1, Math.ceil(currentFiltered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = currentFiltered.slice(start, start + PAGE_SIZE);
  grid.innerHTML = slice.map((p, i) => {
    const s       = stockMap[p.id] !== undefined ? stockMap[p.id] : p.stock;
    const noStock = s === 0;
    return `<div class="pcard" style="animation-delay:${Math.min(i, 11) * .03}s">
      <div class="pimg pimg-clickable" onclick="openProductDetail('${p.id}')">
        ${p.img ? `<img class="pimg-photo" src="${p.img}" alt="${p.name}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <span class="ptag">${p.cat}</span>
        <span class="pstock ${stockClass(s)}">${stockLabel(s)}</span>
        <span class="pimg-emoji"${p.img ? ' style="display:none"' : ''}>${p.e}</span>
      </div>
      <div class="pbody">
        <div class="pclick" onclick="openProductDetail('${p.id}')">
          <div class="pname">${p.name}</div>
          <div class="pdesc">${p.desc}</div>
        </div>
        <div class="pfooter">
          <span class="pprice">$${p.price.toFixed(2)}</span>
          <div class="add-zone" id="addZone_${p.id}">
            ${renderAddZoneHTML(p.id, noStock)}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // Controles de paginación (arriba y abajo)
  _updatePagers(true, currentPage, totalPages);
}

// Actualiza ambos paginadores (superior e inferior) a la vez.
function _updatePagers(show, page, totalPages) {
  ['', 'Top'].forEach(sfx => {
    const wrap = document.getElementById('paginationControls' + sfx);
    if (!wrap) return;
    if (!show || totalPages <= 1) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    const input = document.getElementById('pageInput' + sfx);
    const total = document.getElementById('pageTotal' + sfx);
    const prev  = document.getElementById('prevPageBtn' + sfx);
    const next  = document.getElementById('nextPageBtn' + sfx);
    if (input) { input.value = page; input.max = totalPages; }
    if (total) total.textContent = totalPages;
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
  });
}

// Ir a la página escrita en el input (se limita al rango válido en goToPage).
function goToPageFromInput(el) {
  const v = parseInt(el.value, 10);
  if (isNaN(v)) { el.value = currentPage; return; }
  goToPage(v);
}

function renderAddZoneHTML(id, noStock) {
  const inCart = !!cart[id];
  if (noStock && !inCart)
    return `<button class="add-btn" disabled style="opacity:.4">+</button>`;
  if (inCart)
    return `<div class="qty-spin">
      <button class="qspin-btn" onclick="cartDec('${id}')">−</button>
      <input class="qspin-input" type="number" min="1" max="${stockMap[id] || 0}"
        value="${cart[id]}"
        onchange="cartSetVal('${id}', this.value)"
        oninput="cartSetVal('${id}', this.value)"
        onclick="this.select()">
      <button class="qspin-btn" onclick="cartInc('${id}')">+</button>
    </div>`;
  return `<button class="add-btn" onclick="addToCart('${id}')" title="Agregar">+</button>`;
}

function updateAddZone(id) {
  const s = stockMap[id] !== undefined ? stockMap[id] : 0;
  const html = renderAddZoneHTML(id, s === 0);
  const el = document.getElementById('addZone_' + id);
  if (el) el.innerHTML = html;
  // Mantener sincronizado el selector dentro del modal de detalle (si está abierto).
  const elM = document.getElementById('addZoneModal_' + id);
  if (elM) elM.innerHTML = html;
}

function filterCat(cat, btn) {
  currentCat = cat;
  document.querySelectorAll('.filter-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Reflejar el filtro activo en el botón "Filtrar por"
  const label = document.getElementById('filterBtnLabel');
  if (label) label.textContent = (cat === 'Todos') ? 'Filtrar por' : cat;
  const fbtn = document.getElementById('filterBtn');
  if (fbtn) fbtn.classList.toggle('is-filtered', cat !== 'Todos');
  closeFilterMenu();
  renderProducts();
}

// Abre/cierra el menú de "Filtrar por"
function toggleFilterMenu(e) {
  if (e) e.stopPropagation();
  const dd = document.getElementById('filterDropdown');
  if (!dd) return;
  const open = dd.classList.toggle('open');
  const btn = document.getElementById('filterBtn');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function closeFilterMenu() {
  const dd = document.getElementById('filterDropdown');
  if (dd) dd.classList.remove('open');
  const btn = document.getElementById('filterBtn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
// Cerrar el menú al tocar fuera de él
document.addEventListener('click', function (e) {
  const dd = document.getElementById('filterDropdown');
  if (dd && !dd.contains(e.target)) closeFilterMenu();
});

function filterProducts() {
  currentSearch = document.getElementById('searchInput').value.toLowerCase();
  renderProducts();
}

// ═══════════════════════════════════════════════════
//  DETALLE DE PRODUCTO  (modal — imagen y descripción completas)
//  NO se muestran datos privados (costos, etc.)
// ═══════════════════════════════════════════════════
function _pdEsc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Crea el modal una sola vez y lo reutiliza.
function _ensureProductDetailModal() {
  let m = document.getElementById('productDetailModal');
  if (m) return m;
  m = document.createElement('div');
  m.className = 'moverlay';
  m.id = 'productDetailModal';
  m.innerHTML =
    '<div class="modal">' +
      '<div class="mhd">' +
        '<h2>🔎 Detalle del producto</h2>' +
        '<button class="xbtn" onclick="closeModal(\'productDetailModal\')">✕</button>' +
      '</div>' +
      '<div class="mbody" id="productDetailBody"></div>' +
      '<div class="mfoot" id="productDetailFoot"></div>' +
    '</div>';
  document.body.appendChild(m);
  // Cerrar al tocar el fondo (fuera del modal)
  m.addEventListener('click', function (e) {
    if (e.target === m) closeModal('productDetailModal');
  });
  return m;
}

function openProductDetail(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;

  _ensureProductDetailModal();
  const body = document.getElementById('productDetailBody');
  const foot = document.getElementById('productDetailFoot');

  const s       = stockMap[p.id] !== undefined ? stockMap[p.id] : p.stock;
  const noStock = s === 0;

  const imgHtml = p.img
    ? `<img src="${_pdEsc(p.img)}" alt="${_pdEsc(p.name)}" onerror="this.style.display='none';this.parentNode.innerHTML='${_pdEsc(p.e || '📦')}'">`
    : _pdEsc(p.e || '📦');

  const descHtml = (p.desc && p.desc.trim())
    ? `<div class="pd-desc">${_pdEsc(p.desc)}</div>`
    : `<div class="pd-desc-empty">Este producto no tiene descripción.</div>`;

  body.innerHTML =
    `<div class="pd-img">${imgHtml}</div>` +
    `<div class="pd-tags">` +
      `<span class="pd-tag">${_pdEsc(p.cat)}</span>` +
      `<span class="pd-tag ${stockClass(s)}" style="background:transparent">${_pdEsc(stockLabel(s))}</span>` +
    `</div>` +
    `<div class="pd-name">${_pdEsc(p.name)}</div>` +
    `<div class="pd-price">$${p.price.toFixed(2)}</div>` +
    `<div class="pd-desc-h">Descripción</div>` +
    descHtml;

  foot.innerHTML =
    `<button class="btn-sec" onclick="closeModal('productDetailModal')">Cerrar</button>` +
    `<div class="add-zone pd-add" id="addZoneModal_${p.id}">${renderAddZoneHTML(p.id, noStock)}</div>`;

  openModal('productDetailModal');
}

// ═══════════════════════════════════════════════════
//  POPULARIDAD  (orden del catálogo: lo más útil primero)
//  Peso mayor = aparece antes. Se cachea en el producto.
// ═══════════════════════════════════════════════════
function productPopularity(p) {
  const n = ((p.name || '') + ' ' + (p.desc || '')).toLowerCase();
  const RULES = [
    [100, /\barduino\b/],
    [98,  /protoboard|breadboard|board de prueba/],
    [96,  /\b(caiman|caimanes|cocodrilo|lagarto)\b|alligator/],
    [95,  /jumper|dupont|cables?\s*(macho|hembra|de conexi|jumper)/],
    [94,  /potenci[oó]metro/],
    [92,  /mult[ií]metro|t[eé]ster|\btester\b/],
    [90,  /\besp32\b|\besp8266\b|nodemcu/],
    [88,  /resistencia|resistor|\bohm|ohmio/],
    [86,  /\bled\b|diodo\s*emisor/],
    [85,  /push\s*button|pulsador|\bbot[oó]n\b|t[aá]ctil/],
    [84,  /\bservo\b|sg90|mg90/],
    [83,  /\bsensor\b|hc-?sr04|ultrason|dht1[12]|\bldr\b|\bpir\b|sensor de l[ií]nea|infrarrojo/],
    [80,  /capacitor|condensador|electrol[ií]tic|cer[aá]mic/],
    [78,  /transistor|mosfet|2n2222|bc54[0-9]|tip\d{2,3}|\bnpn\b|\bpnp\b/],
    [76,  /\bbuzzer\b|zumbador/],
    [74,  /\brel[eé]\b|\brelay\b/],
    [72,  /lcd\s*16|\boled\b|7\s*segmentos|display/],
    [70,  /regulador|lm7805|ams1117|fuente/],
    [68,  /bater[ií]a|porta\s*pila|18650|\b9v\b/],
    [66,  /\bdiodo\b|1n400[0-9]|1n4148|zener|rectificador/],
    [64,  /header|espad[ií]n|tira de pines|bornera|terminal/],
    [60,  /interruptor|\bswitch\b|dip\s*switch/],
  ];
  let best = 0;
  for (let i = 0; i < RULES.length; i++) {
    if (RULES[i][1].test(n) && RULES[i][0] > best) best = RULES[i][0];
  }
  return best;
}

function _pop(p) {
  if (p._pop === undefined) p._pop = productPopularity(p);
  return p._pop;
}
