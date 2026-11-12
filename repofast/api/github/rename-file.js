'use strict';
// POST /api/github/rename-file — moves a file in ONE commit by deleting the old tree entry and
// adding the same blob under the new path (no content is re-uploaded).
// body: { owner, repo, branch, from, to, sha, mode?, message? }
const { route } = require('../_lib/http');
const v = require('../_lib/validate');
const flow = require('../_lib/commit-flow');

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const b = ctx.body;
  const owner = v.assertOwner(b.owner);
  const repo = v.assertRepo(b.repo);
  const branch = v.assertBranch(b.branch);
  const from = v.normalizePath(b.from);
  const to = v.normalizePath(b.to);
  const sha = v.assertSha(b.sha, 'file SHA');
  if (from === to) throw new v.HttpError(400, 'The new name is the same as the old one.', { code: 'same_path' });

  const head = await flow.getBranchHead(ctx, owner, repo, branch);
  if (!head) throw new v.HttpError(404, 'Repository or branch not found.', { code: 'not_found' });

  const { data: tree } = await ctx.gh('GET', `/repos/${owner}/${repo}/git/trees/${head}`, { query: { recursive: 1 } });
  const current = tree.tree.find((t) => t.path === from && t.type === 'blob');
  if (!current || current.sha !== sha) throw new v.HttpError(409, 'Repository has changed. Please refresh and try again.', { code: 'file_changed' });
  if (tree.tree.some((t) => t.path === to)) throw new v.HttpError(409, `"${to}" already exists.`, { code: 'target_exists' });

  const result = await flow.commitEntries(ctx, {
    owner, repo, parentSha: head,
    entries: [{ path: from, sha: null, mode: current.mode }, { path: to, sha, mode: current.mode }],
    message: v.assertString(b.message || `Rename ${from} to ${to} via RepoFast`, 'Commit message', { max: 2000 }),
  });
  await flow.moveBranch(ctx, { owner, repo, branch, sha: result.commitSha });
  return { commit: { sha: result.commitSha, htmlUrl: result.htmlUrl }, path: to };
});
