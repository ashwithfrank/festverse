// Remote controller ("/remote"): runs on the organizer's phone.
import { CONFIG } from './config.js';
import { applyTheme, assetUrl, store } from './router.js';
import { createFestLink } from './realtime.js';
import { EVENT_TYPES, newId } from './security.js';

applyTheme();

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const el = {
  mainBtn: $('mainBtn'),
  mainLabel: $('mainLabel'),
  banner: $('banner'),
  bannerTitle: $('bannerTitle'),
  bannerText: $('bannerText'),
  resendBtn: $('resendBtn'),
  testBtn: $('testBtn'),
  testNote: $('testNote'),
  pillLink: $('pillLink'),
  pillDisplay: $('pillDisplay'),
  clockWarn: $('clockWarn'),
  passPanel: $('passPanel'),
  passForm: $('passForm'),
  passInput: $('passInput'),
  passMsg: $('passMsg'),
  rehearsal: $('rehearsal'),
  resetBtn: $('resetBtn'),
  confirmDialog: $('confirmDialog'),
  confirmYes: $('confirmYes'),
  confirmNo: $('confirmNo'),
  confirmWarn: $('confirmWarn'),
  resetDialog: $('resetDialog'),
  resetInput: $('resetInput'),
  resetYes: $('resetYes'),
  resetNo: $('resetNo'),
};

/* ---------------------------------------------------------------- branding */
$('festName').textContent = CONFIG.fest.name;
document.title = `${CONFIG.fest.name} Remote`;
$('footInfo').textContent = `${CONFIG.fest.name} · channel ${CONFIG.channelName}`;
const logo = $('logo');
if (CONFIG.fest.logo) {
  logo.addEventListener('load', () => { logo.hidden = false; });
  logo.addEventListener('error', () => { logo.hidden = true; });
  logo.src = assetUrl(CONFIG.fest.logo);
}

/* ------------------------------------------------------------------- state */
let rec = store.get('remote-official', null); // { event_id, accepted, confirmed, sent_at }
let linkStatus = 'connecting';
let linkDetail = '';
let peers = { displays: [], remotes: [] };
let busy = false; // an official send is in flight
let testBusy = false;
let ackTimedOut = false;
let bannerSticky = false;
const pending = new Map(); // ref event id -> resolve(status)

const getPasscode = () => String(store.get('passcode', '') || '');
const passcodeOk = () => !CONFIG.security.requirePasscode || getPasscode().length >= CONFIG.security.minPasscodeLength;
const saveRec = () => store.set('remote-official', rec);

/* ---------------------------------------------------------------------- ui */
function setBanner(kind, title, text) {
  bannerSticky = true;
  el.banner.dataset.kind = kind;
  el.bannerTitle.textContent = title;
  el.bannerText.textContent = text;
}

function setIdleBanner() {
  let title = 'READY WHEN YOU ARE';
  let text = 'Wait for both indicators to turn green, then press the button.';
  if (!passcodeOk()) {
    title = 'ENTER THE CONTROL PASSCODE';
    text = 'Open "Control passcode" below and enter the same passcode that is set on the display PC.';
  } else if (linkStatus === 'misconfigured') {
    title = 'NOT CONFIGURED';
    text = linkDetail;
  } else if (linkStatus !== 'connected') {
    title = 'CONNECTING…';
    text = linkDetail || 'Waiting for the connection to Supabase Realtime.';
  } else if (peers.displays.length === 0) {
    title = 'WAITING FOR THE DISPLAY';
    text = 'The display page is not detected yet. Open the main page on the projector PC.';
  }
  el.banner.dataset.kind = 'idle';
  el.bannerTitle.textContent = title;
  el.bannerText.textContent = text;
}

function renderPills() {
  const linkLabels = {
    connected: ['ok', 'Remote: connected'],
    connecting: ['warn', 'Remote: connecting…'],
    reconnecting: ['warn', 'Remote: reconnecting…'],
    offline: ['bad', 'Remote: phone is offline'],
    error: ['bad', 'Remote: cannot connect'],
    misconfigured: ['bad', 'Remote: not configured'],
  };
  const [state, label] = linkLabels[linkStatus] || ['warn', linkStatus];
  el.pillLink.dataset.state = state;
  el.pillLink.querySelector('span').textContent = label;

  const n = peers.displays.length;
  let dState = 'warn';
  let dLabel = 'Display: not detected';
  if (linkStatus === 'connected' && n > 0) {
    dState = 'ok';
    const locked = peers.displays.every((d) => !d.audio);
    dLabel = n === 1 ? 'Display: ready' : `Displays ready: ${n}`;
    if (CONFIG.audio.enabled && locked) dLabel += ' · sound locked';
    if (peers.displays.some((d) => d.inaugurated)) dLabel += ' · inaugurated';
  } else if (linkStatus !== 'connected') {
    dLabel = 'Display: unknown';
  }
  el.pillDisplay.dataset.state = dState;
  el.pillDisplay.querySelector('span').textContent = dLabel;
}

function render() {
  const linked = linkStatus === 'connected';
  const ready = linked && passcodeOk();
  const displayInaug = peers.displays.some((d) => d.inaugurated);
  const inaugurated = !!(rec && rec.accepted) || displayInaug;

  let state = 'disabled';
  let label = 'INAUGURATE FEST';
  if (busy) {
    state = 'sending';
    label = 'SENDING…';
  } else if (inaugurated) {
    state = 'done';
    label = 'INAUGURATED';
  } else if (ready) {
    state = 'armed';
  }
  el.mainBtn.dataset.state = state;
  el.mainBtn.disabled = state !== 'armed';
  el.mainLabel.textContent = label;

  el.testBtn.disabled = !ready || testBusy || inaugurated;
  el.resetBtn.disabled = !ready;
  el.resendBtn.hidden = !(rec && rec.accepted && !rec.confirmed && ackTimedOut && !busy);
  el.resendBtn.disabled = !ready;

  renderPills();
  if (!bannerSticky) setIdleBanner();
}

function warnDiag(text) {
  el.clockWarn.textContent = text;
  el.clockWarn.hidden = !text;
}

/* -------------------------------------------------------------------- acks */
function waitForAck(refId, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(refId);
      resolve(null);
    }, ms);
    pending.set(refId, (status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
}

function applyOfficialAck(status) {
  if (!rec) return;
  if (status === 'played' || status === 'already_played') {
    rec.confirmed = true;
    ackTimedOut = false;
    saveRec();
    setBanner('success', 'INAUGURATION SIGNAL SENT', 'Display confirmed. The announcement is on the screen.');
  } else if (status === 'already_inaugurated') {
    rec.confirmed = true;
    ackTimedOut = false;
    saveRec();
    setBanner('success', 'ALREADY INAUGURATED', 'The display had already been inaugurated by an earlier signal.');
  } else if (status === 'rejected_clock') {
    ackTimedOut = true;
    setBanner('error', 'DISPLAY REJECTED THE SIGNAL', 'The date/time on the display PC differs too much from this phone. Fix the PC clock (set time automatically), then press RESEND SIGNAL.');
  }
  render();
}

/* ------------------------------------------------------------- send flows */
async function sendOfficial() {
  if (busy) return;
  busy = true;
  ackTimedOut = false;
  if (!rec) rec = { event_id: newId(), accepted: false, confirmed: false };
  saveRec(); // the id is stored first, so a retry or refresh re-uses it (idempotent on the display)
  setBanner('info', 'SENDING…', 'Waiting for Supabase to accept the signal.');
  render();

  const res = await link.send(EVENT_TYPES.TRIGGER, {}, { eventId: rec.event_id });
  if (!res.ok) {
    busy = false;
    setBanner('error', 'SIGNAL NOT SENT', `${res.error} Nothing was shown on the display. You can press the button again.`);
    render();
    return;
  }

  rec.accepted = true;
  rec.sent_at = Date.now();
  saveRec();
  busy = false;
  setBanner('info', 'INAUGURATION SIGNAL SENT', 'Waiting for the display to confirm…');
  render();

  const status = await waitForAck(rec.event_id, CONFIG.remote.ackTimeoutMs);
  if (status === null && !rec.confirmed) {
    ackTimedOut = true;
    setBanner('warn', 'INAUGURATION SIGNAL SENT', 'No confirmation from the display yet. Look at the screen. If it is still black, press RESEND SIGNAL.');
    render();
  }
  // If an ack arrived, onMessage() already updated the banner.
}

async function sendTest() {
  if (testBusy) return;
  testBusy = true;
  el.testNote.textContent = 'Sending test animation…';
  render();
  const res = await link.send(EVENT_TYPES.TEST);
  if (!res.ok) {
    el.testNote.textContent = `Test not sent: ${res.error}`;
    testBusy = false;
    render();
    return;
  }
  const status = await waitForAck(res.envelope.event_id, CONFIG.remote.ackTimeoutMs);
  const notes = {
    test_played: 'Test animation is playing on the display (confirmed).',
    test_ignored: 'The display ignored the test because it is already inaugurated.',
    rejected_clock: 'The display rejected the test: its clock differs too much from this phone.',
  };
  el.testNote.textContent = status
    ? notes[status] || `Display replied: ${status}`
    : 'Test sent, but the display did not confirm. Is the display page open and connected?';
  testBusy = false;
  render();
}

async function sendReset() {
  const res = await link.send(EVENT_TYPES.RESET);
  if (!res.ok) {
    setBanner('error', 'RESET NOT SENT', res.error);
    render();
    return;
  }
  const status = await waitForAck(res.envelope.event_id, CONFIG.remote.ackTimeoutMs);
  if (status === 'reset_done' || status === 'reset_nothing') {
    rec = null;
    store.remove('remote-official');
    ackTimedOut = false;
    setBanner('success', 'REHEARSAL RESET', 'The display is black again and the button is re-armed.');
    el.testNote.textContent = 'Plays a clearly labelled rehearsal on the display. It never counts as the inauguration.';
  } else {
    setBanner('warn', 'RESET NOT CONFIRMED', 'The reset was sent but the display did not confirm. Check the display, then try again.');
  }
  render();
}

/* ---------------------------------------------------------------- dialogs */
const openDialog = (d) => (typeof d.showModal === 'function' ? d.showModal() : d.setAttribute('open', ''));
const closeDialog = (d) => (typeof d.close === 'function' ? d.close() : d.removeAttribute('open'));

el.mainBtn.addEventListener('click', () => {
  if (el.mainBtn.disabled || busy) return;
  if (peers.displays.length === 0) {
    el.confirmWarn.textContent = 'The display is not detected right now. The signal can only appear if the display page is open and connected.';
    el.confirmWarn.hidden = false;
  } else {
    el.confirmWarn.hidden = true;
  }
  el.confirmYes.disabled = false;
  openDialog(el.confirmDialog);
});
el.confirmNo.addEventListener('click', () => closeDialog(el.confirmDialog));
el.confirmYes.addEventListener('click', () => {
  if (el.confirmYes.disabled || busy) return;
  el.confirmYes.disabled = true; // blocks double taps immediately
  closeDialog(el.confirmDialog);
  sendOfficial();
});

el.resendBtn.addEventListener('click', () => {
  if (!busy) sendOfficial(); // same event_id: the display plays at most once
});
el.testBtn.addEventListener('click', () => {
  if (!el.testBtn.disabled) sendTest();
});

if (params.has('rehearsal')) el.rehearsal.hidden = false;
el.resetBtn.addEventListener('click', () => {
  el.resetInput.value = '';
  el.resetYes.disabled = true;
  openDialog(el.resetDialog);
});
el.resetInput.addEventListener('input', () => {
  el.resetYes.disabled = el.resetInput.value.trim().toUpperCase() !== 'RESET';
});
el.resetNo.addEventListener('click', () => closeDialog(el.resetDialog));
el.resetYes.addEventListener('click', () => {
  if (el.resetYes.disabled) return;
  el.resetYes.disabled = true;
  closeDialog(el.resetDialog);
  sendReset();
});

/* --------------------------------------------------------------- passcode */
el.passForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = el.passInput.value.trim();
  if (value.length < CONFIG.security.minPasscodeLength) {
    el.passMsg.textContent = `Passcode must be at least ${CONFIG.security.minPasscodeLength} characters.`;
    return;
  }
  store.set('passcode', value);
  el.passInput.value = '';
  el.passMsg.textContent = 'Saved on this phone.';
  el.passPanel.open = false;
  bannerSticky = false;
  render();
});
if (!passcodeOk()) el.passPanel.open = true;

/* ------------------------------------------------------------------- link */
const link = createFestLink({
  role: 'remote',
  getPasscode,
  onStatus: (status, detail) => {
    linkStatus = status;
    linkDetail = detail;
    render();
  },
  onPresence: (p) => {
    peers = p;
    render();
  },
  onMessage: (type, env, meta) => {
    if (type !== EVENT_TYPES.ACK) return;
    if (Math.abs(meta.skewSeconds) > 60) {
      warnDiag(`This phone and the display PC disagree on the time by about ${Math.abs(meta.skewSeconds)} seconds. Set both to automatic time, or signals may be rejected.`);
    }
    const resolve = pending.get(env.ref_event_id);
    if (resolve) {
      pending.delete(env.ref_event_id);
      resolve(env.status);
    }
    if (rec && env.ref_event_id === rec.event_id) applyOfficialAck(env.status);
  },
  onReject: (type, reason, env, info = {}) => {
    if (type !== EVENT_TYPES.ACK) return;
    if (info.code === 'stale') {
      warnDiag(`A reply from the display was ignored because its clock differs from this phone by about ${Math.abs(info.skewSeconds)} seconds. Set both devices to automatic time.`);
    } else if (info.code === 'bad_sig' || info.code === 'no_passcode') {
      warnDiag('A reply from the display was rejected. The passcode on the display PC probably differs from this phone.');
    }
  },
});

// Restore what the user last saw after a phone refresh.
if (rec && rec.accepted) {
  if (rec.confirmed) {
    setBanner('success', 'INAUGURATION SIGNAL SENT', 'Display confirmed earlier. This phone cannot send the inauguration again.');
  } else {
    ackTimedOut = true;
    setBanner('warn', 'INAUGURATION SIGNAL SENT', 'No confirmation was received. Look at the display. If it is still black, press RESEND SIGNAL.');
  }
}

render();
link.start();
