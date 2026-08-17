// ════════════════════════════════════════════════════════════════
// PICO · Integración con la API de diseño de QR de GeneraQR
// ════════════════════════════════════════════════════════════════
// GeneraQR (proyecto de Firebase separado) expone Cloud Functions que
// devuelven el estilo del QR (colores, formas, logo) que el dueño
// (calebrenebr@gmail.com) haya publicado como "activo" desde su cuenta
// de GeneraQR. PICO consume ese estilo para dibujar los QR de pedidos
// con el mismo diseño, sin duplicar el diseñador.
//
// - getActiveDesign()  → público, lo usa cualquier cliente al generar
//   el QR de su pedido.
// - listMyDesigns() / setActiveDesign() → solo funcionan si quien está
//   conectado en PICO inició sesión también en GeneraQR con
//   calebrenebr@gmail.com (Cloud Functions lo verifica igualmente).
(function (global) {
  'use strict';

  const FUNCTIONS_BASE = 'https://us-central1-generaqr-91499.cloudfunctions.net';
  const ADMIN_EMAIL = 'calebrenebr@gmail.com';

  const GENERAQR_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCDxv2JVJMoJf6Phho72mq-pYYWF3JneJc",
    authDomain: "generaqr-91499.firebaseapp.com",
    projectId: "generaqr-91499",
    storageBucket: "generaqr-91499.firebasestorage.app",
    messagingSenderId: "397343288725",
    appId: "1:397343288725:web:9bb4b10770e30a49d21a9c"
  };

  const CACHE_KEY = 'pico_qr_active_design_v1';
  const CACHE_MS  = 10 * 60 * 1000; // 10 minutos

  let secondaryApp = null;
  function getSecondaryApp() {
    if (secondaryApp) return secondaryApp;
    try {
      secondaryApp = firebase.app('generaqr');
    } catch (_) {
      secondaryApp = firebase.initializeApp(GENERAQR_FIREBASE_CONFIG, 'generaqr');
    }
    return secondaryApp;
  }

  /** Inicia sesión con Google contra el proyecto de GeneraQR (no el de PICO). */
  async function signInAdmin() {
    const app = getSecondaryApp();
    const provider = new firebase.auth.GoogleAuthProvider();
    const cred = await firebase.auth(app).signInWithPopup(provider);
    if (cred.user.email !== ADMIN_EMAIL) {
      await firebase.auth(app).signOut();
      throw new Error('Esta función solo está disponible para ' + ADMIN_EMAIL);
    }
    return cred.user;
  }

  function getSignedInAdmin() {
    const app = getSecondaryApp();
    return firebase.auth(app).currentUser;
  }

  async function getAdminIdToken(forceRefresh) {
    const user = getSignedInAdmin();
    if (!user) throw new Error('Primero conéctate con tu cuenta de GeneraQR.');
    return user.getIdToken(!!forceRefresh);
  }

  function signOutAdmin() {
    const app = getSecondaryApp();
    return firebase.auth(app).signOut();
  }

  /** Diseño activo, público. Con caché corta en localStorage para no pegarle a la función en cada QR. */
  async function getActiveDesign(options) {
    const opts = options || {};
    if (!opts.force) {
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached && cached._cachedAt && (Date.now() - cached._cachedAt) < CACHE_MS) {
          return cached.data;
        }
      } catch (_) {}
    }
    const res = await fetch(FUNCTIONS_BASE + '/getActiveDesign', { method: 'GET' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ('Error ' + res.status + ' al obtener el diseño.'));
    }
    const data = await res.json();
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data, _cachedAt: Date.now() }));
    } catch (_) {}
    return data;
  }

  async function listMyDesigns() {
    const idToken = await getAdminIdToken();
    const res = await fetch(FUNCTIONS_BASE + '/listMyDesigns', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + idToken }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ('Error ' + res.status + ' al listar diseños.'));
    }
    const data = await res.json();
    return data.designs || [];
  }

  async function setActiveDesign(presetId) {
    const idToken = await getAdminIdToken();
    const res = await fetch(FUNCTIONS_BASE + '/setActiveDesign', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ('Error ' + res.status + ' al publicar el diseño.'));
    }
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
    return res.json();
  }

  /** Carga una <img> a partir de un data URL (para usar como logo del QR). */
  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo cargar el logo del QR.'));
      img.src = dataUrl;
    });
  }

  /**
   * Dibuja un QR con el diseño activo de GeneraQR dentro de `container`
   * (reemplaza su contenido). Si algo falla (sin internet, API caída,
   * aún no se publicó ningún diseño), cae de vuelta a la librería QRCode
   * clásica para no dejar al usuario sin su QR.
   */
  async function renderStyledQr(container, data, opts) {
    const size = (opts && opts.size) || 260;
    container.innerHTML = '';
    try {
      if (typeof QRCodeStyling === 'undefined' || !global.GeneraQRRender) {
        throw new Error('Librería de diseño de QR no disponible.');
      }
      const design = await getActiveDesign();
      let logoImage = null;
      if (design.logoDataUrl) {
        try { logoImage = await loadImage(design.logoDataUrl); } catch (_) { logoImage = null; }
      }
      const renderOpts = global.GeneraQRRender.optionsFromStyle(design, {
        data: data,
        size: size * 2, // 2x para que se vea nítido en pantallas retina
        logoImage: logoImage
      });
      const canvas = await global.GeneraQRRender.renderQrCanvas(renderOpts);
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      canvas.style.display = 'block';
      container.appendChild(canvas);
      return true;
    } catch (err) {
      console.warn('No se pudo dibujar el QR con el diseño de GeneraQR, usando QR clásico:', err.message);
      if (typeof QRCode !== 'undefined') {
        new QRCode(container, { text: data, width: size, height: size });
      }
      return false;
    }
  }

  global.QrDesignAPI = {
    ADMIN_EMAIL,
    signInAdmin,
    getSignedInAdmin,
    signOutAdmin,
    getActiveDesign,
    listMyDesigns,
    setActiveDesign,
    renderStyledQr
  };
})(window);
