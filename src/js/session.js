// Connection lifecycle: connect, restore from the device vault, disconnect, and what happens when a token dies.
import { api, setToken, setTokenExpiry, holdExpiry, isTokenExpired, serverNow, withToken, ApiError } from './github-client.js';
import { state, emit } from './app-state.js';
import { saveToken, loadToken, clearToken } from './vault.js';
import { tokenMeta, expirySeen } from './store.js';

const TOKEN_FORMAT = /^[A-Za-z0-9_\-]{20,255}$/;

function apply(res) {
  state.connected = true;
  state.user = res.user;
  state.token = res.token;
  state.warnings = res.warnings || [];
  state.rateLimit = res.rateLimit || null;
  state.sessionEnded = null;
  setTokenExpiry(res.token.expiresAt || null);
  tokenMeta.set({ login: res.user.login, type: res.token.type, expiresAt: res.token.expiresAt || null });
  emit();
}

/** Validates the token with GitHub (via the API) and keeps it on this device only. */
export async function connect(rawToken, { remember = true } = {}) {
  const token = (rawToken || '').trim();
  if (!TOKEN_FORMAT.test(token)) throw new ApiError(401, 'That does not look like a GitHub token. Tokens start with "ghp_" or "github_pat_".', { code: 'invalid_token_format' });
  setToken(token);
  try {
    const res = await api.connect();
    if (res.token.expiresAt && Date.parse(res.token.expiresAt) <= serverNow()) {
      throw new ApiError(401, 'This token has already expired. Create or regenerate a token and paste the new one.', { code: 'token_expired' });
    }
    await saveToken(token, remember);
    state.repos = null;
    apply(res);
    return res;
  } catch (e) {
    setToken(null); setTokenExpiry(null);
    throw e;
  }
}

/** Re-validates the connection with the token already held (Test Connection / periodic refresh). */
export async function testConnection() {
  const res = await api.verify();
  apply(res);
  return res;
}

function endedNotice(reason, meta) {
  return { reason, login: meta.login || null, tokenType: meta.type || null, expiresAt: meta.expiresAt || null, at: new Date(serverNow()).toISOString() };
}

export async function restore() {
  const token = await loadToken();
  if (!token) return false;
  setToken(token);
  const meta = tokenMeta.get();
  try {
    apply(await api.verify());
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      // The saved token is dead. Wipe it, and remember WHY so the Connection page can explain.
      const expired = !!meta.expiresAt && Date.parse(meta.expiresAt) <= serverNow();
      await clearToken(); setToken(null); setTokenExpiry(null);
      state.sessionEnded = endedNotice(expired ? 'expired' : 'rejected', meta);
      tokenMeta.clear(); expirySeen.clear();
    } else if (e instanceof ApiError && e.status === 0) { setToken(token); throw e; }
    return false;
  }
}

/** Manual disconnect (notice = null) or forced end of session (notice = why). */
export async function disconnect({ notice = null } = {}) {
  try { await api.disconnect(); } catch { /* server keeps no state */ }
  await clearToken();
  setToken(null); setTokenExpiry(null);
  tokenMeta.clear();
  expirySeen.clear();
  state.connected = false; state.user = null; state.token = null; state.repos = null; state.warnings = [];
  state.sessionEnded = notice;
  state.selection = { repo: null, branch: null };
  emit();
}

/**
 * The token stopped working (GitHub answered 401, or its expiry date passed).
 * Returns the notice for the UI, or null when nothing ended.
 *
 *  - expiry date passed  → ask GitHub once. Still accepted? Then our clock/expiry was off: keep going and
 *                          re-check in a minute. Rejected → expired. Unreachable → keep going, re-check shortly.
 *  - plain 401           → revoked, deleted or expired: end the session.
 *  Ending the session ERASES the token from this device and sends the user to reconnect.
 */
let busy = false;
export async function resolveAuthLost() {
  if (!state.connected || busy) return null;
  busy = true;
  try {
    const meta = { login: state.user && state.user.login, type: state.token && state.token.type, expiresAt: state.token && state.token.expiresAt };
    const byClock = !!meta.expiresAt && Date.parse(meta.expiresAt) <= serverNow();
    if (byClock) {
      try {
        apply(await api.verify());            // GitHub still accepts it
        if (isTokenExpired()) holdExpiry(60000);
        return null;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) { holdExpiry(15000); return null; } // offline / GitHub hiccup
      }
    }
    const notice = endedNotice(byClock ? 'expired' : 'rejected', meta);
    await disconnect({ notice });
    return notice;
  } finally { busy = false; }
}

/** Validates a pasted token WITHOUT connecting or storing it. */
export async function probeToken(rawToken) {
  const token = (rawToken || '').trim();
  if (!TOKEN_FORMAT.test(token)) throw new ApiError(401, 'That does not look like a GitHub token. Tokens start with "ghp_" or "github_pat_".', { code: 'invalid_token_format' });
  return withToken(token, () => api.verify());
}
