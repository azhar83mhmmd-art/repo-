'use strict';

/**
 * GitHub reports when a token dies in the `github-authentication-token-expiration` response header,
 * e.g. "2026-12-01 10:00:00 UTC" (or "... +0700"). Returns an ISO-8601 string, or null when the token
 * has no expiry / the header is absent or unreadable.
 */
function parseExpiry(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|GMT|Z|[+-]\d{2}:?\d{2})?$/i);
  let ms;
  if (m) {
    const zone = (m[3] || 'UTC').toUpperCase();
    const off = /^[+-]/.test(zone) ? zone.replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2') : 'Z';
    ms = Date.parse(`${m[1]}T${m[2]}${off}`);
  } else {
    ms = Date.parse(value);
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Calls GET /user and returns account info plus a permission summary for the token. */
async function summarizeAuth(ctx) {
  const { data: user, headers, rate } = await ctx.gh('GET', '/user');
  const scopesHeader = headers.get('x-oauth-scopes');
  const classic = scopesHeader !== null;
  const scopes = classic ? scopesHeader.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const tokenType = classic ? 'classic' : 'fine-grained';
  const expiresAt = parseExpiry(headers.get('github-authentication-token-expiration'));
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
    token: { type: tokenType, scopes, canWriteRepos, canCreateRepos, expiresAt },
    warnings,
    rateLimit: rate,
  };
}

module.exports = { summarizeAuth, parseExpiry };
