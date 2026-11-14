'use strict';
const { route } = require('../../http');
const v = require('../../validate');
const shape = require('../../shape');

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const b = ctx.body;
  const name = v.assertRepo(b.name);
  const body = {
    name,
    description: v.assertString(b.description, 'Description', { max: 350, required: false }),
    private: b.visibility === 'public' ? false : true,
    auto_init: !!b.autoInit,
  };
  if (b.gitignoreTemplate) body.gitignore_template = v.assertString(b.gitignoreTemplate, 'gitignore template', { max: 60 });
  if (b.licenseTemplate) body.license_template = v.assertString(b.licenseTemplate, 'License', { max: 60 });

  const { data } = await ctx.gh('POST', '/user/repos', { body, retry: false });

  // Custom default branch: only possible when we can rename after creation (needs auto_init).
  let repo = data;
  const wanted = b.defaultBranch ? v.assertBranch(b.defaultBranch) : null;
  if (wanted && wanted !== data.default_branch && body.auto_init) {
    try {
      const r = await ctx.gh('POST', `/repos/${data.owner.login}/${data.name}/branches/${encodeURIComponent(data.default_branch)}/rename`, {
        body: { new_name: wanted }, retry: false,
      });
      repo = { ...data, default_branch: r.data.name };
    } catch {
      /* keep the original default branch; the client shows a warning */
    }
  }
  return { __status: 201, repository: shape.repo(repo), branchRenamed: repo.default_branch === wanted };
});
