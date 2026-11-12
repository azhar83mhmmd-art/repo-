// Custom select dropdown — a fully styled replacement for the native <select>.
// Keyboard accessible (↑ ↓ Enter Esc Home End, type-ahead), optional search, icons and sublabels.
// The menu is positioned with `position: fixed` so it is never clipped by modals or scroll areas.
import { html, create, ic, esc, raw } from './dom.js';

let uid = 0;
let openInstance = null;

export class Select {
  /**
   * opts: { options: [{value,label,sub?,icon?,disabled?}], value, placeholder, icon, searchable, size, onChange, ariaLabel, emptyText }
   */
  constructor(opts) {
    this.opts = { options: [], placeholder: 'Select…', emptyText: 'No results', ...opts };
    this.value = opts.value ?? null;
    this.id = `sel-${++uid}`;
    this.active = -1;
    this.query = '';
    this.el = create(html`
      <div class="select ${opts.size || ''}">
        <button type="button" class="select-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${this.id}-list" ${opts.ariaLabel ? raw(`aria-label="${esc(opts.ariaLabel)}"`) : ''}>
          ${opts.icon ? html`<span class="s-icon">${ic(opts.icon)}</span>` : ''}
          <span class="select-value"></span>
          <span class="select-chev">${ic('chevron-down', 'sm')}</span>
        </button>
      </div>`);
    this.btn = this.el.querySelector('.select-btn');
    this.valueEl = this.el.querySelector('.select-value');
    this.btn.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.btn.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && !this.isOpen) { e.preventDefault(); this.open(); }
    });
    this.render();
  }

  get isOpen() { return !!this.menu; }

  setOptions(options, value) {
    this.opts.options = options;
    if (value !== undefined) this.value = value;
    else if (!options.some((o) => o.value === this.value)) this.value = null;
    this.render();
  }
  setValue(v, silent = true) { this.value = v; this.render(); if (!silent) this.opts.onChange?.(v, this.current()); }
  setDisabled(d) { this.el.dataset.disabled = d ? 'true' : 'false'; this.btn.disabled = !!d; }
  current() { return this.opts.options.find((o) => o.value === this.value) || null; }

  render() {
    const cur = this.current();
    if (cur) {
      this.valueEl.classList.remove('placeholder');
      this.valueEl.innerHTML = `${esc(cur.label)}${cur.sub ? `<small>${esc(cur.sub)}</small>` : ''}`;
    } else {
      this.valueEl.classList.add('placeholder');
      this.valueEl.textContent = this.opts.placeholder;
    }
  }

  filtered() {
    const q = this.query.trim().toLowerCase();
    return q ? this.opts.options.filter((o) => (o.label + ' ' + (o.sub || '')).toLowerCase().includes(q)) : this.opts.options;
  }

  open() {
    if (openInstance && openInstance !== this) openInstance.close();
    if (this.isOpen || this.el.dataset.disabled === 'true') return;
    openInstance = this;
    this.query = '';
    const searchable = this.opts.searchable ?? this.opts.options.length > 8;
    this.menu = create(html`
      <div class="select-menu" role="presentation">
        ${searchable ? html`<div class="select-search">${ic('search', 'sm')}<input type="text" placeholder="Search…" aria-label="Search options" autocomplete="off" spellcheck="false"></div>` : ''}
        <div class="select-list" id="${this.id}-list" role="listbox" tabindex="-1"></div>
      </div>`);
    this.list = this.menu.querySelector('.select-list');
    this.search = this.menu.querySelector('input');
    document.body.appendChild(this.menu);
    this.btn.setAttribute('aria-expanded', 'true');
    this.el.classList.add('open');
    this.renderList();
    this.position();

    const idx = this.filtered().findIndex((o) => o.value === this.value);
    this.setActive(idx >= 0 ? idx : this.filtered().findIndex((o) => !o.disabled), true);

    this.onDoc = (e) => { if (!this.menu.contains(e.target) && !this.el.contains(e.target)) this.close(); };
    this.onKey = (e) => this.keydown(e);
    this.onWin = () => this.position();
    document.addEventListener('pointerdown', this.onDoc, true);
    document.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onWin);
    window.addEventListener('scroll', this.onWin, true);
    if (this.search) { this.search.addEventListener('input', () => { this.query = this.search.value; this.renderList(); this.setActive(this.filtered().findIndex((o) => !o.disabled), true); }); this.search.focus(); }
    else this.list.focus();
  }

  renderList() {
    const items = this.filtered();
    if (!items.length) { this.list.innerHTML = `<div class="select-empty">${esc(this.opts.emptyText)}</div>`; return; }
    this.list.innerHTML = items.map((o, i) => `
      <div class="select-opt ${o.value === this.value ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}" role="option" id="${this.id}-o${i}" data-i="${i}" aria-selected="${o.value === this.value}">
        ${o.icon ? ic(o.icon, 'sm') : ''}
        <span class="o-main">${esc(o.label)}${o.sub ? ` <span class="o-sub">${esc(o.sub)}</span>` : ''}</span>
        <span class="o-check">${ic('check', 'sm')}</span>
      </div>`).join('');
    this.list.querySelectorAll('.select-opt').forEach((n) => {
      n.addEventListener('click', () => this.choose(Number(n.dataset.i)));
      n.addEventListener('pointermove', () => this.setActive(Number(n.dataset.i), false, true));
    });
  }

  position() {
    if (!this.menu) return;
    const r = this.btn.getBoundingClientRect();
    const m = this.menu;
    m.style.minWidth = `${r.width}px`;
    m.style.maxWidth = `${Math.max(r.width, 360)}px`;
    m.style.left = `${Math.min(r.left, window.innerWidth - m.offsetWidth - 8)}px`;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const h = Math.min(320, m.scrollHeight);
    if (below < h && above > below) { m.style.top = 'auto'; m.style.bottom = `${window.innerHeight - r.top + 6}px`; m.style.maxHeight = `${Math.min(320, above)}px`; m.style.transformOrigin = 'bottom'; }
    else { m.style.bottom = 'auto'; m.style.top = `${r.bottom + 6}px`; m.style.maxHeight = `${Math.min(320, below)}px`; m.style.transformOrigin = 'top'; }
  }

  setActive(i, scroll = true, hover = false) {
    const nodes = this.list.querySelectorAll('.select-opt');
    nodes.forEach((n) => n.classList.remove('active'));
    this.active = i;
    const n = nodes[i];
    if (n) { n.classList.add('active'); (this.search || this.list).setAttribute('aria-activedescendant', n.id); if (scroll && !hover) n.scrollIntoView({ block: 'nearest' }); }
  }

  keydown(e) {
    const items = this.filtered();
    const step = (dir) => {
      if (!items.length) return;
      let i = this.active;
      for (let k = 0; k < items.length; k++) { i = (i + dir + items.length) % items.length; if (!items[i].disabled) break; }
      this.setActive(i);
    };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); step(1); break;
      case 'ArrowUp': e.preventDefault(); step(-1); break;
      case 'Home': e.preventDefault(); this.setActive(items.findIndex((o) => !o.disabled)); break;
      case 'End': e.preventDefault(); this.setActive(items.length - 1 - [...items].reverse().findIndex((o) => !o.disabled)); break;
      case 'Enter': e.preventDefault(); if (this.active >= 0) this.choose(this.active); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); this.close(true); break;
      case 'Tab': this.close(); break;
      default:
        if (!this.search && e.key.length === 1 && /\S/.test(e.key)) {
          const j = items.findIndex((o, i) => i > this.active && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
          const k = j >= 0 ? j : items.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
          if (k >= 0) this.setActive(k);
        }
    }
  }

  choose(i) {
    const o = this.filtered()[i];
    if (!o || o.disabled) return;
    const changed = o.value !== this.value;
    this.value = o.value;
    this.render();
    this.close(true);
    if (changed) this.opts.onChange?.(o.value, o);
  }

  close(refocus = false) {
    if (!this.menu) return;
    document.removeEventListener('pointerdown', this.onDoc, true);
    document.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onWin);
    window.removeEventListener('scroll', this.onWin, true);
    this.menu.remove(); this.menu = null;
    this.el.classList.remove('open');
    this.btn.setAttribute('aria-expanded', 'false');
    if (openInstance === this) openInstance = null;
    if (refocus) this.btn.focus();
  }

  destroy() { this.close(); }
}

/** Replaces every <div data-select="name"> placeholder inside `root` with a Select; returns a map. */
export function select(opts) { return new Select(opts); }
