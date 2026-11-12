'use strict';
const { route } = require('../../http');
const v = require('../../validate');
const { parseAuthor } = require('../../commit-flow');

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const owner = v.assertOwner(ctx.body.owner);
  const repo = v.assertRepo(ctx.body.repo);
  const body = {
    message: v.assertString(ctx.body.message, 'Commit message', { max: 2000 }),
    tree: v.assertSha(ctx.body.tree, 'tree SHA'),
    parents: v.assertArray(ctx.body.parents || [], 'parents', 2).map((p) => v.assertSha(p, 'parent SHA')),
  };
  const author = parseAuthor(ctx.body.author);
  if (author) body.author = author;
  const { data } = await ctx.gh('POST', `/repos/${owner}/${repo}/git/commits`, { body, retry: false });
  return { __status: 201, sha: data.sha, htmlUrl: data.html_url };
});
