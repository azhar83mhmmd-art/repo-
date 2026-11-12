// ZIP reading in the browser (JSZip). Nothing is uploaded to RepoFast; the ZIP is processed in memory.
// Protections: ZIP Slip / path traversal, absolute paths, .git folders, system metadata,
// decompression-bomb limits (declared sizes are checked BEFORE any file is inflated), and corrupt archives.

export const LIMITS = Object.freeze({
  MAX_FILES: 5000,
  MAX_TOTAL_UNCOMPRESSED: 1024 * 1024 * 1024, // 1 GB
  MAX_FILE_BYTES: 100 * 1024 * 1024,          // GitHub's hard blob limit
  WARN_FILE_BYTES: 50 * 1024 * 1024,
  MAX_RATIO: 1000,                            // suspicious compression ratio
});

const SYSTEM_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\.Spotlight-V100|\.Trashes)(\/|$)/i;
let jszipPromise = null;

function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/jszip.min.js';
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => reject(new Error('Could not load the ZIP library.'));
      document.head.appendChild(s);
    });
  }
  return jszipPromise;
}

export class ZipError extends Error {}

/** Returns a safe relative path or null when the entry must be rejected. */
export function sanitizeEntryPath(name) {
  if (typeof name !== 'string' || name.includes('\0')) return null;
  let p = name.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(p) || p.startsWith('/')) return null;   // absolute
  const parts = p.split('/').filter((s) => s !== '' && s !== '.');
  if (!parts.length) return null;
  for (const seg of parts) {
    if (seg === '..') return null;                               // ZIP Slip
    if (seg.toLowerCase() === '.git') return null;
    if (/[\x00-\x1f\x7f]/.test(seg)) return null;
    if (seg.length > 255) return null;
  }
  const out = parts.join('/');
  return out.length > 1000 ? null : out;
}

/**
 * Reads the ZIP central directory (no file is inflated yet) and returns a manifest.
 * Throws ZipError with a friendly message for invalid, empty or oversized archives.
 */
export async function readZip(file, { ignoreSystem = true, maxBytes } = {}) {
  const JSZip = await loadJSZip();
  const limit = maxBytes || LIMITS.MAX_TOTAL_UNCOMPRESSED;
  if (!/\.zip$/i.test(file.name)) throw new ZipError('Please choose a .zip file.');
  if (file.size === 0) throw new ZipError('This ZIP file is empty.');

  let zip;
  try { zip = await JSZip.loadAsync(file); }
  catch { throw new ZipError('This ZIP file is invalid or corrupted.'); }

  const entries = [];
  const skipped = { system: 0, unsafe: 0, git: 0 };
  const folders = new Set();
  let total = 0;

  zip.forEach((name, entry) => {
    const clean = sanitizeEntryPath(name);
    if (entry.dir) { if (clean) folders.add(clean.replace(/\/$/, '')); else if (/(^|[\\/])\.git([\\/]|$)/i.test(name)) skipped.git++; else skipped.unsafe++; return; }
    if (!clean) { if (/(^|[\\/])\.git([\\/]|$)/i.test(name)) skipped.git++; else skipped.unsafe++; return; }
    if (ignoreSystem && SYSTEM_RE.test(clean)) { skipped.system++; return; }
    const size = entry._data && typeof entry._data.uncompressedSize === 'number' ? entry._data.uncompressedSize : 0;
    const csize = entry._data && typeof entry._data.compressedSize === 'number' ? entry._data.compressedSize : 0;
    entries.push({ path: clean, size, csize, entry });
  });

  if (!entries.length) throw new ZipError('This ZIP does not contain any files.');
  if (entries.length > LIMITS.MAX_FILES) throw new ZipError(`This ZIP has ${entries.length.toLocaleString()} files. The limit is ${LIMITS.MAX_FILES.toLocaleString()} files per upload.`);

  for (const e of entries) {
    total += e.size;
    if (e.csize > 0 && e.size / e.csize > LIMITS.MAX_RATIO && e.size > 10 * 1024 * 1024) throw new ZipError(`"${e.path}" has a suspicious compression ratio and was blocked.`);
  }
  if (total > limit) throw new ZipError(`The extracted size (${Math.round(total / 1048576)} MB) is over the ${Math.round(limit / 1048576)} MB limit.`);

  // Duplicate paths (case-insensitive) would collide in Git on case-insensitive checkouts: keep the first.
  const seen = new Set(); const duplicates = []; const unique = [];
  for (const e of entries) { const k = e.path.toLowerCase(); if (seen.has(k)) { duplicates.push(e.path); continue; } seen.add(k); unique.push(e); }

  // Folders implied by file paths
  for (const e of unique) { const parts = e.path.split('/'); for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/')); }

  // Detect a single wrapping root folder
  const roots = new Set(unique.map((e) => e.path.split('/')[0]));
  const allNested = unique.every((e) => e.path.includes('/'));
  const rootFolder = allNested && roots.size === 1 ? [...roots][0] : null;

  unique.sort((a, b) => a.path.localeCompare(b.path));
  return {
    name: file.name, size: file.size, files: unique, folders: [...folders].sort(),
    totalBytes: unique.reduce((n, e) => n + e.size, 0), rootFolder, skipped, duplicates, zip,
  };
}

/** Reads one entry's bytes (inflates it). */
export async function readEntry(e) { return e.entry.async('uint8array'); }

/** Base64 for any bytes without blowing the call stack. */
export function toBase64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

/** Builds the nested tree used by the preview. */
export function buildTree(files) {
  const root = { name: '', path: '', type: 'dir', children: new Map() };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');
      if (!node.children.has(part)) node.children.set(part, isFile ? { name: part, path, type: 'file', size: f.size } : { name: part, path, type: 'dir', children: new Map() });
      node = node.children.get(part);
    });
  }
  return root;
}

/** Applies the structure option and destination to a list of ZIP-relative paths. */
export function resolvePath(zipPath, { structure, rootFolder, destination }) {
  let p = zipPath;
  if (structure === 'strip-root' && rootFolder && p.startsWith(rootFolder + '/')) p = p.slice(rootFolder.length + 1);
  const dest = (destination || '').replace(/^\/+|\/+$/g, '');
  return dest ? `${dest}/${p}` : p;
}
