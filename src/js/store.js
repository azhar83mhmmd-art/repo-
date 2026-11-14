// Non-sensitive local state: preferences and upload history. Never contains tokens or file contents.
const PREFS_KEY = 'repofast.prefs.v1';
const HISTORY_KEY = 'repofast.history.v1';
const LAST_KEY = 'repofast.last.v1';
const TOKEN_META_KEY = 'repofast.tokenmeta.v1';
const EXPIRY_SEEN_KEY = 'repofast.expiry-seen.v1';

export const DEFAULT_PREFS = Object.freeze({
  theme: 'dark',
  commitMessage: 'Upload project via RepoFast',
  structure: 'preserve',      // preserve | strip-root | custom
  conflict: 'replace',        // replace | skip | cancel
  branchBehavior: 'default',  // default | last
  maxUploadMB: 100,
  ignoreSystemFiles: true,
  sidebarCollapsed: false,
  rememberToken: true,
});

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const prefs = {
  get() { return { ...DEFAULT_PREFS, ...read(PREFS_KEY, {}) }; },
  set(patch) { const next = { ...this.get(), ...patch }; write(PREFS_KEY, next); return next; },
  reset() { try { localStorage.removeItem(PREFS_KEY); } catch { /* ignore */ } },
};

export const history = {
  all() { return read(HISTORY_KEY, []); },
  add(entry) {
    const list = this.all();
    list.unshift({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), at: new Date().toISOString(), ...entry });
    write(HISTORY_KEY, list.slice(0, 300));
  },
  clear() { try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ } },
};

export const last = {
  get() { return read(LAST_KEY, {}); },
  set(patch) { write(LAST_KEY, { ...this.get(), ...patch }); },
};

/** Non-secret facts about the last connected token (login + expiry date) so we can explain what happened after a restart. */
export const tokenMeta = {
  get() { return read(TOKEN_META_KEY, {}); },
  set(meta) { write(TOKEN_META_KEY, meta); },
  clear() { try { localStorage.removeItem(TOKEN_META_KEY); } catch { /* ignore */ } },
};

/** Which expiry warnings (7d, 1d, …) were already shown for a given expiry date, so each is shown once. */
export const expirySeen = {
  get(expiresAt) { const v = read(EXPIRY_SEEN_KEY, null); return v && v.expiresAt === expiresAt && Array.isArray(v.ids) ? v.ids : []; },
  add(expiresAt, ids) { write(EXPIRY_SEEN_KEY, { expiresAt, ids: [...new Set([...this.get(expiresAt), ...ids])] }); },
  clear() { try { localStorage.removeItem(EXPIRY_SEEN_KEY); } catch { /* ignore */ } },
};
