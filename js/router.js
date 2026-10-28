// Route-aware helpers shared by both pages: base-path-safe URLs, theme, local storage.
//
// Routing strategy: there is NO client-side router. "/" is index.html and "/remote"
// is remote/index.html — real files, so GitHub Pages serves them natively (it 301s
// "/remote" to "/remote/"). Every page declares where the site root is relative to
// itself via <meta name="festverse-root">, so the same files work on a user site
// (https://user.github.io/) and a repository site (https://user.github.io/repo/).
import { CONFIG } from './config.js';

export function rootUrl() {
  const meta = document.querySelector('meta[name="festverse-root"]');
  return new URL(meta ? meta.content : './', location.href);
}

export function assetUrl(path) {
  if (!path) return '';
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path;
  return new URL(path, rootUrl()).href;
}

export const displayUrl = () => rootUrl().href;
export const remoteUrl = () => new URL('remote/', rootUrl()).href;

export function applyTheme() {
  const s = document.documentElement.style;
  const c = CONFIG.colors;
  s.setProperty('--gold', c.gold);
  s.setProperty('--gold-light', c.goldLight);
  s.setProperty('--gold-deep', c.goldDeep);
  s.setProperty('--amber', c.amber);
  s.setProperty('--text', c.text);
  const speed = Number(CONFIG.animation.speed);
  s.setProperty('--speed', String(Number.isFinite(speed) && speed > 0 ? speed : 1));
}

const key = (name) => `festverse.${CONFIG.eventKey}.${name}`;

export const store = {
  get(name, fallback = null) {
    try {
      const raw = localStorage.getItem(key(name));
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(name, value) {
    try {
      localStorage.setItem(key(name), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(name) {
    try {
      localStorage.removeItem(key(name));
    } catch {
      /* ignore */
    }
  },
  push(name, entry, max = 50) {
    const list = this.get(name, []);
    const next = Array.isArray(list) ? list : [];
    next.push(entry);
    this.set(name, next.slice(-max));
  },
};
