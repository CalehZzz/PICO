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
  document.getElementById('profileInfo').innerHTML = `
    ${avatarHtml}
    <div class="profile-name">${currentUser.name}</div>
    <div class="profile-email">${currentUser.email}</div>
    ${saved.grade
      ? `<div class="profile-saved-tag">✅ ${saved.grade} – Sección ${saved.section}${sucursalLabel ? ' · ' + sucursalLabel : ''}</div>`
      : '<div style="height:14px"></div>'}`;
  document.getElementById('profileGrade').value    = saved.grade    || '';
  document.getElementById('profileSection').value  = saved.section  || '';
  document.getElementById('profileSucursal').value = saved.sucursal || '';
}

function saveProfile() {
  const grade    = document.getElementById('profileGrade').value;
  const section  = document.getElementById('profileSection').value;
  const sucursal = document.getElementById('profileSucursal').value;
  if (!grade || !section) { showToast('⚠️ Selecciona grado y sección'); return; }
  localStorage.setItem('el_profile_' + currentUser.uid, JSON.stringify({ grade, section, sucursal }));
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
