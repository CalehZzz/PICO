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
      <div class="pimg">
        ${p.img ? `<img class="pimg-photo" src="${p.img}" alt="${p.name}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <span class="ptag">${p.cat}</span>
        <span class="pstock ${stockClass(s)}">${stockLabel(s)}</span>
        <span class="pimg-emoji"${p.img ? ' style="display:none"' : ''}>${p.e}</span>
      </div>
      <div class="pbody">
        <div class="pname">${p.name}</div>
        <div class="pdesc">${p.desc}</div>
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
