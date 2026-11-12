'use strict';
// POST /api/github/update-file — create or update ONE file via the Contents API.
// Updates must send the file's current `sha`, so concurrent edits are rejected (409) rather than overwritten.
// body: { owner, repo, path, content (base64), message, branch, sha? }
const { route } = require('../../http');
const v = require('../../validate');
const { encodePath } = require('../../github');

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const b = ctx.body;
  const owner = v.assertOwner(b.owner);
  const repo = v.assertRepo(b.repo);
  const path = v.normalizePath(b.path);
  if (typeof b.content !== 'string' || !B64.test(b.content)) throw new v.HttpError(400, 'File content must be base64 encoded.', { code: 'invalid_content' });
  if (b.content.length > v.LIMITS.MAX_BLOB_BATCH_BYTES) throw new v.HttpError(413, 'Upload exceeds the configured request size limit.', { code: 'too_large' });
  const body = {
    message: v.assertString(b.message, 'Commit message', { max: 2000 }),
    content: b.content,
  };
  if (b.branch) body.branch = v.assertBranch(b.branch);
  if (b.sha) body.sha = v.assertSha(b.sha, 'file SHA');
  const { data } = await ctx.gh('PUT', `/repos/${owner}/${repo}/contents/${encodePath(path)}`, { body, retry: false });
  return {
    file: { path: data.content.path, sha: data.content.sha, size: data.content.size, htmlUrl: data.content.html_url },
    commit: { sha: data.commit.sha, htmlUrl: data.commit.html_url },
  };
});
