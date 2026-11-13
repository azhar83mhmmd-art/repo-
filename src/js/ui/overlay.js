// Modal, popover menu and confirm dialog.
import { html, create, ic, mount } from './dom.js';

const stack = [];

export function modal({ title, subtitle, body, footer, wide = false, onClose, dismissable = true }) {
  const root = create(html`
    <div class="modal-root" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal ${wide ? 'wide' : ''}">
        <div class="modal-head">
          <div><h2>${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>
          ${dismissable ? html`<button class="btn ghost icon-only sm" data-close aria-label="Close">${ic('x')}</button>` : ''}
        </div>
        <div class="modal-body"></div>
        <div class="modal-foot"></div>
      </div>
    </div>`);
  const bodyEl = root.querySelector('.modal-body');
  const footEl = root.querySelector('.modal-foot');
  const apply = (el, c) => { if (c instanceof Node) el.appendChild(c); else if (c) mount(el, c); };
  apply(bodyEl, body); apply(footEl, footer);
  if (!footer) footEl.remove();

  const prevFocus = document.activeElement;
  const api = {
    el: root, body: bodyEl, foot: footEl,
    close(result) {
      if (!root.isConnected) return;
      root.remove();
      stack.splice(stack.indexOf(api), 1);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = stack.length ? 'hidden' : '';
      prevFocus && prevFocus.focus && prevFocus.focus();
      onClose && onClose(result);
    },
  };
  const onKey = (e) => {
    if (stack[stack.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissable && !document.querySelector('.select-menu')) { e.stopPropagation(); api.close(); }
    if (e.key === 'Tab') {
      const f = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"]), a[href]')].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], lastEl = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  root.addEventListener('mousedown', (e) => { if (e.target === root && dismissable) api.close(); });
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => api.close()));
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';
  stack.push(api);
  setTimeout(() => (root.querySelector('[autofocus]') || root.querySelector('input, textarea, .modal-foot .btn.primary'))?.focus(), 30);
  return api;
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, details }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const m = modal({
      title,
      body: html`<p style="color:var(--text-2)">${message}</p>${details ? html`<div class="alert warning">${ic('alert-triangle')}<div>${details}</div></div>` : ''}`,
      footer: html`<button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${confirmText}</button>`,
      onClose: () => done(false),
    });
    m.el.querySelector('[data-no]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-yes]').addEventListener('click', () => { done(true); m.close(); });
  });
}

/** Popover menu anchored to an element. items: [{label, icon, onClick, danger, href}|'sep'] */
export function popMenu(anchor, items, { header, align = 'right' } = {}) {
  document.querySelectorAll('.menu').forEach((n) => n.remove());
  const el = create(html`<div class="menu" role="menu">${header ? header : ''}${items.map((it) => it === 'sep'
    ? html`<div class="menu-sep"></div>`
    : it.href
      ? html`<a class="menu-item ${it.danger ? 'danger' : ''}" role="menuitem" href="${it.href}" target="_blank" rel="noopener noreferrer">${ic(it.icon || 'external-link', 'sm')}${it.label}</a>`
      : html`<button class="menu-item ${it.danger ? 'danger' : ''}" role="menuitem">${ic(it.icon || 'chevron-right', 'sm')}${it.label}</button>`)}</div>`);
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.left = `${Math.max(8, Math.min(align === 'right' ? r.right - w : r.left, window.innerWidth - w - 8))}px`;
  const below = window.innerHeight - r.bottom;
  if (below < el.offsetHeight + 12 && r.top > below) el.style.bottom = `${window.innerHeight - r.top + 6}px`;
  else el.style.top = `${r.bottom + 6}px`;
  const btns = [...el.querySelectorAll('.menu-item')];
  // NOTE: handlers must be declared BEFORE they are wired (a const used earlier hits the TDZ and kills the menu).
  const onDoc = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() { el.remove(); document.removeEventListener('pointerdown', onDoc, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', close); window.removeEventListener('hashchange', close); }
  let n = 0;
  items.forEach((it) => {
    if (it === 'sep') return;
    const b = btns[n++]; if (!b) return;
    if (it.href) b.addEventListener('click', close);
    else b.addEventListener('click', () => { close(); try { it.onClick && it.onClick(); } catch (err) { console.error(err); } });
  });
  setTimeout(() => { if (!el.isConnected) return; document.addEventListener('pointerdown', onDoc, true); document.addEventListener('keydown', onKey, true); window.addEventListener('resize', close); window.addEventListener('hashchange', close); }, 0);
  btns[0] && btns[0].focus({ preventScroll: true });
  return { close };
}

/** Danger dialog: the user must type `expected` before the confirm button unlocks. */
export function typeConfirm({ title, message, expected, confirmText = 'Delete' }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const m = modal({
      title,
      body: html`<p style="color:var(--text-2)">${message}</p><div class="alert warning">${ic('alert-triangle')}<div>Ketik <b class="mono">${expected}</b> untuk melanjutkan.</div></div><input class="input mono" id="tcInput" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${expected}" style="margin-top:12px">`,
      footer: html`<button class="btn" data-no>Batal</button><button class="btn danger" data-yes disabled>${confirmText}</button>`,
      onClose: () => done(false),
    });
    const inp = m.el.querySelector('#tcInput'), yes = m.el.querySelector('[data-yes]');
    inp.addEventListener('input', () => { yes.disabled = inp.value.trim() !== expected; });
    m.el.querySelector('[data-no]').addEventListener('click', () => m.close());
    yes.addEventListener('click', () => { if (inp.value.trim() === expected) { done(true); m.close(); } });
    setTimeout(() => inp.focus(), 50);
  });
}
