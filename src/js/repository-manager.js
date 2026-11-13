// Repositories page + Create Repository dialog.
import { html, mount, ic, $, $$, timeAgo, debounce, copyText, safeUrl } from './ui/dom.js';
import { Select } from './ui/select.js';
import { modal, typeConfirm } from './ui/overlay.js';
import { api, explain } from './github-client.js';
import { loadRepos, invalidateRepos } from './repos.js';
import { notify } from './notification.js';
import { state } from './app-state.js';
import { navigate } from './router.js';

const PAGE_SIZE = 12;
const GITIGNORES = ['Node', 'Python', 'Java', 'Go', 'Rust', 'Ruby', 'Swift', 'Kotlin', 'Dart', 'Unity', 'C++', 'C', 'CSharp', 'VisualStudio', 'Android', 'Laravel', 'Composer', 'Terraform', 'Flutter', 'Rails'];
const LICENSES = [['mit', 'MIT License'], ['apache-2.0', 'Apache License 2.0'], ['gpl-3.0', 'GNU GPL v3.0'], ['agpl-3.0', 'GNU AGPL v3.0'], ['bsd-3-clause', 'BSD 3-Clause'], ['bsd-2-clause', 'BSD 2-Clause'], ['mpl-2.0', 'Mozilla Public License 2.0'], ['lgpl-3.0', 'GNU LGPL v3.0'], ['unlicense', 'The Unlicense'], ['isc', 'ISC License']];
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function repoCard(r) {
  return html`
    <article class="repo-card">
      <div class="repo-top">
        <span class="repo-ic">${ic(r.private ? 'lock' : 'folder-git-2')}</span>
        <div class="repo-title"><a href="#/explorer?repo=${encodeURIComponent(r.fullName)}" class="repo-name">${r.name}</a><span class="cell-sub mono">${r.owner}</span></div>
        <span class="badge ${r.private ? 'warning' : 'success'}">${ic(r.private ? 'lock' : 'globe')}${r.private ? 'Private' : 'Public'}</span>
      </div>
      <p class="repo-desc">${r.description || 'No description provided.'}</p>
      <div class="repo-meta">
        <span>${ic('git-branch', 'sm')}<span class="mono">${r.defaultBranch}</span></span>
        <span>${ic('history', 'sm')}${timeAgo(r.pushedAt || r.updatedAt)}</span>
        ${r.language ? html`<span class="lang">${r.language}</span>` : ''}
      </div>
      <div class="repo-actions">
        <button class="btn sm primary" data-manage="${r.fullName}">${ic('files', 'sm')}Manage</button>
        <button class="btn sm" data-upload="${r.fullName}">${ic('cloud-upload', 'sm')}Upload</button>
        <button class="btn sm ghost icon-only danger-text" data-delrepo="${r.fullName}" aria-label="Hapus ${r.fullName}" title="Hapus repository">${ic('trash-2', 'sm')}</button>
        <a class="btn sm ghost icon-only" href="${safeUrl(r.htmlUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${r.fullName} on GitHub" title="Open on GitHub">${ic('arrow-up-right', 'sm')}</a>
      </div>
    </article>`;
}

export function bindRepoCards(root, onDeleted) {
  $$('[data-delrepo]', root).forEach((b) => b.addEventListener('click', async () => {
    const full = b.dataset.delrepo; const [owner, name] = full.split('/');
    if (!(await typeConfirm({ title: `Hapus repository ${name}?`, message: 'Repository beserta semua file, issue, dan riwayat commit-nya akan dihapus PERMANEN dari GitHub. Tindakan ini tidak bisa dibatalkan.', expected: name, confirmText: 'Hapus repository' }))) return;
    b.classList.add('loading');
    try { await api.deleteRepository({ owner, repo: name, confirm: name }); invalidateRepos(); notify.success('Repository dihapus', full); onDeleted && onDeleted(); }
    catch (er) { notify.error('Gagal menghapus repository', explain(er)); }
    finally { b.classList.remove('loading'); }
  }));
  $$('[data-manage]', root).forEach((b) => b.addEventListener('click', () => { state.selection.repo = b.dataset.manage; navigate('explorer', { repo: b.dataset.manage }); }));
  $$('[data-upload]', root).forEach((b) => b.addEventListener('click', () => { state.selection.repo = b.dataset.upload; navigate('upload', { repo: b.dataset.upload }); }));
}

export async function render(host) {
  const view = { q: '', vis: 'all', sort: 'updated', page: 1 };
  let all = [];

  mount(host, html`
    <div class="page-head">
      <div><h1>Repositories</h1><p>Every repository your token can access. Manage files, upload projects or create a new one.</p></div>
      <div class="page-actions"><button class="btn" id="refresh">${ic('refresh-cw')}Refresh</button><button class="btn primary" id="create">${ic('plus')}Create Repository</button></div>
    </div>
    <div class="toolbar">
      <div class="input-wrap grow">${ic('search')}<input class="input" id="q" type="search" placeholder="Search repositories…" aria-label="Search repositories"></div>
      <div class="tb-select" id="visSlot"></div>
      <div class="tb-select" id="sortSlot"></div>
    </div>
    <div id="list"></div>
    <div class="pager" id="pager"></div>`);

  const visSel = new Select({ value: 'all', size: 'sm', icon: 'globe', ariaLabel: 'Visibility filter', options: [{ value: 'all', label: 'All visibility' }, { value: 'public', label: 'Public', icon: 'globe' }, { value: 'private', label: 'Private', icon: 'lock' }], onChange: (v) => { view.vis = v; view.page = 1; draw(); } });
  const sortSel = new Select({ value: 'updated', size: 'sm', icon: 'arrow-up-down', ariaLabel: 'Sort', options: [{ value: 'updated', label: 'Last updated' }, { value: 'name', label: 'Name (A–Z)' }], onChange: (v) => { view.sort = v; draw(); } });
  $('#visSlot', host).appendChild(visSel.el);
  $('#sortSlot', host).appendChild(sortSel.el);

  const list = $('#list', host);
  const pager = $('#pager', host);

  function skeleton() {
    mount(list, html`<div class="repo-grid">${[1, 2, 3, 4, 5, 6].map(() => html`<div class="repo-card"><div class="skeleton" style="height:20px;width:60%"></div><div class="skeleton" style="height:14px;margin-top:14px"></div><div class="skeleton" style="height:14px;width:80%;margin-top:8px"></div><div class="skeleton" style="height:32px;margin-top:18px"></div></div>`)}</div>`);
  }

  function draw() {
    let rows = all.filter((r) => (view.vis === 'all' || (view.vis === 'private') === r.private) && (!view.q || (r.fullName + ' ' + (r.description || '')).toLowerCase().includes(view.q)));
    rows = rows.sort(view.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => new Date(b.pushedAt || b.updatedAt) - new Date(a.pushedAt || a.updatedAt));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    view.page = Math.min(view.page, pages);
    const slice = rows.slice((view.page - 1) * PAGE_SIZE, view.page * PAGE_SIZE);

    if (!all.length) {
      mount(list, html`<div class="card"><div class="empty"><div class="e-icon">${ic('folder-git-2', 'lg')}</div><h3>No repositories yet</h3><p>Create your first repository and upload a project in seconds.</p><button class="btn primary" data-create>${ic('plus', 'sm')}Create Repository</button></div></div>`);
      $('[data-create]', list).addEventListener('click', openCreate);
      pager.innerHTML = ''; return;
    }
    if (!rows.length) {
      mount(list, html`<div class="card"><div class="empty"><div class="e-icon">${ic('search', 'lg')}</div><h3>No matches</h3><p>No repository matches your search or filter.</p></div></div>`);
      pager.innerHTML = ''; return;
    }
    mount(list, html`<div class="repo-grid">${slice.map(repoCard)}</div>`);
    bindRepoCards(list, () => load(true));
    mount(pager, pages > 1 ? html`
      <span class="cell-sub">${rows.length} repositories · page ${view.page} of ${pages}</span>
      <div class="pager-btns"><button class="btn sm" data-p="-1" ${view.page === 1 ? 'disabled' : ''}>${ic('chevron-left', 'sm')}Previous</button><button class="btn sm" data-p="1" ${view.page === pages ? 'disabled' : ''}>Next${ic('chevron-right', 'sm')}</button></div>`
      : html`<span class="cell-sub">${rows.length} ${rows.length === 1 ? 'repository' : 'repositories'}</span>`);
    $$('[data-p]', pager).forEach((b) => b.addEventListener('click', () => { view.page += Number(b.dataset.p); draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  }

  async function load(force) {
    skeleton();
    try { all = await loadRepos(force); draw(); }
    catch (e) { mount(list, html`<div class="card"><div class="empty"><div class="e-icon">${ic('alert-circle', 'lg')}</div><h3>Could not load repositories</h3><p>${explain(e)}</p><button class="btn" id="retry">${ic('refresh-cw', 'sm')}Try again</button></div></div>`); $('#retry', list).addEventListener('click', () => load(true)); }
  }

  const openCreate = () => openCreateRepo(() => load(true));
  $('#create', host).addEventListener('click', openCreate);
  $('#refresh', host).addEventListener('click', async (e) => { const b = e.currentTarget; b.classList.add('loading'); await load(true); b.classList.remove('loading'); notify.success('Repository list refreshed'); });
  $('#q', host).addEventListener('input', debounce((e) => { view.q = e.target.value.trim().toLowerCase(); view.page = 1; draw(); }, 150));

  await load(false);
  return { cleanup() { visSel.destroy(); sortSel.destroy(); } };
}

/** Create Repository modal. onCreated(repository) is called after success. */
export function openCreateRepo(onCreated) {
  const body = document.createElement('div');
  body.className = 'form-grid';
  mount(body, html`
    <div class="field"><label for="rn">Repository name <span class="req">*</span></label><input class="input mono" id="rn" placeholder="my-awesome-project" maxlength="100" autocomplete="off" spellcheck="false" autofocus><div class="field-error" id="rnErr" hidden></div></div>
    <div class="field"><label for="rd">Description</label><textarea class="textarea" id="rd" placeholder="Short description (optional)" maxlength="350" rows="2"></textarea></div>
    <div class="field"><span class="label">Visibility</span>
      <div class="option-cards two">
        <label class="option-card"><input type="radio" name="vis" value="public"><span class="radio"></span><span><b>${ic('globe', 'sm')} Public</b><small>Anyone can see this repository.</small></span></label>
        <label class="option-card"><input type="radio" name="vis" value="private" checked><span class="radio"></span><span><b>${ic('lock', 'sm')} Private</b><small>Only you and collaborators.</small></span></label>
      </div></div>
    <div class="field-row"><div class="field"><label>.gitignore template</label><div id="giSlot"></div></div><div class="field"><label>License</label><div id="liSlot"></div></div></div>
    <div class="field-row"><div class="field"><label for="rb">Default branch</label><input class="input mono" id="rb" value="main" maxlength="100" spellcheck="false"></div>
      <div class="field"><span class="label">Initialize</span><label class="check" style="height:40px"><input type="checkbox" id="rr" checked><span>Add a README file</span></label></div></div>
    <div class="alert" id="initNote" hidden>${ic('info')}<div>A .gitignore, license or custom default branch needs an initial commit, so a README will be added.</div></div>`);

  const giSel = new Select({ value: '', placeholder: 'None', icon: 'file-code', searchable: true, ariaLabel: '.gitignore template', options: [{ value: '', label: 'None' }, ...GITIGNORES.map((g) => ({ value: g, label: g }))] });
  const liSel = new Select({ value: '', placeholder: 'None', icon: 'book-open', ariaLabel: 'License', options: [{ value: '', label: 'None' }, ...LICENSES.map(([v, l]) => ({ value: v, label: l }))] });
  $('#giSlot', body).appendChild(giSel.el); $('#liSlot', body).appendChild(liSel.el);

  const m = modal({
    title: 'Create Repository', subtitle: 'A new repository will be created in your GitHub account.',
    body,
    footer: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="doCreate">${ic('plus', 'sm')}Create Repository</button>`,
    onClose: () => { giSel.destroy(); liSel.destroy(); },
  });
  const nameIn = $('#rn', body); const err = $('#rnErr', body);
  const validate = () => {
    const v = nameIn.value.trim(); let msg = '';
    if (!v) msg = 'Repository name is required.';
    else if (!NAME_RE.test(v)) msg = 'Use letters, numbers, dots, hyphens and underscores only.';
    else if (v === '.' || v === '..') msg = 'That name is reserved.';
    err.hidden = !msg; err.textContent = msg; nameIn.classList.toggle('invalid', !!msg);
    return !msg;
  };
  nameIn.addEventListener('input', () => { if (err.textContent) validate(); });
  m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
  const syncNote = () => { $('#initNote', body).hidden = $('#rr', body).checked || !(giSel.value || liSel.value || $('#rb', body).value.trim() !== 'main'); };
  body.addEventListener('change', syncNote); body.addEventListener('click', () => setTimeout(syncNote, 0));

  $('#doCreate', m.el).addEventListener('click', async (e) => {
    if (!validate()) { nameIn.focus(); return; }
    const btn = e.currentTarget;
    const branch = $('#rb', body).value.trim() || 'main';
    const needsInit = !!(giSel.value || liSel.value || branch !== 'main');
    btn.classList.add('loading'); btn.innerHTML = `${ic('loader-2', 'sm spin')}Creating…`;
    try {
      const res = await api.createRepository({
        name: nameIn.value.trim(), description: $('#rd', body).value.trim(),
        visibility: body.querySelector('input[name=vis]:checked').value,
        autoInit: $('#rr', body).checked || needsInit,
        gitignoreTemplate: giSel.value || undefined, licenseTemplate: liSel.value || undefined, defaultBranch: branch,
      });
      invalidateRepos();
      const r = res.repository;
      notify.success('Repository created successfully', r.fullName, { href: r.htmlUrl, linkText: 'Open Repository' });
      m.close();
      showCreated(r);
      onCreated && onCreated(r);
    } catch (er) {
      notify.error('Could not create repository', explain(er));
      btn.classList.remove('loading'); btn.innerHTML = `${ic('plus', 'sm')}Create Repository`;
      if (er.status === 422) { err.hidden = false; err.textContent = 'A repository with this name may already exist.'; nameIn.classList.add('invalid'); }
    }
  });
  nameIn.focus();
}

function showCreated(r) {
  const m = modal({
    title: 'Repository created',
    body: html`<div class="created"><div class="hero-icon ok">${ic('check-circle-2', 'xl')}</div><h3>${r.fullName}</h3>
      <div class="url-row"><code>${r.htmlUrl}</code><button class="btn sm icon-only ghost" id="cp" aria-label="Copy URL">${ic('copy', 'sm')}</button></div>
      <p class="cell-sub">Default branch <span class="mono">${r.defaultBranch}</span> · ${r.private ? 'Private' : 'Public'}</p></div>`,
    footer: html`<button class="btn" data-close>Close</button><button class="btn" id="goUp">${ic('cloud-upload', 'sm')}Upload ZIP</button><a class="btn primary" href="${safeUrl(r.htmlUrl)}" target="_blank" rel="noopener noreferrer">${ic('arrow-up-right', 'sm')}Open Repository</a>`,
  });
  m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
  $('#cp', m.el).addEventListener('click', () => copyText(r.htmlUrl).then(() => notify.success('URL copied')));
  $('#goUp', m.el).addEventListener('click', () => { m.close(); state.selection.repo = r.fullName; navigate('upload', { repo: r.fullName }); });
}
