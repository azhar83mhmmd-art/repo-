// Application shell: boot, routing, sidebar/topbar, theme, command palette.
import { icon } from './icons.js';
import { state, onState } from './app-state.js';
import { defineRoutes, onRoute, start, navigate, parseHash } from './router.js';
import { html, create, ic, mount, esc, avatarImg } from './ui/dom.js';
import { modal, popMenu } from './ui/overlay.js';
import { notify } from './notification.js';
import { prefs } from './store.js';
import { restore, disconnect, resolveAuthLost } from './session.js';
import { startExpiryWatch, refreshExpiryNow, longDate } from './token-expiry.js';
import { explain } from './github-client.js';
import { loadRepos } from './repos.js';

const PAGES = {
  overview:     { title: 'Overview',          group: 'Workspace',   icon: 'layout-dashboard', load: () => import('./pages/overview.js'),   auth: true },
  repositories: { title: 'Repositories',      group: 'Workspace',   icon: 'folder-git-2',     load: () => import('./repository-manager.js'), auth: true },
  upload:       { title: 'Upload ZIP',        group: 'Workspace',   icon: 'cloud-upload',     load: () => import('./upload-manager.js'),   auth: true },
  explorer:     { title: 'File Explorer',     group: 'Workspace',   icon: 'files',            load: () => import('./file-explorer.js'),    auth: true },
  history:      { title: 'Upload History',    group: 'Activity',    icon: 'history',          load: () => import('./pages/history.js'),    auth: false },
  commits:      { title: 'Recent Commits',    group: 'Activity',    icon: 'git-commit-horizontal', load: () => import('./pages/commits.js'), auth: true },
  connection:   { title: 'GitHub Connection', group: 'Preferences', icon: 'github',           load: () => import('./pages/connection.js'), auth: false },
  settings:     { title: 'Settings',          group: 'Preferences', icon: 'settings-2',       load: () => import('./settings.js'),         auth: false },
};

const $ = (s) => document.querySelector(s);
const view = () => $('#view');
let cleanup = null;
let renderToken = 0;

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((n) => { n.outerHTML = icon(n.dataset.icon); });
}

/* ---------- Theme ---------- */
function resolveTheme(t) { return t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t; }
export function applyTheme(t = prefs.get().theme) {
  document.documentElement.dataset.theme = resolveTheme(t);
  const light = resolveTheme(t) === 'light';
  $('#themeBtn').innerHTML = icon(light ? 'moon' : 'sun');
  $('#themeBtn').setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
  document.querySelector('meta[name=theme-color]').content = light ? '#F4F6FA' : '#090B10';
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => prefs.get().theme === 'system' && applyTheme());
window.addEventListener('repofast:theme', () => applyTheme());

/* ---------- Sidebar / topbar ---------- */
function renderSidebar() {
  const card = $('#connCard');
  const dc = $('#disconnectBtn');
  if (state.connected && state.user) {
    const exp = state.token && state.token.expiresAt
      ? `<span class="conn-exp" data-expiry-level title="Token expires ${esc(longDate(state.token.expiresAt))}">${icon('clock', 'sm')}<span class="mono" data-expiry-countdown></span></span>` : '';
    card.innerHTML = `${avatarImg(state.user, 64, 'avatar', 32)}
      <div class="conn-meta"><b>${esc(state.user.login)}</b><span class="conn-state"><i class="dot ok"></i>Connected</span>${exp}</div>`;
    refreshExpiryNow();
    dc.hidden = false;
  } else {
    card.innerHTML = `<span class="avatar" style="display:grid;place-items:center;color:var(--text-3)">${icon('github', 'sm')}</span>
      <div class="conn-meta"><b>Not connected</b><span class="conn-state"><i class="dot off"></i>GitHub</span></div>`;
    dc.hidden = true;
  }
  const u = $('#userBtn');
  u.innerHTML = state.connected && state.user ? String(avatarImg(state.user, 64, 'avatar', 34)) : `<span class="avatar" style="display:grid;place-items:center;color:var(--text-3)">${icon('github')}</span>`;
}

function renderCrumbs(name) {
  const p = PAGES[name];
  $('#crumbs').innerHTML = `<span>RepoFast</span>${icon('chevron-right')}<span>${esc(p.group)}</span>${icon('chevron-right')}<b>${esc(p.title)}</b>`;
  document.title = `${p.title} — RepoFast`;
  document.querySelectorAll('[data-route]').forEach((b) => b.classList.toggle('active', b.dataset.route === name));
}

function setDrawer(open) {
  const sb = $('#sidebar');
  sb.classList.toggle('open', open);
  $('#scrim').classList.toggle('show', open);
  document.body.style.overflow = open ? 'hidden' : '';
}

function setCollapsed(c) {
  $('#app').classList.toggle('collapsed', c);
  $('#collapseBtn').setAttribute('aria-label', c ? 'Expand sidebar' : 'Collapse sidebar');
  prefs.set({ sidebarCollapsed: c });
}

function userMenu() {
  const items = state.connected
    ? [{ label: 'GitHub Connection', icon: 'key-round', onClick: () => navigate('connection') },
       { label: 'Open GitHub profile', icon: 'arrow-up-right', href: state.user.htmlUrl },
       { label: 'Settings', icon: 'settings-2', onClick: () => navigate('settings') },
       'sep',
       { label: 'Disconnect', icon: 'log-out', danger: true, onClick: doDisconnect }]
    : [{ label: 'Connect GitHub', icon: 'github', onClick: () => navigate('connection') }];
  const header = state.connected ? html`<div class="menu-head">${avatarImg(state.user, 64)}<div><b>${state.user.login}</b><small>${state.user.type} · ${state.token.type} token</small></div></div><div class="menu-sep"></div>` : null;
  popMenu($('#userBtn'), items, { header });
}

async function doDisconnect() {
  await disconnect();
  notify.info('Disconnected', 'Your token was removed from this device.');
  navigate('connection');
}

/* ---------- Command palette ---------- */
function openPalette() {
  const all = Object.entries(PAGES).map(([k, p]) => ({ group: 'Go to', label: p.title, icon: p.icon, run: () => navigate(k) }));
  const m = modal({
    title: 'Search', dismissable: false,
    body: html`<div></div>`,
  });
  m.el.querySelector('.modal').classList.add('palette');
  const modalEl = m.el.querySelector('.modal');
  modalEl.innerHTML = `<div class="p-input">${icon('search')}<input type="text" placeholder="Search pages and repositories…" aria-label="Search" autocomplete="off" spellcheck="false"><kbd class="mono" style="font-size:11px;border:1px solid var(--border);border-radius:5px;padding:1px 6px">Esc</kbd></div><div class="palette-list"></div>`;
  const input = modalEl.querySelector('input');
  const list = modalEl.querySelector('.palette-list');
  let items = [...all]; let active = 0;
  const repoItems = () => (state.repos || []).map((r) => ({ group: 'Repositories', label: r.fullName, icon: r.private ? 'lock' : 'folder-git-2', run: () => { state.selection.repo = r.fullName; navigate('explorer', { repo: r.fullName }); } }));
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const pool = [...all, ...repoItems()];
    items = (q ? pool.filter((i) => i.label.toLowerCase().includes(q)) : pool).slice(0, 40);
    active = Math.min(active, Math.max(0, items.length - 1));
    let g = ''; let out = '';
    items.forEach((it, i) => {
      if (it.group !== g) { g = it.group; out += `<div class="palette-group">${esc(g)}</div>`; }
      out += `<div class="select-opt ${i === active ? 'active' : ''}" data-i="${i}">${icon(it.icon, 'sm')}<span class="o-main">${esc(it.label)}</span></div>`;
    });
    list.innerHTML = out || '<div class="select-empty">No results</div>';
    list.querySelectorAll('.select-opt').forEach((n) => n.addEventListener('click', () => { m.close(); items[Number(n.dataset.i)].run(); }));
  };
  input.addEventListener('input', draw);
  m.el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, items.length); draw(); list.querySelector('.active')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); draw(); list.querySelector('.active')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); m.close(); items[active].run(); }
    else if (e.key === 'Escape') { e.preventDefault(); m.close(); }
  });
  m.el.addEventListener('mousedown', (e) => { if (e.target === m.el) m.close(); });
  draw(); input.focus();
  if (state.connected && !state.repos) loadRepos().then(draw).catch(() => {});
}

/* ---------- Routing ---------- */
async function renderPage(name, def, params) {
  const my = ++renderToken;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  setDrawer(false);

  let effective = name;
  if (def.auth && !state.connected) effective = 'connection';
  const page = PAGES[effective];
  renderCrumbs(effective);

  const host = view();
  host.innerHTML = '<div class="page-loading"><div class="skeleton" style="height:32px;width:240px"></div><div class="skeleton" style="height:140px;margin-top:20px"></div></div>';
  host.style.animation = 'none'; void host.offsetWidth; host.style.animation = '';
  try {
    const mod = await page.load();
    if (my !== renderToken) return;
    host.innerHTML = '';
    const result = await mod.render(host, { params, navigate, state, redirected: effective !== name, from: name });
    if (my !== renderToken) { result && result.cleanup && result.cleanup(); return; }
    cleanup = result && result.cleanup ? result.cleanup : null;
  } catch (e) {
    console.error(e);
    host.innerHTML = `<div class="card"><div class="empty"><div class="e-icon">${icon('alert-circle', 'lg')}</div><h3>Something went wrong</h3><p>${esc(explain(e))}</p><button class="btn" id="retryPage">${icon('refresh-cw', 'sm')}Try again</button></div></div>`;
    host.querySelector('#retryPage').addEventListener('click', () => navigate(parseHash().path, parseHash().params));
  }
  window.scrollTo({ top: 0 });
}

/* ---------- Image fallbacks (avatar + logo) ---------- */
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.classList.contains('avatar')) {
    const f = document.createElement('span');
    f.className = img.className + ' fallback';
    f.textContent = (img.dataset.name || '?').trim().charAt(0).toUpperCase() || '?';
    img.replaceWith(f);
  } else if (img.closest('.brand-mark')) {
    img.replaceWith(Object.assign(document.createElement('span'), { className: 'brand-fallback', textContent: 'R' }));
  }
}, true);

/* ---------- Boot ---------- */
async function boot() {
  hydrateIcons();
  const p = prefs.get();
  applyTheme(p.theme);
  setCollapsed(p.sidebarCollapsed);

  document.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.route)));
  $('#collapseBtn').addEventListener('click', () => setCollapsed(!$('#app').classList.contains('collapsed')));
  $('#menuBtn').addEventListener('click', () => setDrawer(true));
  $('#scrim').addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });
  matchMedia('(min-width: 761px)').addEventListener('change', (e) => e.matches && setDrawer(false));
  $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('[data-route]')) setDrawer(false); });
  $('#themeBtn').addEventListener('click', () => {
    const next = resolveTheme(prefs.get().theme) === 'light' ? 'dark' : 'light';
    prefs.set({ theme: next }); applyTheme(next);
  });
  $('#searchBtn').addEventListener('click', openPalette);
  $('#searchBtn2').addEventListener('click', openPalette);
  $('#userBtn').addEventListener('click', userMenu);
  $('#disconnectBtn').addEventListener('click', doDisconnect);
  $('#connCard').addEventListener('click', () => navigate('connection'));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!document.querySelector('.modal-root')) openPalette(); }
  });

  onState(renderSidebar);
  renderSidebar();

  // The token stopped working (401 from GitHub, or its expiry date passed). resolveAuthLost() decides,
  // erases the token from this device when it is really dead, and tells us why.
  window.addEventListener('repofast:auth-lost', async () => {
    const notice = await resolveAuthLost();
    if (!notice) return;
    if (notice.reason === 'expired') notify.error('GitHub token expired', `It expired on ${longDate(notice.expiresAt)} and was removed from this device. Create or regenerate a token, then reconnect.`, { duration: 15000 });
    else notify.error('Session ended', 'GitHub rejected your token — it was revoked, deleted or has expired. Please connect again.', { duration: 12000 });
    navigate('connection');
  });
  startExpiryWatch();

  defineRoutes(PAGES);
  onRoute(renderPage);

  try { await restore(); } catch (e) { notify.warning('Offline', explain(e)); }
  renderSidebar();
  if (!location.hash) location.hash = state.connected ? '#/overview' : '#/connection';
  start();
}

boot();
