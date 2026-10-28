// Loads the pinned Supabase client library and creates the (single) client.
import { CONFIG } from './config.js';
import { assetUrl } from './router.js';

export function configProblems() {
  const problems = [];
  const { url, publishableKey } = CONFIG.supabase;
  if (!url || /YOUR_/i.test(url) || !/^https:\/\//i.test(url)) {
    problems.push('Supabase URL is not set in js/config.js.');
  }
  if (!publishableKey || /YOUR_/i.test(publishableKey) || publishableKey.length < 20) {
    problems.push('Supabase publishable key is not set in js/config.js.');
  }
  if (/service_role|sb_secret_/i.test(String(publishableKey))) {
    problems.push('A SECRET key was pasted into the frontend. Remove it and use the publishable key.');
  }
  return problems;
}

function loadScript(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    const timer = setTimeout(() => {
      el.remove();
      reject(new Error(`timed out loading ${url}`));
    }, timeoutMs);
    el.async = true;
    el.src = url;
    el.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    el.onerror = () => {
      clearTimeout(timer);
      el.remove();
      reject(new Error(`failed to load ${url}`));
    };
    document.head.appendChild(el);
  });
}

async function loadLibrary() {
  const have = () => globalThis.supabase && typeof globalThis.supabase.createClient === 'function';
  if (have()) return globalThis.supabase;

  const errors = [];
  for (const url of CONFIG.supabase.libUrls || []) {
    try {
      await loadScript(assetUrl(url)); // local paths (js/vendor/...) resolve from the site root
      if (have()) return globalThis.supabase;
      errors.push(`${url} loaded but did not define window.supabase`);
    } catch (err) {
      errors.push(err.message);
      console.warn('[FestVerse] Supabase library source failed:', err.message);
    }
  }
  if (CONFIG.supabase.esmUrl) {
    try {
      const mod = await import(CONFIG.supabase.esmUrl);
      if (mod && typeof mod.createClient === 'function') return mod;
    } catch (err) {
      errors.push(`esm fallback: ${err.message}`);
    }
  }
  throw new Error(`Could not load the Supabase library (${errors.join('; ')}).`);
}

let clientPromise = null;

export function getClient() {
  if (!clientPromise) {
    clientPromise = loadLibrary()
      .then((lib) =>
        lib.createClient(CONFIG.supabase.url, CONFIG.supabase.publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          realtime: { params: { eventsPerSecond: 10 } },
        }),
      )
      .catch((err) => {
        clientPromise = null; // allow a retry later
        throw err;
      });
  }
  return clientPromise;
}
