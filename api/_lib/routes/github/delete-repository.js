'use strict';
// POST /api/github/delete-repository — permanently deletes a repository. body: { owner, repo, confirm }
// `confirm` must equal the repository name (server-side guard against accidental calls).
const { route } = require('../../http');
const v = require('../../validate');

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const owner = v.assertOwner(ctx.body.owner);
  const repo = v.assertRepo(ctx.body.repo);
  if (ctx.body.confirm !== repo) throw new v.HttpError(400, 'Type the repository name to confirm deletion.', { code: 'confirm_mismatch' });
  try {
    await ctx.gh('DELETE', `/repos/${owner}/${repo}`, { retry: false });
  } catch (e) {
    if (e.status === 403 || e.status === 404) {
      throw new v.HttpError(e.status, 'GitHub refused to delete this repository. Your token needs the "delete_repo" scope (classic) or Administration: Read and write (fine-grained), and you must be an admin of the repository.', { code: 'delete_repo_denied' });
    }
    throw e;
  }
  return { deleted: true, fullName: `${owner}/${repo}` };
});
