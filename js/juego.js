// ═══════════════════════════════════════════════════════════════
// PICO · LED Arena — survival arena (Brotato-like)
// Colección Firestore: ledArena
// Resumen en perfiles/{uid}: ledArena*
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'juego') return;

  const COL = 'ledArena';
  const LS = {
    custom: 'pico_led_custom_v1',
    stats: 'pico_led_stats_v1',
    save: 'pico_led_save_v1',
    name: 'pico_led_name_v1',
    top: 'pico_led_top_v1'
  };

  const ARENA_W = 1400, ARENA_H = 1100, WALL = 40;
  // 10 bosses antes del final (~cada 10.5 min) + boss final a las 2h
  const BOSS_AT = [10.5, 21, 31.5, 42, 52.5, 63, 73.5, 84, 94.5, 105, 120].map(m => m * 60);

  const COLORS = ['#38bdf8','#22c55e','#f59e0b','#ef4444','#a78bfa','#ec4899','#14b8a6','#f97316','#eab308','#60a5fa'];
  const HATS = [
    { id: 'none', name: 'Ninguno' },
    { id: 'chonguita', name: 'Chonguita' },
    { id: 'sombrero', name: 'Sombrero' },
    { id: 'gorra', name: 'Gorra' },
    { id: 'corona', name: 'Corona' }
  ];
  const SHOES = [
    { id: 'none', name: 'Ninguno' },
    { id: 'tenis', name: 'Tenis' },
    { id: 'botas', name: 'Botas' }
  ];
  const ACCS = [
    { id: 'none', name: 'Ninguno' },
    { id: 'lentes', name: 'Lentes' },
    { id: 'bufanda', name: 'Bufanda' },
    { id: 'mochila', name: 'Mochila' }
  ];

  // 20 armas automáticas (solo te mueves)
  const WEAPONS = [
    { id:'blaster', name:'LED Blaster', icon:'🔫', desc:'Pistola confiable.', dmg:8, rate:.35, range:420, speed:420, count:1, color:'#7dd3fc' },
    { id:'shotgun', name:'Cap Shotgun', icon:'💥', desc:'Abánico corto.', dmg:6, rate:.85, range:220, speed:380, count:5, spread:.35, color:'#fb7185' },
    { id:'rifle', name:'Resistor Rifle', icon:'🎯', desc:'Alcance largo.', dmg:14, rate:.55, range:560, speed:560, count:1, color:'#86efac' },
    { id:'smg', name:'Proto SMG', icon:'⚡', desc:'Ráfaga loca.', dmg:4, rate:.12, range:340, speed:480, count:1, color:'#fde047' },
    { id:'diode', name:'Diode Darts', icon:'🔸', desc:'Dardos dobles.', dmg:7, rate:.28, range:400, speed:500, count:2, spread:.12, color:'#fbbf24' },
    { id:'laser', name:'Crystal Laser', icon:'✦', desc:'Atraviesa enemigos.', dmg:11, rate:.7, range:620, speed:900, count:1, pierce:3, color:'#c4b5fd' },
    { id:'coil', name:'Coil Cannon', icon:'🌀', desc:'Explosión al impacto.', dmg:22, rate:1.1, range:480, speed:320, count:1, radius:42, color:'#67e8f9' },
    { id:'burst', name:'Transistor Burst', icon:'📶', desc:'Tres disparos.', dmg:5, rate:.5, range:360, speed:450, count:3, spread:.18, color:'#34d399' },
    { id:'missile', name:'Arduino Missiles', icon:'🚀', desc:'Teledirigidos.', dmg:18, rate:1.0, range:500, speed:280, count:1, homing:true, radius:36, color:'#fdba74' },
    { id:'boomer', name:'Breadboardang', icon:'🪃', desc:'Regresa al dueño.', dmg:10, rate:.9, range:300, speed:360, count:1, bounce:true, color:'#a3e635' },
    { id:'oscope', name:'O-Scope Beam', icon:'〰️', desc:'Haz rapidísimo.', dmg:3, rate:.08, range:300, speed:700, count:1, color:'#22d3ee' },
    { id:'orb', name:'Voltage Orb', icon:'🔮', desc:'Orbe eléctrico.', dmg:9, rate:.75, range:380, speed:240, count:1, radius:50, color:'#e879f9' },
    { id:'aura', name:'Ampere Aura', icon:'⭕', desc:'Orbita y golpea.', dmg:6, rate:.2, range:90, orbit:true, color:'#f472b6' },
    { id:'mines', name:'Fuse Mines', icon:'💣', desc:'Minas en el piso.', dmg:28, rate:1.4, range:160, mine:true, radius:70, color:'#f87171' },
    { id:'iron', name:'Solder Iron', icon:'🔧', desc:'Giro cuerpo a cuerpo.', dmg:12, rate:.25, range:70, melee:true, color:'#fb923c' },
    { id:'multi', name:'Multimeter Zap', icon:'📟', desc:'Encadena enemigos.', dmg:8, rate:.45, range:350, speed:520, count:1, chain:2, color:'#4ade80' },
    { id:'shuri', name:'Chip Shuriken', icon:'★', desc:'Estrellas ninja.', dmg:9, rate:.4, range:390, speed:440, count:3, spread:.5, color:'#94a3b8' },
    { id:'plasma', name:'Plasma Cap', icon:'🟣', desc:'Plasma perforante.', dmg:15, rate:.65, range:450, speed:360, count:1, pierce:2, radius:28, color:'#d946ef' },
    { id:'drone', name:'Nano Drone', icon:'🛸', desc:'Dron autónomo.', dmg:5, rate:.3, range:280, speed:300, count:1, homing:true, color:'#2dd4bf' },
    { id:'nova', name:'Overclock Nova', icon:'☀️', desc:'Explosión circular.', dmg:20, rate:1.6, range:140, nova:true, radius:120, color:'#facc15' }
  ];

  const BOSSES = [
    { name:'Resistor Rage', kind:'resistor', color:'#f87171', hp:1100, speed:58, dmg:16, size:52, atk:'charge' },
    { name:'Capacitor Crush', kind:'capacitor', color:'#fbbf24', hp:1600, speed:50, dmg:18, size:56, atk:'burst' },
    { name:'Diode Demon', kind:'diode', color:'#a3e635', hp:2200, speed:66, dmg:18, size:54, atk:'spiral' },
    { name:'Transistor Tyrant', kind:'transistor', color:'#34d399', hp:3000, speed:62, dmg:21, size:58, atk:'charge' },
    { name:'Inductor Inferno', kind:'inductor', color:'#fb923c', hp:4000, speed:54, dmg:24, size:62, atk:'ring' },
    { name:'Oscillator Overlord', kind:'crystal', color:'#22d3ee', hp:5200, speed:68, dmg:22, size:60, atk:'spiral' },
    { name:'Relay Reaper', kind:'relay', color:'#c084fc', hp:6800, speed:74, dmg:26, size:66, atk:'burst' },
    { name:'IC Invader', kind:'ic', color:'#60a5fa', hp:8800, speed:58, dmg:28, size:70, atk:'ring' },
    { name:'MOSFET Monster', kind:'mosfet', color:'#f472b6', hp:11200, speed:64, dmg:32, size:74, atk:'charge' },
    { name:'Arduino Abomination', kind:'arduino', color:'#4ade80', hp:14500, speed:56, dmg:34, size:80, atk:'burst' },
    { name:'MEGA PICO DARK CORE', kind:'motherboard', color:'#ef4444', hp:28000, speed:72, dmg:40, size:98, atk:'final', final:true }
  ];

  // ── helpers ──
  const $ = (id) => document.getElementById(id);
  function loadLS(k, fb) { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch (_) { return fb; } }
  function saveLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function fmt(n) { return Number(n || 0).toLocaleString('es-SV'); }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function shuffle(a) {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  }
  function shade(hex, amt) {
    const n = hex.replace('#', '');
    const full = n.length === 3 ? n.split('').map(c => c + c).join('') : n;
    const num = parseInt(full, 16);
    let r = (num >> 16) + amt, g = ((num >> 8) & 255) + amt, b = (num & 255) + amt;
    return '#' + ((1 << 24) + (clamp(r, 0, 255) << 16) + (clamp(g, 0, 255) << 8) + clamp(b, 0, 255)).toString(16).slice(1);
  }
  function circleRect(cx, cy, cr, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw), ny = clamp(cy, ry, ry + rh);
    return (cx - nx) ** 2 + (cy - ny) ** 2 < cr * cr;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function toast(msg) {
    if (typeof showToast === 'function') showToast(msg);
  }

  // ── persistent state ──
  let custom = loadLS(LS.custom, { color: COLORS[0], hat: 'none', shoes: 'none', acc: 'none' });
  let stats = loadLS(LS.stats, { bestScore: 0, bestKills: 0, gamesPlayed: 0, bestTime: 0 });
  let saveSlot = loadLS(LS.save, null);
  let playerName = localStorage.getItem(LS.name) || '';

  const keys = Object.create(null);
  const touch = { x: 0, y: 0 };
  const mouse = { x: 0, y: 0, down: false, worldX: 0, worldY: 0, gotoX: null, gotoY: null };
  let raf = 0;
  const isCoarse = () => window.matchMedia && window.matchMedia('(pointer:coarse)').matches;

  const G = {
    running: false,
    paused: false,
    overlay: null,
    time: 0,
    score: 0,
    kills: 0,
    wave: 1,
    xp: 0,
    level: 1,
    bossesDefeated: 0,
    nextBossIdx: 0,
    bossActive: false,
    player: null,
    weapons: [],
    enemies: [],
    bullets: [],
    pickups: [],
    particles: [],
    obstacles: [],
    cam: { x: 0, y: 0 },
    spawnAcc: 0,
    saveAcc: 0,
    invuln: 0,
    lastTs: 0,
    fx: null
  };

  function freshFx() {
    return {
      shake: 0,
      flash: 0,
      flashColor: '#ef4444',
      tint: 0,
      tintRgb: '239,68,68',
      surge: 0,
      gridMode: 0, // 0 normal, 1 voltaje, 2 sangre, 3 overclock, 4 void
      rings: [],
      storms: [],
      sparks: [],
      lastWaveFx: 0,
      lastMinuteMark: 0,
      bossWarnIdx: -1,
      vignette: 0
    };
  }

  /** Escala exponencial con el tiempo (~1 → ~2.1 a 5min → ~4.4 a 10min → ~19 a 20min). */
  function difficultyMul() {
    return Math.pow(1.15, G.time / 60);
  }
  function waveExp() {
    return Math.pow(1.07, Math.max(0, G.wave - 1));
  }

  // ── boot ──
  function boot() {
    // No pedir sucursal en la página del juego
    try {
      const m = document.getElementById('sucursalGateModal');
      if (m) {
        m.classList.remove('open');
        m.style.display = 'none';
      }
      document.body.style.overflow = '';
    } catch (_) {}

    if ($('playerName')) $('playerName').value = playerName;
    refreshMenuStats();
    buildCustomUI();
    drawPreview();
    bindUI();
    updateContinueBtn();
    updateAuthHint();
    setupTouch();
    syncCloud().then(() => {
      refreshMenuStats();
      updateContinueBtn();
      buildCustomUI();
      drawPreview();
    });
    loadTop10();
    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && G.running && !G.paused) pauseGame();
    });
    setInterval(() => {
      const sc = $('screenCustom');
      if (sc && !sc.classList.contains('hidden')) drawPreview();
    }, 90);
  }

  function refreshMenuStats() {
    if ($('statBest')) $('statBest').textContent = fmt(stats.bestScore);
    if ($('statKills')) $('statKills').textContent = fmt(stats.bestKills);
    if ($('statGames')) $('statGames').textContent = fmt(stats.gamesPlayed);
  }
  function updateContinueBtn() {
    const b = $('btnContinue');
    if (b) b.disabled = !(saveSlot && saveSlot.alive);
  }
  function updateAuthHint() {
    const h = $('authHint');
    if (!h) return;
    const u = typeof currentUser !== 'undefined' ? currentUser : null;
    h.textContent = u
      ? 'Sesión activa: puntaje, partida y look se guardan en ledArena + tu perfil.'
      : 'Inicia sesión para guardar puntaje, partida y top 10 en la nube.';
  }
  function showScreen(id) {
    ['screenMenu', 'screenCustom', 'screenTop', 'screenGame'].forEach(s => {
      const el = $(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
  }

  function bindUI() {
    $('btnPlay')?.addEventListener('click', startNewGame);
    $('btnContinue')?.addEventListener('click', continueGame);
    $('btnCustom')?.addEventListener('click', () => {
      showScreen('screenCustom');
      drawPreview();
    });
    $('btnTop')?.addEventListener('click', () => {
      showScreen('screenTop');
      loadTop10();
    });
    $('btnCustomBack')?.addEventListener('click', () => showScreen('screenMenu'));
    $('btnTopBack')?.addEventListener('click', () => showScreen('screenMenu'));
    $('btnSaveCustom')?.addEventListener('click', () => {
      saveLS(LS.custom, custom);
      persistCustomCloud();
      toast('Look guardado gratis ✓');
      showScreen('screenMenu');
    });
    $('btnPause')?.addEventListener('click', pauseGame);
    $('playerName')?.addEventListener('change', (e) => {
      playerName = (e.target.value || '').trim().slice(0, 18);
      localStorage.setItem(LS.name, playerName);
    });
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      keys[e.key] = true;
      if (G.running && !G.paused) {
        if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
      }
      if (e.code === 'Escape' && G.running) {
        e.preventDefault();
        if (G.paused && G.overlay === 'pause') closeOverlay();
        else pauseGame();
      }
    });
    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
      keys[e.key] = false;
    });
    setupMouse();
  }

  function setupMouse() {
    const c = $('gameCanvas');
    if (!c) return;
    const updatePos = (e) => {
      const rect = c.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.worldX = mouse.x + G.cam.x;
      mouse.worldY = mouse.y + G.cam.y;
    };
    c.addEventListener('pointerdown', (e) => {
      if (!G.running || G.paused || isCoarse()) return;
      if (e.button !== 0) return;
      // no robar clics del HUD
      if (e.target.closest && e.target.closest('.led-hud-r, .led-ico')) return;
      mouse.down = true;
      updatePos(e);
      mouse.gotoX = mouse.worldX;
      mouse.gotoY = mouse.worldY;
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!G.running) return;
      updatePos(e);
      if (mouse.down && !isCoarse()) {
        mouse.gotoX = mouse.worldX;
        mouse.gotoY = mouse.worldY;
      }
    });
    const up = () => { mouse.down = false; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  }

  function buildCustomUI() {
    const row = $('colorRow');
    if (!row) return;
    row.innerHTML = '';
    COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'led-swatch' + (custom.color === c ? ' active' : '');
      b.style.background = c;
      b.addEventListener('click', () => {
        custom.color = c;
        buildCustomUI();
        drawPreview();
      });
      row.appendChild(b);
    });
    fillChips($('hatRow'), HATS, 'hat');
    fillChips($('shoeRow'), SHOES, 'shoes');
    fillChips($('accRow'), ACCS, 'acc');
  }
  function fillChips(row, list, key) {
    if (!row) return;
    row.innerHTML = '';
    list.forEach((item) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'led-chip' + (custom[key] === item.id ? ' active' : '');
      b.textContent = item.name;
      b.addEventListener('click', () => {
        custom[key] = item.id;
        buildCustomUI();
        drawPreview();
      });
      row.appendChild(b);
    });
  }

  // ── LED drawing ──
  function drawLed(ctx, x, y, scale, look, facing, t) {
    const bob = Math.sin((t || 0) * 8) * 1.2 * scale;
    const swing = Math.sin((t || 0) * 10) * 0.35;
    ctx.save();
    ctx.translate(x, y + bob);

    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.ellipse(0, 18 * scale, 14 * scale, 5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = look.color;
    ctx.lineWidth = 3.2 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-5 * scale, 8 * scale);
    ctx.lineTo(-6 * scale + Math.sin(swing) * 4 * scale, 18 * scale);
    ctx.moveTo(5 * scale, 8 * scale);
    ctx.lineTo(6 * scale - Math.sin(swing) * 4 * scale, 18 * scale);
    ctx.stroke();

    if (look.shoes === 'tenis' || look.shoes === 'botas') {
      ctx.fillStyle = look.shoes === 'botas' ? '#334155' : '#f8fafc';
      const sy = 18 * scale;
      ctx.fillRect(-10 * scale + Math.sin(swing) * 4 * scale, sy - 2 * scale, 8 * scale, 4 * scale);
      ctx.fillRect(2 * scale - Math.sin(swing) * 4 * scale, sy - 2 * scale, 8 * scale, 4 * scale);
    }

    ctx.beginPath();
    ctx.moveTo(-10 * scale, 0);
    ctx.lineTo(-16 * scale, 6 * scale + Math.cos(swing) * 3 * scale);
    ctx.moveTo(10 * scale, 0);
    ctx.lineTo(16 * scale, 6 * scale - Math.cos(swing) * 3 * scale);
    ctx.stroke();

    if (look.acc === 'mochila') {
      ctx.fillStyle = '#475569';
      ctx.fillRect(-6 * scale, -6 * scale, 12 * scale, 14 * scale);
    }

    const grd = ctx.createRadialGradient(-4 * scale, -6 * scale, 2 * scale, 0, 0, 16 * scale);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.35, look.color);
    grd.addColorStop(1, shade(look.color, -40));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(0, 0, 14 * scale, 16 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(-5 * scale, -22 * scale, 3 * scale, 7 * scale);
    ctx.fillRect(2 * scale, -24 * scale, 3 * scale, 9 * scale);

    ctx.fillStyle = '#0f172a';
    const ex = (facing || 1) > 0 ? 3 : -3;
    ctx.beginPath();
    ctx.arc((-4 + ex) * scale, -2 * scale, 2.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc((4 + ex) * scale, -2 * scale, 2.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc((-3.3 + ex) * scale, -2.6 * scale, 0.7 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc((4.7 + ex) * scale, -2.6 * scale, 0.7 * scale, 0, Math.PI * 2);
    ctx.fill();

    if (look.acc === 'lentes') {
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 1.6 * scale;
      ctx.strokeRect(-9 * scale, -5 * scale, 8 * scale, 6 * scale);
      ctx.strokeRect(1 * scale, -5 * scale, 8 * scale, 6 * scale);
      ctx.beginPath();
      ctx.moveTo(-1 * scale, -2 * scale);
      ctx.lineTo(1 * scale, -2 * scale);
      ctx.stroke();
    }
    if (look.acc === 'bufanda') {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-12 * scale, 6 * scale, 24 * scale, 4 * scale);
      ctx.fillRect(6 * scale, 8 * scale, 5 * scale, 10 * scale);
    }

    drawHat(ctx, look.hat, scale);
    ctx.restore();
  }

  function drawHat(ctx, hat, s) {
    if (!hat || hat === 'none') return;
    if (hat === 'chonguita') {
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.ellipse(0, -18 * s, 16 * s, 7 * s, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fb7185';
      ctx.beginPath();
      ctx.arc(-10 * s, -22 * s, 5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(10 * s, -22 * s, 5 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (hat === 'sombrero') {
      ctx.fillStyle = '#92400e';
      ctx.beginPath();
      ctx.ellipse(0, -16 * s, 20 * s, 4 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-8 * s, -28 * s, 16 * s, 12 * s);
    } else if (hat === 'gorra') {
      ctx.fillStyle = '#1d4ed8';
      ctx.beginPath();
      ctx.ellipse(0, -17 * s, 14 * s, 6 * s, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(0, -18 * s, 16 * s, 4 * s);
    } else if (hat === 'corona') {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(-12 * s, -16 * s);
      ctx.lineTo(-8 * s, -28 * s);
      ctx.lineTo(-4 * s, -18 * s);
      ctx.lineTo(0, -30 * s);
      ctx.lineTo(4 * s, -18 * s);
      ctx.lineTo(8 * s, -28 * s);
      ctx.lineTo(12 * s, -16 * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPreview() {
    const c = $('previewCanvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    drawLed(ctx, c.width / 2, c.height / 2 + 10, 3.2, custom, 1, performance.now() / 1000);
  }

  // ── cloud ──
  function uid() {
    return typeof currentUser !== 'undefined' && currentUser ? currentUser.uid : null;
  }
  function getName() {
    const n = ($('playerName')?.value || playerName || '').trim();
    if (n) return n.slice(0, 18);
    if (typeof currentUser !== 'undefined' && currentUser?.name) {
      return String(currentUser.name).split(' ')[0].slice(0, 18);
    }
    return 'LED Player';
  }
  function serverTs() {
    return typeof firebase !== 'undefined' && firebase.firestore
      ? firebase.firestore.FieldValue.serverTimestamp()
      : Date.now();
  }

  async function syncCloud() {
    const id = uid();
    if (!id || typeof db === 'undefined') return;
    try {
      const snap = await db.collection(COL).doc(id).get();
      if (!snap.exists) return;
      const d = snap.data() || {};
      if (d.custom) custom = { ...custom, ...d.custom };
      if (d.stats) stats = { ...stats, ...d.stats };
      if (d.save) saveSlot = d.save;
      if (d.playerName && !playerName) {
        playerName = d.playerName;
        if ($('playerName')) $('playerName').value = playerName;
      }
      saveLS(LS.custom, custom);
      saveLS(LS.stats, stats);
      saveLS(LS.save, saveSlot);
    } catch (e) {
      console.warn('ledArena sync', e);
    }
  }

  async function persistCustomCloud() {
    const id = uid();
    if (!id || typeof db === 'undefined') return;
    try {
      await db.collection(COL).doc(id).set({
        custom,
        playerName: getName(),
        email: currentUser.email || '',
        updatedAt: serverTs()
      }, { merge: true });
      if (typeof saveProfileToCloud === 'function') {
        saveProfileToCloud({
          ledArenaColor: custom.color,
          ledArenaHat: custom.hat,
          ledArenaShoes: custom.shoes,
          ledArenaAcc: custom.acc,
          ledArenaName: getName()
        });
      }
    } catch (e) {
      console.warn('ledArena custom', e);
    }
  }

  async function persistSaveCloud(save) {
    saveLS(LS.save, save);
    const id = uid();
    if (!id || typeof db === 'undefined') return;
    try {
      await db.collection(COL).doc(id).set({
        save,
        playerName: getName(),
        email: currentUser.email || '',
        updatedAt: serverTs()
      }, { merge: true });
    } catch (e) {
      console.warn('ledArena save', e);
    }
  }

  async function persistStatsCloud() {
    saveLS(LS.stats, stats);
    const id = uid();
    if (!id || typeof db === 'undefined') return;
    try {
      await db.collection(COL).doc(id).set({
        stats,
        playerName: getName(),
        email: currentUser.email || '',
        bestScore: stats.bestScore,
        bestKills: stats.bestKills,
        updatedAt: serverTs()
      }, { merge: true });
      if (typeof saveProfileToCloud === 'function') {
        saveProfileToCloud({
          ledArenaBestScore: stats.bestScore,
          ledArenaBestKills: stats.bestKills,
          ledArenaGamesPlayed: stats.gamesPlayed,
          ledArenaBestTime: stats.bestTime
        });
      }
    } catch (e) {
      console.warn('ledArena stats', e);
    }
  }

  async function submitScore(run) {
    const entry = {
      uid: uid() || 'guest',
      name: getName(),
      email: typeof currentUser !== 'undefined' && currentUser ? currentUser.email || '' : '',
      score: run.score,
      kills: run.kills,
      wave: run.wave,
      time: Math.floor(run.time),
      bossesDefeated: run.bossesDefeated,
      weapons: (run.weapons || []).map((w) => w.id),
      custom: { ...custom },
      createdAt: serverTs()
    };
    const localTop = loadLS(LS.top, []);
    localTop.push({ ...entry, createdAt: Date.now() });
    localTop.sort((a, b) => b.score - a.score);
    saveLS(LS.top, localTop.slice(0, 10));

    if (typeof db === 'undefined') return;
    try {
      await db.collection(COL).doc('_scores').collection('runs').add(entry);
      const id = uid();
      if (id) {
        await db.collection(COL).doc(id).set({
          lastRun: {
            score: run.score,
            kills: run.kills,
            wave: run.wave,
            time: Math.floor(run.time),
            bossesDefeated: run.bossesDefeated,
            at: Date.now()
          },
          bestScore: Math.max(stats.bestScore, run.score),
          updatedAt: serverTs()
        }, { merge: true });
      }
    } catch (e) {
      console.warn('ledArena score', e);
    }
  }

  async function loadTop10() {
    const list = $('topList');
    if (!list) return;
    list.innerHTML = '<li class="led-muted">Cargando…</li>';
    let rows = [];
    try {
      if (typeof db !== 'undefined') {
        const snap = await db
          .collection(COL)
          .doc('_scores')
          .collection('runs')
          .orderBy('score', 'desc')
          .limit(10)
          .get();
        rows = snap.docs.map((d) => d.data());
      }
    } catch (e) {
      console.warn('top10', e);
    }
    if (!rows.length) rows = loadLS(LS.top, []);
    if (!rows.length) {
      list.innerHTML = '<li class="led-muted">Aún no hay puntajes. ¡Sé el primero!</li>';
      return;
    }
    list.innerHTML = rows
      .slice(0, 10)
      .map(
        (r, i) => `
      <li>
        <span class="rank">#${i + 1}</span>
        <div>
          <div class="name">${escapeHtml(r.name || 'Anónimo')}</div>
          <div class="meta">${fmt(r.kills || 0)} kills · Oleada ${r.wave || 1} · ${fmtTime(r.time || 0)}</div>
        </div>
        <span class="pts">${fmt(r.score || 0)}</span>
      </li>`
      )
      .join('');
  }

  // ── touch ──
  function setupTouch() {
    const pad = $('touchPad');
    const base = $('joyBase');
    const knob = $('joyKnob');
    if (!pad || !base || !knob) return;
    const R = 40;
    let pid = null;
    function setKnob(dx, dy) {
      const len = Math.hypot(dx, dy) || 1;
      const cl = Math.min(len, R);
      const nx = (dx / len) * cl;
      const ny = (dy / len) * cl;
      knob.style.left = 32 + nx + 'px';
      knob.style.top = 32 + ny + 'px';
      touch.x = nx / R;
      touch.y = ny / R;
    }
    function reset() {
      pid = null;
      touch.x = 0;
      touch.y = 0;
      knob.style.left = '32px';
      knob.style.top = '32px';
    }
    // Solo capturar pointer en móvil; en desktop el mouse mueve por el canvas
    const enable = () => {
      pad.style.pointerEvents = isCoarse() ? 'auto' : 'none';
    };
    enable();
    window.addEventListener('resize', enable);
    pad.addEventListener('pointerdown', (e) => {
      if (!G.running || G.paused || !isCoarse()) return;
      pid = e.pointerId;
      pad.setPointerCapture?.(e.pointerId);
      // Coloca la base cerca del dedo
      const rect = pad.getBoundingClientRect();
      const bx = e.clientX - rect.left - 55;
      const by = e.clientY - rect.top - 55;
      base.style.left = Math.max(8, Math.min(rect.width - 118, bx)) + 'px';
      base.style.top = Math.max(8, Math.min(rect.height - 118, by)) + 'px';
      base.style.bottom = 'auto';
      setKnob(0, 0);
    });
    pad.addEventListener('pointermove', (e) => {
      if (pid !== e.pointerId) return;
      const rect = base.getBoundingClientRect();
      setKnob(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
    });
    pad.addEventListener('pointerup', reset);
    pad.addEventListener('pointercancel', reset);
  }

  function resizeCanvas() {
    const c = $('gameCanvas');
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight - 64;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── game lifecycle ──
  function startNewGame() {
    playerName = getName();
    localStorage.setItem(LS.name, playerName);
    resetRun();
    addWeapon(WEAPONS[0], 1);
    showScreen('screenGame');
    resizeCanvas();
    G.running = true;
    G.paused = false;
    G.lastTs = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    gameToast('Muévete: WASD · flechas · mouse · joystick');
    // Demo rápida de bosses/FX: /juego/?demoFx=1
    try {
      if (new URLSearchParams(location.search).get('demoFx') === '1') {
        setTimeout(() => {
          G.time = BOSS_AT[0] - 1;
          G.nextBossIdx = 0;
          triggerFieldEvent('bossWarn', BOSSES[0]);
        }, 800);
        setTimeout(() => {
          if (!G.bossActive) spawnBoss(BOSSES[0], false);
        }, 2600);
        setTimeout(() => triggerFieldEvent('voltageSurge'), 5000);
      }
    } catch (_) {}
  }

  function continueGame() {
    if (!saveSlot || !saveSlot.alive) return;
    resetRun();
    applySave(saveSlot);
    showScreen('screenGame');
    resizeCanvas();
    G.running = true;
    G.paused = false;
    G.lastTs = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    gameToast('Partida reanudada');
  }

  function resetRun() {
    G.time = 0;
    G.score = 0;
    G.kills = 0;
    G.wave = 1;
    G.xp = 0;
    G.level = 1;
    G.bossesDefeated = 0;
    G.nextBossIdx = 0;
    G.bossActive = false;
    G.weapons = [];
    G.enemies = [];
    G.bullets = [];
    G.pickups = [];
    G.particles = [];
    G.spawnAcc = 0;
    G.saveAcc = 0;
    G.invuln = 1.2;
    G.overlay = null;
    G.paused = false;
    G.fx = freshFx();
    G.player = {
      x: ARENA_W / 2,
      y: ARENA_H / 2,
      r: 14,
      speed: 175,
      hp: 100,
      maxHp: 100,
      facing: 1,
      look: { ...custom }
    };
    G.obstacles = makeObstacles();
    G.cam = { x: 0, y: 0 };
    mouse.down = false;
    mouse.gotoX = null;
    mouse.gotoY = null;
    hideOverlay();
    updateHud();
    updateWeaponSlots();
    // asegurar spawn libre
    if (hitObstacle(G.player.x, G.player.y, G.player.r)) unstickPlayer();
  }

  function makeObstacles() {
    // Evitar el centro (spawn del jugador)
    const spots = [
      [280, 260], [520, 220], [980, 250], [1180, 320],
      [260, 520], [480, 720], [920, 500], [1160, 680],
      [320, 900], [700, 880], [1050, 900], [560, 400], [860, 760]
    ];
    return spots.map(([x, y], i) => ({
      x,
      y,
      w: 46 + (i % 3) * 14,
      h: 36 + (i % 2) * 16,
      kind: i % 3 === 0 ? 'crate' : i % 3 === 1 ? 'wall' : 'pillar'
    }));
  }

  function addWeapon(def, level) {
    if (G.weapons.length >= 4) return false;
    if (G.weapons.some((w) => w.id === def.id)) return false;
    G.weapons.push({
      id: def.id,
      name: def.name,
      icon: def.icon,
      level: level || 1,
      cd: 0,
      def
    });
    updateWeaponSlots();
    return true;
  }
  function upgradeWeapon(id) {
    const w = G.weapons.find((x) => x.id === id);
    if (!w) return false;
    w.level = Math.min(8, w.level + 1);
    updateWeaponSlots();
    return true;
  }

  function applySave(s) {
    G.time = s.time || 0;
    G.score = s.score || 0;
    G.kills = s.kills || 0;
    G.wave = s.wave || 1;
    G.xp = s.xp || 0;
    G.level = s.level || 1;
    G.bossesDefeated = s.bossesDefeated || 0;
    G.nextBossIdx = s.nextBossIdx || 0;
    G.player.hp = s.hp || G.player.maxHp;
    G.player.maxHp = s.maxHp || 100;
    G.player.x = s.x || ARENA_W / 2;
    G.player.y = s.y || ARENA_H / 2;
    G.player.look = s.look || { ...custom };
    G.weapons = (s.weapons || []).map((w) => {
      const def = WEAPONS.find((d) => d.id === w.id) || WEAPONS[0];
      return { id: def.id, name: def.name, icon: def.icon, level: w.level || 1, cd: 0, def };
    });
    if (!G.weapons.length) addWeapon(WEAPONS[0], 1);
    updateWeaponSlots();
    updateHud();
  }

  function snapshotSave() {
    return {
      alive: true,
      time: G.time,
      score: G.score,
      kills: G.kills,
      wave: G.wave,
      xp: G.xp,
      level: G.level,
      bossesDefeated: G.bossesDefeated,
      nextBossIdx: G.nextBossIdx,
      hp: G.player.hp,
      maxHp: G.player.maxHp,
      x: G.player.x,
      y: G.player.y,
      look: G.player.look,
      weapons: G.weapons.map((w) => ({ id: w.id, level: w.level })),
      savedAt: Date.now()
    };
  }

  function loop(ts) {
    if (!G.running) return;
    const dt = Math.min(0.05, (ts - G.lastTs) / 1000 || 0.016);
    G.lastTs = ts;
    if (!G.paused) update(dt);
    render();
    raf = requestAnimationFrame(loop);
  }

  function update(dt) {
    G.time += dt;
    G.invuln = Math.max(0, G.invuln - dt);
    G.saveAcc += dt;
    if (G.saveAcc > 20) {
      G.saveAcc = 0;
      const snap = snapshotSave();
      saveSlot = snap;
      persistSaveCloud(snap);
    }
    G.wave = 1 + Math.floor(G.time / 45);
    movePlayer(dt);
    spawnEnemies(dt);
    maybeSpawnBoss();
    updateWeapons(dt);
    updateBullets(dt);
    updateEnemies(dt);
    updatePickups(dt);
    updateParticles(dt);
    updateFieldFx(dt);
    collidePlayer();

    const c = $('gameCanvas');
    const vw = c ? c.clientWidth : 800;
    const vh = c ? c.clientHeight : 600;
    const sh = G.fx && G.fx.shake > 0 ? G.fx.shake : 0;
    G.cam.x = clamp(G.player.x - vw / 2 + (Math.random() - 0.5) * sh * 10, 0, Math.max(0, ARENA_W - vw));
    G.cam.y = clamp(G.player.y - vh / 2 + (Math.random() - 0.5) * sh * 10, 0, Math.max(0, ARENA_H - vh));
    updateHud();
    if (G.player.hp <= 0) gameOver();
  }

  function movePlayer(dt) {
    let mx = 0;
    let my = 0;
    if (keys.KeyW || keys.ArrowUp || keys.w || keys.W) my -= 1;
    if (keys.KeyS || keys.ArrowDown || keys.s || keys.S) my += 1;
    if (keys.KeyA || keys.ArrowLeft || keys.a || keys.A) mx -= 1;
    if (keys.KeyD || keys.ArrowRight || keys.d || keys.D) mx += 1;
    mx += touch.x;
    my += touch.y;
    const kbOrTouch = Math.abs(mx) + Math.abs(my) > 0.05;
    if (kbOrTouch) {
      mouse.gotoX = null;
      mouse.gotoY = null;
    }
    // Mouse: clic / arrastre → camina hacia el punto (también click-to-move)
    if (mouse.gotoX != null && !isCoarse()) {
      if (mouse.down) {
        mouse.worldX = mouse.x + G.cam.x;
        mouse.worldY = mouse.y + G.cam.y;
        mouse.gotoX = mouse.worldX;
        mouse.gotoY = mouse.worldY;
      }
      const dx = mouse.gotoX - G.player.x;
      const dy = mouse.gotoY - G.player.y;
      if (Math.hypot(dx, dy) > 10) {
        mx += dx;
        my += dy;
      } else {
        mouse.gotoX = null;
        mouse.gotoY = null;
      }
    }
    const len = Math.hypot(mx, my);
    if (len > 0.05) {
      mx /= len;
      my /= len;
      G.player.facing = mx >= 0 ? 1 : -1;
      tryMove(mx * G.player.speed * dt, my * G.player.speed * dt);
    }
    // Si quedó atrapado en un obstáculo (save viejo), empujarlo fuera
    if (hitObstacle(G.player.x, G.player.y, G.player.r)) unstickPlayer();
  }

  function tryMove(dx, dy) {
    let nx = clamp(G.player.x + dx, WALL + G.player.r, ARENA_W - WALL - G.player.r);
    let ny = clamp(G.player.y + dy, WALL + G.player.r, ARENA_H - WALL - G.player.r);
    if (!hitObstacle(nx, ny, G.player.r)) {
      G.player.x = nx;
      G.player.y = ny;
      return;
    }
    if (!hitObstacle(nx, G.player.y, G.player.r)) G.player.x = nx;
    if (!hitObstacle(G.player.x, ny, G.player.r)) G.player.y = ny;
  }

  function unstickPlayer() {
    const angles = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4);
    for (let distTry = 20; distTry <= 160; distTry += 20) {
      for (const a of angles) {
        const nx = clamp(G.player.x + Math.cos(a) * distTry, WALL + G.player.r, ARENA_W - WALL - G.player.r);
        const ny = clamp(G.player.y + Math.sin(a) * distTry, WALL + G.player.r, ARENA_H - WALL - G.player.r);
        if (!hitObstacle(nx, ny, G.player.r)) {
          G.player.x = nx;
          G.player.y = ny;
          return;
        }
      }
    }
    G.player.x = ARENA_W / 2;
    G.player.y = ARENA_H / 2 + 80;
  }

  function hitObstacle(x, y, r) {
    for (const o of G.obstacles) {
      if (circleRect(x, y, r, o.x - o.w / 2, o.y - o.h / 2, o.w, o.h)) return o;
    }
    return null;
  }

  function spawnEnemies(dt) {
    const d = difficultyMul();
    const w = waveExp();
    const post = G.bossesDefeated >= 11 ? 1.45 + (G.time - 7200) / 1800 : 1;
    // Spawn crece fuerte pero con techo jugable
    const rate = Math.min(32, (2.0 + G.wave * 0.32) * Math.pow(d, 0.55) * Math.sqrt(w) * post);
    G.spawnAcc += dt * rate;
    const cap = Math.min(280, Math.floor(38 + G.wave * 7 + (G.time / 22) * Math.min(2.4, Math.sqrt(d))));
    const eliteChance = Math.min(0.42, 0.05 + G.time / 2200 + G.bossesDefeated * 0.018 + G.wave * 0.004);
    while (G.spawnAcc >= 1 && G.enemies.length < cap) {
      G.spawnAcc -= 1;
      spawnOne(Math.random() < eliteChance);
    }
    if (Math.random() < dt * 0.08 && G.pickups.filter((p) => p.kind === 'weapon').length < 3) {
      spawnWeaponPickup();
    }
  }

  function spawnOne(elite) {
    const edge = Math.floor(Math.random() * 4);
    let x;
    let y;
    if (edge === 0) {
      x = rnd(WALL, ARENA_W - WALL);
      y = WALL + 10;
    } else if (edge === 1) {
      x = rnd(WALL, ARENA_W - WALL);
      y = ARENA_H - WALL - 10;
    } else if (edge === 2) {
      x = WALL + 10;
      y = rnd(WALL, ARENA_H - WALL);
    } else {
      x = ARENA_W - WALL - 10;
      y = rnd(WALL, ARENA_H - WALL);
    }

    const d = difficultyMul();
    const w = waveExp();
    const types = [
      { name: 'Bug', color: '#f87171', hp: 18, speed: 70, r: 10, score: 10 },
      { name: 'Glitch', color: '#fb923c', hp: 28, speed: 95, r: 9, score: 14 },
      { name: 'Spam', color: '#a78bfa', hp: 40, speed: 55, r: 13, score: 18 },
      { name: 'Leak', color: '#34d399', hp: 55, speed: 48, r: 15, score: 22 },
      { name: 'Noise', color: '#38bdf8', hp: 22, speed: 110, r: 8, score: 16 }
    ];
    const base = types[Math.floor(Math.random() * types.length)];
    const hpMul = d * w * (elite ? 3.4 : 1);
    const spdMul = Math.min(2.35, 1 + Math.log2(1 + d) * 0.28) * (elite ? 1.22 : 1);
    const dmgMul = Math.min(5.5, Math.pow(d, 0.62) * Math.sqrt(w)) * (elite ? 1.7 : 1);
    G.enemies.push({
      x,
      y,
      r: base.r * (elite ? 1.45 : 1),
      hp: base.hp * hpMul,
      maxHp: base.hp * hpMul,
      speed: base.speed * (0.9 + Math.random() * 0.3) * spdMul,
      color: base.color,
      name: base.name,
      dmg: (6.5 + G.wave * 0.55) * dmgMul,
      score: Math.floor(base.score * d * (elite ? 3.5 : 1)),
      elite: !!elite,
      boss: false,
      t: Math.random() * 10,
      atkCd: 0
    });
  }

  function maybeSpawnBoss() {
    // Aviso de campo ~18s antes del boss
    if (G.fx && G.nextBossIdx < BOSS_AT.length) {
      const eta = BOSS_AT[G.nextBossIdx] - G.time;
      if (eta > 0 && eta < 18 && G.fx.bossWarnIdx !== G.nextBossIdx && !G.bossActive) {
        G.fx.bossWarnIdx = G.nextBossIdx;
        triggerFieldEvent('bossWarn', BOSSES[G.nextBossIdx]);
      }
    }
    if (G.nextBossIdx >= BOSS_AT.length) {
      if (!G.bossActive && G.time > 7200) {
        const cycle = Math.floor((G.time - 7200) / 420);
        if (cycle + 11 > G.bossesDefeated) spawnBoss(BOSSES[cycle % 10], true);
      }
      return;
    }
    if (G.bossActive) return;
    if (G.time >= BOSS_AT[G.nextBossIdx]) spawnBoss(BOSSES[G.nextBossIdx], false);
  }

  function spawnBoss(def, mini) {
    G.bossActive = true;
    const scale = mini ? 0.72 : 1.15;
    const idx = Math.min(G.nextBossIdx, BOSSES.length - 1);
    const post = G.bossesDefeated >= 11 ? 1.35 + (G.bossesDefeated - 11) * 0.12 : 1;
    const exp = Math.pow(1.16, idx) * difficultyMul() * 0.35 + Math.pow(1.16, idx);
    const hp = def.hp * scale * post * Math.max(1, exp * 0.55);
    G.enemies.push({
      x: ARENA_W / 2,
      y: WALL + 90,
      r: def.size * scale,
      hp,
      maxHp: hp,
      speed: def.speed * (mini ? 0.95 : 1.08) * Math.min(1.45, 1 + idx * 0.03),
      color: def.color,
      name: def.name,
      kind: def.kind || 'ic',
      dmg: def.dmg * (mini ? 0.9 : 1.15) * post * Math.min(2.8, Math.pow(1.09, idx)),
      score: Math.floor(500 * (idx + 1) * (def.final ? 6 : 1) * difficultyMul()),
      elite: true,
      boss: true,
      final: !!def.final,
      atk: def.atk,
      t: 0,
      atkCd: 1.4,
      phase: 0,
      pulse: 0
    });
    banner(def.final ? '⚠ BOSS FINAL: ' + def.name : '⚠ BOSS: ' + def.name);
    gameToast(def.final ? '¡El Dark Core ha despertado!' : '¡Un componente malvado aparece!');
    triggerFieldEvent(def.final ? 'darkCore' : 'bossSpawn', def);
  }

  function nearestEnemy(x, y, range, exclude) {
    let best = null;
    let bd = range;
    for (const e of G.enemies) {
      if (e === exclude) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  function updateWeapons(dt) {
    for (const w of G.weapons) {
      w.cd -= dt;
      const def = w.def;
      const rate = def.rate / (1 + (w.level - 1) * 0.12);
      if (w.cd > 0) continue;
      w.cd = rate;
      if (def.orbit) {
        doOrbit(w);
        continue;
      }
      if (def.melee) {
        doMelee(w);
        continue;
      }
      if (def.nova) {
        doNova(w);
        continue;
      }
      if (def.mine) {
        doMine(w);
        continue;
      }
      const target = nearestEnemy(G.player.x, G.player.y, def.range * (1 + w.level * 0.05));
      if (!target && !def.homing) continue;
      fireWeapon(w, target);
    }
  }

  function fireWeapon(w, target) {
    const def = w.def;
    const lvl = w.level;
    const dmg = def.dmg * (1 + (lvl - 1) * 0.18);
    const count = def.count || 1;
    const spread = def.spread || 0;
    let ang = target
      ? Math.atan2(target.y - G.player.y, target.x - G.player.x)
      : Math.random() * Math.PI * 2;
    const style = def.id === 'laser' || def.id === 'oscope' ? 'beam'
      : def.id === 'shotgun' || def.id === 'shuri' ? 'shard'
      : def.id === 'missile' || def.id === 'drone' ? 'rocket'
      : def.id === 'orb' || def.id === 'plasma' || def.id === 'coil' ? 'orb'
      : def.id === 'boomer' ? 'boomer'
      : 'bolt';
    for (let i = 0; i < count; i++) {
      const a = ang + (count === 1 ? 0 : (i - (count - 1) / 2) * (spread || 0.15));
      G.bullets.push({
        x: G.player.x,
        y: G.player.y,
        vx: Math.cos(a) * (def.speed || 400),
        vy: Math.sin(a) * (def.speed || 400),
        ang: a,
        dmg,
        r: style === 'orb' ? 6 : style === 'rocket' ? 5 : 3.5,
        life: 1.6,
        color: def.color,
        style,
        pierce: def.pierce || 0,
        radius: def.radius || 0,
        homing: !!def.homing,
        bounce: !!def.bounce,
        chain: def.chain || 0,
        owner: 'player',
        hit: new Set(),
        trail: []
      });
    }
  }

  function doOrbit(w) {
    const range = 90 + w.level * 8;
    const dmg = w.def.dmg * (1 + (w.level - 1) * 0.15);
    for (const e of G.enemies) {
      if (dist(e.x, e.y, G.player.x, G.player.y) < range + e.r) damageEnemy(e, dmg * 0.35);
    }
    G.particles.push({
      x: G.player.x,
      y: G.player.y,
      life: 0.15,
      max: 0.15,
      color: w.def.color,
      r: range,
      ring: true
    });
  }
  function doMelee(w) {
    const range = 70 + w.level * 5;
    const dmg = w.def.dmg * (1 + (w.level - 1) * 0.2);
    for (const e of G.enemies) {
      if (dist(e.x, e.y, G.player.x, G.player.y) < range + e.r) damageEnemy(e, dmg);
    }
    G.particles.push({
      x: G.player.x,
      y: G.player.y,
      life: 0.12,
      max: 0.12,
      color: w.def.color,
      r: range,
      ring: true
    });
  }
  function doNova(w) {
    const range = (w.def.radius || 120) + w.level * 8;
    const dmg = w.def.dmg * (1 + (w.level - 1) * 0.2);
    for (const e of G.enemies) {
      if (dist(e.x, e.y, G.player.x, G.player.y) < range + e.r) damageEnemy(e, dmg);
    }
    G.particles.push({
      x: G.player.x,
      y: G.player.y,
      life: 0.35,
      max: 0.35,
      color: w.def.color,
      r: range,
      ring: true
    });
  }
  function doMine(w) {
    G.pickups.push({
      kind: 'mine',
      x: G.player.x,
      y: G.player.y,
      r: 10,
      dmg: w.def.dmg * (1 + (w.level - 1) * 0.2),
      radius: w.def.radius || 70,
      life: 8,
      color: w.def.color
    });
  }

  function updateBullets(dt) {
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      if (b.homing && b.owner === 'player') {
        const t = nearestEnemy(b.x, b.y, 500);
        if (t) {
          const ang = Math.atan2(t.y - b.y, t.x - b.x);
          const spd = Math.hypot(b.vx, b.vy) || 300;
          b.vx = Math.cos(ang) * spd;
          b.vy = Math.sin(ang) * spd;
        }
      }
      if (b.bounce) {
        const toP = Math.atan2(G.player.y - b.y, G.player.x - b.x);
        b.vx += Math.cos(toP) * 400 * dt;
        b.vy += Math.sin(toP) * 400 * dt;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.ang = Math.atan2(b.vy, b.vx);
      b.life -= dt;
      if (b.owner === 'player') {
        b.trail = b.trail || [];
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 6) b.trail.shift();
      }
      if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > ARENA_W || b.y > ARENA_H) {
        G.bullets.splice(i, 1);
        continue;
      }
      if (b.owner === 'enemy') continue;
      for (let j = 0; j < G.enemies.length; j++) {
        const e = G.enemies[j];
        if (b.hit.has(e)) continue;
        if (dist(b.x, b.y, e.x, e.y) < b.r + e.r) {
          b.hit.add(e);
          damageEnemy(e, b.dmg);
          if (b.radius) explode(b.x, b.y, b.radius, b.dmg * 0.6, b.color);
          if (b.chain > 0) {
            const n = nearestEnemy(e.x, e.y, 180, e);
            if (n) {
              G.bullets.push({
                x: e.x,
                y: e.y,
                vx: (n.x - e.x) * 3,
                vy: (n.y - e.y) * 3,
                dmg: b.dmg * 0.7,
                r: b.r,
                life: 0.5,
                color: b.color,
                pierce: 0,
                radius: 0,
                homing: false,
                bounce: false,
                chain: b.chain - 1,
                owner: 'player',
                hit: new Set([e])
              });
            }
          }
          if (b.pierce > 0) b.pierce--;
          else if (!b.bounce) {
            G.bullets.splice(i, 1);
            break;
          }
        }
      }
    }
  }

  function updateEnemies(dt) {
    const p = G.player;
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      e.t = (e.t || 0) + dt;
      e.atkCd = (e.atkCd || 0) - dt;
      if (e.boss) updateBossAI(e, dt);
      else {
        const ang = Math.atan2(p.y - e.y, p.x - e.x);
        let nx = e.x + Math.cos(ang) * e.speed * dt;
        let ny = e.y + Math.sin(ang) * e.speed * dt;
        if (!hitObstacle(nx, ny, e.r * 0.6)) {
          e.x = nx;
          e.y = ny;
        } else {
          if (!hitObstacle(nx, e.y, e.r * 0.6)) e.x = nx;
          if (!hitObstacle(e.x, ny, e.r * 0.6)) e.y = ny;
        }
      }
      if (e.hp <= 0) {
        onEnemyDeath(e);
        G.enemies.splice(i, 1);
      }
    }
  }

  function updateBossAI(e, dt) {
    const p = G.player;
    const ang = Math.atan2(p.y - e.y, p.x - e.x);
    e.pulse = (e.pulse || 0) + dt;
    const rage = 1 + (1 - Math.max(0, e.hp / e.maxHp)) * 0.85; // más agresivo al perder vida
    if (e.atk === 'charge' && e.atkCd <= 0) {
      e.phase = 0.75;
      e.vx = Math.cos(ang) * (340 + rage * 80);
      e.vy = Math.sin(ang) * (340 + rage * 80);
      e.atkCd = Math.max(1.6, 3.0 / rage);
      addFieldRing(e.x, e.y, e.color, e.r * 2.5, 0.55);
    }
    if (e.phase > 0) {
      e.phase -= dt;
      e.x += (e.vx || 0) * dt;
      e.y += (e.vy || 0) * dt;
    } else {
      e.x += Math.cos(ang) * e.speed * rage * dt;
      e.y += Math.sin(ang) * e.speed * rage * dt;
    }
    e.x = clamp(e.x, WALL + e.r, ARENA_W - WALL - e.r);
    e.y = clamp(e.y, WALL + e.r, ARENA_H - WALL - e.r);

    if (e.atkCd <= 0) {
      if (e.atk === 'burst' || e.atk === 'final') {
        const n = e.final ? 20 : 12;
        for (let i = 0; i < n; i++) enemyShot(e, (Math.PI * 2 * i) / n + e.t, 200 + rage * 60);
        if (e.final) {
          for (let i = 0; i < 8; i++) enemyShot(e, (Math.PI * 2 * i) / 8 + e.t * 0.5, 140);
        }
        e.atkCd = (e.final ? 1.7 : 2.3) / rage;
        addFieldRing(e.x, e.y, e.color, e.r * 3, 0.7);
      } else if (e.atk === 'spiral') {
        for (let i = 0; i < 4; i++) enemyShot(e, e.t * 3.4 + i * 1.7, 240 + rage * 40);
        e.atkCd = 0.28 / rage;
      } else if (e.atk === 'ring') {
        for (let i = 0; i < 16; i++) enemyShot(e, (i * Math.PI) / 8, 170 + rage * 50);
        e.atkCd = 2.8 / rage;
        addFieldRing(e.x, e.y, e.color, e.r * 4, 0.85);
      } else if (e.atk === 'charge') {
        e.atkCd = 2.2 / rage;
      }
    }
  }

  function enemyShot(e, ang, spd) {
    G.bullets.push({
      x: e.x,
      y: e.y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      dmg: e.dmg * 0.55,
      r: 5,
      life: 3.5,
      color: e.color,
      pierce: 0,
      radius: 0,
      homing: false,
      bounce: false,
      chain: 0,
      owner: 'enemy',
      hit: new Set()
    });
  }

  function collidePlayer() {
    if (G.invuln > 0) return;
    const p = G.player;
    for (const e of G.enemies) {
      if (dist(p.x, p.y, e.x, e.y) < p.r + e.r * 0.85) {
        p.hp -= e.dmg;
        G.invuln = 0.7;
        burst(p.x, p.y, '#fecaca', 8);
        break;
      }
    }
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      if (b.owner !== 'enemy') continue;
      if (dist(p.x, p.y, b.x, b.y) < p.r + b.r) {
        p.hp -= b.dmg;
        G.invuln = 0.55;
        G.bullets.splice(i, 1);
        burst(p.x, p.y, '#fecaca', 6);
      }
    }
  }

  function updatePickups(dt) {
    for (let i = G.pickups.length - 1; i >= 0; i--) {
      const p = G.pickups[i];
      p.life = (p.life == null ? 20 : p.life) - dt;
      if (p.life <= 0) {
        G.pickups.splice(i, 1);
        continue;
      }
      if (p.kind === 'mine') {
        for (const e of G.enemies) {
          if (dist(p.x, p.y, e.x, e.y) < p.r + e.r) {
            explode(p.x, p.y, p.radius, p.dmg, p.color);
            G.pickups.splice(i, 1);
            break;
          }
        }
        continue;
      }
      if (dist(G.player.x, G.player.y, p.x, p.y) < G.player.r + 16) {
        if (p.kind === 'xp') addXp(p.value || 5);
        else if (p.kind === 'heal') {
          G.player.hp = Math.min(G.player.maxHp, G.player.hp + 20);
          gameToast('+20 HP');
        } else if (p.kind === 'weapon') offerWeapon(p.weaponId);
        G.pickups.splice(i, 1);
      }
    }
  }

  function updateParticles(dt) {
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.life -= dt;
      if (p.vx) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      if (p.life <= 0) G.particles.splice(i, 1);
    }
  }

  function damageEnemy(e, dmg) {
    e.hp -= dmg;
    burst(e.x, e.y, e.color, 2);
  }

  function onEnemyDeath(e) {
    G.kills++;
    G.score += e.score || 10;
    addXp(e.boss ? 40 : e.elite ? 12 : 4);
    burst(e.x, e.y, e.color, e.boss ? 30 : 8);
    if (Math.random() < (e.boss ? 1 : 0.55)) {
      G.pickups.push({
        kind: 'xp',
        x: e.x,
        y: e.y,
        r: 8,
        value: e.boss ? 25 : 5,
        life: 12,
        color: '#a78bfa'
      });
    }
    if (Math.random() < 0.04) {
      G.pickups.push({ kind: 'heal', x: e.x + 10, y: e.y, r: 8, life: 10, color: '#4ade80' });
    }
    if (e.boss) {
      G.bossActive = false;
      G.bossesDefeated++;
      if (G.nextBossIdx < BOSS_AT.length) G.nextBossIdx++;
      G.score += 500 * G.bossesDefeated;
      G.player.maxHp += 8;
      G.player.hp = Math.min(G.player.maxHp, G.player.hp + 40);
      banner(e.final ? '¡DARK CORE DERROTADO!' : 'Boss derrotado');
      gameToast('La arena se vuelve más hostil…');
      spawnWeaponPickup(e.x, e.y);
      spawnWeaponPickup(e.x + 40, e.y);
      triggerFieldEvent(e.final ? 'darkCoreDown' : 'bossDown', e);
    }
  }

  function explode(x, y, radius, dmg, color) {
    burst(x, y, color || '#fbbf24', 14);
    for (const e of G.enemies) {
      if (dist(x, y, e.x, e.y) < radius + e.r) damageEnemy(e, dmg);
    }
  }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 120;
      G.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.25 + Math.random() * 0.35,
        max: 0.5,
        color,
        r: 2 + Math.random() * 3
      });
    }
  }

  // ── Field FX (arena reactions) ──
  function ensureFx() {
    if (!G.fx) G.fx = freshFx();
    return G.fx;
  }
  function addFieldRing(x, y, color, maxR, life) {
    const fx = ensureFx();
    fx.rings.push({
      x, y,
      r: 8,
      maxR: maxR || 180,
      life: life || 0.7,
      max: life || 0.7,
      color: color || '#38bdf8',
      width: 3 + Math.random() * 3
    });
  }
  function spawnStorm(x, y, r, life, color, dmg) {
    ensureFx().storms.push({
      x: x ?? rnd(WALL + 80, ARENA_W - WALL - 80),
      y: y ?? rnd(WALL + 80, ARENA_H - WALL - 80),
      r: r || 70,
      life: life || 8,
      max: life || 8,
      color: color || '56,189,248',
      dmg: dmg || 8,
      tick: 0
    });
  }
  function triggerFieldEvent(kind, payload) {
    const fx = ensureFx();
    if (kind === 'bossWarn') {
      fx.surge = Math.max(fx.surge, 1.2);
      fx.tint = Math.max(fx.tint, 0.55);
      fx.tintRgb = '239,68,68';
      fx.gridMode = 2;
      fx.shake = Math.max(fx.shake, 0.45);
      addFieldRing(ARENA_W / 2, ARENA_H / 2, '#f87171', 520, 1.4);
      gameToast('⚠ Interferencia detectada…');
    } else if (kind === 'bossSpawn') {
      const col = (payload && payload.color) || '#f87171';
      fx.flash = 0.55;
      fx.flashColor = col;
      fx.shake = 1.4;
      fx.tint = 0.85;
      fx.tintRgb = '239,68,68';
      fx.surge = 1.8;
      fx.gridMode = 2;
      addFieldRing(ARENA_W / 2, WALL + 90, col, 700, 1.6);
      addFieldRing(ARENA_W / 2, WALL + 90, '#fecaca', 420, 1.1);
      for (let i = 0; i < 3; i++) spawnStorm(null, null, 55 + Math.random() * 40, 10, '248,113,113', 10);
      burst(ARENA_W / 2, WALL + 90, col, 40);
    } else if (kind === 'darkCore') {
      fx.flash = 0.9;
      fx.flashColor = '#7f1d1d';
      fx.shake = 2.2;
      fx.tint = 1.2;
      fx.tintRgb = '127,29,29';
      fx.surge = 2.5;
      fx.gridMode = 4;
      addFieldRing(ARENA_W / 2, ARENA_H / 2, '#ef4444', 900, 2.2);
      for (let i = 0; i < 5; i++) spawnStorm(null, null, 70 + Math.random() * 50, 14, '239,68,68', 14);
    } else if (kind === 'bossDown') {
      fx.flash = 0.4;
      fx.flashColor = '#67e8f9';
      fx.shake = 0.8;
      fx.tint = 0.5;
      fx.tintRgb = '34,211,238';
      fx.surge = 1.1;
      fx.gridMode = 1;
      fx.storms = [];
      const x = (payload && payload.x) || ARENA_W / 2;
      const y = (payload && payload.y) || ARENA_H / 2;
      addFieldRing(x, y, '#67e8f9', 600, 1.3);
      addFieldRing(x, y, '#a78bfa', 420, 1.0);
    } else if (kind === 'darkCoreDown') {
      fx.flash = 0.7;
      fx.flashColor = '#fbbf24';
      fx.shake = 1.6;
      fx.tint = 0.7;
      fx.tintRgb = '250,204,21';
      fx.surge = 1.6;
      fx.gridMode = 3;
      fx.storms = [];
      addFieldRing(ARENA_W / 2, ARENA_H / 2, '#fbbf24', 900, 2);
    } else if (kind === 'voltageSurge') {
      fx.surge = Math.max(fx.surge, 1.6);
      fx.flash = Math.max(fx.flash, 0.25);
      fx.flashColor = '#38bdf8';
      fx.tint = Math.max(fx.tint, 0.4);
      fx.tintRgb = '56,189,248';
      fx.gridMode = 1;
      fx.shake = Math.max(fx.shake, 0.55);
      addFieldRing(G.player.x, G.player.y, '#38bdf8', 380, 0.9);
      for (let i = 0; i < 2; i++) spawnStorm(null, null, 60, 7, '56,189,248', 7);
      gameToast('⚡ Sobretensión en el protoboard');
    } else if (kind === 'overclock') {
      fx.surge = Math.max(fx.surge, 2);
      fx.gridMode = 3;
      fx.tint = Math.max(fx.tint, 0.55);
      fx.tintRgb = '167,139,250';
      fx.flash = Math.max(fx.flash, 0.3);
      fx.flashColor = '#a78bfa';
      fx.shake = Math.max(fx.shake, 0.7);
      for (let i = 0; i < 4; i++) spawnStorm(null, null, 50 + Math.random() * 35, 9, '167,139,250', 9);
      gameToast('🔥 Overclock del campo');
    }
  }

  function updateFieldFx(dt) {
    const fx = ensureFx();
    fx.shake = Math.max(0, fx.shake - dt * 1.8);
    fx.flash = Math.max(0, fx.flash - dt * 1.4);
    fx.tint = Math.max(0, fx.tint - dt * 0.35);
    fx.surge = Math.max(0, fx.surge - dt * 0.28);
    if (!G.bossActive && fx.gridMode === 2 && fx.tint < 0.15) fx.gridMode = fx.surge > 0.4 ? 1 : 0;
    if (!G.bossActive && fx.gridMode === 4 && fx.tint < 0.2) fx.gridMode = 0;

    // Vignette por vida baja
    const hpRatio = G.player ? G.player.hp / G.player.maxHp : 1;
    fx.vignette = hpRatio < 0.32 ? (0.32 - hpRatio) / 0.32 : 0;

    // Hitos de oleada
    if (G.wave >= 5 && G.wave % 5 === 0 && fx.lastWaveFx !== G.wave) {
      fx.lastWaveFx = G.wave;
      triggerFieldEvent(G.wave % 10 === 0 ? 'overclock' : 'voltageSurge');
    }
    // Hitos de minuto (5, 10, 15…)
    const minute = Math.floor(G.time / 300); // cada 5 min
    if (minute > 0 && minute !== fx.lastMinuteMark) {
      fx.lastMinuteMark = minute;
      triggerFieldEvent(minute % 2 === 0 ? 'overclock' : 'voltageSurge');
    }

    // Sparks during surge
    if (fx.surge > 0.3 && Math.random() < dt * fx.surge * 8) {
      fx.sparks.push({
        x: rnd(WALL, ARENA_W - WALL),
        y: rnd(WALL, ARENA_H - WALL),
        life: 0.15 + Math.random() * 0.25,
        max: 0.4,
        len: 10 + Math.random() * 28,
        ang: Math.random() * Math.PI * 2,
        color: fx.gridMode === 2 || fx.gridMode === 4 ? '#f87171' : fx.gridMode === 3 ? '#c4b5fd' : '#67e8f9'
      });
    }
    for (let i = fx.sparks.length - 1; i >= 0; i--) {
      fx.sparks[i].life -= dt;
      if (fx.sparks[i].life <= 0) fx.sparks.splice(i, 1);
    }
    for (let i = fx.rings.length - 1; i >= 0; i--) {
      const r = fx.rings[i];
      r.life -= dt;
      const t = 1 - r.life / r.max;
      r.r = r.maxR * t;
      if (r.life <= 0) fx.rings.splice(i, 1);
    }
    for (let i = fx.storms.length - 1; i >= 0; i--) {
      const s = fx.storms[i];
      s.life -= dt;
      s.tick = (s.tick || 0) + dt;
      if (s.tick >= 0.55) {
        s.tick = 0;
        if (G.player && dist(G.player.x, G.player.y, s.x, s.y) < s.r + G.player.r) {
          if (G.invuln <= 0) {
            G.player.hp -= s.dmg;
            G.invuln = 0.35;
            burst(G.player.x, G.player.y, '#7dd3fc', 5);
          }
        }
      }
      if (s.life <= 0) fx.storms.splice(i, 1);
    }
  }

  function drawFieldFxUnder(ctx) {
    const fx = ensureFx();
    // Storm zones on floor
    for (const s of fx.storms) {
      const a = 0.12 + 0.1 * Math.sin(G.time * 6 + s.x);
      const g = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, s.r);
      g.addColorStop(0, `rgba(${s.color},${0.35 + a})`);
      g.addColorStop(0.55, `rgba(${s.color},.14)`);
      g.addColorStop(1, `rgba(${s.color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${s.color},${0.35 + a})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (0.85 + 0.08 * Math.sin(G.time * 5)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Expanding rings
    for (const r of fx.rings) {
      ctx.globalAlpha = Math.max(0, r.life / r.max) * 0.85;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width || 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(1, r.r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Electric sparks
    for (const sp of fx.sparks) {
      ctx.globalAlpha = Math.max(0, sp.life / sp.max);
      ctx.strokeStyle = sp.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sp.x + Math.cos(sp.ang) * sp.len, sp.y + Math.sin(sp.ang) * sp.len);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawFieldFxOver(ctx, vw, vh) {
    const fx = ensureFx();
    // Screen flash (screen space)
    if (fx.flash > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(0.55, fx.flash);
      ctx.fillStyle = fx.flashColor || '#ef4444';
      ctx.fillRect(0, 0, vw, vh);
      ctx.restore();
    }
    // Tint + vignette
    if (fx.tint > 0.02 || fx.vignette > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (fx.tint > 0.02) {
        ctx.globalAlpha = Math.min(0.35, fx.tint * 0.28);
        ctx.fillStyle = `rgb(${fx.tintRgb})`;
        ctx.fillRect(0, 0, vw, vh);
      }
      if (fx.vignette > 0) {
        const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.25, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(127,29,29,${0.15 + fx.vignette * 0.55})`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, vw, vh);
      }
      ctx.restore();
    }
  }

  function arenaGridColors() {
    const fx = ensureFx();
    const mode = fx.gridMode || 0;
    if (mode === 2) return { floor: '#1a0f14', grid: 'rgba(248,113,113,.16)', dots: 'rgba(252,165,165,.3)', wall: '#2a1520', border: 'rgba(248,113,113,.65)' };
    if (mode === 3) return { floor: '#16122a', grid: 'rgba(167,139,250,.18)', dots: 'rgba(196,181,253,.32)', wall: '#1e1638', border: 'rgba(167,139,250,.7)' };
    if (mode === 4) return { floor: '#0a0608', grid: 'rgba(239,68,68,.22)', dots: 'rgba(127,29,29,.45)', wall: '#1a0808', border: 'rgba(239,68,68,.85)' };
    if (mode === 1 || fx.surge > 0.4) return { floor: '#0e1f2a', grid: 'rgba(56,189,248,.16)', dots: 'rgba(125,211,252,.32)', wall: '#123044', border: 'rgba(56,189,248,.65)' };
    return { floor: '#12261f', grid: 'rgba(52, 211, 153, .10)', dots: 'rgba(148, 163, 184, .28)', wall: '#1a2744', border: 'rgba(56, 189, 248, .45)' };
  }

  function xpToLevel(lv) {
    return Math.floor(12 + lv * 7);
  }
  function addXp(n) {
    G.xp += n;
    let need = xpToLevel(G.level);
    while (G.xp >= need) {
      G.xp -= need;
      G.level++;
      need = xpToLevel(G.level);
      levelUp();
    }
  }

  function levelUp() {
    G.paused = true;
    G.overlay = 'level';
    const choices = buildLevelChoices();
    const card = $('overlayCard');
    card.innerHTML = `
      <h3>Nivel ${G.level}</h3>
      <p>Elige una mejora. Las armas siguen siendo automáticas.</p>
      <div class="led-choices">
        ${choices
          .map(
            (c, i) => `
          <button type="button" class="led-choice" data-i="${i}">
            <b>${c.icon || '✦'} ${c.title}</b>
            <span>${c.desc}</span>
          </button>`
          )
          .join('')}
      </div>`;
    showOverlay();
    card.querySelectorAll('.led-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        choices[+btn.dataset.i].apply();
        closeOverlay();
      });
    });
  }

  function buildLevelChoices() {
    const opts = [];
    G.weapons.forEach((w) => {
      if (w.level < 8) {
        opts.push({
          icon: w.icon,
          title: `Mejorar ${w.name}`,
          desc: `Nivel ${w.level} → ${w.level + 1}`,
          apply: () => upgradeWeapon(w.id)
        });
      }
    });
    if (G.weapons.length < 4) {
      const owned = new Set(G.weapons.map((w) => w.id));
      shuffle(WEAPONS.filter((w) => !owned.has(w.id)))
        .slice(0, 3)
        .forEach((w) => {
          opts.push({
            icon: w.icon,
            title: w.name,
            desc: w.desc + ' (nueva)',
            apply: () => addWeapon(w, 1)
          });
        });
    }
    opts.push({
      icon: '❤️',
      title: '+25 Vida máxima',
      desc: 'Tanquea más hits de la horda',
      apply: () => {
        G.player.maxHp += 25;
        G.player.hp += 25;
      }
    });
    opts.push({
      icon: '👟',
      title: '+12% Velocidad',
      desc: 'Maniobrar es sobrevivir',
      apply: () => {
        G.player.speed *= 1.12;
      }
    });
    opts.push({
      icon: '✨',
      title: 'Curación +35',
      desc: 'Recupera vida ahora',
      apply: () => {
        G.player.hp = Math.min(G.player.maxHp, G.player.hp + 35);
      }
    });
    return shuffle(opts).slice(0, 3);
  }

  function offerWeapon(weaponId) {
    const def = WEAPONS.find((w) => w.id === weaponId) || WEAPONS[Math.floor(Math.random() * WEAPONS.length)];
    const owned = G.weapons.find((w) => w.id === def.id);
    if (owned) {
      upgradeWeapon(def.id);
      gameToast(`${def.icon} ${def.name} mejorada`);
      return;
    }
    if (G.weapons.length < 4) {
      addWeapon(def, 1);
      gameToast(`${def.icon} ${def.name} equipada`);
      return;
    }
    G.paused = true;
    G.overlay = 'weapon';
    const card = $('overlayCard');
    card.innerHTML = `
      <h3>${def.icon} ${def.name}</h3>
      <p>${def.desc}. Ya llevas 4 armas. ¿Reemplazar una?</p>
      <div class="led-choices">
        ${G.weapons
          .map(
            (w, i) => `
          <button type="button" class="led-choice" data-i="${i}">
            <b>Reemplazar ${w.icon} ${w.name}</b><span>Nv.${w.level}</span>
          </button>`
          )
          .join('')}
        <button type="button" class="led-choice" data-i="-1"><b>Dejarla</b><span>Seguir con tu loadout</span></button>
      </div>`;
    showOverlay();
    card.querySelectorAll('.led-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.i;
        if (i >= 0) {
          G.weapons.splice(i, 1);
          addWeapon(def, 1);
        }
        closeOverlay();
      });
    });
  }

  function spawnWeaponPickup(x, y) {
    const owned = new Set(G.weapons.map((w) => w.id));
    let pool = WEAPONS.filter((w) => !owned.has(w.id));
    if (!pool.length) pool = WEAPONS.slice();
    const def = pool[Math.floor(Math.random() * pool.length)];
    G.pickups.push({
      kind: 'weapon',
      x: x != null ? x : rnd(WALL + 80, ARENA_W - WALL - 80),
      y: y != null ? y : rnd(WALL + 80, ARENA_H - WALL - 80),
      r: 14,
      weaponId: def.id,
      icon: def.icon,
      color: def.color,
      life: 25
    });
  }

  // ── render ──
  function render() {
    const c = $('gameCanvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const vw = c.clientWidth;
    const vh = c.clientHeight;
    ctx.clearRect(0, 0, vw, vh);
    ctx.save();
    ctx.translate(-G.cam.x, -G.cam.y);

    const pal = arenaGridColors();
    ctx.fillStyle = '#0c1426';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    // piso tipo protoboard
    ctx.fillStyle = pal.floor;
    ctx.fillRect(WALL, WALL, ARENA_W - WALL * 2, ARENA_H - WALL * 2);
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    const gridPulse = ensureFx().surge > 0 ? 1 + Math.sin(G.time * 10) * 0.04 : 1;
    for (let x = WALL; x <= ARENA_W - WALL; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, WALL);
      ctx.lineTo(x, ARENA_H - WALL);
      ctx.stroke();
    }
    for (let y = WALL; y <= ARENA_H - WALL; y += 28) {
      ctx.beginPath();
      ctx.moveTo(WALL, y);
      ctx.lineTo(ARENA_W - WALL, y);
      ctx.stroke();
    }
    // puntos de protoboard
    ctx.fillStyle = pal.dots;
    for (let x = WALL + 14; x < ARENA_W - WALL; x += 28) {
      for (let y = WALL + 14; y < ARENA_H - WALL; y += 28) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6 * gridPulse, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = pal.wall;
    ctx.fillRect(0, 0, ARENA_W, WALL);
    ctx.fillRect(0, ARENA_H - WALL, ARENA_W, WALL);
    ctx.fillRect(0, 0, WALL, ARENA_H);
    ctx.fillRect(ARENA_W - WALL, 0, WALL, ARENA_H);
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = 3 + (ensureFx().surge > 0.5 ? Math.sin(G.time * 8) * 1.5 : 0);
    ctx.strokeRect(WALL, WALL, ARENA_W - WALL * 2, ARENA_H - WALL * 2);

    drawFieldFxUnder(ctx);

    for (const o of G.obstacles) {
      const ox = o.x - o.w / 2;
      const oy = o.y - o.h / 2;
      if (o.kind === 'crate') {
        // caja de componentes
        ctx.fillStyle = '#334155';
        roundRect(ctx, ox, oy, o.w, o.h, 6);
        ctx.fill();
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(ox + 6, oy + 6, o.w - 12, 5);
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PICO', o.x, o.y + 4);
      } else if (o.kind === 'pillar') {
        // capacitor grande
        ctx.fillStyle = '#1e3a5f';
        roundRect(ctx, ox + 4, oy, o.w - 8, o.h, 5);
        ctx.fill();
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(ox + 4, oy, o.w - 8, 6);
        ctx.strokeStyle = 'rgba(125,211,252,.35)';
        ctx.stroke();
      } else {
        // IC / chip
        ctx.fillStyle = '#0f172a';
        roundRect(ctx, ox, oy, o.w, o.h, 4);
        ctx.fill();
        ctx.fillStyle = '#64748b';
        for (let i = 0; i < 4; i++) {
          const yy = oy + 6 + i * ((o.h - 12) / 3);
          ctx.fillRect(ox - 4, yy, 4, 3);
          ctx.fillRect(ox + o.w, yy, 4, 3);
        }
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(o.x - 6, o.y - 4, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.stroke();
    }

    for (const p of G.pickups) {
      if (p.kind === 'weapon') {
        ctx.fillStyle = p.color || '#38bdf8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12 + Math.sin(G.time * 4) * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.icon || '?', p.x, p.y + 1);
      } else if (p.kind === 'mine') {
        ctx.fillStyle = p.color || '#f87171';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color || '#a78bfa';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const b of G.bullets) drawBullet(ctx, b);
    for (const e of G.enemies) drawEnemy(ctx, e);
    if (G.invuln <= 0 || Math.floor(G.time * 20) % 2 === 0) {
      drawPlayerWeapons(ctx, G.player, G.weapons, G.time);
      drawLed(ctx, G.player.x, G.player.y, 1.15, G.player.look, G.player.facing, G.time);
    }
    for (const p of G.particles) {
      ctx.globalAlpha = Math.max(0, p.life / (p.max || 0.4));
      ctx.strokeStyle = p.color;
      ctx.fillStyle = p.color;
      if (p.ring) {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 - p.life / p.max), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r || 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    drawFieldFxOver(ctx, vw, vh);
  }

  function drawPlayerWeapons(ctx, player, weapons, t) {
    if (!weapons || !weapons.length) return;
    const n = weapons.length;
    weapons.forEach((w, i) => {
      const ang = t * 1.6 + (i / n) * Math.PI * 2;
      const orbit = 26 + n * 2;
      const x = player.x + Math.cos(ang) * orbit;
      const y = player.y + Math.sin(ang) * orbit * 0.72;
      const col = (w.def && w.def.color) || '#7dd3fc';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + Math.PI / 2);
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      // cañón / arma tipo componente
      ctx.fillStyle = '#1e293b';
      roundRect(ctx, -4, -10, 8, 16, 2);
      ctx.fill();
      ctx.fillStyle = col;
      roundRect(ctx, -3, -14, 6, 8, 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-1.5, -16, 3, 5);
      // LED tip glow
      ctx.beginPath();
      ctx.arc(0, -17, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    });
  }

  function drawBullet(ctx, b) {
    // trail
    if (b.trail && b.trail.length > 1 && b.owner === 'player') {
      ctx.strokeStyle = b.color || '#fff';
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1.5, (b.r || 3) * 0.8);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.trail[0].x, b.trail[0].y);
      for (let i = 1; i < b.trail.length; i++) ctx.lineTo(b.trail[i].x, b.trail[i].y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.ang || 0);
    const col = b.color || '#fff';
    if (b.owner === 'enemy') {
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    if (b.style === 'beam') {
      ctx.fillStyle = col;
      ctx.fillRect(-10, -1.5, 18, 3);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-6, -0.7, 10, 1.4);
    } else if (b.style === 'rocket') {
      ctx.fillStyle = col;
      roundRect(ctx, -8, -3, 14, 6, 2);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(-8, -3);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-8, 3);
      ctx.fill();
    } else if (b.style === 'orb') {
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, b.r + 2);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.45, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, b.r + 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.style === 'shard') {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-4, -4);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
    } else if (b.style === 'boomer') {
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 6, -0.8, Math.PI + 0.8);
      ctx.stroke();
    } else {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(2, 0, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemy(ctx, e) {
    if (e.boss) {
      const pulse = 1 + Math.sin((e.pulse || e.t || 0) * 5) * 0.08;
      const auraR = e.r * (2.4 + Math.sin(G.time * 3) * 0.25);
      const g2 = ctx.createRadialGradient(e.x, e.y, 4, e.x, e.y, auraR);
      g2.addColorStop(0, 'rgba(255,255,255,.14)');
      g2.addColorStop(0.25, e.final ? 'rgba(239,68,68,.42)' : 'rgba(251,113,133,.3)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, auraR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = e.final ? 'rgba(252,165,165,.8)' : 'rgba(254,202,202,.58)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * 1.85 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * 2.35 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.boss) {
      const pulse = 1 + Math.sin((e.pulse || e.t || 0) * 4.5) * 0.06;
      ctx.scale(pulse, pulse);
      drawBossComponent(ctx, e);
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = e.final ? '#fecaca' : '#fff7ed';
      ctx.font = `bold ${Math.max(11, e.r * 0.32)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(e.final ? '☠ BOSS FINAL' : '⚠ BOSS', 0, -e.r - 34);
      ctx.shadowBlur = 0;
      const bw = e.r * 2.6;
      ctx.fillStyle = '#450a0a';
      ctx.fillRect(-bw / 2, -e.r - 22, bw, 9);
      const hpPct = Math.max(0, e.hp / e.maxHp);
      const hg = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      hg.addColorStop(0, '#ef4444');
      hg.addColorStop(0.5, '#fbbf24');
      hg.addColorStop(1, '#f87171');
      ctx.fillStyle = hg;
      ctx.fillRect(-bw / 2, -e.r - 22, bw * hpPct, 9);
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-bw / 2, -e.r - 22, bw, 9);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(10, e.r * 0.26)}px sans-serif`;
      ctx.fillText(e.name, 0, -e.r - 28);
    } else {
      const kind = e.name === 'Bug' ? 'chip' : e.name === 'Glitch' ? 'cap' : e.name === 'Spam' ? 'led' : e.name === 'Leak' ? 'res' : 'diode';
      drawMiniPart(ctx, e, kind);
      if (e.elite) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, e.r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawMiniPart(ctx, e, kind) {
    const r = e.r;
    ctx.fillStyle = e.color;
    if (kind === 'res') {
      ctx.fillStyle = '#f59e0b';
      roundRect(ctx, -r, -r * 0.45, r * 2, r * 0.9, 3);
      ctx.fill();
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.45);
      ctx.lineTo(-r * 0.4, r * 0.45);
      ctx.moveTo(r * 0.15, -r * 0.45);
      ctx.lineTo(r * 0.15, r * 0.45);
      ctx.stroke();
      ctx.strokeStyle = '#94a3b8';
      ctx.beginPath();
      ctx.moveTo(-r - 4, 0);
      ctx.lineTo(-r, 0);
      ctx.moveTo(r, 0);
      ctx.lineTo(r + 4, 0);
      ctx.stroke();
    } else if (kind === 'cap') {
      ctx.fillStyle = e.color;
      roundRect(ctx, -r * 0.7, -r, r * 1.4, r * 1.7, 3);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-r * 0.7, -r, r * 1.4, 4);
      ctx.strokeStyle = '#94a3b8';
      ctx.beginPath();
      ctx.moveTo(-3, r * 0.7);
      ctx.lineTo(-3, r + 4);
      ctx.moveTo(3, r * 0.7);
      ctx.lineTo(3, r + 4);
      ctx.stroke();
    } else if (kind === 'led') {
      const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, r);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.4, e.color);
      g.addColorStop(1, shade(e.color, -50));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -2, r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(-3, r * 0.4, 2, 6);
      ctx.fillRect(1, r * 0.4, 2, 8);
    } else if (kind === 'diode') {
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.7);
      ctx.lineTo(r * 0.5, 0);
      ctx.lineTo(-r, r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(r * 0.45, -r * 0.7, 3, r * 1.4);
      ctx.strokeStyle = '#94a3b8';
      ctx.beginPath();
      ctx.moveTo(-r - 4, 0);
      ctx.lineTo(-r, 0);
      ctx.moveTo(r * 0.45 + 3, 0);
      ctx.lineTo(r + 4, 0);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#334155';
      roundRect(ctx, -r, -r * 0.7, r * 2, r * 1.4, 3);
      ctx.fill();
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-r * 0.35, -r * 0.15, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r * 0.35, -r * 0.15, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBossComponent(ctx, e) {
    const r = e.r;
    const kind = e.kind || 'ic';
    const glow = 18 + Math.sin((e.pulse || e.t || 0) * 6) * 10;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = glow;
    // halo exterior
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (kind === 'resistor') {
      ctx.fillStyle = '#f59e0b';
      roundRect(ctx, -r * 1.2, -r * 0.45, r * 2.4, r * 0.9, 8);
      ctx.fill();
      const bands = ['#ef4444', '#000', '#fbbf24', '#a16207'];
      bands.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(-r * 0.8 + i * r * 0.4, -r * 0.45, r * 0.18, r * 0.9);
      });
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-r * 1.2 - 14, 0);
      ctx.lineTo(-r * 1.2, 0);
      ctx.moveTo(r * 1.2, 0);
      ctx.lineTo(r * 1.2 + 14, 0);
      ctx.stroke();
      // ojos malvados
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath(); ctx.arc(-r * 0.25, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.35, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fecaca';
      ctx.beginPath(); ctx.arc(-r * 0.25, 0, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.35, 0, 2, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'capacitor') {
      ctx.fillStyle = e.color;
      roundRect(ctx, -r * 0.75, -r, r * 1.5, r * 1.85, 6);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-r * 0.75, -r, r * 1.5, 8);
      ctx.fillStyle = '#0f172a';
      ctx.font = `bold ${Math.max(10, r * 0.35)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('1000µF', 0, 8);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-8, r * 0.85); ctx.lineTo(-8, r + 12);
      ctx.moveTo(8, r * 0.85); ctx.lineTo(8, r + 16);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(-10, -r * 0.35, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(10, -r * 0.35, 5, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'diode') {
      ctx.fillStyle = '#111827';
      roundRect(ctx, -r, -r * 0.55, r * 1.5, r * 1.1, 6);
      ctx.fill();
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, -r * 0.45);
      ctx.lineTo(r * 0.55, 0);
      ctx.lineTo(-r * 0.2, r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(r * 0.55, -r * 0.45, 5, r * 0.9);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(r * 0.4, -r * 0.55, 6, r * 1.1);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-r - 12, 0); ctx.lineTo(-r, 0);
      ctx.moveTo(r * 0.55 + 5, 0); ctx.lineTo(r + 10, 0);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(-r * 0.45, -8, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-r * 0.45, 8, 4, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'transistor') {
      ctx.fillStyle = '#0f172a';
      roundRect(ctx, -r * 0.7, -r * 0.7, r * 1.4, r * 1.4, 8);
      ctx.fill();
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-6, r * 0.7); ctx.lineTo(-6, r + 12);
      ctx.moveTo(0, r * 0.7); ctx.lineTo(0, r + 16);
      ctx.moveTo(6, r * 0.7); ctx.lineTo(6, r + 12);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(-10, -8, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(10, -8, 4, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'inductor') {
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        ctx.arc(-r * 0.8 + i * r * 0.4, 0, r * 0.22, Math.PI, 0);
      }
      ctx.stroke();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-r - 10, 0); ctx.lineTo(-r * 0.8, 0);
      ctx.moveTo(r * 0.8, 0); ctx.lineTo(r + 10, 0);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.5, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.5, 4, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'crystal') {
      ctx.fillStyle = e.color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.55, -r * 0.2);
      ctx.lineTo(r * 0.35, r);
      ctx.lineTo(-r * 0.35, r);
      ctx.lineTo(-r * 0.55, -r * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.7);
      ctx.lineTo(r * 0.2, -r * 0.1);
      ctx.lineTo(0, r * 0.3);
      ctx.lineTo(-r * 0.15, -r * 0.1);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath(); ctx.arc(-8, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(8, 0, 4, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'relay') {
      ctx.fillStyle = '#1e293b';
      roundRect(ctx, -r, -r * 0.7, r * 2, r * 1.4, 6);
      ctx.fill();
      ctx.fillStyle = e.color;
      roundRect(ctx, -r * 0.7, -r * 0.4, r * 1.4, r * 0.8, 4);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(i * 10 - 2, r * 0.7, 4, 10);
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(-12, -r * 0.15, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(12, -r * 0.15, 4, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'ic' || kind === 'mosfet') {
      ctx.fillStyle = '#0f172a';
      roundRect(ctx, -r, -r * 0.7, r * 2, r * 1.4, 5);
      ctx.fill();
      ctx.fillStyle = '#1e293b';
      roundRect(ctx, -r * 0.75, -r * 0.45, r * 1.5, r * 0.9, 3);
      ctx.fill();
      ctx.fillStyle = e.color;
      ctx.font = `bold ${Math.max(11, r * 0.32)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(kind === 'mosfet' ? 'MOSFET' : 'PICO·IC', 0, 6);
      ctx.fillStyle = '#94a3b8';
      for (let i = 0; i < 6; i++) {
        const yy = -r * 0.5 + i * (r / 5);
        ctx.fillRect(-r - 8, yy, 8, 3);
        ctx.fillRect(r, yy, 8, 3);
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(-14, -10, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(14, -10, 4, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'arduino') {
      ctx.fillStyle = '#0f766e';
      roundRect(ctx, -r * 1.15, -r * 0.75, r * 2.3, r * 1.5, 8);
      ctx.fill();
      ctx.fillStyle = '#134e4a';
      roundRect(ctx, -r * 0.95, -r * 0.55, r * 1.1, r * 1.1, 4);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(-r * 0.7 + i * 12, -r * 0.35, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#38bdf8';
      roundRect(ctx, r * 0.35, -r * 0.35, r * 0.55, r * 0.7, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(10, r * 0.28)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('ARDUINO', 0, r * 0.85);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(-20, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(20, 0, 5, 0, Math.PI * 2); ctx.fill();
    } else {
      // motherboard / dark core
      ctx.fillStyle = '#111827';
      roundRect(ctx, -r, -r * 0.8, r * 2, r * 1.6, 8);
      ctx.fill();
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.strokeRect(-r * 0.85 + i * 8, -r * 0.65, r * 0.5, r * 0.35);
      }
      ctx.fillStyle = '#1d4ed8';
      roundRect(ctx, -r * 0.35, -r * 0.15, r * 0.7, r * 0.55, 3);
      ctx.fill();
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.arc(0, -r * 0.4, r * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(11, r * 0.28)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('PICO CORE', 0, r * 0.7);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fecaca';
      ctx.beginPath(); ctx.arc(-18, -8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(18, -8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath(); ctx.arc(-18, -8, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(18, -8, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // ── HUD / overlays ──
  function updateHud() {
    if ($('hudScore')) $('hudScore').textContent = fmt(G.score);
    if ($('hudWave')) $('hudWave').textContent = String(G.wave);
    if ($('hudTime')) $('hudTime').textContent = fmtTime(G.time);
    if ($('hudLv')) $('hudLv').textContent = 'Nv.' + G.level;
    if ($('hudHp')) $('hudHp').style.width = Math.max(0, (G.player.hp / G.player.maxHp) * 100) + '%';
    if ($('hudXp')) $('hudXp').style.width = Math.max(0, (G.xp / xpToLevel(G.level)) * 100) + '%';
  }
  function updateWeaponSlots() {
    const el = $('hudWeps');
    if (!el) return;
    el.innerHTML =
      G.weapons
        .map(
          (w) =>
            `<div class="led-wslot" title="${w.name}"><span>${w.icon}</span><span class="lvl">${w.level}</span></div>`
        )
        .join('') +
      Array.from({ length: Math.max(0, 4 - G.weapons.length) })
        .map(() => `<div class="led-wslot" style="opacity:.35">+</div>`)
        .join('');
  }

  function pauseGame() {
    if (!G.running || G.overlay === 'level' || G.overlay === 'weapon') return;
    G.paused = true;
    G.overlay = 'pause';
    const snap = snapshotSave();
    saveSlot = snap;
    persistSaveCloud(snap);
    $('overlayCard').innerHTML = `
      <h3>Pausa</h3>
      <p>Partida guardada. Puntos: <b>${fmt(G.score)}</b> · Tiempo: <b>${fmtTime(G.time)}</b></p>
      <div class="led-overlay-actions">
        <button type="button" class="led-btn led-btn-primary" id="btnResume">Continuar</button>
        <button type="button" class="led-btn led-btn-ghost" id="btnSaveQuit">Guardar y salir</button>
        <button type="button" class="led-btn led-btn-danger" id="btnGiveUp">Rendirse</button>
      </div>`;
    showOverlay();
    $('btnResume')?.addEventListener('click', closeOverlay);
    $('btnSaveQuit')?.addEventListener('click', () => {
      G.running = false;
      hideOverlay();
      showScreen('screenMenu');
      updateContinueBtn();
      toast('Partida guardada');
    });
    $('btnGiveUp')?.addEventListener('click', () => {
      hideOverlay();
      gameOver();
    });
  }

  function gameOver() {
    G.running = false;
    G.paused = true;
    const run = {
      score: G.score,
      kills: G.kills,
      wave: G.wave,
      time: G.time,
      bossesDefeated: G.bossesDefeated,
      weapons: G.weapons.slice()
    };
    stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
    if (run.score > (stats.bestScore || 0)) stats.bestScore = run.score;
    if (run.kills > (stats.bestKills || 0)) stats.bestKills = run.kills;
    if (run.time > (stats.bestTime || 0)) stats.bestTime = Math.floor(run.time);
    persistStatsCloud();
    submitScore(run);
    saveSlot = { alive: false };
    persistSaveCloud(saveSlot);
    updateContinueBtn();
    refreshMenuStats();

    $('overlayCard').innerHTML = `
      <h3>Fin de la partida</h3>
      <p>Tu LED se apagó… pero qué batalla.</p>
      <div class="led-mini">
        <div><span>Puntos</span><b>${fmt(run.score)}</b></div>
        <div><span>Kills</span><b>${fmt(run.kills)}</b></div>
        <div><span>Tiempo</span><b>${fmtTime(run.time)}</b></div>
      </div>
      <p style="font-size:.85rem">Oleada ${run.wave} · Bosses ${run.bossesDefeated}/11</p>
      <div class="led-overlay-actions">
        <button type="button" class="led-btn led-btn-primary" id="btnAgain">Jugar de nuevo</button>
        <button type="button" class="led-btn led-btn-ghost" id="btnToMenu">Menú / Top 10</button>
      </div>`;
    showOverlay();
    $('btnAgain')?.addEventListener('click', () => {
      hideOverlay();
      startNewGame();
    });
    $('btnToMenu')?.addEventListener('click', () => {
      hideOverlay();
      showScreen('screenMenu');
      loadTop10();
    });
  }

  function showOverlay() {
    $('overlay')?.classList.remove('hidden');
  }
  function hideOverlay() {
    $('overlay')?.classList.add('hidden');
    G.overlay = null;
  }
  function closeOverlay() {
    hideOverlay();
    G.paused = false;
    G.lastTs = performance.now();
  }

  function banner(text) {
    const el = $('bossBanner');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(banner._t);
    banner._t = setTimeout(() => el.classList.add('hidden'), 3200);
  }
  function gameToast(msg) {
    const el = $('gameToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(gameToast._t);
    gameToast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // Auth hooks for init/auth
  window.__ledArenaOnAuth = function () {
    updateAuthHint();
    syncCloud().then(() => {
      refreshMenuStats();
      updateContinueBtn();
      buildCustomUI();
      drawPreview();
    });
  };
  window.initLedArenaPage = function () {
    updateAuthHint();
    window.__ledArenaOnAuth?.();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
