// Realtime link: Supabase Broadcast (events) + Presence (who is online) with
// reconnection, signature/freshness validation and duplicate protection.
//
// Broadcast is an event mechanism, not a durable queue: a message sent while the
// receiver is offline is lost. That is why the remote waits for an explicit
// delivery_ack from the display and offers "resend" (same event_id => idempotent).
import { CONFIG } from './config.js';
import { getClient, configProblems } from './supabase-client.js';
import { EVENT_TYPES, signEnvelope, verifyEnvelope, newId } from './security.js';
import { store } from './router.js';

const SEEN_MAX = 120;
const HEALTH_MS = 5000;
const JOIN_WATCHDOG_MS = 12000;

/**
 * status: 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'error' | 'misconfigured'
 */
export function createFestLink(options) {
  const {
    role,
    getPasscode = () => '',
    getPresenceMeta = () => ({}),
    onStatus = () => {},
    onPresence = () => {},
    onMessage = () => {},
    onReject = () => {},
  } = options;

  const clientId = newId().slice(0, 8);
  let client = null;
  let channel = null;
  let status = 'connecting';
  let detail = '';
  let stopped = true;
  let everConnected = false;
  let attempt = 0;
  let retryTimer = null;
  let watchdog = null;
  let healthTimer = null;
  let queue = Promise.resolve();
  let seen = new Set(store.get(`seen-${role}`, []) || []);

  function setStatus(next, d = '') {
    if (next === status && d === detail) return;
    status = next;
    detail = d;
    try {
      onStatus(status, detail);
    } catch (err) {
      console.error('[FestVerse] onStatus handler failed', err);
    }
  }

  function remember(id) {
    seen.add(id);
    if (seen.size > SEEN_MAX) seen = new Set([...seen].slice(-SEEN_MAX));
    store.set(`seen-${role}`, [...seen]);
  }

  function dropChannel() {
    if (!channel) return;
    const old = channel;
    channel = null; // set first so late callbacks from the old channel are ignored
    try {
      if (client) client.removeChannel(old);
    } catch (err) {
      console.warn('[FestVerse] removeChannel failed', err);
    }
  }

  function scheduleRetry() {
    if (stopped || retryTimer) return;
    attempt += 1;
    const delay = Math.min(2000 * attempt, 15000);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (status !== 'connected') connect();
    }, delay);
  }

  function sanitizeMeta(meta) {
    const out = {};
    if (meta && typeof meta === 'object') {
      for (const [k, v] of Object.entries(meta)) {
        if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
      }
    }
    return out;
  }

  function trackPresence() {
    if (!channel || status !== 'connected') return;
    try {
      const payload = { role, client: clientId, ts: Date.now(), ...sanitizeMeta(getPresenceMeta()) };
      Promise.resolve(channel.track(payload)).catch((err) => console.warn('[FestVerse] presence track failed', err));
    } catch (err) {
      console.warn('[FestVerse] presence track failed', err);
    }
  }

  function emitPresence() {
    if (!channel) return;
    try {
      const all = Object.values(channel.presenceState() || {})
        .flat()
        .filter((p) => p && typeof p === 'object');
      const pick = (r) =>
        all
          .filter((p) => p.role === r)
          .map((p) => ({
            client: String(p.client || ''),
            inaugurated: p.inaugurated === true,
            audio: p.audio === true,
            ts: Number(p.ts) || 0,
          }));
      onPresence({ displays: pick('display'), remotes: pick('remote') });
    } catch (err) {
      console.warn('[FestVerse] presence read failed', err);
    }
  }

  async function process(type, msg) {
    if (msg && msg.meta && msg.meta.replayed) {
      onReject(type, 'replayed message ignored', null, { code: 'replayed' });
      return;
    }
    const env = msg && msg.payload;
    const res = await verifyEnvelope(type, env, { passcode: getPasscode() });
    if (!res.ok) {
      console.warn(`[FestVerse] rejected ${type}: ${res.reason}`);
      onReject(type, res.reason, env, res);
      return;
    }
    const duplicate = seen.has(env.event_id);
    if (!duplicate) remember(env.event_id);
    onMessage(type, env, { duplicate, skewSeconds: res.skewSeconds });
  }

  // Messages are handled strictly one after another, so duplicate detection is race-free.
  function enqueue(type, msg) {
    queue = queue.then(() => process(type, msg)).catch((err) => console.error('[FestVerse] handler error', err));
  }

  async function connect() {
    if (stopped) return;
    clearTimeout(retryTimer);
    retryTimer = null;
    clearTimeout(watchdog);

    const problems = configProblems();
    if (problems.length) {
      setStatus('misconfigured', problems.join(' '));
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('offline');
      return;
    }

    try {
      client = await getClient();
    } catch (err) {
      console.error('[FestVerse]', err);
      setStatus('error', err.message);
      scheduleRetry();
      return;
    }
    if (stopped) return;

    dropChannel();
    setStatus(everConnected ? 'reconnecting' : 'connecting');

    const ch = client.channel(CONFIG.channelName, {
      config: {
        broadcast: { self: false, ack: true }, // ack: send() resolves only once the server accepted it
        presence: { key: `${role}-${clientId}`, enabled: true },
      },
    });
    channel = ch;

    Object.values(EVENT_TYPES).forEach((type) => {
      ch.on('broadcast', { event: type }, (msg) => enqueue(type, msg));
    });
    ch.on('presence', { event: 'sync' }, () => {
      if (channel === ch) emitPresence();
    });

    ch.subscribe((s, err) => {
      if (channel !== ch || stopped) return;
      if (s === 'SUBSCRIBED') {
        everConnected = true;
        attempt = 0;
        clearTimeout(watchdog);
        setStatus('connected');
        trackPresence();
        emitPresence();
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        const why = err ? String(err.message || err) : s;
        console.warn(`[FestVerse] channel ${s}`, err || '');
        setStatus(everConnected ? 'reconnecting' : 'error', why);
        scheduleRetry();
      }
    });

    watchdog = setTimeout(() => {
      if (status !== 'connected') connect();
    }, JOIN_WATCHDOG_MS);
  }

  function health() {
    if (stopped || !channel) return;
    const st = channel.state;
    if (status === 'connected' && st && st !== 'joined') {
      setStatus('reconnecting', `channel ${st}`);
      scheduleRetry();
    } else if (status !== 'connected' && st === 'joined') {
      setStatus('connected');
      trackPresence();
      emitPresence();
    }
  }

  const onOnline = () => {
    if (status !== 'connected') connect();
  };
  const onOffline = () => setStatus('offline');
  const onVisible = () => {
    if (!document.hidden && status !== 'connected') connect();
  };

  function start() {
    if (!stopped) return;
    stopped = false;
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    healthTimer = setInterval(health, HEALTH_MS);
    connect();
  }

  function stop() {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(watchdog);
    clearInterval(healthTimer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
    dropChannel();
  }

  async function send(type, extra = {}, opts = {}) {
    if (!channel || status !== 'connected') {
      return { ok: false, error: 'Not connected to Supabase Realtime yet.' };
    }
    let envelope;
    try {
      envelope = await signEnvelope(type, extra, getPasscode(), opts.eventId);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    try {
      const result = await channel.send({ type: 'broadcast', event: type, payload: envelope });
      const ok = result === 'ok';
      return { ok, result, envelope, error: ok ? '' : `Supabase did not accept the message (${result}).` };
    } catch (err) {
      return { ok: false, envelope, error: err && err.message ? err.message : String(err) };
    }
  }

  return {
    start,
    stop,
    send,
    refreshPresence: trackPresence,
    get status() {
      return status;
    },
    get detail() {
      return detail;
    },
  };
}
