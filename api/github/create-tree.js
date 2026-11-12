'use strict';
// POST /api/github/create-tree — one tree chunk (≤ 1000 entries). Chain chunks via base_tree.
const { route } = require('../_lib/http');
const v = require('../_lib/validate');

function toEntries(list, max = v.LIMITS.TREE_CHUNK) {
  return v.assertArray(list, 'entries', max).map((e) => ({
    path: v.normalizePath(e.path),
    mode: v.assertMode(e.mode),
    type: 'blob',
    sha: e.sha === null ? null : v.assertSha(e.sha, 'blob SHA'),
  }));
}

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const owner = v.assertOwner(ctx.body.owner);
  const repo = v.assertRepo(ctx.body.repo);
  const body = { tree: toEntries(ctx.body.entries) };
  if (ctx.body.baseTree) body.base_tree = v.assertSha(ctx.body.baseTree, 'base tree');
  const { data } = await ctx.gh('POST', `/repos/${owner}/${repo}/git/trees`, { body, retry: true });
  return { sha: data.sha };
});

module.exports.toEntries = toEntries;
