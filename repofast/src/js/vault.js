// Device-only token vault.
// The GitHub token never goes to a database or cookie. When "remember on this device" is on, it is
// AES-GCM encrypted with a NON-EXTRACTABLE CryptoKey (kept in IndexedDB) so the raw token is never
// readable from storage. Otherwise it only lives in memory until the tab is closed.
// (Not localStorage, never in URLs or logs.)

const DB = 'repofast-vault';
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(out && out.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
const get = (k) => idb('readonly', (s) => s.get(k));
const put = (k, v) => idb('readwrite', (s) => s.put(v, k));
const del = (k) => idb('readwrite', (s) => s.delete(k));

let memoryToken = null;

export const vaultSupported = () => !!(window.indexedDB && window.crypto && crypto.subtle && window.isSecureContext);

export async function saveToken(token, remember) {
  memoryToken = token;
  if (!remember || !vaultSupported()) { await clearStored(); return false; }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  await put('key', key);
  await put('token', { iv, data, savedAt: Date.now() });
  return true;
}

export async function loadToken() {
  if (memoryToken) return memoryToken;
  if (!vaultSupported()) return null;
  try {
    const [key, rec] = await Promise.all([get('key'), get('token')]);
    if (!key || !rec) return null;
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.data);
    memoryToken = new TextDecoder().decode(buf);
    return memoryToken;
  } catch {
    await clearStored();
    return null;
  }
}

export async function hasStoredToken() {
  if (!vaultSupported()) return false;
  try { return !!(await get('token')); } catch { return false; }
}

async function clearStored() {
  try { await del('token'); await del('key'); } catch { /* storage unavailable */ }
}

export async function clearToken() {
  memoryToken = null;
  await clearStored();
}
