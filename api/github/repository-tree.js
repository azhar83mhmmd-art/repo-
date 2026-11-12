'use strict';
// GET /api/github/repository-tree
//   ?owner&repo&ref&path          → one directory level (lazy browsing, via the Contents API)
//   ?owner&repo&ref&recursive=1   → whole Git tree (used for conflict detection)
const { route } = require('../_lib/http');
const v = require('../_lib/validate');
const { encodePath } = require('../_lib/github');

module.exports = route({ methods: ['GET'] }, async (ctx) => {
  const owner = v.assertOwner(ctx.query.owner);
  const repo = v.assertRepo(ctx.query.repo);
  const ref = ctx.query.ref ? v.assertBranch(ctx.query.ref) : undefined;

  if (ctx.query.recursive === '1') {
    let sha = ref;
    if (!sha) {
      const { data } = await ctx.gh('GET', `/repos/${owner}/${repo}`);
      sha = data.default_branch;
    }
    let tree;
    try {
      ({ data: tree } = await ctx.gh('GET', `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(sha)}`, { query: { recursive: 1 } }));
    } catch (e) {
      if (e.code === 'empty_repository') return { entries: [], truncated: false, empty: true };
      throw e;
    }
    return {
      sha: tree.sha,
      truncated: !!tree.truncated,
      entries: tree.tree.map((t) => ({ path: t.path, type: t.type, sha: t.sha, size: t.size ?? null, mode: t.mode })),
    };
  }

  const path = v.normalizePath(ctx.query.path || '', { allowRoot: true });
  let data;
  try {
    ({ data } = await ctx.gh('GET', `/repos/${owner}/${repo}/contents/${encodePath(path)}`, { query: { ref } }));
  } catch (e) {
    if (e.status === 404 && path === '') return { path, entries: [], empty: true };
    if (e.status === 404 && /empty/i.test(String(e.detail))) return { path, entries: [], empty: true };
    throw e;
  }
  if (!Array.isArray(data)) throw new v.HttpError(400, 'Path is a file, not a folder.', { code: 'not_a_directory' });

  const entries = data
    .map((e) => ({
      name: e.name, path: e.path, type: e.type === 'dir' ? 'dir' : e.type === 'file' ? 'file' : e.type,
      size: e.size, sha: e.sha, htmlUrl: e.html_url, downloadUrl: e.download_url || null,
    }))
    .sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));
  return { path, entries };
});
