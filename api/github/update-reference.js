'use strict';
// POST /api/github/update-reference — fast-forward a branch (never force by default) or create it.
const { route } = require('../_lib/http');
const v = require('../_lib/validate');

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const owner = v.assertOwner(ctx.body.owner);
  const repo = v.assertRepo(ctx.body.repo);
  const branch = v.assertBranch(ctx.body.branch);
  const sha = v.assertSha(ctx.body.sha, 'commit SHA');
  if (ctx.body.create) {
    const { data } = await ctx.gh('POST', `/repos/${owner}/${repo}/git/refs`, { body: { ref: `refs/heads/${branch}`, sha }, retry: false });
    return { __status: 201, ref: data.ref, sha: data.object.sha };
  }
  let data;
  try {
    ({ data } = await ctx.gh('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      body: { sha, force: false }, retry: false,
    }));
  } catch (e) {
    // GitHub answers 422 "Update is not a fast forward" when someone pushed in the meantime.
    if (e.status === 422 && /fast.?forward/i.test(String(e.detail))) {
      throw new v.HttpError(409, 'Branch has changed since you started. Please refresh and try again.', { code: 'branch_changed' });
    }
    throw e;
  }
  return { ref: data.ref, sha: data.object.sha };
});
