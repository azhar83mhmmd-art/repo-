// Minimal hash router with lazy page modules.
const routes = new Map();
let current = null;
let onChange = () => {};

export function defineRoutes(map) { Object.entries(map).forEach(([k, v]) => routes.set(k, v)); }
export function onRoute(fn) { onChange = fn; }

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { path: path || 'overview', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function navigate(path, params) {
  const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const next = `#/${path}${qs}`;
  if (location.hash === next) handle(); else location.hash = next;
}

export async function handle() {
  const { path, params } = parseHash();
  const def = routes.get(path) || routes.get('overview');
  const name = routes.has(path) ? path : 'overview';
  if (current && current.cleanup) { try { current.cleanup(); } catch { /* ignore */ } }
  current = null;
  onChange(name, def, params);
}

export function setCleanup(fn) { current = { cleanup: fn }; }
export function start() { window.addEventListener('hashchange', handle); handle(); }
