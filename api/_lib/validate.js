'use strict';
// Input validation helpers shared by every endpoint.
// Nothing here touches the network.

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = extra.code || null;
    this.detail = extra.detail || null;
    this.rateLimit = extra.rateLimit || null;
  }
}

const LIMITS = Object.freeze({
  MAX_PATH_LENGTH: 1024,
  MAX_SEGMENT_LENGTH: 255,
  MAX_FILES: 10000,
  MAX_TOTAL_BYTES: 1024 * 1024 * 1024, // 1 GB manifest sanity cap
  MAX_FILE_BYTES: 100 * 1024 * 1024, // GitHub rejects blobs over 100 MB
  WARN_FILE_BYTES: 50 * 1024 * 1024, // GitHub warns over 50 MB
  MAX_BLOB_BATCH_BYTES: 3.2 * 1024 * 1024, // keep requests under Vercel's 4.5 MB body limit
  MAX_BLOB_BATCH_FILES: 40,
  TREE_CHUNK: 1000,
});

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const MODES = new Set(['100644', '100755', '040000', '160000', '120000']);

function assertOwner(value) {
  if (typeof value !== 'string' || !OWNER_RE.test(value)) {
    throw new HttpError(400, 'Invalid repository owner.', { code: 'invalid_owner' });
  }
  return value;
}

function assertRepo(value) {
  if (typeof value !== 'string' || !REPO_RE.test(value) || value === '.' || value === '..') {
    throw new HttpError(400, 'Invalid repository name.', { code: 'invalid_repo' });
  }
  return value;
}

function assertSha(value, label = 'SHA') {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new HttpError(400, `Invalid ${label}.`, { code: 'invalid_sha' });
  }
  return value.toLowerCase();
}

function assertBranch(value) {
  const bad =
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 244 ||
    /[\x00-\x20~^:?*[\\\x7f]/.test(value) ||
    value.includes('..') ||
    value.includes('@{') ||
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.endsWith('.lock') ||
    value.includes('//') ||
    value === '@';
  if (bad) throw new HttpError(400, 'Invalid branch name.', { code: 'invalid_branch' });
  return value;
}

/**
 * Normalises a repository-relative path and rejects anything that could escape it
 * (ZIP Slip / path traversal) or touch Git internals.
 * Returns '' for the repository root when allowRoot is true.
 */
function normalizePath(input, { allowRoot = false } = {}) {
  if (typeof input !== 'string') throw new HttpError(400, 'Path must be a string.', { code: 'invalid_path' });
  if (input.includes('\0')) throw new HttpError(400, 'Path contains invalid characters.', { code: 'invalid_path' });

  let p = input.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(p)) throw new HttpError(400, 'Absolute paths are not allowed.', { code: 'invalid_path' });
  p = p.replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '');

  if (p === '') {
    if (allowRoot) return '';
    throw new HttpError(400, 'Path is empty.', { code: 'invalid_path' });
  }
  if (p.length > LIMITS.MAX_PATH_LENGTH) {
    throw new HttpError(400, 'Path is too long.', { code: 'invalid_path' });
  }
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new HttpError(400, `Unsafe path rejected: ${truncate(input)}`, { code: 'path_traversal' });
    }
    if (seg.length > LIMITS.MAX_SEGMENT_LENGTH) {
      throw new HttpError(400, 'A path segment is too long.', { code: 'invalid_path' });
    }
    if (seg.toLowerCase() === '.git') {
      throw new HttpError(400, 'Paths inside .git are not allowed.', { code: 'invalid_path' });
    }
    if (/[\x00-\x1f\x7f]/.test(seg)) {
      throw new HttpError(400, 'Path contains control characters.', { code: 'invalid_path' });
    }
  }
  return p;
}

function assertMode(value) {
  const mode = value || '100644';
  if (!MODES.has(mode)) throw new HttpError(400, 'Invalid file mode.', { code: 'invalid_mode' });
  return mode;
}

function assertString(value, label, { max = 5000, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${label} is required.`, { code: 'missing_field' });
    return '';
  }
  if (typeof value !== 'string' || value.length > max) {
    throw new HttpError(400, `${label} is invalid.`, { code: 'invalid_field' });
  }
  return value;
}

function assertArray(value, label, max) {
  if (!Array.isArray(value)) throw new HttpError(400, `${label} must be a list.`, { code: 'invalid_field' });
  if (value.length > max) throw new HttpError(413, `${label} has too many items.`, { code: 'too_many_items' });
  return value;
}

function truncate(s, n = 80) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

module.exports = {
  HttpError,
  LIMITS,
  assertOwner,
  assertRepo,
  assertSha,
  assertBranch,
  assertMode,
  assertString,
  assertArray,
  normalizePath,
};
