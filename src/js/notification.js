// Toast notifications.
import { html, create, ic, safeUrl } from './ui/dom.js';

const ICONS = { success: 'check-circle-2', error: 'alert-circle', warning: 'alert-triangle', info: 'info' };
let root;

function ensureRoot() {
  if (!root) {
    root = document.createElement('div');
    root.className = 'toasts';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
  }
  return root;
}

export function toast(type, title, message = '', opts = {}) {
  const el = create(html`
    <div class="toast ${type}" role="${type === 'error' ? 'alert' : 'status'}">
      <span class="t-icon">${ic(ICONS[type] || 'info', 'lg')}</span>
      <div class="t-body">
        <div class="t-title">${title}</div>
        ${message ? html`<div class="t-msg">${message}</div>` : ''}
        ${opts.href ? html`<div class="t-msg"><a href="${safeUrl(opts.href)}" target="_blank" rel="noopener noreferrer">${opts.linkText || 'Open'}</a></div>` : ''}
      </div>
      <button class="t-x" aria-label="Dismiss">${ic('x', 'sm')}</button>
    </div>`);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  el.querySelector('.t-x').addEventListener('click', close);
  ensureRoot().appendChild(el);
  const ttl = opts.duration ?? (type === 'error' ? 8000 : 4800);
  if (ttl > 0) setTimeout(close, ttl);
  return close;
}

export const notify = {
  success: (t, m, o) => toast('success', t, m, o),
  error: (t, m, o) => toast('error', t, m, o),
  warning: (t, m, o) => toast('warning', t, m, o),
  info: (t, m, o) => toast('info', t, m, o),
};
