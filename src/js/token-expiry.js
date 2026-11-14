// Live token-expiry watcher.
//   • shows the exact expiry date + a ticking countdown (sidebar chip, banner, Connection page)
//   • warns once at 7 days, 3 days, 1 day, 1 hour and 10 minutes
//   • at the moment of expiry hands over to session.resolveAuthLost() which erases the token and ends the session
// Pure helpers are exported so they can be unit-tested.
import { state, onState } from './app-state.js';
import { serverNow, isTokenExpired } from './github-client.js';
import { testConnection } from './session.js';
import { expirySeen } from './store.js';
import { notify } from './notification.js';
import { icon } from './icons.js';
import { esc } from './ui/dom.js';

const SEC = 1000; const MIN = 60 * SEC; const HOUR = 60 * MIN; const DAY = 24 * HOUR;

export const STAGES = [
  { id: '7d', ms: 7 * DAY, label: '7 days' },
  { id: '3d', ms: 3 * DAY, label: '3 days' },
  { id: '1d', ms: 1 * DAY, label: '24 hours' },
  { id: '1h', ms: 1 * HOUR, label: '1 hour' },
  { id: '10m', ms: 10 * MIN, label: '10 minutes' },
];

const pad = (n) => String(n).padStart(2, '0');

/** "12d 03:04:05" or "03:04:05"; "Expired" at or below zero. */
export function formatRemaining(ms) {
  if (!(ms > 0)) return 'Expired';
  const s = Math.floor(ms / SEC);
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  return `${d > 0 ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(x)}`;
}

/** none = no expiry known · ok = >7d · notice = ≤7d · warning = ≤24h · critical = ≤1h · expired */
export function levelFor(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return 'none';
  if (ms <= 0) return 'expired';
  if (ms <= HOUR) return 'critical';
  if (ms <= DAY) return 'warning';
  if (ms <= 7 * DAY) return 'notice';
  return 'ok';
}

/** Stages that have been crossed (remaining ≤ stage), most urgent last. */
export const crossedStages = (ms) => STAGES.filter((s) => ms <= s.ms);

export function longDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); }
  catch { return String(iso); }
}

/** Snapshot used by every view. */
export function expirySnapshot() {
  const iso = state.connected && state.token ? state.token.expiresAt : null;
  if (!iso) return { has: false, iso: null, ms: null, level: 'none', text: '' };
  const ms = Date.parse(iso) - serverNow();
  return { has: true, iso, ms, level: levelFor(ms), text: formatRemaining(ms) };
}

/* ---------- live DOM ---------- */
let timer = null; let dismissedLevel = null; let lastDispatch = 0; let lastRefresh = Date.now();
const banner = () => document.getElementById('expiryBanner');

function paint(snap) {
  document.querySelectorAll('[data-expiry-countdown]').forEach((n) => { if (n.textContent !== snap.text) n.textContent = snap.text; });
  document.querySelectorAll('[data-expiry-level]').forEach((n) => { n.dataset.level = snap.level; });
  const root = banner(); if (!root) return;
  const show = snap.has && ['notice', 'warning', 'critical'].includes(snap.level) && dismissedLevel !== snap.level;
  if (!show) { if (!root.hidden) { root.hidden = true; root.innerHTML = ''; } return; }
  if (root.dataset.level !== snap.level || root.hidden) {
    root.hidden = false; root.dataset.level = snap.level;
    root.innerHTML = `<div class="eb-inner" data-expiry-level="${snap.level}">${icon(snap.level === 'notice' ? 'clock' : 'alert-triangle')}
      <div class="eb-text"><b>${snap.level === 'critical' ? 'Your GitHub token is about to expire' : 'Your GitHub token expires soon'}</b>
      <span>${esc(longDate(snap.iso))} · <span class="mono eb-count" data-expiry-countdown>${esc(snap.text)}</span> left</span></div>
      <a class="btn sm" href="#/connection">Renew</a>
      <button class="btn ghost icon-only sm" id="ebClose" aria-label="Dismiss">${icon('x', 'sm')}</button></div>`;
    root.querySelector('#ebClose').addEventListener('click', () => { dismissedLevel = snap.level; root.hidden = true; root.innerHTML = ''; });
  }
}

function warnOnce(snap) {
  const crossed = crossedStages(snap.ms);
  if (!crossed.length) return;
  const seen = expirySeen.get(snap.iso);
  const fresh = crossed.filter((s) => !seen.includes(s.id));
  if (!fresh.length) return;
  expirySeen.add(snap.iso, crossed.map((s) => s.id));         // mark all crossed, so nothing bursts after a long absence
  const urgent = fresh[fresh.length - 1];                      // announce only the most urgent one
  const when = `Expires ${longDate(snap.iso)}.`;
  const msg = `${when} Create or regenerate a token in GitHub, then reconnect.`;
  if (urgent.id === '1h' || urgent.id === '10m') notify.error(`Token expires in ${urgent.label}`, msg, { duration: 15000 });
  else notify.warning(`Token expires in ${urgent.label}`, msg, { duration: 12000 });
}

function tick() {
  const snap = expirySnapshot();
  paint(snap);
  if (!snap.has) return;
  if (snap.level === 'expired' || snap.ms <= 0) {
    // Expiry date passed. Hand over once per few seconds; session.resolveAuthLost() confirms with GitHub and acts.
    if (isTokenExpired() && Date.now() - lastDispatch > 4000) {
      lastDispatch = Date.now();
      window.dispatchEvent(new CustomEvent('repofast:auth-lost', { detail: { reason: 'expired' } }));
    }
    return;
  }
  warnOnce(snap);
  // Quietly re-check with GitHub every 15 minutes (catches revoked tokens, refreshes expiry and the clock).
  if (Date.now() - lastRefresh > 15 * MIN) { lastRefresh = Date.now(); testConnection().catch(() => {}); }
}

/** Call after (re)rendering anything that contains [data-expiry-countdown]. */
export function refreshExpiryNow() { tick(); }

export function startExpiryWatch() {
  if (timer) return;
  timer = setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Background tabs freeze timers: catch up immediately, and re-verify if we were away a while.
    if (state.connected && Date.now() - lastRefresh > 5 * MIN) { lastRefresh = Date.now(); testConnection().catch(() => {}); }
    tick();
  });
  window.addEventListener('online', () => { if (state.connected) testConnection().catch(() => {}); });
  onState(() => { dismissedLevel = state.connected ? dismissedLevel : null; tick(); });
  tick();
}
