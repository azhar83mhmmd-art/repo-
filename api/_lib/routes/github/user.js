'use strict';
const { route } = require('../../http');

module.exports = route({ methods: ['GET'] }, async (ctx) => {
  const { data, rate } = await ctx.gh('GET', '/user');
  return {
    user: {
      login: data.login, name: data.name, avatarUrl: data.avatar_url, htmlUrl: data.html_url,
      type: data.type, publicRepos: data.public_repos, totalPrivateRepos: data.total_private_repos ?? null,
    },
    rateLimit: rate,
  };
});
