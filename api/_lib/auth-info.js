'use strict';

/** Calls GET /user and returns account info plus a permission summary for the token. */
async function summarizeAuth(ctx) {
  const { data: user, headers, rate } = await ctx.gh('GET', '/user');
  const scopesHeader = headers.get('x-oauth-scopes');
  const classic = scopesHeader !== null;
  const scopes = classic ? scopesHeader.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const tokenType = classic ? 'classic' : 'fine-grained';
  const warnings = [];
  let canCreateRepos = null;
  let canWriteRepos = null;

  if (classic) {
    canWriteRepos = scopes.includes('repo') || scopes.includes('public_repo');
    canCreateRepos = canWriteRepos;
    if (!canWriteRepos) warnings.push('This classic token has no "repo" or "public_repo" scope, so it cannot write to repositories.');
    else if (!scopes.includes('repo')) warnings.push('Only "public_repo" is granted: private repositories will not be accessible.');
  } else {
    warnings.push('Fine-grained token: needs "Contents: Read and write" on the target repositories, and "Administration: Read and write" to create repositories.');
  }

  return {
    user: {
      login: user.login,
      name: user.name || null,
      avatarUrl: user.avatar_url,
      htmlUrl: user.html_url,
      type: user.type,
      id: user.id,
      publicRepos: user.public_repos,
      totalPrivateRepos: user.total_private_repos ?? null,
      plan: user.plan ? user.plan.name : null,
    },
    token: { type: tokenType, scopes, canWriteRepos, canCreateRepos },
    warnings,
    rateLimit: rate,
  };
}

module.exports = { summarizeAuth };
