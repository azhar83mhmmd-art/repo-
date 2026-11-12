'use strict';
const { route } = require('../_lib/http');
const v = require('../_lib/validate');

module.exports = route({ methods: ['GET'] }, async (ctx) => {
  const owner = v.assertOwner(ctx.query.owner);
  const repo = v.assertRepo(ctx.query.repo);
  const { data: info } = await ctx.gh('GET', `/repos/${owner}/${repo}`);
  const { data } = await ctx.gh('GET', `/repos/${owner}/${repo}/branches`, { query: { per_page: 100 } });
  return {
    defaultBranch: info.default_branch,
    permissions: info.permissions ? { push: !!info.permissions.push, admin: !!info.permissions.admin } : null,
    branches: data.map((b) => ({ name: b.name, sha: b.commit.sha, protected: !!b.protected })),
  };
});
