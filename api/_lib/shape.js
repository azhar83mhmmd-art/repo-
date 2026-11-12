'use strict';
// Maps GitHub payloads to compact shapes so the browser never receives more than it needs.

const repo = (r) => ({
  id: r.id,
  name: r.name,
  fullName: r.full_name,
  owner: r.owner && r.owner.login,
  description: r.description,
  private: !!r.private,
  visibility: r.visibility || (r.private ? 'private' : 'public'),
  defaultBranch: r.default_branch,
  htmlUrl: r.html_url,
  updatedAt: r.updated_at,
  pushedAt: r.pushed_at,
  size: r.size,
  fork: !!r.fork,
  archived: !!r.archived,
  language: r.language || null,
  permissions: r.permissions ? { admin: !!r.permissions.admin, push: !!r.permissions.push } : null,
});

const commit = (c) => ({
  sha: c.sha,
  message: c.commit && c.commit.message,
  author: (c.commit && c.commit.author && c.commit.author.name) || (c.author && c.author.login) || 'Unknown',
  authorLogin: c.author ? c.author.login : null,
  authorAvatar: c.author ? c.author.avatar_url : null,
  date: c.commit && (c.commit.author && c.commit.author.date),
  htmlUrl: c.html_url,
});

module.exports = { repo, commit };
