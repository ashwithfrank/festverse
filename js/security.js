// Message envelope: creation, signing, and strict validation of untrusted payloads.
import { CONFIG } from './config.js';

export const EVENT_TYPES = Object.freeze({
  TRIGGER: 'inauguration_trigger', // the OFFICIAL inauguration
  TEST: 'test_trigger', // rehearsal animation – can never be mistaken for the official one
  RESET: 'rehearsal_reset', // rehearsal-only reset
  ACK: 'delivery_ack', // display -> remote: "I received / played it"
});

export const ACK_STATUSES = Object.freeze([
  'played',
  'already_played',
  'already_inaugurated',
  'test_played',
  'test_ignored',
  'reset_done',
  'reset_nothing',
  'rejected_clock',
]);

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const SIG_RE = /^[0-9a-f]{64}$/;

export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function cryptoAvailable() {
  return !!(globalThis.crypto && globalThis.crypto.subtle);
}

async function hmacHex(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

// The exact string that is signed. Includes the type, so a signed TEST event can
// never be replayed as an official TRIGGER.
function canonical(env) {
  return [
    'festverse-v1',
    env.event_id,
    env.event_type,
    env.created_at,
    env.ref_event_id || '',
    env.status || '',
  ].join('|');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signEnvelope(type, extra = {}, passcode = '', eventId = '') {
  const env = {
    event_id: eventId || newId(),
    event_type: type,
    created_at: new Date().toISOString(),
    fest_name: CONFIG.fest.name,
    message: CONFIG.announcement.primary,
    ...extra,
  };
  if (CONFIG.security.requirePasscode) {
    if (!passcode) throw new Error('No control passcode is set on this device.');
    if (!cryptoAvailable()) {
      throw new Error('Signing needs HTTPS (or localhost). Open the HTTPS GitHub Pages URL.');
    }
    env.sig = await hmacHex(passcode, canonical(env));
  }
  return env;
}

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

// Validates an untrusted payload. Never throws.
export async function verifyEnvelope(expectedType, env, { passcode = '', now = Date.now() } = {}) {
  try {
    if (!env || typeof env !== 'object' || Array.isArray(env)) return fail('malformed payload');
    if (env.event_type !== expectedType) return fail('event type mismatch');
    if (typeof env.event_id !== 'string' || !ID_RE.test(env.event_id)) return fail('invalid event_id');
    if (typeof env.created_at !== 'string' || env.created_at.length > 40) return fail('invalid created_at');
    const created = Date.parse(env.created_at);
    if (!Number.isFinite(created)) return fail('invalid created_at');

    if (expectedType === EVENT_TYPES.ACK) {
      if (typeof env.ref_event_id !== 'string' || !ID_RE.test(env.ref_event_id)) return fail('invalid ref_event_id');
      if (typeof env.status !== 'string' || !ACK_STATUSES.includes(env.status)) return fail('invalid ack status');
    }

    // Signature first, so a stale-but-genuine message can be diagnosed ("clock mismatch").
    let sigOk = true;
    if (CONFIG.security.requirePasscode) {
      if (!passcode) return fail('no passcode set on this device', { code: 'no_passcode' });
      if (!cryptoAvailable()) return fail('crypto unavailable (use HTTPS)', { code: 'no_crypto' });
      if (typeof env.sig !== 'string' || !SIG_RE.test(env.sig)) return fail('missing or malformed signature', { code: 'bad_sig' });
      const expected = await hmacHex(passcode, canonical(env));
      sigOk = safeEqual(expected, env.sig);
      if (!sigOk) return fail('signature mismatch (wrong passcode?)', { code: 'bad_sig' });
    }

    const skewSeconds = Math.round((now - created) / 1000);
    if (Math.abs(skewSeconds) > CONFIG.security.maxEventAgeSeconds) {
      return fail(`stale or clock mismatch (${skewSeconds}s)`, { code: 'stale', sigOk, skewSeconds });
    }
    return { ok: true, skewSeconds };
  } catch (err) {
    return fail(`validation error: ${err && err.message ? err.message : err}`);
  }
}
