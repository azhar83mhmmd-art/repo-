// Connection lifecycle: connect, restore from the device vault, disconnect.
import { api, setToken, withToken, ApiError } from './github-client.js';
import { state, emit } from './app-state.js';
import { saveToken, loadToken, clearToken } from './vault.js';

const TOKEN_FORMAT = /^[A-Za-z0-9_\-]{20,255}$/;

function apply(res) {
  state.connected = true;
  state.user = res.user;
  state.token = res.token;
  state.warnings = res.warnings || [];
  state.rateLimit = res.rateLimit || null;
  emit();
}

/** Validates the token with GitHub (via the API) and keeps it on this device only. */
export async function connect(rawToken, { remember = true } = {}) {
  const token = (rawToken || '').trim();
  if (!TOKEN_FORMAT.test(token)) throw new ApiError(401, 'That does not look like a GitHub token. Tokens start with "ghp_" or "github_pat_".', { code: 'invalid_token_format' });
  setToken(token);
  try {
    const res = await api.connect();
    await saveToken(token, remember);
    state.repos = null;
    apply(res);
    return res;
  } catch (e) {
    setToken(null);
    throw e;
  }
}

/** Re-validates the connection with the token already held (Test Connection). */
export async function testConnection() {
  const res = await api.verify();
  apply(res);
  return res;
}

export async function restore() {
  const token = await loadToken();
  if (!token) return false;
  setToken(token);
  try {
    apply(await api.verify());
    return true;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401)) { await clearToken(); setToken(null); }
    else if (e instanceof ApiError && e.status === 0) { setToken(token); throw e; }
    return false;
  }
}

export async function disconnect() {
  try { await api.disconnect(); } catch { /* server keeps no state */ }
  await clearToken();
  setToken(null);
  state.connected = false; state.user = null; state.token = null; state.repos = null; state.warnings = [];
  state.selection = { repo: null, branch: null };
  emit();
}

/** Validates a pasted token WITHOUT connecting or storing it. */
export async function probeToken(rawToken) {
  const token = (rawToken || '').trim();
  if (!TOKEN_FORMAT.test(token)) throw new ApiError(401, 'That does not look like a GitHub token. Tokens start with "ghp_" or "github_pat_".', { code: 'invalid_token_format' });
  return withToken(token, () => api.verify());
}
