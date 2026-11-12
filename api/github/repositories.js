'use strict';
const { route } = require('../_lib/http');
const { parseLink } = require('../_lib/github');
const shape = require('../_lib/shape');

module.exports = route({ methods: ['GET'] }, async (ctx) => {
  const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(ctx.query.per_page, 10) || 30));
  const sort = ['created', 'updated', 'pushed', 'full_name'].includes(ctx.query.sort) ? ctx.query.sort : 'updated';
  const direction = ctx.query.direction === 'asc' ? 'asc' : 'desc';
  const visibility = ['all', 'public', 'private'].includes(ctx.query.visibility) ? ctx.query.visibility : 'all';

  const { data, link, rate } = await ctx.gh('GET', '/user/repos', {
    query: { page, per_page: perPage, sort, direction, visibility, affiliation: 'owner,collaborator,organization_member' },
  });
  const pages = parseLink(link);
  return { repositories: data.map(shape.repo), page, perPage, hasNext: !!pages.next, rateLimit: rate };
});
