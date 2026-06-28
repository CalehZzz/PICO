const admin = require('firebase-admin');
const serviceAccount = require('./clave.json');
admin.initializeApp({ credential: admin.cert(serviceAccount) });

const EMAIL = 'calebrenebr@gmail.com';   // ← tu correo exacto de PICO

admin.auth().getUserByEmail(EMAIL)
  .then(u => admin.auth().setCustomUserClaims(u.uid, { admin: true }))
  .then(() => { console.log('✅ Listo: ' + EMAIL + ' ahora es admin. Cierra sesión y vuelve a entrar.'); process.exit(0); })
  .catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
