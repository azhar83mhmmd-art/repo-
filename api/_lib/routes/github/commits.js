'use strict';
const { route } = require('../../http');
const v = require('../../validate');
const shape = require('../../shape');

module.exports = route({ methods: ['GET'] }, async (ctx) => {
  const owner = v.assertOwner(ctx.query.owner);
  const repo = v.assertRepo(ctx.query.repo);
  const sha = ctx.query.branch ? v.assertBranch(ctx.query.branch) : undefined;
  const path = ctx.query.path ? v.normalizePath(ctx.query.path) : undefined;
  const perPage = Math.min(100, Math.max(1, parseInt(ctx.query.per_page, 10) || 30));
  const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
  try {
    const { data, link } = await ctx.gh('GET', `/repos/${owner}/${repo}/commits`, { query: { sha, path, per_page: perPage, page } });
    return { commits: data.map(shape.commit), hasNext: /rel="next"/.test(link || ''), page };
  } catch (e) {
    if (e.code === 'empty_repository') return { commits: [], hasNext: false, page, empty: true };
    throw e;
  }
});
