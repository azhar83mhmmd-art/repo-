'use strict';
// POST /api/upload/bulk-upload — finalises an upload: tree(s) → ONE commit → move branch.
// body: { owner, repo, branch, baseBranch?, createBranch?, expectedHead?, message, entries:[{path, sha, mode?}], author? }
// Never force-pushes. If the branch moved since the browser read it, responds 409 so the user can retry.
const { route } = require('../_lib/http');
const v = require('../_lib/validate');
const flow = require('../_lib/commit-flow');

module.exports = route({ methods: ['POST'] }, async (ctx) => {
  const b = ctx.body;
  const owner = v.assertOwner(b.owner);
  const repo = v.assertRepo(b.repo);
  const branch = v.assertBranch(b.branch);
  const message = v.assertString(b.message || 'Upload project via RepoFast', 'Commit message', { max: 2000 });
  const entries = v.assertArray(b.entries, 'entries', v.LIMITS.MAX_FILES);
  if (entries.length === 0) throw new v.HttpError(400, 'There is nothing to upload.', { code: 'empty_upload' });

  const seen = new Set();
  for (const e of entries) {
    const p = v.normalizePath(e.path);
    if (seen.has(p.toLowerCase())) throw new v.HttpError(400, `Duplicate path in upload: ${p}`, { code: 'duplicate_path' });
    seen.add(p.toLowerCase());
  }

  let parentSha;
  let createRef = false;
  if (b.createBranch) {
    const base = v.assertBranch(b.baseBranch || '');
    parentSha = await flow.getBranchHead(ctx, owner, repo, base);
    if (!parentSha) throw new v.HttpError(404, 'Repository or branch not found.', { code: 'not_found' });
    if (await flow.getBranchHead(ctx, owner, repo, branch)) {
      throw new v.HttpError(409, `Branch "${branch}" already exists.`, { code: 'branch_exists' });
    }
    createRef = true;
  } else {
    parentSha = await flow.getBranchHead(ctx, owner, repo, branch);
    if (!parentSha) throw new v.HttpError(404, 'Repository or branch not found.', { code: 'not_found' });
    if (b.expectedHead && v.assertSha(b.expectedHead, 'expected head') !== parentSha) {
      throw new v.HttpError(409, 'Branch has changed since you started. Please refresh and try again.', { code: 'branch_changed' });
    }
  }

  const result = await flow.commitEntries(ctx, {
    owner, repo, parentSha, entries, message, author: flow.parseAuthor(b.author),
  });
  await flow.moveBranch(ctx, { owner, repo, branch, sha: result.commitSha, create: createRef });

  return {
    commit: { sha: result.commitSha, htmlUrl: result.htmlUrl || `https://github.com/${owner}/${repo}/commit/${result.commitSha}` },
    branch, files: entries.length, treeChunks: result.chunks, createdBranch: createRef,
    repoUrl: `https://github.com/${owner}/${repo}`,
  };
});
