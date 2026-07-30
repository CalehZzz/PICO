// ════════════════════════════════════════════════════════════════
// PICO · Patrocinio CREAJ / ferias: $50 en créditos a cambio de
// cartel con logo + QR en el stand del proyecto.
// ════════════════════════════════════════════════════════════════

function openSponsorModal() {
  const m = document.getElementById('sponsorModal');
  if (!m) return;
  // Reset steps
  const stepSchool = document.getElementById('sponsorStepSchool');
  const stepForm = document.getElementById('sponsorStepForm');
  const done = document.getElementById('sponsorDone');
  if (stepSchool) stepSchool.style.display = '';
  if (stepForm) stepForm.style.display = 'none';
  if (done) done.style.display = 'none';
  const err = document.getElementById('sponsorFormError');
  if (err) err.textContent = '';
  // Prefill from sucursal if CDB
  const suc = (typeof selectedSucursal !== 'undefined' && selectedSucursal) ? selectedSucursal
    : ((typeof getSavedProfile === 'function' && getSavedProfile().sucursal) || null);
  if (suc === 'cdb') {
    selectSponsorSchool('cdb');
  }
  openModal('sponsorModal');
}

function closeSponsorModal() {
  closeModal('sponsorModal');
}

function selectSponsorSchool(kind) {
  // kind: 'cdb' | 'otros'
  const stepSchool = document.getElementById('sponsorStepSchool');
  const stepForm = document.getElementById('sponsorStepForm');
  if (stepSchool) stepSchool.style.display = 'none';
  if (stepForm) stepForm.style.display = '';

  const schoolKind = document.getElementById('sponsorSchoolKind');
  if (schoolKind) schoolKind.value = kind;

  const otrosWrap = document.getElementById('sponsorOtrosFields');
  const inst = document.getElementById('sponsorInstitucion');
  const feria = document.getElementById('sponsorFeria');
  if (kind === 'cdb') {
    if (otrosWrap) otrosWrap.style.display = 'none';
    if (inst) inst.value = 'Colegio Don Bosco';
    if (feria) feria.value = 'CREAJ';
  } else {
    if (otrosWrap) otrosWrap.style.display = '';
    if (inst) inst.value = '';
    if (feria) feria.value = '';
  }

  const title = document.getElementById('sponsorFormSchoolLabel');
  if (title) {
    title.textContent = kind === 'cdb'
      ? 'Colegio Don Bosco · Feria CREAJ'
      : 'Otra institución / feria';
  }
}

function sponsorBackToSchool() {
  const stepSchool = document.getElementById('sponsorStepSchool');
  const stepForm = document.getElementById('sponsorStepForm');
  if (stepForm) stepForm.style.display = 'none';
  if (stepSchool) stepSchool.style.display = '';
}

async function submitSponsorForm() {
  const err = document.getElementById('sponsorFormError');
  const btn = document.getElementById('sponsorSubmitBtn');
  const kind = (document.getElementById('sponsorSchoolKind') || {}).value || 'cdb';

  const proyecto = (document.getElementById('sponsorProyecto') || {}).value.trim();
  const descripcion = (document.getElementById('sponsorDesc') || {}).value.trim();
  const integrantes = (document.getElementById('sponsorIntegrantes') || {}).value.trim();
  const grado = (document.getElementById('sponsorGrado') || {}).value.trim();
  const seccion = (document.getElementById('sponsorSeccion') || {}).value.trim();
  const telefono = (document.getElementById('sponsorTelefono') || {}).value.trim();
  let institucion = (document.getElementById('sponsorInstitucion') || {}).value.trim();
  let feria = (document.getElementById('sponsorFeria') || {}).value.trim();

  if (kind === 'cdb') {
    institucion = 'Colegio Don Bosco';
    feria = 'CREAJ';
  }

  if (!proyecto) { if (err) err.textContent = 'Escribe el nombre del proyecto.'; return; }
  if (!descripcion) { if (err) err.textContent = 'Agrega una breve descripción.'; return; }
  if (!integrantes) { if (err) err.textContent = 'Lista los integrantes.'; return; }
  if (!grado || !seccion) { if (err) err.textContent = 'Completa grado y sección.'; return; }
  if (!telefono || telefono.length < 8) { if (err) err.textContent = 'Teléfono de contacto inválido.'; return; }
  if (kind === 'otros') {
    if (!institucion || institucion.length < 2) { if (err) err.textContent = 'Nombre de la institución.'; return; }
    if (!feria || feria.length < 2) { if (err) err.textContent = 'Nombre de la feria de proyectos.'; return; }
  }
  if (err) err.textContent = '';

  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const fn = firebase.functions().httpsCallable('solicitarPatrocinioCreditos');
    await fn({
      schoolKind: kind,
      institucion,
      feria,
      proyecto,
      descripcion,
      integrantes,
      grado,
      seccion,
      telefono
    });
    const stepForm = document.getElementById('sponsorStepForm');
    const done = document.getElementById('sponsorDone');
    if (stepForm) stepForm.style.display = 'none';
    if (done) done.style.display = '';
  } catch (e) {
    if (err) err.textContent = (e && e.message) ? e.message : 'No se pudo enviar. Intenta de nuevo.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar solicitud'; }
  }
}
