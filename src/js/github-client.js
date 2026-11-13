// Browser-side client. Talks to RepoFast's serverless API (which forwards to GitHub).
// The token is held in memory here and sent only in the Authorization header over HTTPS.

export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = extra.code || null;
    this.detail = extra.detail || null;
    this.rateLimit = extra.rateLimit || null;
  }
}

const FRIENDLY = {
  401: 'Your GitHub token is invalid or expired.',
  403: 'Your token does not have sufficient permissions.',
  404: 'Repository or branch not found.',
  409: 'Repository has changed. Please refresh and try again.',
  413: 'Upload exceeds the configured request size limit.',
  422: 'GitHub rejected the requested operation.',
  429: 'GitHub API rate limit reached. Please try again later.',
  500: 'An unexpected server error occurred.',
};

let token = null;
export const setToken = (t) => { token = t; };
export const hasToken = () => !!token;
/** Runs fn with a temporary token (used to test a token without connecting). */
export async function withToken(t, fn) { const prev = token; token = t; try { return await fn(); } finally { token = prev; } }

// Largest base64 payload that safely fits through the serverless function (Vercel limit ≈ 4.5 MB).
export const PROXY_MAX_B64 = 3.2 * 1024 * 1024;
export const DIRECT_MAX_BYTES = 100 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GH_DIRECT = 'https://api.github.com';

async function parseError(res) {
  let payload = null;
  try { payload = await res.json(); } catch { /* not JSON */ }
  const e = payload && payload.error;
  if (!e && res.status === 404) return new ApiError(404, 'Server API RepoFast tidak ditemukan (404 dari hosting, bukan dari GitHub). Folder api/ belum ter-deploy di Vercel — deploy ulang proyek lengkap (termasuk api/index.js dan vercel.json).', { code: 'api_missing' });
  return new ApiError(res.status, (e && e.message) || FRIENDLY[res.status] || 'Something went wrong.', {
    code: e && e.code, detail: e && e.detail, rateLimit: e && e.rateLimit,
  });
}

async function request(method, path, { query, body, signal, retries } = {}) {
  const url = new URL(`/api/${path}`, location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const attempts = retries ?? (method === 'GET' ? 3 : 1);

  for (let i = 1; i <= attempts; i++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(method !== 'GET' ? { 'X-RepoFast-Client': 'web' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'omit',
        cache: 'no-store',
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (i < attempts) { await sleep(400 * 2 ** (i - 1)); continue; }
      throw new ApiError(0, 'Cannot reach the RepoFast server. Check your connection and try again.', { code: 'network' });
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    const err = await parseError(res);
    if ([502, 503, 504].includes(res.status) && i < attempts) { await sleep(500 * 2 ** (i - 1)); continue; }
    if (res.status === 401 && err.code !== 'invalid_token_format') window.dispatchEvent(new CustomEvent('repofast:auth-lost'));
    throw err;
  }
}

const post = (p, body, o) => request('POST', p, { body, ...o });

export const api = {
  connect: () => post('auth/connect', {}),
  verify: () => request('GET', 'auth/verify'),
  disconnect: () => post('auth/disconnect', {}),

  repositories: (query) => request('GET', 'github/repositories', { query }),
  createRepository: (body) => post('github/create-repository', body),
  branches: (owner, repo) => request('GET', 'github/branches', { query: { owner, repo } }),
  list: (owner, repo, path, ref) => request('GET', 'github/repository-tree', { query: { owner, repo, path, ref } }),
  fullTree: (owner, repo, ref) => request('GET', 'github/repository-tree', { query: { owner, repo, ref, recursive: 1 } }),
  file: (owner, repo, path, ref) => request('GET', 'github/file-content', { query: { owner, repo, path, ref } }),
  commits: (owner, repo, branch, extra = {}) => request('GET', 'github/commits', { query: { owner, repo, branch, ...extra } }),

  updateFile: (body) => post('github/update-file', body),
  deleteFile: (body) => post('github/delete-file', body),
  renameFile: (body) => post('github/rename-file', body),
  deleteFolder: (body) => post('github/delete-folder', body),
  deletePath: (body) => post('github/delete-folder', body), // file or folder, one commit
  deleteRepository: (body) => post('github/delete-repository', body),

  createTree: (body) => post('github/create-tree', body),
  createCommit: (body) => post('github/create-commit', body),
  updateRef: (body) => post('github/update-reference', body),

  validateManifest: (body) => post('upload/validate-zip', body),
  checkConflicts: (body) => post('upload/process-zip', body),
  bulkUpload: (body) => post('upload/bulk-upload', body, { retries: 1 }),

  /** Creates blobs through the API proxy. files: [{path, content(base64)}] */
  blobs: (owner, repo, files, signal) => post('github/upload-blob', { owner, repo, files }, { signal }),

  /**
   * Files too large for one serverless request are sent straight from the browser to GitHub with the
   * same token. Nothing is stored; only the request path differs.
   */
  async blobDirect(owner, repo, base64, signal) {
    let res;
    try {
      res = await fetch(`${GH_DIRECT}/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST', signal,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ content: base64, encoding: 'base64' }),
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new ApiError(0, 'Could not reach GitHub directly. Check your connection and try again.', { code: 'network' });
    }
    if (!res.ok) {
      let p = null; try { p = await res.json(); } catch { /* ignore */ }
      const rl = res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');
      throw new ApiError(rl ? 429 : res.status, FRIENDLY[rl ? 429 : res.status] || 'GitHub rejected the requested operation.', { detail: p && p.message });
    }
    return (await res.json()).sha;
  },
};

/** Human-friendly message for any thrown error. */
export function explain(err) {
  if (err instanceof ApiError) return err.detail && err.status !== 401 ? `${err.message} (${err.detail})` : err.message;
  return err && err.message ? err.message : 'An unexpected error occurred.';
}
