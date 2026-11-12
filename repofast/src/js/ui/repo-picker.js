// Repository + branch picker shared by Upload, Explorer and Commits.
import { Select } from './select.js';
import { html, create } from './dom.js';
import { api, explain } from '../github-client.js';
import { loadRepos, findRepo } from '../repos.js';
import { state } from '../app-state.js';
import { last } from '../store.js';
import { prefs } from '../store.js';
import { notify } from '../notification.js';

/**
 * Renders two selects (repository, branch) into `host`.
 * opts: { onChange({repo, branch, branches, defaultBranch, permissions}), writable }
 */
export function repoPicker(host, { onChange, initialRepo, initialBranch, labels = true, branchOnly = false } = {}) {
  const el = create(html`
    <div class="picker">
      <div class="field"><label>${labels ? 'Repository' : ''}</label><div data-slot="repo"></div></div>
      <div class="field"><label>${labels ? 'Branch' : ''}</label><div data-slot="branch"></div></div>
    </div>`);
  host.appendChild(el);

  const repoSel = new Select({
    placeholder: 'Select repository', icon: 'folder-git-2', searchable: true, emptyText: 'No repositories found', ariaLabel: 'Repository',
    onChange: (v) => pickRepo(v),
  });
  const branchSel = new Select({ placeholder: 'Select branch', icon: 'git-branch', ariaLabel: 'Branch', onChange: (v) => { state.selection.branch = v; last.set({ branch: v }); emit(); } });
  el.querySelector('[data-slot=repo]').appendChild(repoSel.el);
  el.querySelector('[data-slot=branch]').appendChild(branchSel.el);
  branchSel.setDisabled(true);

  let info = { branches: [], defaultBranch: null, permissions: null };
  let alive = true;

  function emit() {
    const repo = findRepo(repoSel.value);
    onChange && onChange({ repo, branch: branchSel.value, ...info });
  }

  async function pickRepo(fullName, preferBranch) {
    state.selection.repo = fullName;
    last.set({ repo: fullName });
    const repo = findRepo(fullName);
    branchSel.setDisabled(true);
    branchSel.setOptions([], null);
    branchSel.valueEl.textContent = 'Loading branches…';
    try {
      const res = await api.branches(repo.owner, repo.name);
      if (!alive) return;
      info = res;
      branchSel.setOptions(res.branches.map((b) => ({ value: b.name, label: b.name, sub: b.name === res.defaultBranch ? 'default' : (b.protected ? 'protected' : ''), icon: 'git-branch' })));
      const p = prefs.get();
      const want = preferBranch || (p.branchBehavior === 'last' && last.get().repo === fullName ? last.get().branch : null) || res.defaultBranch;
      const chosen = res.branches.some((b) => b.name === want) ? want : (res.branches[0] && res.branches[0].name) || null;
      branchSel.setValue(chosen);
      branchSel.setDisabled(false);
      state.selection.branch = chosen;
      if (!res.branches.length) branchSel.valueEl.textContent = 'Empty repository';
    } catch (e) {
      notify.error('Could not load branches', explain(e));
      info = { branches: [], defaultBranch: null, permissions: null };
    }
    emit();
  }

  (async () => {
    try {
      const repos = await loadRepos();
      if (!alive) return;
      repoSel.setOptions(repos.map((r) => ({ value: r.fullName, label: r.fullName, sub: r.private ? 'private' : 'public', icon: r.private ? 'lock' : 'globe' })));
      const want = initialRepo || state.selection.repo || last.get().repo;
      if (want && findRepo(want)) { repoSel.setValue(want); await pickRepo(want, initialBranch); }
    } catch (e) { notify.error('Could not load repositories', explain(e)); }
  })();

  return {
    el, repoSel, branchSel,
    get repo() { return findRepo(repoSel.value); },
    get branch() { return branchSel.value; },
    get info() { return info; },
    async setRepo(full, branch) { repoSel.setValue(full); await pickRepo(full, branch); },
    async refreshBranches() { if (repoSel.value) await pickRepo(repoSel.value, branchSel.value); },
    destroy() { alive = false; repoSel.destroy(); branchSel.destroy(); },
  };
}
