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
    // ── Caché eterno + sincronización incremental ──────────────────────────
    // 1) Partimos del caché de localStorage (si existe).
    // 2) Preguntamos a Firestore SOLO por los productos cambiados desde la
    //    última sync (updatedAt > syncTs). Si no hay caché, traemos todo.
    // 3) Fusionamos: cada doc devuelto reemplaza/añade al caché; los marcados
    //    'eliminado' se quitan. Guardamos y avanzamos el syncTs.
    try { localStorage.removeItem(PROD_CACHE_KEY_OLD); } catch (_) {}

    const cache = readProdCache();
    // Mapa id -> producto crudo, base sobre la que fusionar.
    const byId = new Map();
    let maxSyncTs = cache ? (cache.syncTs || 0) : 0;
    if (cache) cache.data.forEach(d => byId.set(d.id, d));

    let changedSnap;
    if (!cache) {
      // Primera vez en este navegador: traer todo el catálogo una sola vez.
      changedSnap = await db.collection('productos').get();
    } else {
      // Solo lo modificado desde la última sincronización.
      // (Los productos viejos sin 'updatedAt' no se vuelven a leer: ya están en caché.)
      try {
        changedSnap = await db.collection('productos')
          .where('updatedAt', '>', maxSyncTs)
          .get();
      } catch (qErr) {
        // Si la consulta incremental falla (p.ej. falta de índice), caemos a
        // una recarga completa para no dejar el catálogo desactualizado.
        console.warn('Sync incremental falló, recargando todo:', qErr);
        changedSnap = await db.collection('productos').get();
        maxSyncTs = 0; // recomputar el syncTs desde cero con el barrido completo
        byId.clear();
      }
    }

    changedSnap.forEach(doc => {
      const d = { id: doc.id, ...doc.data() };
      const ts = updatedAtToMs(d.updatedAt);
      if (ts > maxSyncTs) maxSyncTs = ts;
      if (d.eliminado) {
        // Borrado lógico: quitar del caché.
        byId.delete(d.id);
      } else {
        byId.set(d.id, d);
      }
    });

    const rawProducts = Array.from(byId.values());
    writeProdCache(rawProducts, maxSyncTs);

    // Procesar productos (detectar cat/emoji, calcular stock)
    // El stock mostrado es SOLO el de la sucursal elegida (stockCdb o stockExsal).
    const stockField = selectedSucursal === 'cdb' ? 'stockCdb'
                     : selectedSucursal === 'exsal' ? 'stockExsal'
                     : selectedSucursal === 'domicilio' ? 'stockCdb'  // domicilio usa el stock de CDB (por ahora)
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
