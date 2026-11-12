'use strict';
// GET /api/github/file-content?owner&repo&path&ref → { content (base64), sha, size, ... }
const { route } = require('../_lib/http');
const v = require('../_lib/validate');
const { encodePath } = require('../_lib/github');

const MAX_INLINE = 3 * 1024 * 1024; // stay within Vercel's response size limit once base64-encoded

module.exports = route({ methods: ['GET'] }, async (ctx) => {
  const owner = v.assertOwner(ctx.query.owner);
  const repo = v.assertRepo(ctx.query.repo);
  const path = v.normalizePath(ctx.query.path);
  const ref = ctx.query.ref ? v.assertBranch(ctx.query.ref) : undefined;

  const { data } = await ctx.gh('GET', `/repos/${owner}/${repo}/contents/${encodePath(path)}`, { query: { ref } });
  if (Array.isArray(data) || data.type !== 'file') {
    throw new v.HttpError(400, 'Path is not a file.', { code: 'not_a_file' });
  }
  if (data.size > MAX_INLINE) {
    return { path: data.path, name: data.name, sha: data.sha, size: data.size, tooLarge: true, htmlUrl: data.html_url, downloadUrl: data.download_url };
  }
  let content = data.content;
  if (!content && data.size > 0) {
    const blob = await ctx.gh('GET', `/repos/${owner}/${repo}/git/blobs/${data.sha}`);
    content = blob.data.content;
  }
  return {
    path: data.path, name: data.name, sha: data.sha, size: data.size,
    content: (content || '').replace(/\n/g, ''), htmlUrl: data.html_url, downloadUrl: data.download_url, tooLarge: false,
  };
});
