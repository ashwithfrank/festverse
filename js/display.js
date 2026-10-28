// Main display ("/"): black until a valid, fresh, signed inauguration event arrives.
import { CONFIG } from './config.js';
import { applyTheme, assetUrl, store } from './router.js';
import { configProblems } from './supabase-client.js';
import { createFestLink } from './realtime.js';
import { EVENT_TYPES, newId } from './security.js';

applyTheme();

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const setup = $('setup');
const params = new URLSearchParams(location.search);

const TOTAL_SECONDS = 8.0; // matches animations.css
const BURST_SECONDS = 3.2; // moment of the "boom" and particle burst
const speed = Math.max(0.2, Number(CONFIG.animation.speed) || 1);

/* ------------------------------------------------------------------ content */
// Always rendered with textContent from LOCAL config – never from the network payload.
document.title = CONFIG.fest.name;
$('festName').textContent = CONFIG.fest.name;
$('primary').textContent = CONFIG.announcement.primary;
$('secondary').textContent = CONFIG.announcement.secondary;
$('subtitle').textContent = CONFIG.announcement.subtitle || '';

const logo = $('logo');
if (CONFIG.fest.logo) {
  logo.addEventListener('load', () => { logo.hidden = false; });
  logo.addEventListener('error', () => { logo.hidden = true; });
  logo.src = assetUrl(CONFIG.fest.logo);
}

/* ------------------------------------------------------------------- state */
let official = store.get('official', null); // { event_id, at } once inaugurated on THIS display
let run = null; // current animation run { timers, test, sound }
let audioCtx = null;
let audioEl = null;
let wakeLock = null;
const ui = { link: 'connecting', detail: '', remotes: 0, log: [] };

const getPasscode = () => String(store.get('passcode', '') || '');
const audioReady = () => !!(audioCtx && audioCtx.state === 'running') || (!!audioEl && navigator.userActivation && navigator.userActivation.hasBeenActive === true);

function log(text) {
  const time = new Date().toLocaleTimeString();
  ui.log.unshift(`${time}  ${text}`);
  ui.log = ui.log.slice(0, 8);
  renderSetup();
}

/* --------------------------------------------------------------- particles */
const canvas = $('fx');
const g = canvas.getContext ? canvas.getContext('2d') : null;
const COLORS = [[255, 215, 120], [255, 190, 70], [255, 240, 200], [246, 226, 122]];
let particles = [];
let raf = 0;
let lastTs = 0;
let emitRate = 0; // ambient particles per second
let emitCarry = 0;
let vw = 0;
let vh = 0;
let dpr = 1;

function resizeCanvas() {
  if (!g) return;
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  vw = window.innerWidth;
  vh = window.innerHeight;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function spawnAmbient() {
  const c = COLORS[(Math.random() * COLORS.length) | 0];
  particles.push({
    x: Math.random() * vw,
    y: vh + 10,
    vx: (Math.random() - 0.5) * 24,
    vy: -(28 + Math.random() * 70) * (vh / 1080),
    r: 0.8 + Math.random() * 2.2,
    age: 0,
    life: 5 + Math.random() * 6,
    c,
    drag: 1,
  });
}

function burst(count) {
  const cx = vw / 2;
  const cy = vh * 0.46;
  const unit = Math.max(vw, vh) / 1920;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (80 + Math.random() * 620) * unit;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      r: 1 + Math.random() * 2.8,
      age: 0,
      life: 2.2 + Math.random() * 2.6,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      drag: 0.985,
    });
  }
}

function tick(ts) {
  if (!g) return;
  const dt = Math.min((ts - lastTs) / 1000 || 0.016, 0.05);
  lastTs = ts;
  g.clearRect(0, 0, vw, vh);
  g.globalCompositeOperation = 'lighter';

  emitCarry += emitRate * dt;
  while (emitCarry >= 1 && particles.length < 420) {
    spawnAmbient();
    emitCarry -= 1;
  }
  emitCarry = Math.min(emitCarry, 3);

  const next = [];
  for (const p of particles) {
    p.age += dt;
    if (p.age >= p.life) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= p.drag;
    p.vy *= p.drag;
    if (p.drag < 1) p.vy -= 6 * dt; // sparks drift gently upward
    const t = p.age / p.life;
    const alpha = Math.min(1, t * 6) * (1 - t);
    const [r, gr, b] = p.c;
    g.fillStyle = `rgba(${r},${gr},${b},${(alpha * 0.14).toFixed(3)})`;
    g.beginPath();
    g.arc(p.x, p.y, p.r * 3.2, 0, 6.2832);
    g.fill();
    g.fillStyle = `rgba(${r},${gr},${b},${alpha.toFixed(3)})`;
    g.beginPath();
    g.arc(p.x, p.y, p.r, 0, 6.2832);
    g.fill();
    next.push(p);
  }
  particles = next;
  raf = requestAnimationFrame(tick);
}

function startParticles(rate) {
  emitRate = rate;
  if (g && !raf) {
    lastTs = performance.now();
    raf = requestAnimationFrame(tick);
  }
}

function stopParticles() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  emitRate = 0;
  particles = [];
  if (g) g.clearRect(0, 0, vw, vh);
}

/* ------------------------------------------------------------------- sound */
function unlockAudio() {
  try {
    if (CONFIG.audio.enabled) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !audioCtx) audioCtx = new AC();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().then(syncAudioPresence).catch(() => {});
      if (CONFIG.audio.file && !audioEl) {
        audioEl = new Audio(assetUrl(CONFIG.audio.file));
        audioEl.preload = 'auto';
        audioEl.volume = Math.min(1, Math.max(0, CONFIG.audio.volume));
      }
    }
  } catch (err) {
    console.warn('[FestVerse] audio unlock failed', err);
  }
  requestWakeLock();
  renderSetup();
  setTimeout(syncAudioPresence, 150); // let the phone show "sound locked" -> unlocked
}

let lastAudioPresence = false;
function syncAudioPresence() {
  const now = audioReady();
  if (now !== lastAudioPresence) {
    lastAudioPresence = now;
    if (link) link.refreshPresence();
  }
  renderSetup();
}

function playSound() {
  if (!CONFIG.audio.enabled) return null;
  try {
    if (audioEl) {
      audioEl.currentTime = 0;
      audioEl.play().catch((err) => log(`Sound blocked by browser (${err.name}) – click the page once.`));
      return { stop: () => audioEl.pause() };
    }
    const ctx = audioCtx;
    if (!ctx) {
      log('Sound not enabled – click the page once.');
      return null;
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const vol = Math.min(1, Math.max(0, CONFIG.audio.volume));
    const t0 = ctx.currentTime + 0.08;
    const at = (x) => t0 + x * speed;
    const master = ctx.createGain();
    master.gain.value = vol;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);

    // 1. rising orchestral-style swell
    const swell = ctx.createGain();
    swell.gain.setValueAtTime(0.0001, at(0));
    swell.gain.exponentialRampToValueAtTime(0.45, at(3.1));
    swell.gain.exponentialRampToValueAtTime(0.0001, at(4.3));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(180, at(0));
    lp.frequency.exponentialRampToValueAtTime(5200, at(3.1));
    [110, 110.8, 164.8, 220.4].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(at(0));
      o.stop(at(4.4));
    });
    lp.connect(swell);
    swell.connect(master);

    // 2. deep impact at the burst
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(110, at(3.1));
    boom.frequency.exponentialRampToValueAtTime(34, at(4.7));
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, at(3.05));
    bg.gain.exponentialRampToValueAtTime(1, at(3.15));
    bg.gain.exponentialRampToValueAtTime(0.0001, at(5.1));
    boom.connect(bg);
    bg.connect(master);
    boom.start(at(3.05));
    boom.stop(at(5.2));

    // 3. shimmering chimes
    [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const gn = ctx.createGain();
      const s = at(3.2 + i * 0.18);
      gn.gain.setValueAtTime(0.0001, s);
      gn.gain.exponentialRampToValueAtTime(0.16, s + 0.02);
      gn.gain.exponentialRampToValueAtTime(0.0001, s + 2.4 * speed);
      o.connect(gn);
      gn.connect(master);
      o.start(s);
      o.stop(s + 2.5 * speed);
    });

    return {
      stop: () => {
        try {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
        } catch {
          /* ignore */
        }
      },
    };
  } catch (err) {
    console.warn('[FestVerse] sound failed', err);
    return null;
  }
}

/* --------------------------------------------------------------- wake lock */
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {
    /* not critical */
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestWakeLock(); });

/* --------------------------------------------------------------- animation */
function after(ms, fn) {
  const id = setTimeout(fn, ms);
  if (run) run.timers.push(id);
}

function clearRun() {
  if (!run) return;
  run.timers.forEach(clearTimeout);
  if (run.sound) run.sound.stop();
  run = null;
}

function blackout() {
  clearRun();
  stopParticles();
  stage.classList.remove('fade-out');
  stage.dataset.state = 'idle';
  $('badge').hidden = true;
}

function showFinalStatic() {
  blackout();
  stage.dataset.state = 'final';
  startParticles(14);
}

function startAnimation({ test }) {
  blackout();
  $('badge').hidden = !test;
  void stage.offsetWidth; // restart CSS animations from zero
  stage.dataset.state = 'playing';
  run = { timers: [], test, sound: null };
  run.sound = playSound();
  startParticles(16);
  after(BURST_SECONDS * speed * 1000, () => {
    burst(Math.max(20, Number(CONFIG.animation.particles) || 160));
    emitRate = 40;
  });
  after(TOTAL_SECONDS * speed * 1000, () => { emitRate = 18; });
  if (test) {
    const hold = Math.max(2, Number(CONFIG.animation.testHoldSeconds) || 6);
    after((TOTAL_SECONDS * speed + hold) * 1000, () => {
      stage.classList.add('fade-out');
      after(1400, () => { if (!official) blackout(); });
    });
  }
}

/* --------------------------------------------------------- protocol / acks */
let link = null;

function ack(env, status) {
  link.send(EVENT_TYPES.ACK, { ref_event_id: env.event_id, status }).then((res) => {
    if (!res.ok) log(`Could not send confirmation to the remote: ${res.error}`);
  });
}

function startOfficial(env) {
  official = { event_id: env.event_id, at: Date.now() };
  store.set('official', official);
  store.push('history', { action: 'inaugurated', event_id: env.event_id, at: new Date().toISOString() });
  startAnimation({ test: false });
  link.refreshPresence();
  log('OFFICIAL inauguration started.');
}

function onMessage(type, env, meta) {
  const dup = meta.duplicate;
  log(`${type}${dup ? ' (duplicate)' : ''} accepted, ${meta.skewSeconds}s old`);

  if (type === EVENT_TYPES.TRIGGER) {
    if (official) {
      ack(env, official.event_id === env.event_id ? 'already_played' : 'already_inaugurated');
    } else if (dup) {
      ack(env, 'already_played');
    } else {
      startOfficial(env);
      ack(env, 'played');
    }
  } else if (type === EVENT_TYPES.TEST) {
    if (official || dup) {
      ack(env, 'test_ignored');
    } else {
      startAnimation({ test: true });
      ack(env, 'test_played');
      log('Test animation playing.');
    }
  } else if (type === EVENT_TYPES.RESET) {
    if (dup) return;
    if (official) {
      store.push('history', { action: 'rehearsal_reset', cleared: official.event_id, event_id: env.event_id, at: new Date().toISOString() });
      official = null;
      store.remove('official');
      blackout();
      link.refreshPresence();
      ack(env, 'reset_done');
      log('Rehearsal reset: back to black.');
    } else {
      blackout();
      ack(env, 'reset_nothing');
    }
  }
  // EVENT_TYPES.ACK is meant for remotes; the display ignores it.
  renderSetup();
}

function onReject(type, reason, env, info = {}) {
  log(`Rejected ${type}: ${reason}`);
  // A genuine (correctly signed) message that is only too old/new means a clock problem:
  // tell the remote, so it is caught during rehearsal instead of at the ceremony.
  if (info.code === 'stale' && info.sigOk && env && (type === EVENT_TYPES.TRIGGER || type === EVENT_TYPES.TEST)) {
    ack(env, 'rejected_clock');
  }
}

/* ------------------------------------------------------------------- setup */
function setupVisible() {
  return !setup.hidden;
}

function showSetup(visible) {
  setup.hidden = !visible;
  document.body.classList.toggle('setup-open', visible);
  renderSetup();
}

function needsSetup() {
  return configProblems().length > 0 || (CONFIG.security.requirePasscode && getPasscode().length < CONFIG.security.minPasscodeLength);
}

function setText(id, text, tone) {
  const el = $(id);
  el.textContent = text;
  if (tone) el.dataset.tone = tone;
  else delete el.dataset.tone;
}

function renderSetup() {
  if (!setupVisible()) return;
  const labels = {
    connected: ['Connected – listening for the remote', 'ok'],
    connecting: ['Connecting…', 'warn'],
    reconnecting: ['Connection lost – reconnecting…', 'warn'],
    offline: ['This PC is offline', 'bad'],
    error: ['Cannot connect', 'bad'],
    misconfigured: ['Not configured', 'bad'],
  };
  const [label, tone] = labels[ui.link] || [ui.link, 'warn'];
  setText('sConn', ui.detail ? `${label} — ${ui.detail}` : label, tone);
  setText('sRemotes', String(ui.remotes), ui.remotes > 0 ? 'ok' : 'warn');
  setText('sSound', audioReady() ? 'Enabled' : CONFIG.audio.enabled ? 'Locked – click the page once' : 'Disabled in config', audioReady() ? 'ok' : 'warn');
  setText('sState', official ? `INAUGURATED (id ${official.event_id.slice(0, 8)}…) – refresh will not replay it` : 'Waiting for the inauguration', official ? 'ok' : '');
  const problems = configProblems();
  const needPass = CONFIG.security.requirePasscode && getPasscode().length < CONFIG.security.minPasscodeLength;
  setText('sConfig', problems.length ? problems.join(' ') : needPass ? 'Enter the control passcode below.' : 'OK', problems.length || needPass ? 'bad' : 'ok');
  const list = $('sLog');
  list.replaceChildren(...ui.log.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
}

$('setupHide').addEventListener('click', () => showSetup(false));

$('passForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('passInput');
  const value = input.value.trim();
  if (value.length < CONFIG.security.minPasscodeLength) {
    $('passMsg').textContent = `Passcode must be at least ${CONFIG.security.minPasscodeLength} characters.`;
    return;
  }
  store.set('passcode', value);
  input.value = '';
  $('passMsg').textContent = 'Passcode saved on this PC. Press H to hide this panel.';
  renderSetup();
});

$('btnEnable').addEventListener('click', () => {
  unlockAudio();
  toggleFullscreen(true);
});

$('btnPreview').addEventListener('click', () => {
  unlockAudio();
  if (official) {
    log('Preview blocked: this display is already inaugurated. Use "Clear local record" first.');
    return;
  }
  startAnimation({ test: true });
});

$('btnClear').addEventListener('click', () => {
  if (!official) {
    log('No local inauguration record to clear.');
    return;
  }
  if (!window.confirm('Clear the local inauguration record on THIS display? Use only for rehearsal.')) return;
  store.push('history', { action: 'local_clear', cleared: official.event_id, at: new Date().toISOString() });
  official = null;
  store.remove('official');
  blackout();
  link.refreshPresence();
  log('Local record cleared (rehearsal).');
});

// Last-resort fallback if the internet or Supabase fails on the day: the operator at the
// display PC can start the official animation locally (setup panel only, with a confirmation).
$('btnEmergency').addEventListener('click', () => {
  unlockAudio();
  if (official) {
    log('Already inaugurated on this display.');
    return;
  }
  const ok = window.confirm('EMERGENCY LOCAL START\n\nThis starts the OFFICIAL inauguration on this display right now, without the remote. Continue?');
  if (!ok) return;
  showSetup(false);
  startOfficial({ event_id: newId() });
});

/* ------------------------------------------------------------ input / keys */
function toggleFullscreen(forceOn = false) {
  const el = document.documentElement;
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (!forceOn) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    }
  } catch {
    /* fullscreen not available */
  }
}

document.addEventListener('click', (e) => {
  if (!setup.contains(e.target)) unlockAudio();
});
document.addEventListener('dblclick', (e) => {
  if (!setup.contains(e.target)) toggleFullscreen();
});
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 's') showSetup(!setupVisible());
  else if (k === 'h') showSetup(false);
  else if (k === 'f') toggleFullscreen();
  else if (k === 't' && setupVisible()) $('btnPreview').click();
});

/* ------------------------------------------------------------------- start */
link = createFestLink({
  role: 'display',
  getPasscode,
  getPresenceMeta: () => ({ inaugurated: !!official, audio: audioReady() }),
  onStatus: (status, detail) => {
    ui.link = status;
    ui.detail = detail;
    if (status === 'connected') log('Connected to Supabase Realtime.');
    else if (status !== 'connecting') log(`Connection: ${status}${detail ? ` (${detail})` : ''}`);
    renderSetup();
  },
  onPresence: ({ remotes }) => {
    ui.remotes = remotes.length;
    renderSetup();
  },
  onMessage,
  onReject,
});

if (official) showFinalStatic(); // refresh after the ceremony: show the result, never replay the animation
showSetup(params.has('setup') || needsSetup());
requestWakeLock();
link.start();

// Handy for developers / the test suite; exposes nothing that can trigger the ceremony.
window.festverseDisplay = { get official() { return official; }, get status() { return ui.link; } };
