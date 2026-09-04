// ════════════════════════════════════════════════════════════════
// PICO · Perfil del usuario
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════
function getSavedProfile() {
  if (!currentUser) return {};
  return JSON.parse(localStorage.getItem('el_profile_' + currentUser.uid) || '{}');
}

// ═══════════════════════════════════════════════════
//  PERFIL EN LA NUBE (Firestore: perfiles/{uid})
//  Se guarda across-devices. localStorage queda como caché rápido y
//  síncrono; Firestore es la fuente de verdad.
// ═══════════════════════════════════════════════════
function profileDocRef() {
  return currentUser ? db.collection('perfiles').doc(currentUser.uid) : null;
}

// Lee el perfil de la nube al iniciar sesión y lo fusiona con el caché local.
// Migra perfiles antiguos que solo existían en localStorage.
async function loadProfileFromCloud() {
  if (!currentUser) return;
  const key = 'el_profile_' + currentUser.uid;
  let local = {};
  try { local = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) {}
  // Guardar siempre email/nombre en el perfil de la nube para que el admin pueda
  // asignar descuentos buscando por email SIN necesidad de una compra previa.
  try {
    await profileDocRef().set({
      email:      currentUser.email || '',
      emailLower: (currentUser.email || '').trim().toLowerCase(),
      name:       currentUser.name  || ''
    }, { merge: true });
  } catch (_) {}
  try {
    const snap = await profileDocRef().get();
    if (snap.exists) {
      const cloud = snap.data() || {};
      // La nube es la fuente de verdad; lo local solo llena huecos.
      const merged = { ...local, ...cloud };
      // La sucursal elegida en el gate ESTA sesión tiene prioridad.
      if (selectedSucursal) merged.sucursal = selectedSucursal;
      localStorage.setItem(key, JSON.stringify(merged));
    } else if (Object.keys(local).length) {
      // Migración: perfil viejo solo-local → subirlo a la nube.
      await profileDocRef().set(local, { merge: true });
    }
  } catch (e) {
    console.warn('No se pudo cargar el perfil desde la nube:', e);
  }
  // Refrescar UI si estamos en la página de perfil
  if (document.body.dataset.page === 'profile') renderProfile();
}

// Guarda (merge) campos del perfil en la nube. No bloquea la UI.
function saveProfileToCloud(prof) {
  const ref = profileDocRef();
  if (!ref) return Promise.resolve();
  return ref.set(prof, { merge: true })
    .catch(e => console.warn('No se pudo guardar el perfil en la nube:', e));
}

function renderProfile() {
  if (!currentUser) { showPage('catalog'); return; }
  const initials   = currentUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatarHtml = currentUser.photoURL
    ? `<img src="${currentUser.photoURL}" class="profile-photo-lg" alt="">`
    : `<div class="profile-avatar-lg">${initials}</div>`;
  const saved = getSavedProfile();
  // Etiqueta PÚBLICA (genérica, sin nombrar la institución).
  const sucursalLabel = saved.sucursal
    ? ((typeof entregaPublicLabel === 'function') ? entregaPublicLabel(saved.sucursal)
        : (saved.sucursal === 'domicilio' ? 'Envío a domicilio' : 'Retiro en sucursal'))
    : '';
  // Etiqueta de resumen: datos académicos si los hay, o "domicilio guardado" si guardó dirección.
  let tag = '';
  if (saved.grade) {
    tag = `<div class="profile-saved-tag">${saved.grade} – Sección ${saved.section || '—'}${sucursalLabel ? ' · ' + sucursalLabel : ''}</div>`;
  } else if (saved.sucursal === 'domicilio' && saved.shipAddress) {
    tag = `<div class="profile-saved-tag">Dirección guardada · ${sucursalLabel}</div>`;
  } else {
    tag = '<div style="height:14px"></div>';
  }
  document.getElementById('profileInfo').innerHTML = `
    ${avatarHtml}
    <div class="profile-name">${currentUser.name}</div>
    <div class="profile-email">${currentUser.email}</div>
    ${tag}`;

  // Académicos
  document.getElementById('profileGrade').value    = saved.grade    || '';
  document.getElementById('profileSection').value  = saved.section  || '';
  document.getElementById('profileSucursal').value = saved.sucursal || '';

  // Datos de envío (domicilio)
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('profileShipPhone',      saved.shipPhone);
  set('profileShipPhone2',     saved.shipPhone2);
  set('profileShipDepartment', saved.shipDepartment);
  set('profileShipCity',       saved.shipCity);
  set('profileShipAddress',    saved.shipAddress);
  set('profileShipRef',        saved.shipRef);
  set('profileShipNotes',      saved.shipNotes);

  // Mostrar/ocultar secciones según la sucursal elegida
  toggleProfileSections(saved.sucursal || '');

  // Stats LED Arena (colección ledArena + resumen en perfil) — solo admin
  if (typeof isAdmin !== 'undefined' && isAdmin) {
    const fmtN = (n) => Number(n || 0).toLocaleString('es-SV');
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('profLedScore', fmtN(saved.ledArenaBestScore || 0));
    setTxt('profLedKills', fmtN(saved.ledArenaBestKills || 0));
    setTxt('profLedGames', fmtN(saved.ledArenaGamesPlayed || 0));
    // Si hay sesión, refrescar desde la colección dedicada
    if (currentUser && typeof db !== 'undefined') {
      db.collection('ledArena').doc(currentUser.uid).get().then((snap) => {
        if (!snap.exists) return;
        const d = snap.data() || {};
        const st = d.stats || {};
        setTxt('profLedScore', fmtN(st.bestScore || d.bestScore || saved.ledArenaBestScore || 0));
        setTxt('profLedKills', fmtN(st.bestKills || saved.ledArenaBestKills || 0));
        setTxt('profLedGames', fmtN(st.gamesPlayed || saved.ledArenaGamesPlayed || 0));
      }).catch(() => {});
    }
  }
}

// Muestra los datos académicos para retiro en sucursal, o los de envío para domicilio.
function toggleProfileSections(sucursal) {
  const academic = document.getElementById('profileAcademic');
  const shipping = document.getElementById('profileShipping');
  // Grado/Sección solo para Colegio Don Bosco ('cdb'); envío solo para domicilio.
  // Universidad Don Bosco ('udb') no requiere datos aquí (el teléfono se pide al confirmar).
  if (academic) academic.style.display = (sucursal === 'cdb')       ? '' : 'none';
  if (shipping) shipping.style.display = (sucursal === 'domicilio') ? '' : 'none';
}

function saveProfile() {
  const grade    = document.getElementById('profileGrade').value;
  const section  = document.getElementById('profileSection').value;
  const sucursal = document.getElementById('profileSucursal').value;
  if (!sucursal) { showToast('Elegí cómo querés recibir tus pedidos'); return; }

  // Partimos del perfil existente para NO borrar datos ya guardados (envío, etc.)
  const prof = getSavedProfile();
  prof.grade    = grade;
  prof.section  = section;
  prof.sucursal = sucursal;

  // Guardar datos de envío (los campos solo existen/aplican para domicilio)
  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  prof.shipPhone      = val('profileShipPhone');
  prof.shipPhone2     = val('profileShipPhone2');
  prof.shipDepartment = val('profileShipDepartment');
  prof.shipCity       = val('profileShipCity');
  prof.shipAddress    = val('profileShipAddress');
  prof.shipRef        = val('profileShipRef');
  prof.shipNotes      = val('profileShipNotes');

  localStorage.setItem('el_profile_' + currentUser.uid, JSON.stringify(prof));
  // Guardar también en la nube (cross-device)
  saveProfileToCloud(prof);

  // Si cambió la entrega desde el perfil, reflejarla. Inventario ÚNICO: el stock
  // NO depende de la entrega, así que NO se vacía el carrito ni se recargan productos.
  if (sucursal && sucursal !== selectedSucursal) {
    selectedSucursal = sucursal;
    localStorage.setItem(SUCURSAL_KEY, sucursal);
    if (typeof updateSucursalBadge === 'function') updateSucursalBadge();
    updateCartUI();
  }
  renderProfile();
  showToast('Perfil actualizado');
}
