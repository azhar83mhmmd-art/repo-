// Upload engine: ZIP entries → Git blobs → tree(s) → ONE commit → branch update.
// Pure logic (no DOM). Progress is reported from operations that have actually completed.
import { api, ApiError, PROXY_MAX_B64 } from './github-client.js';
import { readEntry, toBase64 } from './zip-manager.js';

export const MAX_DIRECT_BYTES = 50 * 1024 * 1024; // GitHub recommends staying below 50 MB per file
const CONCURRENCY = 3; // files in flight at once; each file is its own request so progress is reported per file
const TREE_CHUNK = 1000;

export class UploadCancelled extends Error { constructor() { super('Upload cancelled.'); this.name = 'UploadCancelled'; } }

async function retry(fn, signal, tries = 3) {
  let last;
  for (let i = 1; i <= tries; i++) {
    if (signal && signal.aborted) throw new UploadCancelled();
    try { return await fn(); }
    catch (e) {
      if (e && e.name === 'AbortError') throw new UploadCancelled();
      last = e;
      const transient = e instanceof ApiError && [0, 502, 503, 504].includes(e.status);
      if (!transient || i === tries) throw e;
      await new Promise((r) => setTimeout(r, 600 * 2 ** (i - 1)));
    }
  }
  throw last;
}

/** Splits files into proxy batches (bounded by request size) and "direct" large files. */
export function planBatches(files) {
  const batches = []; const direct = [];
  let cur = []; let curB64 = 0;
  for (const f of files) {
    const est = Math.ceil(f.size * 4 / 3) + 8;
    if (est > PROXY_MAX_B64 * 0.95) { direct.push(f); continue; }
    if (cur.length >= BATCH_FILES || curB64 + est > PROXY_MAX_B64 * 0.9) { batches.push(cur); cur = []; curB64 = 0; }
    cur.push(f); curB64 += est;
  }
  if (cur.length) batches.push(cur);
  return { batches, direct };
}

/**
 * files: [{ path (final repo path), size, entry (JSZip entry wrapper from zip-manager) }]
 * opts: { owner, repo, branch, baseBranch, createBranch, message, author, plan, signal, onProgress, onFile }
 * onFile({ path, size, status: 'reading'|'uploading'|'done'|'error'|'cancelled', error? }) fires for every file as it happens.
 * plan: result of api.checkConflicts for the branch we build on ({ empty, head, baseTree }).
 */
export async function runUpload(files, opts) {
  const { owner, repo, branch, createBranch, message, author, signal, onProgress, onFile } = opts;
  const fileEvt = (f, status, error) => { try { onFile && onFile({ path: f.path, size: f.size, status, error }); } catch { /* UI errors must not break the upload */ } };
  let { plan } = opts;
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const treeChunks = Math.ceil(files.length / TREE_CHUNK);
  const totalOps = 1 /* validate */ + files.length + treeChunks + 1 /* commit */ + 1 /* ref */;
  const st = { phase: 'validating', done: 0, totalOps, filesDone: 0, totalFiles: files.length, bytesDone: 0, totalBytes, current: '', commitsCreated: 1 };
  const emit = (patch = {}) => { Object.assign(st, patch); onProgress && onProgress({ ...st, percent: Math.round((st.done / st.totalOps) * 100) }); };
  const check = () => { if (signal && signal.aborted) throw new UploadCancelled(); };

  // 1) Server-side validation of the manifest (paths, sizes, duplicates)
  emit({ phase: 'validating', current: 'Checking paths and sizes' });
  const v = await retry(() => api.validateManifest({ files: files.map((f) => ({ path: f.path, size: f.size })) }), signal);
  if (v.rejected.length) throw new ApiError(400, `${v.rejected.length} file(s) were rejected: ${v.rejected.slice(0, 3).map((r) => `${r.path} (${r.reason})`).join(', ')}`, { code: 'rejected' });
  emit({ done: st.done + 1 });

  // Empty repositories cannot accept Git Database writes: seed the branch with the first file via the Contents API.
  let queue = files;
  if (plan.empty) {
    check();
    const first = files[0];
    emit({ phase: 'blobs', current: `Initialising empty repository with ${first.path}` });
    fileEvt(first, 'uploading');
    const bytes = await readEntry(first);
    try { await retry(() => api.updateFile({ owner, repo, path: first.path, content: toBase64(bytes), message, branch }), signal); }
    catch (e) { fileEvt(first, e instanceof UploadCancelled ? 'cancelled' : 'error', e); throw e; }
    fileEvt(first, 'done');
    st.commitsCreated = 2; st.done += 1; st.filesDone += 1; st.bytesDone += first.size;
    emit();
    queue = files.slice(1);
    plan = await api.checkConflicts({ owner, repo, branch, paths: [] });
    if (!queue.length) {
      emit({ phase: 'done', done: st.totalOps, current: '' });
      return { commitSha: plan.head, commitUrl: `https://github.com/${owner}/${repo}/commit/${plan.head}`, files: files.length, branch, commitsCreated: 1, treeChunks: 0, initialised: true };
    }
  }

  // 2) Blobs — one request per file so every file reports its own status in real time
  const blobs = new Map();
  emit({ phase: 'blobs', current: 'Uploading files' });

  const runFile = async (f) => {
    check();
    if (f.size > MAX_DIRECT_BYTES) {
      const err = new ApiError(413, `"${f.path}" is larger than 50 MB. Use Git LFS for files this large.`, { code: 'file_too_large' });
      fileEvt(f, 'error', err); throw err;
    }
    fileEvt(f, 'reading');
    emit({ current: f.path });
    try {
      const b64 = toBase64(await readEntry(f));
      check();
      fileEvt(f, 'uploading');
      let sha;
      if (Math.ceil(f.size * 4 / 3) + 8 > PROXY_MAX_B64 * 0.95) {
        sha = await retry(() => api.blobDirect(owner, repo, b64, signal), signal);
      } else {
        const res = await retry(() => api.blobs(owner, repo, [{ path: f.path, content: b64 }], signal), signal);
        sha = res.blobs[0].sha;
      }
      blobs.set(f.path, sha);
    } catch (e) {
      fileEvt(f, e instanceof UploadCancelled || (e && e.name === 'AbortError') ? 'cancelled' : 'error', e);
      throw e;
    }
    fileEvt(f, 'done');
    emit({ done: st.done + 1, filesDone: st.filesDone + 1, bytesDone: st.bytesDone + f.size, current: f.path });
  };

  let next = 0; let failure = null;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (!failure) {
      const i = next++; if (i >= queue.length) return;
      try { await runFile(queue[i]); } catch (e) { failure = failure || e; }
    }
  }));
  if (failure) throw failure;
  check();

  // 3) Tree(s) — chunked and chained through base_tree, still a single commit
  const entries = queue.map((f) => ({ path: f.path, sha: blobs.get(f.path), mode: '100644' }));
  let tree = plan.baseTree;
  emit({ phase: 'tree', current: 'Building Git tree' });
  for (let i = 0; i < entries.length; i += TREE_CHUNK) {
    check();
    const res = await retry(() => api.createTree({ owner, repo, baseTree: tree, entries: entries.slice(i, i + TREE_CHUNK) }), signal);
    tree = res.sha;
    emit({ done: st.done + 1, current: `Tree ${Math.floor(i / TREE_CHUNK) + 1} of ${Math.ceil(entries.length / TREE_CHUNK)}` });
  }
  st.done += Math.max(0, treeChunks - Math.ceil(entries.length / TREE_CHUNK)); // when the first file was used to seed an empty repo

  // 4) Commit — after this point cancelling is no longer offered
  check();
  emit({ phase: 'commit', current: 'Creating commit' });
  const commit = await retry(() => api.createCommit({ owner, repo, message, tree, parents: [plan.head], author }), signal, 2);
  emit({ done: st.done + 1 });

  // 5) Move the branch (fast-forward only; never force)
  emit({ phase: 'branch', current: createBranch ? `Creating branch ${branch}` : `Updating ${branch}` });
  await api.updateRef({ owner, repo, branch, sha: commit.sha, create: !!createBranch });
  emit({ phase: 'done', done: st.totalOps, current: '' });

  return { commitSha: commit.sha, commitUrl: commit.htmlUrl || `https://github.com/${owner}/${repo}/commit/${commit.sha}`, files: files.length, branch, commitsCreated: st.commitsCreated, treeChunks: Math.ceil(entries.length / TREE_CHUNK), initialised: !!opts.plan.empty };
}
