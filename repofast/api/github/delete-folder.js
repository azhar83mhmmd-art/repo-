'use strict';
// POST /api/github/delete-folder — removes a file OR a whole folder (everything inside it) in ONE commit.
// Every matching blob gets a null tree entry. Never force-pushes.
// body: { owner, repo, branch, path, message? }
const { route } = require('../_lib/http');
const v = require('../_lib/validate');
const flow = require('../_lib/commit-flow');

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const b = ctx.body;
  const owner = v.assertOwner(b.owner);
  const repo = v.assertRepo(b.repo);
  const branch = v.assertBranch(b.branch);
  const path = v.normalizePath(b.path);

  const head = await flow.getBranchHead(ctx, owner, repo, branch);
  if (!head) throw new v.HttpError(404, 'Repository or branch not found.', { code: 'not_found' });

  const { data: headCommit } = await ctx.gh('GET', `/repos/${owner}/${repo}/git/commits/${head}`);
  const { data: tree } = await ctx.gh('GET', `/repos/${owner}/${repo}/git/trees/${headCommit.tree.sha}`, { query: { recursive: 1 } });
  if (tree.truncated) throw new v.HttpError(413, 'This repository is too large to delete in one step.', { code: 'tree_truncated' });

  const prefix = path + '/';
  const victims = tree.tree.filter((t) => t.type === 'blob' && (t.path === path || t.path.startsWith(prefix)));
  if (!victims.length) throw new v.HttpError(404, 'That file or folder was not found. Refresh and try again.', { code: 'folder_not_found' });
  if (victims.length > v.LIMITS.MAX_FILES) throw new v.HttpError(413, `This folder has ${victims.length} files, which is over the ${v.LIMITS.MAX_FILES} file limit.`, { code: 'too_many_files' });

  const isFile = victims.length === 1 && victims[0].path === path;
  const result = await flow.commitEntries(ctx, {
    owner, repo, parentSha: head,
    entries: victims.map((t) => ({ path: t.path, sha: null, mode: t.mode })),
    message: v.assertString(b.message || `Delete ${isFile ? '' : 'folder '}${path} via RepoFast`, 'Commit message', { max: 2000 }),
  });
  await flow.moveBranch(ctx, { owner, repo, branch, sha: result.commitSha });
  return { commit: { sha: result.commitSha, htmlUrl: result.htmlUrl || `https://github.com/${owner}/${repo}/commit/${result.commitSha}` }, path, deleted: victims.length, file: isFile };
});
