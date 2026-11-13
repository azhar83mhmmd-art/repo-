// Shared in-memory application state (no secrets other than what vault.js manages).
export const state = {
  connected: false,
  user: null,        // { login, name, avatarUrl, htmlUrl, type, ... }
  token: null,       // { type, scopes, canWriteRepos, canCreateRepos }
  warnings: [],
  rateLimit: null,
  repos: null,       // cached full repository list (array) once loaded
  reposLoadedAt: 0,
  selection: { repo: null, branch: null }, // current working repo (owner/name) shared by Upload, Explorer, Commits
};

export const listeners = new Set();
export const onState = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => listeners.forEach((fn) => fn(state));
