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
// Sucursal elegida en el gate de entrada ('cdb' | 'exsal'). Determina qué stock se muestra.
const SUCURSAL_KEY   = 'pico_sucursal_v1';
let selectedSucursal = localStorage.getItem(SUCURSAL_KEY) || null;
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

// Descuentos: lista global (leída de Firestore) y descuentos asignados al usuario
let allDescuentos       = [];   // [{id, nombre, porcentaje}]
let userDiscountIds     = [];   // IDs de descuentos que tiene este usuario (cargados por uid)
let selectedDiscount    = null; // {id, nombre, porcentaje} o null
let unsubDescuentos     = null;
let unsubUserDiscount   = null;

// Paginación / lazy render
const PAGE_SIZE            = 10;
let currentPage            = 1;
let currentFiltered        = [];

// Cache de productos en sessionStorage (evita releer Firestore en cada refresh)
const PROD_CACHE_KEY = 'pico_prods_v1';
const PROD_CACHE_TTL = 5 * 60 * 1000; // 5 minutos
