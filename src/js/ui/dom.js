// Tiny DOM helpers: safe templating (auto-escape), element creation, formatting.
import { icon } from '../icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Marker for already-safe HTML (icons, nested templates). */
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(s);

/** Tagged template: interpolations are escaped unless wrapped in raw()/html``. Arrays are joined. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      out += Array.isArray(v) ? v.map((x) => (x instanceof Safe ? x.s : esc(x))).join('') : v instanceof Safe ? v.s : esc(v);
    }
  });
  return new Safe(out);
}

export const ic = (name, cls) => raw(icon(name, cls));

export function mount(target, content) {
  target.innerHTML = content instanceof Safe ? content.s : String(content);
  return target;
}

export function create(content) {
  const t = document.createElement('template');
  t.innerHTML = (content instanceof Safe ? content.s : String(content)).trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function formatBytes(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n >= 100 ? n.toFixed(0) : n.toFixed(n >= 10 ? 1 : 2)} ${u[i]}`;
}

export function timeAgo(date) {
  if (!date) return '—';
  const d = new Date(date);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, sec] of units) {
    if (s >= sec) { const v = Math.floor(s / sec); return `${v} ${name}${v > 1 ? 's' : ''} ago`; }
  }
  return 'just now';
}

export function timeAgoShort(date) {
  if (!date) return '—';
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 45) return 'now';
  for (const [n, sec] of [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]]) if (s >= sec) return `${Math.floor(s / sec)}${n} ago`;
  return 'now';
}

export const formatDate = (date) => date ? new Date(date).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const shortSha = (s) => (s || '').slice(0, 7);
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  return Promise.resolve();
}

export function ext(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Allows only http(s) URLs coming from GitHub payloads in href attributes. */
export function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '#'; } catch { return '#'; }
}

/** Builds a GitHub avatar URL safely (handles URLs with or without a query string). */
export function avatarSrc(url, size = 64) {
  if (!url) return '';
  try { const u = new URL(url); u.searchParams.set('s', String(size)); return u.toString(); }
  catch { return url + (String(url).includes('?') ? '&' : '?') + 's=' + size; }
}

/** <img> markup for a user avatar; falls back to an initial badge if the image fails (see app.js). */
export function avatarImg(user, size = 64, cls = 'avatar', px = 34) {
  const name = (user && (user.login || user.name)) || '?';
  return raw(`<img class="${esc(cls)}" src="${esc(avatarSrc(user && user.avatarUrl, size))}" alt="${esc(name)}" data-name="${esc(name)}" width="${px}" height="${px}" loading="lazy" referrerpolicy="no-referrer">`);
}

/** Initial badge used when an avatar cannot be loaded or there is no user. */
export function avatarFallback(name = '?', cls = 'avatar') {
  return raw(`<span class="${esc(cls)} fallback" aria-hidden="true">${esc(String(name).trim().charAt(0).toUpperCase() || '?')}</span>`);
}
