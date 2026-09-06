// ════════════════════════════════════════════════════════════════
// PICO · Carga de productos desde Firestore + detección de categoría
// ════════════════════════════════════════════════════════════════

// Generación para invalidar cargas concurrentes (auth / gate / etc.).
let _loadProductsGen = 0;

// ═══════════════════════════════════════════════════
//  CATEGORY / EMOJI DETECTION  (sin tocar Firestore)
// ═══════════════════════════════════════════════════
function detectCatEmoji(name, desc) {
  const n = ((name || '') + ' ' + (desc || '')).toLowerCase();

  // El ORDEN importa: se evalúa de lo más específico a lo más genérico.
  // Así un transistor que mencione "resistencia" en su texto NO cae en Resistencias.

  // 1) Microcontroladores / placas de desarrollo
  if (/\barduino\b|\besp32\b|\besp8266\b|nodemcu|atmega\d|attiny\d|stm32|raspberry|\bpic\s?1\d|microcontrolador/.test(n))
    return { cat: 'Microcontroladores', e: '' };

  // 2) LEDs (antes de Transistores, para que "diodo emisor" no caiga en diodos)
  if (/\bled\b|neopixel|ws2812|tira\s*led|diodo\s*emisor|7\s*segmentos/.test(n))
    return { cat: 'LEDs', e: '' };

  // 3) Transistores y diodos (números de parte muy específicos)
  if (/\btransistor\b|\bmosfet\b|\bbjt\b|\bigbt\b|\bscr\b|\btriac\b|\bnpn\b|\bpnp\b|2n\d{3,4}|bc\d{3}|tip\d{2,3}|irfz?\d|irl\d|\bdiodo\b|\bzener\b|rectificador|1n\d{3,4}/.test(n))
    return { cat: 'Transistores', e: '' };

  // 4) Sensores
  if (/\bsensor\b|hc-?sr04|ultrason|\bdht1[12]?\b|\bldr\b|\bpir\b|mq-?\d|infrarrojo|hall|aceler[oó]metro|giroscop|mpu6050|temperatura|humedad|sensor de l[ií]nea|fotorresist|flama|\bllama\b|sonido/.test(n))
    return { cat: 'Sensores', e: '' };

  // 5) Capacitores
  if (/\bcapacitor\b|condensador|electrol[ií]tic|cer[aá]mic|tantalio|\bmlcc\b|\d+\s*(uf|µf|nf|pf)\b/.test(n))
    return { cat: 'Capacitores', e: '' };

  // 6) Resistencias (incluye potenciómetros y trimmers — resistencias variables)
  if (/resistencia|resistor|\bohm|ohmio|potenci[oó]metro|trimmer|preset/.test(n))
    return { cat: 'Resistencias', e: '' };

  // 7) Conectores / cables / protoboard / botones
  if (/header|espad[ií]n|jumper|dupont|conector|caiman|caimanes|cocodrilo|protoboard|breadboard|push\s*button|pulsador|\bbot[oó]n\b|\bjst\b|bornera|terminal|socket|z[oó]calo|\bcable\b|interruptor|\bswitch\b/.test(n))
    return { cat: 'Conectores', e: '' };

  // 8) Resto: módulos varios
  return { cat: 'Módulos', e: '' };
}

// Normaliza `groupColors` del inventario (colores en un solo documento).
// Cada entrada: { id?, label, color (hex), imageUrl?, enabled }.
function _normalizeGroupColors(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    const label = (c.label != null && String(c.label).trim()) ? String(c.label).trim() : '';
    const color = (c.color != null && String(c.color).trim()) ? String(c.color).trim() : '';
    const imageUrl = (c.imageUrl != null && String(c.imageUrl).trim()) ? String(c.imageUrl).trim() : '';
    const enabled = c.enabled === false ? false : true;
    if (!label && !color) return;
    const id = (c.id != null && String(c.id).trim())
      ? String(c.id).trim()
      : ('c' + i + '_' + (label || color).toLowerCase().replace(/\s+/g, '-'));
    out.push({ id, label: label || color, color: color || '#9ca3af', imageUrl, enabled });
  });
  return out;
}

/** Escala de imagen del modal (50–100 %). Default 100 = llena el recuadro. */
function normalizeImageScale(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!isFinite(n)) return 100;
  return Math.max(50, Math.min(100, Math.round(n)));
}

/**
 * Convierte docs crudos (caché o Firestore) en el modelo en memoria y pinta el catálogo.
 * opts.keepPage: no resetear paginación (útil tras sync en segundo plano).
 * opts.silentUi: no tocar loading/grid (ya visibles desde caché).
 */
function applyRawProducts(rawProducts, opts) {
  const keepPage = !!(opts && opts.keepPage);
  const loadEl = document.getElementById('loadingProducts');
  const gridEl = document.getElementById('productsGrid');
  const hasGrid = !!(loadEl && gridEl);

  products = [];
  productGroups = {};
  rawProducts.forEach(d => {
    const det = detectCatEmoji(d.name, d.desc);
    // Categoría: si el admin la asignó explícitamente, se usa esa;
    // si no, se cae al detector automático (compatibilidad con productos viejos).
    const cat = (d.categoria && String(d.categoria).trim()) ? String(d.categoria).trim() : det.cat;
    const e   = det.e;
    // Stock único: 'stockCdb'. Fallback al 'stock' legado si el producto viejo no tiene stockCdb.
    let s = typeof d.stockCdb === 'number' ? d.stockCdb
          : (typeof d.stock === 'number' ? d.stock : 0);
    const groupColors = _normalizeGroupColors(d.groupColors);
    const groupId = (d.groupId && String(d.groupId).trim()) ? String(d.groupId).trim() : '';
    // Si trae groupColors, el color vive en este doc: no es variante multi-doc.
    const groupKind = groupColors.length
      ? 'color'
      : ((d.groupKind === 'color') ? 'color' : (d.groupKind === 'valor' ? 'valor' : ''));
    const groupName = (d.groupName && String(d.groupName).trim()) ? String(d.groupName).trim() : '';
    const variantLabel = (d.variantLabel && String(d.variantLabel).trim()) ? String(d.variantLabel).trim() : '';
    const variantColor = (d.variantColor && String(d.variantColor).trim()) ? String(d.variantColor).trim() : '';
    // false = deshabilitada en inventario (p.ej. sin stock de ese color). Ausente = habilitada.
    const variantEnabled = d.variantEnabled === false ? false : true;
    const p = {
      id:    d.id,
      name:  d.name  || 'Producto',
      price: typeof d.price === 'number' ? d.price : 0,
      cost:  typeof d.cost  === 'number' ? d.cost  : 0,
      desc:  d.desc  || '',
      img:   d.imageUrl || '',
      // Orden manual decidido por el admin (menor = aparece primero). null = automático.
      orden: (typeof d.orden === 'number' && isFinite(d.orden)) ? d.orden : null,
      // Descuento de oferta en tienda (inventario). 0 = sin oferta.
      descuentoPct: (typeof d.descuentoPct === 'number' && d.descuentoPct > 0 && d.descuentoPct <= 100)
        ? Math.round(d.descuentoPct) : 0,
      // Escala visual de la foto en el modal (solo CSS; no cambia el modal).
      imageScale: normalizeImageScale(d.imageScale),
      stock: s, cat, e,
      groupId, groupKind, groupName, variantLabel, variantColor, variantEnabled,
      groupColors
    };
    products.push(p);
    stockMap[d.id] = s;

    // Índice de grupos multi-doc (valor, o color legado sin groupColors).
    // Productos con groupColors NO entran: son la tarjeta raíz ellos mismos.
    if (groupId && !groupColors.length) {
      if (!productGroups[groupId]) {
        productGroups[groupId] = {
          id: groupId,
          name: groupName || p.name,
          kind: groupKind || 'valor',
          cat, e,
          orden: p.orden,
          variants: []
        };
      }
      const g = productGroups[groupId];
      g.variants.push(p);
      if (groupName) g.name = groupName;
      if (groupKind) g.kind = groupKind;
      // Orden del grupo = menor orden entre variantes (null = ignorar)
      if (p.orden != null && (g.orden == null || p.orden < g.orden)) g.orden = p.orden;
      // Categoría representativa: la más frecuente / primera
      if (!g.cat) g.cat = cat;
      if (!g.e) g.e = e;
    }
  });
  // Ordenar variantes dentro de cada grupo (por label, luego nombre)
  Object.keys(productGroups).forEach(gid => {
    productGroups[gid].variants.sort((a, b) =>
      (a.variantLabel || a.name).localeCompare(b.variantLabel || b.name, 'es', { numeric: true })
    );
  });

  // El stock que se muestra es directamente 'stockCdb' leído de Firebase. El
  // descuento por pedido ya está aplicado en Firebase al momento de crear el
  // pedido, así que NO se vuelve a restar aquí (evita doble descuento).

  if (hasGrid) {
    loadEl.style.display = 'none';
    gridEl.style.display = '';
  }
  if (typeof buildCategoryFilter === 'function') buildCategoryFilter();
  if (typeof renderProducts === 'function') renderProducts(keepPage ? { keepPage: true } : undefined);
  if (typeof updateCartUI === 'function') updateCartUI();
  _prefetchVisibleProductImages();
}

/** Prefetch de URLs ya visibles en tarjetas (misma URL del modal; 0 lecturas Firestore). */
function _prefetchVisibleProductImages() {
  try {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    grid.querySelectorAll('img.pimg-photo[src]').forEach(el => {
      const src = el.getAttribute('src');
      if (!src) return;
      const img = new Image();
      img.src = src;
    });
  } catch (_) {}
}

// ═══════════════════════════════════════════════════
//  LOAD PRODUCTS FROM FIRESTORE
// ═══════════════════════════════════════════════════
async function loadProducts() {
  const gen = ++_loadProductsGen;
  const loadEl = document.getElementById('loadingProducts');
  const gridEl = document.getElementById('productsGrid');
  // Las páginas sin catálogo (mis-pedidos, admin, perfil) igual cargan los
  // productos para que el carrito muestre nombres, precios y stock correctos.
  const hasGrid = !!(loadEl && gridEl);

  try {
    // ── Caché eterno + sincronización incremental ──────────────────────────
    // 1) Partimos del caché de localStorage (si existe) y PINTAMOS YA.
    // 2) Preguntamos a Firestore SOLO por los productos cambiados desde la
    //    última sync (updatedAt > syncTs). Si no hay caché, traemos todo.
    // 3) Fusionamos: cada doc devuelto reemplaza/añade al caché; los marcados
    //    'eliminado' se quitan. Guardamos y avanzamos el syncTs.
    // Sin lecturas extra: misma consulta incremental de siempre; solo deja de
    // bloquear la UI mientras espera la red cuando ya hay caché.
    try { localStorage.removeItem(PROD_CACHE_KEY_OLD); } catch (_) {}

    const cache = readProdCache();
    const byId = new Map();
    let maxSyncTs = cache ? (cache.syncTs || 0) : 0;
    if (cache) cache.data.forEach(d => byId.set(d.id, d));

    let paintedFromCache = false;
    if (cache && cache.data.length) {
      // Pintar de inmediato: el visitante ve el catálogo sin esperar Firestore.
      applyRawProducts(Array.from(byId.values()), { keepPage: false });
      paintedFromCache = true;
    } else if (hasGrid) {
      // Solo cold start: mostrar spinner.
      loadEl.style.display = '';
      gridEl.style.display = 'none';
    }

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

    // Si otra loadProducts() empezó mientras esperábamos, no pisar su resultado.
    if (gen !== _loadProductsGen) return;

    let changed = !cache; // cold start siempre aplica el snapshot completo
    if (cache && byId.size === 0 && changedSnap) {
      // Recarga completa tras fallo de índice: hay que reaplicar.
      changed = true;
    }
    changedSnap.forEach(doc => {
      const d = { id: doc.id, ...doc.data() };
      const ts = updatedAtToMs(d.updatedAt);
      if (ts > maxSyncTs) maxSyncTs = ts;
      if (d.eliminado) {
        byId.delete(d.id);
      } else {
        byId.set(d.id, d);
      }
      changed = true;
    });

    const rawProducts = Array.from(byId.values());
    if (changed) {
      writeProdCache(rawProducts, maxSyncTs);
      applyRawProducts(rawProducts, { keepPage: paintedFromCache });
    } else if (!paintedFromCache) {
      // Sin caché previo y sin docs (catálogo vacío): igual ocultar spinner.
      writeProdCache(rawProducts, maxSyncTs);
      applyRawProducts(rawProducts, { keepPage: false });
    }
  } catch (err) {
    if (gen !== _loadProductsGen) return;
    if (loadEl && products.length === 0) {
      loadEl.innerHTML = '<div class="ni"></div><p>Error al cargar productos. Recarga la página.</p>';
    }
    console.error('loadProducts:', err);
  }
}
