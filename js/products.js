// ════════════════════════════════════════════════════════════════
// PICO · Carga de productos desde Firestore + detección de categoría
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  CATEGORY / EMOJI DETECTION  (sin tocar Firestore)
// ═══════════════════════════════════════════════════
function detectCatEmoji(name, desc) {
  const n = ((name || '') + ' ' + (desc || '')).toLowerCase();
  if (/resistencia|potenciometro|potenci/.test(n))             return { cat:'Resistencias',       e:'🔴' };
  if (/capacitor|electrolit|ceramico|condensador/.test(n))     return { cat:'Capacitores',         e:'🔵' };
  if (/transistor|mosfet|diodo|bjt|igbt/.test(n))             return { cat:'Transistores',         e:'⚫' };
  if (/sensor|pir|dht|ultrason|ldr|llama|sonido|temp/.test(n))return { cat:'Sensores',             e:'🌡️' };
  if (/arduino|esp32|esp8266|nodemcu|atmega|stm32/.test(n))   return { cat:'Microcontroladores',   e:'🟢' };
  if (/\bled\b|neopixel|tira led|rgb led/.test(n))            return { cat:'LEDs',                 e:'💡' };
  if (/header|jumper|conector|push|button|boton|jst/.test(n)) return { cat:'Conectores',           e:'🔌' };
  return { cat:'Módulos', e:'⚙️' };
}

// ═══════════════════════════════════════════════════
//  LOAD PRODUCTS FROM FIRESTORE
// ═══════════════════════════════════════════════════
async function loadProducts() {
  const loadEl = document.getElementById('loadingProducts');
  const gridEl = document.getElementById('productsGrid');
  // Las páginas sin catálogo (mis-pedidos, admin, perfil) igual cargan los
  // productos para que el carrito muestre nombres, precios y stock correctos.
  const hasGrid = !!(loadEl && gridEl);
  if (hasGrid) { loadEl.style.display = ''; gridEl.style.display = 'none'; }
  try {
    // ── Intentar usar cache de sessionStorage ──────────────────────────────
    let rawProducts = null;
    try {
      const cached = sessionStorage.getItem(PROD_CACHE_KEY);
      if (cached) {
        const { ts, data } = JSON.parse(cached);
        if (Date.now() - ts < PROD_CACHE_TTL) rawProducts = data;
      }
    } catch (_) {}

    if (!rawProducts) {
      // Cargar productos desde Firestore y guardar en cache
      const snap = await db.collection('productos').get();
      rawProducts = [];
      snap.forEach(doc => {
        const d = doc.data();
        rawProducts.push({ id: doc.id, ...d });
      });
      try {
        sessionStorage.setItem(PROD_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: rawProducts }));
      } catch (_) {}
    }

    // Procesar productos (detectar cat/emoji, calcular stock)
    // El stock mostrado es SOLO el de la sucursal elegida (stockCdb o stockExsal).
    const stockField = selectedSucursal === 'cdb' ? 'stockCdb'
                     : selectedSucursal === 'exsal' ? 'stockExsal'
                     : null;
    products = [];
    rawProducts.forEach(d => {
      const { cat, e } = detectCatEmoji(d.name, d.desc);
      let s;
      if (stockField) {
        // Stock real de la sucursal seleccionada
        s = typeof d[stockField] === 'number' ? d[stockField] : 0;
      } else {
        // Sin sucursal (no debería ocurrir tras el gate): fallback a la suma o stock legado
        const hasSucursalStock = typeof d.stockCdb === 'number' || typeof d.stockExsal === 'number';
        s = hasSucursalStock
          ? ((typeof d.stockCdb === 'number' ? d.stockCdb : 0) + (typeof d.stockExsal === 'number' ? d.stockExsal : 0))
          : (typeof d.stock === 'number' ? d.stock : 0);
      }
      products.push({
        id:    d.id,
        name:  d.name  || 'Producto',
        price: typeof d.price === 'number' ? d.price : 0,
        cost:  typeof d.cost  === 'number' ? d.cost  : 0,
        desc:  d.desc  || '',
        img:   d.imageUrl || '',
        stock: s, cat, e
      });
      stockMap[d.id] = s;
    });

    // El stock que se muestra es directamente el de la sucursal (stockCdb / stockExsal)
    // leído de Firebase. El descuento por pedido ya está aplicado en Firebase al
    // momento de crear el pedido, así que NO se vuelve a restar aquí (evita doble descuento).

    if (hasGrid) { loadEl.style.display = 'none'; gridEl.style.display = ''; }
    renderProducts();
    // Re-renderizar carrito ahora que products ya está cargado (fix: al init loadCart corre antes que Firestore)
    updateCartUI();
  } catch (err) {
    if (loadEl) loadEl.innerHTML = '<div class="ni">⚠️</div><p>Error al cargar productos. Recarga la página.</p>';
    console.error('loadProducts:', err);
  }
}
