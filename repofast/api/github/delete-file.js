'use strict';
// POST /api/github/delete-file — deletes ONE file (requires its current sha). Other files are untouched.
const { route } = require('../_lib/http');
const v = require('../_lib/validate');
const { encodePath } = require('../_lib/github');

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const b = ctx.body;
  const owner = v.assertOwner(b.owner);
  const repo = v.assertRepo(b.repo);
  const path = v.normalizePath(b.path);
  const body = {
    message: v.assertString(b.message || `Delete ${path} via RepoFast`, 'Commit message', { max: 2000 }),
    sha: v.assertSha(b.sha, 'file SHA'),
  };
  if (b.branch) body.branch = v.assertBranch(b.branch);
  const { data } = await ctx.gh('DELETE', `/repos/${owner}/${repo}/contents/${encodePath(path)}`, { body, retry: false });
  return { commit: { sha: data.commit.sha, htmlUrl: data.commit.html_url } };
});
