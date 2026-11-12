'use strict';
// POST /api/github/upload-blob — creates Git blobs for a bounded batch of files.
// body: { owner, repo, files: [{ path, content (base64) }] }
// The browser keeps each batch under ~3 MB so it fits Vercel's request body limit.
const { route } = require('../_lib/http');
const { mapLimit } = require('../_lib/github');
const v = require('../_lib/validate');

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const owner = v.assertOwner(ctx.body.owner);
  const repo = v.assertRepo(ctx.body.repo);
  const files = v.assertArray(ctx.body.files, 'files', v.LIMITS.MAX_BLOB_BATCH_FILES);

  let total = 0;
  for (const f of files) {
    v.normalizePath(f && f.path);
    if (typeof f.content !== 'string' || !B64.test(f.content)) {
      throw new v.HttpError(400, 'File content must be base64 encoded.', { code: 'invalid_content' });
    }
    total += f.content.length;
  }
  if (total > v.LIMITS.MAX_BLOB_BATCH_BYTES) {
    throw new v.HttpError(413, 'Upload exceeds the configured request size limit.', { code: 'batch_too_large' });
  }

  const blobs = await mapLimit(files, 4, async (f) => {
    const { data } = await ctx.gh('POST', `/repos/${owner}/${repo}/git/blobs`, {
      body: { content: f.content, encoding: 'base64' }, retry: true, timeout: 25000,
    });
    return { path: f.path, sha: data.sha };
  });
  return { blobs };
});
