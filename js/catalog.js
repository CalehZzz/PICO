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
  // Orden: primero el orden MANUAL del admin (menor número = primero),
  // luego popularidad y alfabético para los que no tienen orden asignado.
  currentFiltered.sort((a, b) => {
    const ao = (a.orden == null ? Infinity : a.orden);
    const bo = (b.orden == null ? Infinity : b.orden);
    if (ao !== bo) return ao - bo;
    return _pop(b) - _pop(a) || a.name.localeCompare(b.name, 'es');
  });
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
    return `<article class="pcard" style="animation-delay:${Math.min(i, 9) * .04}s">
      <div class="pimg pimg-clickable" onclick="openProductDetail('${p.id}')">
        ${p.img ? `<img class="pimg-photo" src="${p.img}" alt="${p.name}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <span class="pstock ${stockClass(s)}">${stockLabel(s)}</span>
        <span class="pimg-emoji"${p.img ? ' style="display:none"' : ''}>${p.e}</span>
      </div>
      <div class="pbody">
        <div class="pclick" onclick="openProductDetail('${p.id}')">
          <span class="pcat">${p.cat}</span>
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
    </article>`;
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
        oninput="cartTypeVal('${id}', this.value)"
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

// Construye el menú "Filtrar por" dinámicamente con las categorías presentes en el
// catálogo (sin lecturas extra a Firestore). "Todos" siempre va primero.
function buildCategoryFilter() {
  const menu = document.getElementById('filterMenu');
  if (!menu) return;
  const cats = Array.from(new Set(products.map(p => p.cat).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'es'));
  // Si la categoría activa ya no existe en el catálogo, volver a "Todos".
  if (currentCat !== 'Todos' && !cats.includes(currentCat)) currentCat = 'Todos';
  const check = '<svg class="filter-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const items = ['Todos', ...cats];
  menu.innerHTML = items.map(c => {
    const safe = _pdEsc(c).replace(/'/g, "\\'");
    return `<button class="filter-item ${c === currentCat ? 'active' : ''}" type="button" role="menuitemradio" onclick="filterCat('${safe}',this)">${_pdEsc(c)}${check}</button>`;
  }).join('');
  const label = document.getElementById('filterBtnLabel');
  if (label) label.textContent = (currentCat === 'Todos') ? 'Filtrar por' : currentCat;
  const fbtn = document.getElementById('filterBtn');
  if (fbtn) fbtn.classList.toggle('is-filtered', currentCat !== 'Todos');
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

  // Encabezado de descripción: el admin ve un botón para editarla en línea.
  const descHeader = isAdmin
    ? `<div class="pd-desc-h">Descripción <button class="pd-edit-btn" onclick="startEditProductDesc('${p.id}')"><span>✏️</span> Editar</button></div>`
    : `<div class="pd-desc-h">Descripción</div>`;

  body.innerHTML =
    `<div class="pd-img">${imgHtml}</div>` +
    `<div class="pd-tags">` +
      `<span class="pd-tag">${_pdEsc(p.cat)}</span>` +
      `<span class="pd-tag ${stockClass(s)}" style="background:transparent">${_pdEsc(stockLabel(s))}</span>` +
    `</div>` +
    `<div class="pd-name">${_pdEsc(p.name)}</div>` +
    `<div class="pd-price">$${p.price.toFixed(2)}</div>` +
    descHeader +
    `<div id="pdDescArea">${descHtml}</div>`;

  foot.innerHTML =
    `<button class="btn-sec" onclick="closeModal('productDetailModal')">Cerrar</button>` +
    `<div class="add-zone pd-add" id="addZoneModal_${p.id}">${renderAddZoneHTML(p.id, noStock)}</div>`;

  openModal('productDetailModal');
}

// ── Edición de descripción por el ADMIN (en línea, dentro del modal) ──
function startEditProductDesc(id) {
  if (!isAdmin) return;
  const p = products.find(x => x.id === id);
  const area = document.getElementById('pdDescArea');
  if (!p || !area) return;
  area.innerHTML =
    `<textarea id="pdDescInput" class="pd-desc-edit" rows="4" placeholder="Escribe la descripción del producto...">${_pdEsc(p.desc || '')}</textarea>` +
    `<div class="pd-desc-actions">` +
      `<button class="btn-sec" onclick="cancelEditProductDesc('${id}')">Cancelar</button>` +
      `<button class="btn-pri" id="pdDescSaveBtn" onclick="saveProductDesc('${id}')">Guardar</button>` +
    `</div>`;
  const ta = document.getElementById('pdDescInput');
  if (ta) ta.focus();
}

function cancelEditProductDesc(id) {
  openProductDetail(id); // re-render limpio del modal
}

async function saveProductDesc(id) {
  if (!isAdmin) return;
  const p  = products.find(x => x.id === id);
  const ta = document.getElementById('pdDescInput');
  if (!p || !ta) return;
  const nuevo = ta.value.trim();
  const btn = document.getElementById('pdDescSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  try {
    const ts = Date.now();
    await db.collection('productos').doc(id).update({ desc: nuevo, updatedAt: ts });
    // Reflejar en memoria
    p.desc = nuevo;
    // Reflejar en el caché local (persiste hasta la próxima sincronización)
    try {
      const cache = readProdCache();
      if (cache && Array.isArray(cache.data)) {
        const raw = cache.data.find(d => d.id === id);
        if (raw) { raw.desc = nuevo; raw.updatedAt = ts; }
        writeProdCache(cache.data, Math.max(cache.syncTs || 0, ts));
      }
    } catch (_) {}
    showToast('✅ Descripción actualizada');
    renderProducts();      // refrescar el catálogo
    openProductDetail(id); // refrescar el modal con la nueva descripción
  } catch (e) {
    console.error('saveProductDesc:', e);
    showToast('⚠️ No se pudo guardar la descripción');
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
  }
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
