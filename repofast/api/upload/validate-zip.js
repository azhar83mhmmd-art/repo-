'use strict';
// POST /api/upload/validate-zip — server-side validation of the manifest the browser extracted
// from the ZIP (paths + sizes only; no file bytes). Rejects unsafe paths, duplicates and oversize files.
// body: { files: [{ path, size }], destination?, stripRoot? }
const { route } = require('../_lib/http');
const v = require('../_lib/validate');

module.exports = route({ methods: ['POST'], auth: false }, async (ctx) => {
  const files = v.assertArray(ctx.body.files, 'files', v.LIMITS.MAX_FILES);
  const dest = v.normalizePath(ctx.body.destination || '', { allowRoot: true });
  const accepted = [];
  const rejected = [];
  const warnings = [];
  const seen = new Set();
  let total = 0;

  for (const f of files) {
    const size = Number(f && f.size);
    if (!Number.isFinite(size) || size < 0) { rejected.push({ path: String(f && f.path), reason: 'Invalid size' }); continue; }
    let p;
    try {
      p = v.normalizePath(dest ? `${dest}/${f.path}` : f.path);
    } catch (e) {
      rejected.push({ path: String(f && f.path).slice(0, 200), reason: e.message });
      continue;
    }
    if (size > v.LIMITS.MAX_FILE_BYTES) { rejected.push({ path: p, reason: 'Larger than GitHub\'s 100 MB file limit' }); continue; }
    if (seen.has(p.toLowerCase())) { rejected.push({ path: p, reason: 'Duplicate path' }); continue; }
    seen.add(p.toLowerCase());
    if (size > v.LIMITS.WARN_FILE_BYTES) warnings.push(`${p} is over 50 MB; GitHub recommends Git LFS for large files.`);
    total += size;
    accepted.push({ path: p, size });
  }
  if (total > v.LIMITS.MAX_TOTAL_BYTES) throw new v.HttpError(413, 'Upload exceeds the configured request size limit.', { code: 'too_large' });
  return { accepted, rejected, warnings: warnings.slice(0, 20), totalBytes: total, fileCount: accepted.length };
});
