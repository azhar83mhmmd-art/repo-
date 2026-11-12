'use strict';
// POST /api/upload/process-zip — compares the planned paths with the repository's current tree
// so the browser can show conflicts BEFORE anything is uploaded.
// body: { owner, repo, branch, paths: [string] } → { existing: [path], head }
const { route } = require('../_lib/http');
const v = require('../_lib/validate');
const flow = require('../_lib/commit-flow');

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const owner = v.assertOwner(ctx.body.owner);
  const repo = v.assertRepo(ctx.body.repo);
  const branch = v.assertBranch(ctx.body.branch);
  const paths = v.assertArray(ctx.body.paths, 'paths', v.LIMITS.MAX_FILES).map((p) => v.normalizePath(p));

  const head = await flow.getBranchHead(ctx, owner, repo, branch);
  if (!head) return { empty: true, existing: [], head: null, baseTree: null, truncated: false };

  const { data: tree } = await ctx.gh('GET', `/repos/${owner}/${repo}/git/trees/${head}`, { query: { recursive: 1 } });
  const index = new Map();
  for (const t of tree.tree) if (t.type === 'blob') index.set(t.path, t.sha);
  const existing = paths.filter((p) => index.has(p)).map((p) => ({ path: p, sha: index.get(p) }));
  return { empty: false, head, baseTree: tree.sha, existing, truncated: !!tree.truncated };
});
