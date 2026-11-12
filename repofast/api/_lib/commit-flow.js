'use strict';
// Shared tree → commit → ref pipeline used by bulk upload and rename.
const v = require('./validate');
const { toEntries } = require('./routes/github/create-tree');

const enc = encodeURIComponent;

async function getBranchHead(ctx, owner, repo, branch) {
  try {
    const { data } = await ctx.gh('GET', `/repos/${owner}/${repo}/git/ref/heads/${enc(branch)}`);
    return data.object.sha;
  } catch (e) {
    if (e.status === 404 || e.code === 'empty_repository') return null;
    throw e;
  }
}

/**
 * Applies entries on top of `parentSha` as ONE commit. Large entry lists are split into
 * ≤1000-entry tree chunks chained through base_tree, so the result is still a single commit.
 * Returns { commitSha, htmlUrl, treeSha, chunks }.
 */
async function commitEntries(ctx, { owner, repo, parentSha, entries, message, author }) {
  let baseTree;
  if (parentSha) {
    const { data } = await ctx.gh('GET', `/repos/${owner}/${repo}/git/commits/${parentSha}`);
    baseTree = data.tree.sha;
  }
  const clean = toEntries(entries, v.LIMITS.MAX_FILES);
  let chunks = 0;
  let treeSha = baseTree;
  for (let i = 0; i < clean.length; i += v.LIMITS.TREE_CHUNK) {
    const body = { tree: clean.slice(i, i + v.LIMITS.TREE_CHUNK) };
    if (treeSha) body.base_tree = treeSha;
    const { data } = await ctx.gh('POST', `/repos/${owner}/${repo}/git/trees`, { body, retry: true });
    treeSha = data.sha;
    chunks++;
  }
  const commitBody = { message, tree: treeSha, parents: parentSha ? [parentSha] : [] };
  if (author && author.name && author.email) commitBody.author = { name: author.name, email: author.email };
  const { data: commit } = await ctx.gh('POST', `/repos/${owner}/${repo}/git/commits`, { body: commitBody, retry: false });
  return { commitSha: commit.sha, htmlUrl: commit.html_url, treeSha, chunks };
}

async function moveBranch(ctx, { owner, repo, branch, sha, create }) {
  if (create) {
    await ctx.gh('POST', `/repos/${owner}/${repo}/git/refs`, { body: { ref: `refs/heads/${branch}`, sha }, retry: false });
  } else {
    await ctx.gh('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${enc(branch)}`, { body: { sha, force: false }, retry: false });
  }
}

function parseAuthor(a) {
  if (!a) return null;
  const name = typeof a.name === 'string' ? a.name.trim().slice(0, 100) : '';
  const email = typeof a.email === 'string' ? a.email.trim().slice(0, 200) : '';
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return { name, email };
}

module.exports = { getBranchHead, commitEntries, moveBranch, parseAuthor };
