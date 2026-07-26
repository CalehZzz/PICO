// ════════════════════════════════════════════════════════════════
// PICO · Render del catálogo (paginación / lazy)
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  PRODUCTS RENDER  (lazy — IntersectionObserver)
// ═══════════════════════════════════════════════════
function stockClass(s) { return s === 0 ? 'stock-none' : s <= 5 ? 'stock-low' : 'stock-ok'; }
function stockLabel(s) { return s === 0 ? 'Sin stock'  : s <= 5 ? `Pocas (${s})` : `${s} disp.`; }

/** Texto buscable de un producto (incluye colores embebidos y etiquetas legado). */
function _productSearchHay(p) {
  const colorHay = (p.groupColors || [])
    .map(c => [c.label || '', c.color || ''].join(' '))
    .join(' ');
  return [
    p.name, p.cat, p.desc || '',
    p.variantLabel || '', p.groupName || '', p.variantColor || '',
    colorHay
  ].join(' ').toLowerCase();
}
function _productMatchesSearch(p, q) {
  if (!q) return true;
  return _productSearchHay(p).includes(q);
}
function _groupMatchesSearch(g, q) {
  if (!q) return true;
  if ((g.name || '').toLowerCase().includes(q) || (g.cat || '').toLowerCase().includes(q)) return true;
  return (g.variants || []).some(v => _productMatchesSearch(v, q));
}
function _variantIsEnabled(v) {
  return v && v.variantEnabled !== false;
}
function _variantStock(v) {
  if (!v) return 0;
  return stockMap[v.id] !== undefined ? stockMap[v.id] : (v.stock || 0);
}
/** Colores habilitados de un producto con groupColors. */
function _productEnabledColors(p) {
  return (p && p.groupColors || []).filter(c => c && c.enabled !== false);
}
function _colorIsEnabled(c) {
  return c && c.enabled !== false;
}
/** Variantes habilitadas del grupo multi-doc (incluye sin stock; el UI las marca aparte). */
function _groupEnabledVariants(g) {
  return (g.variants || []).filter(_variantIsEnabled);
}
function _groupRepProduct(g) {
  const enabled = _groupEnabledVariants(g);
  const withStock = enabled.find(v => _variantStock(v) > 0 && v.img);
  if (withStock) return withStock;
  const anyImg = enabled.find(v => v.img) || (g.variants || []).find(v => v.img);
  return withStock || enabled[0] || anyImg || (g.variants || [])[0] || null;
}
function _groupStockTotal(g) {
  return _groupEnabledVariants(g).reduce((sum, v) => sum + _variantStock(v), 0);
}
function _groupDiscountPct(g) {
  let best = 0;
  (g.variants || []).forEach(v => {
    const pct = _productDiscountPct(v.id);
    if (pct > best) best = pct;
  });
  return best;
}
/** Circulitos de color para la tarjeta (sin leyendas). */
function _colorDotsHtml(colors) {
  const list = (colors || []).filter(c => c && c.enabled !== false && (c.color || c.label));
  if (!list.length) return '';
  return `<div class="pcolor-dots" aria-hidden="true">` +
    list.map(c =>
      `<span class="pcolor-dot" style="--swatch:${_pdEsc(c.color || '#9ca3af')}" title="${_pdEsc(c.label || '')}"></span>`
    ).join('') +
  `</div>`;
}
function _groupColorDots(g) {
  if (!g || g.kind !== 'color') return '';
  const colors = _groupEnabledVariants(g).map(v => ({
    label: v.variantLabel || v.name,
    color: v.variantColor || '#9ca3af',
    enabled: _variantIsEnabled(v)
  }));
  return _colorDotsHtml(colors);
}
function _itemSortKey(item) {
  if (item.type === 'group') {
    const g = item.group;
    const rep = _groupRepProduct(g) || { name: g.name, orden: g.orden, _pop: 0 };
    return {
      orden: g.orden == null ? Infinity : g.orden,
      pop: _pop(rep),
      name: g.name || ''
    };
  }
  const p = item.product;
  return {
    orden: p.orden == null ? Infinity : p.orden,
    pop: _pop(p),
    name: p.name || ''
  };
}

/**
 * Construye la lista del catálogo:
 * - 1 tarjeta por grupo multi-doc (valor / color legado) + productos raíz.
 * - Productos con groupColors = una sola tarjeta raíz (nunca variantes sueltas).
 * - En búsqueda tampoco se listan variantes sueltas: solo el grupo / raíz.
 */
function _buildCatalogItems() {
  const q = (currentSearch || '').trim();
  const searching = q.length > 0;
  const items = [];

  const inCat = (cat) => currentCat === 'Todos' || cat === currentCat;
  const groupHasOffer = (g) => !discountMode || (g.variants || []).some(v => _productDiscountPct(v.id) > 0);
  const prodHasOffer = (p) => !discountMode || _productDiscountPct(p.id) > 0;

  Object.keys(productGroups || {}).forEach(gid => {
    const g = productGroups[gid];
    if (!g || !_groupEnabledVariants(g).length) return;
    if (!inCat(g.cat)) return;
    if (!groupHasOffer(g)) return;
    if (searching && !_groupMatchesSearch(g, q)) return;
    items.push({ type: 'group', group: g });
  });

  (products || []).forEach(p => {
    // Variantes de un grupo multi-doc: nunca aparecen sueltas (ni al buscar).
    if (p.groupId && productGroups[p.groupId]) return;
    if (!inCat(p.cat)) return;
    if (!prodHasOffer(p)) return;
    if (searching && !_productMatchesSearch(p, q)) return;
    items.push({ type: 'product', product: p });
  });

  items.sort((a, b) => {
    const ka = _itemSortKey(a), kb = _itemSortKey(b);
    if (ka.orden !== kb.orden) return ka.orden - kb.orden;
    return kb.pop - ka.pop || ka.name.localeCompare(kb.name, 'es');
  });
  return items;
}

function renderProducts() {
  updateSucursalBadge();
  // En páginas sin catálogo no hay grid que renderizar.
  if (!document.getElementById('productsGrid')) return;
  // Cada vez que cambia el filtro/búsqueda, volver a la primera página
  currentPage = 1;
  catalogItems = _buildCatalogItems();
  // Compat: currentFiltered = productos raíz listados (sin variantes de grupo).
  currentFiltered = catalogItems
    .filter(it => it.type === 'product')
    .map(it => it.product);
  _renderVisibleSlice();
}

// Navega a una página concreta del catálogo (paginación 100% local, sin lecturas extra)
function goToPage(page) {
  const total = (Array.isArray(catalogItems) && catalogItems.length)
    ? catalogItems.length
    : currentFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, page), totalPages);
  _renderVisibleSlice();
  // Subir al inicio del catálogo al cambiar de página
  const wrap = document.querySelector('.catalog-wrap');
  if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _discountTagHtml(pct, size) {
  if (!(pct > 0)) return '';
  const w = size === 'lg' ? 72 : 58;
  const h = size === 'lg' ? 84 : 68;
  const cls = size === 'lg' ? 'discount-tag discount-tag-lg' : 'discount-tag';
  return `<span class="${cls}" title="${pct}% de descuento" aria-label="${pct}% de descuento">` +
    `<svg viewBox="0 0 48 56" width="${w}" height="${h}" aria-hidden="true">` +
      `<path d="M24 3.2l15.8 14V48.2c0 2-1.6 3.6-3.6 3.6H11.8c-2 0-3.6-1.6-3.6-3.6V17.2L24 3.2z" fill="#ff8a80"/>` +
      `<circle cx="24" cy="16.2" r="3.1" fill="#fff"/>` +
      `<path d="M24 9.4c2.2-2.4 1.1-4.9 0-5.9-1.1.9-2.2 3.4 0 5.9z" stroke="#8d6e63" stroke-width="1.15" fill="none"/>` +
      `<path d="M12.2 37.8h23.6" stroke="#fff" stroke-width="1.5" stroke-dasharray="2 2.1" stroke-linecap="round"/>` +
      `<text x="24" y="31.5" text-anchor="middle" fill="#fff" font-size="11" font-weight="800" font-family="Plus Jakarta Sans,sans-serif">-${pct}%</text>` +
    `</svg></span>`;
}

function _pricePairHtml(oldP, pct, asCard) {
  const newP = pct > 0 ? oldP * (1 - pct / 100) : oldP;
  if (pct > 0) {
    if (asCard) {
      return `<span class="pprice-wrap"><span class="pprice-old">$${oldP.toFixed(2)}</span><span class="pprice pprice-sale">$${newP.toFixed(2)}</span></span>`;
    }
    return `<div class="pd-price pd-price-sale"><span class="pprice-old">$${oldP.toFixed(2)}</span><span class="pd-price-new">$${newP.toFixed(2)}</span></div>`;
  }
  return asCard
    ? `<span class="pprice">$${oldP.toFixed(2)}</span>`
    : `<div class="pd-price">$${oldP.toFixed(2)}</div>`;
}

function _renderProductCard(p, i) {
  const s       = _variantStock(p);
  const noStock = s === 0;
  const pct     = discountMode ? _productDiscountPct(p.id) : 0;
  const oldP    = typeof p.price === 'number' ? p.price : 0;
  const colorDots = _colorDotsHtml(p.groupColors);
  // Imagen de tarjeta: primer color con foto, si hay groupColors.
  const coverImg = (() => {
    const withImg = _productEnabledColors(p).find(c => c.imageUrl);
    return (withImg && withImg.imageUrl) || p.img || '';
  })();
  const card =
    `<article class="pcard${pct > 0 ? ' pcard-sale' : ''}">` +
      `<div class="pimg pimg-clickable" onclick="openProductDetail('${p.id}')">` +
        `${coverImg ? `<img class="pimg-photo" src="${_pdEsc(coverImg)}" alt="${_pdEsc(p.name)}" loading="lazy" onerror="this.style.display='none'">` : ''}` +
        `${_discountTagHtml(pct)}` +
        `<span class="pstock ${stockClass(s)}">${stockLabel(s)}</span>` +
        `<span class="pimg-emoji"${coverImg ? ' style="display:none"' : ''}>${p.e}</span>` +
      `</div>` +
      `<div class="pbody">` +
        `<div class="pclick" onclick="openProductDetail('${p.id}')">` +
          `<span class="pcat">${_pdEsc(p.cat)}</span>` +
          `<div class="pname">${_pdEsc(p.name)}</div>` +
          `${colorDots}` +
          `<div class="pdesc">${_pdEsc(p.desc)}</div>` +
        `</div>` +
        `<div class="pfooter">` +
          `${_pricePairHtml(oldP, pct, true)}` +
          `<div class="add-zone" id="addZone_${p.id}">${renderAddZoneHTML(p.id, noStock, null)}</div>` +
        `</div>` +
      `</div>` +
    `</article>`;
  const shellClass = pct > 0 ? 'pcard-fire-shell' : 'pcard-slot';
  return `<div class="${shellClass}" style="animation-delay:${Math.min(i, 9) * .04}s">${card}</div>`;
}

function _renderGroupCard(g, i) {
  const rep = _groupRepProduct(g);
  const s = _groupStockTotal(g);
  const enabled = _groupEnabledVariants(g);
  const pct = discountMode ? _groupDiscountPct(g) : 0;
  const oldP = rep && typeof rep.price === 'number' ? rep.price : 0;
  const optsLabel = enabled.length === 1
    ? '1 opción'
    : `${enabled.length} opciones`;
  const stockTxt = s === 0 ? 'Sin stock' : (s <= 5 ? `Pocas · ${optsLabel}` : `${optsLabel}`);
  const gid = _pdEsc(g.id).replace(/'/g, "\\'");
  const colorDots = _groupColorDots(g);
  const card =
    `<article class="pcard pcard-group${pct > 0 ? ' pcard-sale' : ''}">` +
      `<div class="pimg pimg-clickable" onclick="openGroupDetail('${gid}')">` +
        `${rep && rep.img ? `<img class="pimg-photo" src="${_pdEsc(rep.img)}" alt="${_pdEsc(g.name)}" loading="lazy" onerror="this.style.display='none'">` : ''}` +
        `${_discountTagHtml(pct)}` +
        `<span class="pstock ${stockClass(s)}">${_pdEsc(stockTxt)}</span>` +
        `<span class="pimg-emoji"${rep && rep.img ? ' style="display:none"' : ''}>${_pdEsc((g.e || (rep && rep.e) || '📦'))}</span>` +
      `</div>` +
      `<div class="pbody">` +
        `<div class="pclick" onclick="openGroupDetail('${gid}')">` +
          `<span class="pcat">${_pdEsc(g.cat || '')}</span>` +
          `<div class="pname">${_pdEsc(g.name)}</div>` +
          `${colorDots}` +
          `<div class="pdesc">${_pdEsc((rep && rep.desc) || '')}</div>` +
        `</div>` +
        `<div class="pfooter">` +
          `${_pricePairHtml(oldP, pct, true)}` +
          `<div class="add-zone">` +
            `<button class="add-btn" onclick="openGroupDetail('${gid}')" title="Elegir variante">+</button>` +
          `</div>` +
        `</div>` +
      `</div>` +
    `</article>`;
  const shellClass = pct > 0 ? 'pcard-fire-shell' : 'pcard-slot';
  return `<div class="${shellClass}" style="animation-delay:${Math.min(i, 9) * .04}s">${card}</div>`;
}

function _renderVisibleSlice() {
  const grid   = document.getElementById('productsGrid');
  const noRes  = document.getElementById('noResults');
  const items  = Array.isArray(catalogItems) ? catalogItems : [];

  if (!items.length) {
    grid.innerHTML = '';
    noRes.classList.remove('hidden');
    _updatePagers(false);
    return;
  }
  noRes.classList.add('hidden');

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  grid.innerHTML = slice.map((it, i) =>
    it.type === 'group' ? _renderGroupCard(it.group, i) : _renderProductCard(it.product, i)
  ).join('');

  // Controles de paginación (arriba y abajo)
  _updatePagers(true, currentPage, totalPages);
}

// Estado del modal de grupo / color embebido
let _pdSelectedVariantId = null;
let _pdActiveGroupId = null;
let _pdSelectedColorId = null; // id dentro de product.groupColors
let _pdColorProductId = null;  // producto raíz con groupColors

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

/**
 * Zona +/- del catálogo / modal.
 * @param {string} id productId raíz
 * @param {boolean} noStock
 * @param {string|null} colorId color de groupColors (modal); null en tarjeta
 */
function renderAddZoneHTML(id, noStock, colorId) {
  const p = (products || []).find(x => x.id === id);
  const hasColors = !!(p && p.groupColors && p.groupColors.length);

  // En la tarjeta: productos con colores abren el modal (varios colores a la vez).
  if (hasColors && !colorId) {
    const totalInCart = (typeof cartQtyForProduct === 'function') ? cartQtyForProduct(id) : 0;
    if (noStock && totalInCart < 1)
      return `<button class="add-btn" disabled style="opacity:.4">+</button>`;
    const badge = totalInCart > 0
      ? `<span class="add-color-qty" title="En carrito">${totalInCart}</span>`
      : '';
    return `<button class="add-btn" onclick="openProductDetail('${id}')" title="Elegir color">+${badge}</button>`;
  }

  const key = (typeof makeCartKey === 'function') ? makeCartKey(id, colorId || null) : id;
  const inCart = !!cart[key];
  const lineMax = (typeof cartLineMax === 'function')
    ? cartLineMax(id, key)
    : (stockMap[id] || 0);
  const kAttr = (typeof _cartKeyAttr === 'function') ? _cartKeyAttr(key) : key;
  if ((noStock || lineMax < 1) && !inCart)
    return `<button class="add-btn" disabled style="opacity:.4">+</button>`;
  if (inCart)
    return `<div class="qty-spin">
      <button class="qspin-btn" onclick="cartDec('${kAttr}')">−</button>
      <input class="qspin-input" type="number" min="1" max="${lineMax}"
        value="${cart[key]}"
        onchange="cartSetVal('${kAttr}', this.value)"
        oninput="cartTypeVal('${kAttr}', this.value)"
        onclick="this.select()">
      <button class="qspin-btn" onclick="cartInc('${kAttr}')">+</button>
    </div>`;
  const colorArg = colorId
    ? `, '${String(colorId).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
    : '';
  return `<button class="add-btn" onclick="addToCart('${id}'${colorArg})" title="Agregar">+</button>`;
}

function updateAddZone(id, colorId) {
  const s = stockMap[id] !== undefined ? stockMap[id] : 0;
  const el = document.getElementById('addZone_' + id);
  if (el) el.innerHTML = renderAddZoneHTML(id, s === 0, null);
  // Modal: reflejar la línea del color seleccionado (stock compartido del raíz).
  const elM = document.getElementById('addZoneModal_' + id);
  if (elM) {
    const modalColor = (_pdColorProductId === id && _pdSelectedColorId)
      ? _pdSelectedColorId
      : (colorId || null);
    elM.innerHTML = renderAddZoneHTML(id, s === 0, modalColor);
  }
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
    '<div class="pd-fire-shell" id="productDetailShell">' +
      '<span class="pd-orb pd-orb-a" aria-hidden="true"></span>' +
      '<span class="pd-orb pd-orb-b" aria-hidden="true"></span>' +
      '<span class="pd-orb pd-orb-c" aria-hidden="true"></span>' +
      '<span class="pd-spark pd-spark-1" aria-hidden="true"></span>' +
      '<span class="pd-spark pd-spark-2" aria-hidden="true"></span>' +
      '<span class="pd-spark pd-spark-3" aria-hidden="true"></span>' +
      '<span class="pd-spark pd-spark-4" aria-hidden="true"></span>' +
      '<span class="pd-spark pd-spark-5" aria-hidden="true"></span>' +
      '<span class="pd-spark pd-spark-6" aria-hidden="true"></span>' +
      '<div class="modal" id="productDetailBox">' +
        '<div class="mhd">' +
          '<h2>🔎 Detalle del producto</h2>' +
          '<button class="xbtn" onclick="closeModal(\'productDetailModal\')">✕</button>' +
        '</div>' +
        '<div class="mbody" id="productDetailBody"></div>' +
        '<div class="mfoot" id="productDetailFoot"></div>' +
      '</div>' +
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
  // Grupo multi-doc (valor / color legado): modal de grupo.
  if (p.groupId && productGroups[p.groupId] && !(p.groupColors && p.groupColors.length)) {
    openGroupDetail(p.groupId, p.id);
    return;
  }
  _pdActiveGroupId = null;
  _pdSelectedVariantId = p.id;
  _pdColorProductId = (p.groupColors && p.groupColors.length) ? p.id : null;
  _pdSelectedColorId = null;
  if (_pdColorProductId) {
    const enabled = _productEnabledColors(p);
    const first = enabled.find(c => c.imageUrl) || enabled[0] || p.groupColors[0] || null;
    _pdSelectedColorId = first ? first.id : null;
  }
  _fillProductDetailModal(p, null);
}

function openGroupDetail(groupId, preselectId) {
  const g = productGroups[groupId];
  if (!g) return;
  const enabled = _groupEnabledVariants(g);
  let selected = null;
  if (preselectId) selected = g.variants.find(v => v.id === preselectId) || null;
  if (!selected || !_variantIsEnabled(selected)) {
    selected = enabled.find(v => _variantStock(v) > 0) || enabled[0] || g.variants[0] || null;
  }
  if (!selected) return;
  _pdActiveGroupId = groupId;
  _pdSelectedVariantId = selected.id;
  _pdColorProductId = null;
  _pdSelectedColorId = null;
  _fillProductDetailModal(selected, g);
}

function selectGroupVariant(variantId) {
  if (!_pdActiveGroupId) return;
  const g = productGroups[_pdActiveGroupId];
  if (!g) return;
  const v = g.variants.find(x => x.id === variantId);
  if (!v || !_variantIsEnabled(v)) return;
  _pdSelectedVariantId = v.id;
  _fillProductDetailModal(v, g, { animate: false });
}

/** Elige un color del array groupColors del producto raíz (stock/id compartidos). */
function selectProductColor(colorId) {
  if (!_pdColorProductId) return;
  const p = products.find(x => x.id === _pdColorProductId);
  if (!p) return;
  const c = (p.groupColors || []).find(x => x.id === colorId);
  if (!c || !_colorIsEnabled(c)) return;
  _pdSelectedColorId = c.id;
  _fillProductDetailModal(p, null, { animate: false });
}

/** Picker de colores desde groupColors (producto raíz, stock compartido). */
function _renderEmbeddedColorPicker(p, selectedColorId) {
  const colors = p && p.groupColors || [];
  if (!colors.length) return '';
  const chips = colors.map(c => {
    const enabled = _colorIsEnabled(c);
    const sel = c.id === selectedColorId;
    const title = enabled
      ? (c.label || c.color)
      : `${c.label || c.color} (no disponible)`;
    const safeId = String(c.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<button type="button" class="pd-swatch${sel ? ' is-selected' : ''}${enabled ? '' : ' is-disabled'}"` +
      ` style="--swatch:${_pdEsc(c.color || '#9ca3af')}"` +
      ` title="${_pdEsc(title)}"` +
      ` aria-label="${_pdEsc(title)}"` +
      (enabled ? ` onclick="selectProductColor('${safeId}')"` : ' disabled') +
      `></button>`;
  }).join('');
  return `<div class="pd-variant-block">` +
    `<div class="pd-variant-label">Color</div>` +
    `<div class="pd-variant-options pd-variant-color">${chips}</div>` +
  `</div>`;
}

function _renderVariantPicker(g, selectedId) {
  if (!g) return '';
  const kind = g.kind === 'color' ? 'color' : 'valor';
  const label = kind === 'color' ? 'Color' : 'Valor';
  const chips = (g.variants || []).map(v => {
    const enabled = _variantIsEnabled(v);
    const stock = _variantStock(v);
    const sel = v.id === selectedId;
    const disabled = !enabled;
    const title = disabled
      ? `${v.variantLabel || v.name} (no disponible)`
      : `${v.variantLabel || v.name}${stock === 0 ? ' · sin stock' : ''}`;
    const safeId = String(v.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    if (kind === 'color') {
      const color = v.variantColor || '#9ca3af';
      return `<button type="button" class="pd-swatch${sel ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}${stock === 0 && enabled ? ' is-oustock' : ''}"` +
        ` style="--swatch:${_pdEsc(color)}"` +
        ` title="${_pdEsc(title)}"` +
        ` aria-label="${_pdEsc(title)}"` +
        (disabled ? ' disabled' : ` onclick="selectGroupVariant('${safeId}')"`) +
        `></button>`;
    }
    return `<button type="button" class="pd-chip${sel ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}${stock === 0 && enabled ? ' is-oustock' : ''}"` +
      ` title="${_pdEsc(title)}"` +
      (disabled ? ' disabled' : ` onclick="selectGroupVariant('${safeId}')"`) +
      `>${_pdEsc(v.variantLabel || v.name)}</button>`;
  }).join('');
  return `<div class="pd-variant-block">` +
    `<div class="pd-variant-label">${label}</div>` +
    `<div class="pd-variant-options pd-variant-${kind}">${chips}</div>` +
  `</div>`;
}

function _fillProductDetailModal(p, g, opts) {
  _ensureProductDetailModal();
  const body = document.getElementById('productDetailBody');
  const foot = document.getElementById('productDetailFoot');
  const shell = document.getElementById('productDetailShell');
  const animate = !(opts && opts.animate === false);

  // Color embebido (groupColors): stock e id del producto raíz siempre.
  const embeddedColors = (!g && p.groupColors && p.groupColors.length) ? p.groupColors : null;
  let selectedColor = null;
  if (embeddedColors) {
    selectedColor = embeddedColors.find(c => c.id === _pdSelectedColorId) || null;
    if (!selectedColor || !_colorIsEnabled(selectedColor)) {
      selectedColor = _productEnabledColors(p).find(c => c.imageUrl)
        || _productEnabledColors(p)[0]
        || embeddedColors[0]
        || null;
      _pdSelectedColorId = selectedColor ? selectedColor.id : null;
    }
  }

  // Stock: raíz para groupColors; variante elegida en grupos multi-doc.
  const s       = _variantStock(p);
  const noStock = s === 0 || (g ? !_variantIsEnabled(p) : false);
  const pct     = discountMode ? _productDiscountPct(p.id) : 0;
  const oldP    = typeof p.price === 'number' ? p.price : 0;
  const displayName = g ? (g.name || p.groupName || p.name) : p.name;
  const displayImg = (selectedColor && selectedColor.imageUrl) || p.img || '';

  if (shell) {
    shell.classList.toggle('has-fire', pct > 0);
    // Solo animar al abrir el modal; no al cambiar color/variante.
    if (animate) {
      shell.classList.remove('pd-pop');
      void shell.offsetWidth;
      shell.classList.add('pd-pop');
    }
  }
  const overlay = document.getElementById('productDetailModal');
  if (overlay) overlay.classList.toggle('pd-sale-overlay', pct > 0);

  const imgHtml = displayImg
    ? `<img src="${_pdEsc(displayImg)}" alt="${_pdEsc(displayName)}" onerror="this.style.display='none';this.parentNode.innerHTML='${_pdEsc(p.e || '📦')}'">`
    : _pdEsc(p.e || '📦');

  const descHtml = (p.desc && p.desc.trim())
    ? `<div class="pd-desc">${_pdEsc(p.desc)}</div>`
    : `<div class="pd-desc-empty">Este producto no tiene descripción.</div>`;

  const descHeader = isAdmin
    ? `<div class="pd-desc-h">Descripción <button class="pd-edit-btn" onclick="startEditProductDesc('${p.id}')"><span>✏️</span> Editar</button></div>`
    : `<div class="pd-desc-h">Descripción</div>`;

  const variantPicker = g
    ? _renderVariantPicker(g, p.id)
    : (embeddedColors ? _renderEmbeddedColorPicker(p, _pdSelectedColorId) : '');
  const selectedLabel = g
    ? (p.variantLabel || '')
    : (selectedColor ? (selectedColor.label || '') : '');
  const variantNote = selectedLabel
    ? `<div class="pd-selected-variant">Seleccionado: <strong>${_pdEsc(selectedLabel)}</strong></div>`
    : '';

  body.innerHTML =
    `<div class="pd-img">${imgHtml}${_discountTagHtml(pct, 'lg')}</div>` +
    `<div class="pd-tags">` +
      `<span class="pd-tag">${_pdEsc(p.cat)}</span>` +
      `<span class="pd-tag ${stockClass(s)}" style="background:transparent">${_pdEsc(stockLabel(s))}</span>` +
    `</div>` +
    `<div class="pd-name">${_pdEsc(displayName)}</div>` +
    variantNote +
    variantPicker +
    _pricePairHtml(oldP, pct, false) +
    descHeader +
    `<div id="pdDescArea">${descHtml}</div>`;

  // Carrito: con groupColors, una línea por color (stock compartido del raíz).
  const modalColorId = embeddedColors ? _pdSelectedColorId : null;
  const lineKey = (typeof makeCartKey === 'function') ? makeCartKey(p.id, modalColorId) : p.id;
  const lineMax = (typeof cartLineMax === 'function') ? cartLineMax(p.id, lineKey) : (stockMap[p.id] || 0);
  const modalNoStock = noStock || (lineMax < 1 && !cart[lineKey]);
  foot.innerHTML =
    `<button class="btn-sec" onclick="closeModal('productDetailModal')">Cerrar</button>` +
    `<div class="add-zone pd-add" id="addZoneModal_${p.id}">${renderAddZoneHTML(p.id, modalNoStock, modalColorId)}</div>`;

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

// ═══════════════════════════════════════════════════
//  DESCUENTOS — modo catálogo (preview) / próximamente
//  Porcentajes simulados solo para diseñar la UI.
// ═══════════════════════════════════════════════════

/** % de oferta del producto para preview del catálogo (inventario). 0 = sin oferta. */
function _productDiscountPct(id) {
  const p = (products || []).find(x => x.id === id);
  if (typeof getProductDiscountPctRaw === 'function') return getProductDiscountPctRaw(p);
  return (typeof getProductDiscountPct === 'function') ? getProductDiscountPct(p) : 0;
}

// Timers del FX de Descuentos (evitar apilar timeouts al spamear el botón).
let _discountIgniteTimer = null;
let _discountBurstTimer = null;
let _discountLogoTimer = null;
const DISCOUNT_FX_MS = 1050; // onda expansiva completa

function _playDiscountBurst(originEl) {
  const burst = document.getElementById('discountBurst');
  if (!burst) return;
  // Lecturas de layout PRIMERO (antes de escribir clases/estilos).
  let x = window.innerWidth / 2;
  let y = window.innerHeight * 0.22;
  if (originEl && originEl.getBoundingClientRect) {
    const r = originEl.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  if (_discountBurstTimer) { clearTimeout(_discountBurstTimer); _discountBurstTimer = null; }
  burst.style.setProperty('--bx', x + 'px');
  burst.style.setProperty('--by', y + 'px');
  burst.classList.remove('is-on');
  // Reinicio en el siguiente frame (sin forzar reflow síncrono → menos lag).
  requestAnimationFrame(() => {
    burst.classList.add('is-on');
    _discountBurstTimer = window.setTimeout(() => {
      burst.classList.remove('is-on');
      _discountBurstTimer = null;
    }, DISCOUNT_FX_MS);
  });
}

function _igniteDescuentosBtn(btn) {
  if (!btn) return;
  if (_discountIgniteTimer) { clearTimeout(_discountIgniteTimer); _discountIgniteTimer = null; }
  btn.classList.remove('is-igniting');
  requestAnimationFrame(() => {
    btn.classList.add('is-igniting');
    _discountIgniteTimer = window.setTimeout(() => {
      btn.classList.remove('is-igniting');
      _discountIgniteTimer = null;
    }, DISCOUNT_FX_MS);
  });
}

// Precarga el logo pastel para el swap al entrar a Descuentos.
try { (new Image()).src = '/logo-discount.png'; } catch (_) {}

function _syncDiscountBrandLogo() {
  const img = document.querySelector('#mainNav .brand-icon');
  if (!img) return;
  const next = discountMode ? '/logo-discount.png' : '/logo.png';
  if (img.getAttribute('src') === next) return;
  if (_discountLogoTimer) { clearTimeout(_discountLogoTimer); _discountLogoTimer = null; }

  // Morph: sale → cambia src → entra (arranca al instante al cambiar el modo).
  img.classList.add('is-swapping');
  _discountLogoTimer = window.setTimeout(() => {
    img.src = next;
    img.alt = discountMode ? 'PICO Ofertas' : 'PICO';
    // Forzar un frame con el nuevo src aún “out”, luego entrar.
    requestAnimationFrame(() => {
      img.classList.remove('is-swapping');
      _discountLogoTimer = null;
    });
  }, 180);
}

function _syncDescuentosBtn() {
  const btn = document.getElementById('descuentosBtn');
  const label = document.getElementById('descuentosBtnLabel');
  if (btn) {
    btn.classList.toggle('is-active', !!discountMode);
    btn.setAttribute('aria-pressed', discountMode ? 'true' : 'false');
  }
  if (label) label.textContent = discountMode ? 'Salir de ofertas' : 'Descuentos';
  _syncDiscountBrandLogo();
}

function toggleDescuentosMode(e) {
  const btn = document.getElementById('descuentosBtn');
  const origin = btn || (e && e.currentTarget);

  // Todo arranca al pulsar: onda + ignite + cambio de paleta (sin delay de bloqueo).
  _igniteDescuentosBtn(btn);
  _playDiscountBurst(origin);

  // Solo admins pueden entrar al modo Descuentos (preview / pruebas).
  // El resto ve "Próximamente".

  if (!isAdmin) {
    if (discountMode) {
      discountMode = false;
      document.body.classList.remove('discount-mode');
      _syncDescuentosBtn();
      requestAnimationFrame(() => { if (typeof renderProducts === 'function') renderProducts(); });
    }
    openModal('descuentosModal');
    const body = document.querySelector('#descuentosModal .discount-soon h3');
    const p = document.querySelector('#descuentosModal .discount-soon p');
    if (body) body.textContent = 'Próximamente...';
    if (p) p.textContent = 'Estamos preparando ofertas especiales. Muy pronto vas a ver descuentos aquí.';
    return;
  }

  // Admin: solo productos con descuentoPct > 0 (inventario)
  const hasOffers = (products || []).some(p => _productDiscountPct(p.id) > 0);
  if (!discountMode && !hasOffers) {
    openModal('descuentosModal');
    const body = document.querySelector('#descuentosModal .discount-soon h3');
    const p = document.querySelector('#descuentosModal .discount-soon p');
    if (body) body.textContent = 'Sin ofertas por ahora';
    if (p) p.textContent = 'Cuando haya productos con descuento en el inventario, aparecerán aquí.';
    return;
  }

  discountMode = !discountMode;
  document.body.classList.toggle('discount-mode', !!discountMode);
  _syncDescuentosBtn();

  // Re-render del catálogo DESPUÉS del paint del tema (evita jank en el click).
  requestAnimationFrame(() => {
    if (typeof renderProducts === 'function') renderProducts();
    // Solo subir al salir de ofertas (no al entrar)
    if (!discountMode) {
      const wrap = document.querySelector('.catalog-wrap');
      if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function closeDescuentosSoon() {
  closeModal('descuentosModal');
}
