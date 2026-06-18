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

function renderProfile() {
  if (!currentUser) { showPage('catalog'); return; }
  const initials   = currentUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatarHtml = currentUser.photoURL
    ? `<img src="${currentUser.photoURL}" class="profile-photo-lg" alt="">`
    : `<div class="profile-avatar-lg">${initials}</div>`;
  const saved = getSavedProfile();
  const sucursalLabel = saved.sucursal === 'cdb' ? '🏫 CDB' : saved.sucursal === 'exsal' ? '🏢 EXSAL' : saved.sucursal === 'domicilio' ? '🚚 Domicilio' : '';
  // Etiqueta de resumen: datos académicos si los hay, o "domicilio guardado" si guardó dirección.
  let tag = '';
  if (saved.grade) {
    tag = `<div class="profile-saved-tag">✅ ${saved.grade} – Sección ${saved.section || '—'}${sucursalLabel ? ' · ' + sucursalLabel : ''}</div>`;
  } else if (saved.sucursal === 'domicilio' && saved.shipAddress) {
    tag = `<div class="profile-saved-tag">✅ Dirección guardada · ${sucursalLabel}</div>`;
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
}

// Muestra los datos académicos para retiro en sucursal, o los de envío para domicilio.
function toggleProfileSections(sucursal) {
  const academic = document.getElementById('profileAcademic');
  const shipping = document.getElementById('profileShipping');
  const esDom = sucursal === 'domicilio';
  if (academic) academic.style.display = esDom ? 'none' : '';
  if (shipping) shipping.style.display = esDom ? '' : 'none';
}

// Al cambiar la sucursal en el perfil: si un usuario normal elige domicilio,
// mostramos "Próximamente" y revertimos la selección (domicilio es solo admin).
function onProfileSucursalChange(value) {
  if (value === 'domicilio' && !isAdmin) {
    showComingSoon();
    const sel = document.getElementById('profileSucursal');
    const prev = (getSavedProfile().sucursal && getSavedProfile().sucursal !== 'domicilio')
      ? getSavedProfile().sucursal : '';
    if (sel) sel.value = prev;
    toggleProfileSections(prev);
    return;
  }
  toggleProfileSections(value);
}

function saveProfile() {
  const grade    = document.getElementById('profileGrade').value;
  const section  = document.getElementById('profileSection').value;
  const sucursal = document.getElementById('profileSucursal').value;
  if (!sucursal) { showToast('⚠️ Elegí cómo querés recibir tus pedidos'); return; }
  // Envío a domicilio aún no disponible para usuarios normales (sí para admin).
  if (sucursal === 'domicilio' && !isAdmin) {
    showComingSoon();
    document.getElementById('profileSucursal').value = selectedSucursal || '';
    toggleProfileSections(selectedSucursal || '');
    return;
  }

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

  // Si cambió la sucursal desde el perfil, reflejarlo en el gate y recargar el stock
  if (sucursal && sucursal !== selectedSucursal) {
    selectedSucursal = sucursal;
    localStorage.setItem(SUCURSAL_KEY, sucursal);
    cart = {};
    saveCart();
    updateCartUI();
    loadProducts();
  }
  renderProfile();
  showToast('✅ Perfil actualizado');
}
