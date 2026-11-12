// Repository list service: loads and caches all repositories the token can access.
import { api } from './github-client.js';
import { state } from './app-state.js';

let inflight = null;

export async function loadRepos(force = false) {
  if (!force && state.repos && Date.now() - state.reposLoadedAt < 120000) return state.repos;
  if (inflight) return inflight;
  inflight = (async () => {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const res = await api.repositories({ page, per_page: 100, sort: 'updated' });
      all.push(...res.repositories);
      if (!res.hasNext) break;
    }
    state.repos = all;
    state.reposLoadedAt = Date.now();
    return all;
  })().finally(() => { inflight = null; });
  return inflight;
}

export const invalidateRepos = () => { state.reposLoadedAt = 0; };
export const findRepo = (fullName) => (state.repos || []).find((r) => r.fullName === fullName) || null;
