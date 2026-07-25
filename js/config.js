// ════════════════════════════════════════════════════════════════
// PICO · Firebase + estado global de la app
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  FIREBASE INIT
// ═══════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyBrcUAuy-X43Rq8i_RJ7VUy97siQ90_gqQ",
  authDomain: "pico-6c040.firebaseapp.com",
  databaseURL: "https://pico-6c040-default-rtdb.firebaseio.com",
  projectId: "pico-6c040",
  storageBucket: "pico-6c040.firebasestorage.app",
  messagingSenderId: "566388158042",
  appId: "1:566388158042:web:0642d5d533a9f59cd2b263",
  measurementId: "G-EN9QFLSHM8"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ═══════════════════════════════════════════════════
//  APP STATE
// ═══════════════════════════════════════════════════
let currentUser      = null;
let isAdmin          = false;
let products         = [];
let stockMap         = {};
// Entrega elegida en el modal de entrada: 'domicilio' | 'cdb' (Colegio Don Bosco)
// | 'udb' (Universidad Don Bosco). Inventario ÚNICO: NO cambia el stock mostrado.
// ('exsal' es legado y ya no se ofrece; solo se lee en pedidos históricos.)
const SUCURSAL_KEY   = 'pico_sucursal_v1';
let selectedSucursal = localStorage.getItem(SUCURSAL_KEY) || null;
// Migración: EXSAL ya no se ofrece. Si el usuario tenía 'exsal' guardado, se
// limpia para que el modal de entrada le pida elegir de nuevo su entrega.
if (selectedSucursal === 'exsal') { selectedSucursal = null; try { localStorage.removeItem(SUCURSAL_KEY); } catch (_) {} }
let cart             = {};
let orders           = [];
// Busca un pedido entre los docs actualmente cargados (admin: ambas secciones; cliente: mis pedidos)
function findLoadedOrder(firestoreId) {
  return adminPaging.active.docs.find(o => o.firestoreId === firestoreId)
      || adminPaging.done.docs.find(o => o.firestoreId === firestoreId)
      || (myOrdersPaging.docs || []).find(o => o.firestoreId === firestoreId)
      || (orders || []).find(o => o.firestoreId === firestoreId);
}
let adminUnsubscribe = null;
let currentCat       = 'Todos';
let currentSearch    = '';
let discountMode     = false; // vista de catálogo filtrada por productos con descuentoPct

// Descuentos: lista global (leída de Firestore) y descuentos asignados al usuario
let allDescuentos       = [];   // [{id, nombre, porcentaje}]
let userDiscountIds     = [];   // IDs de descuentos que tiene este usuario (cargados por uid)
// selectedDiscount: { source:'assigned'|'code'|'stamp', id, nombre, porcentaje, code? } | null
let selectedDiscount    = null;
let unsubDescuentos     = null;
let unsubUserDiscount   = null;
// Tarjeta de sellos activa del usuario logueado (listener por email)
let userStampCard       = null; // { code, nombre, sellos, rewardAvailable, ... } | null
let unsubStampCard      = null;
const STAMP_REWARD_PCT  = 40;
const STAMP_TARGET      = 8;
const STAMP_MIN_ORDER   = 1;    // $ mínimo de productos para ganar 1 sello

// Paginación / lazy render
const PAGE_SIZE            = 10;
let currentPage            = 1;
let currentFiltered        = [];

// ═══════════════════════════════════════════════════
//  CACHE ETERNO DE PRODUCTOS  (localStorage, sin expiración)
// ═══════════════════════════════════════════════════
// El catálogo completo se guarda en localStorage y sobrevive a cerrar la
// pestaña / el navegador. NO expira por tiempo. La frescura se mantiene con
// una sincronización incremental: al abrir, solo se releen de Firestore los
// productos cuyo 'updatedAt' es más nuevo que la última sync guardada.
const PROD_CACHE_KEY  = 'pico_prods_v2';        // {data:[...], syncTs:<ms>}
const PROD_SYNC_KEY   = 'pico_prods_sync_v2';   // último updatedAt sincronizado (ms)
// (Se conserva el nombre v1 antiguo solo para limpiarlo si existiera)
const PROD_CACHE_KEY_OLD = 'pico_prods_v1';

// Lee el caché de productos desde localStorage. Devuelve {data, syncTs} o null.
function readProdCache() {
  try {
    const raw = localStorage.getItem(PROD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.data)) return null;
    return parsed;
  } catch (_) { return null; }
}

// Guarda el caché completo. syncTs = mayor updatedAt visto hasta ahora (ms).
function writeProdCache(data, syncTs) {
  try {
    localStorage.setItem(PROD_CACHE_KEY, JSON.stringify({ data, syncTs: syncTs || 0 }));
  } catch (_) {}
}

// Convierte un valor updatedAt (Timestamp de Firestore o número) a milisegundos.
function updatedAtToMs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}
