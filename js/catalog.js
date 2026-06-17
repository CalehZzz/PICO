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
  const pager  = document.getElementById('paginationControls');

  if (!currentFiltered.length) {
    grid.innerHTML = '';
    noRes.classList.remove('hidden');
    pager.classList.add('hidden');
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

  // Controles de paginación
  if (totalPages <= 1) {
    pager.classList.add('hidden');
  } else {
    pager.classList.remove('hidden');
    document.getElementById('pageInfo').textContent = `Página ${currentPage} de ${totalPages}`;
    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
  }
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
  const el = document.getElementById('addZone_' + id);
  if (!el) return;
  const s = stockMap[id] !== undefined ? stockMap[id] : 0;
  el.innerHTML = renderAddZoneHTML(id, s === 0);
}

function filterCat(cat, btn) {
  currentCat = cat;
  document.querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProducts();
}

function filterProducts() {
  currentSearch = document.getElementById('searchInput').value.toLowerCase();
  renderProducts();
}

// ═══════════════════════════════════════════════════
//  DETALLE DE PRODUCTO  (modal — imagen y descripción completas)
//  NO se muestran datos privados (costos, IDs de Stripe, etc.)
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

  foot.innerHTML = noStock
    ? `<button class="btn-sec" onclick="closeModal('productDetailModal')">Cerrar</button>` +
      `<button class="btn-pri" disabled style="opacity:.5;cursor:not-allowed">Sin stock</button>`
    : `<button class="btn-sec" onclick="closeModal('productDetailModal')">Cerrar</button>` +
      `<button class="btn-pri" onclick="addToCart('${p.id}')">🛒 Agregar al carrito</button>`;

  openModal('productDetailModal');
}
