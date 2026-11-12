import { html, mount, ic, $, $$, timeAgo, timeAgoShort, formatDate, safeUrl, shortSha } from '../ui/dom.js';
import { loadRepos } from '../repos.js';
import { history } from '../store.js';
import { explain } from '../github-client.js';
import { state } from '../app-state.js';
import { bindRepoCards } from '../repository-manager.js';

export async function render(host, ctx) {
  const h = history.all();
  const ok = h.filter((x) => x.status === 'success');
  const failed = h.length - ok.length;
  const files = ok.reduce((n, x) => n + (x.files || 0), 0);

  mount(host, html`
    <section class="welcome">
      <div><h1>Welcome back to RepoFast</h1><p>Manage your GitHub repositories and upload projects effortlessly.</p></div>
      <div class="quick">
        <button class="btn primary lg" id="qCreate">${ic('plus')}Create Repository</button>
        <button class="btn lg" id="qUpload">${ic('cloud-upload')}Upload ZIP</button>
        <button class="btn lg" id="qBrowse">${ic('folder-git-2')}Browse Repositories</button>
      </div>
    </section>
    <div class="stats" id="stats">
      ${stat('folder-git-2', 'Total Repositories', null, 'Loading…', 'repos')}
      ${stat('cloud-upload', 'Total Uploads', ok.length, failed ? `${failed} failed` : 'All successful', 'uploads')}
      ${stat('files', 'Files Uploaded', files.toLocaleString(), ok.length ? `${ok.length} commit${ok.length === 1 ? '' : 's'}` : 'No uploads yet', 'files')}
      ${stat('activity', 'Recent Activity', ok[0] ? timeAgoShort(ok[0].at) : null, ok[0] ? `${ok[0].repo}` : 'Loading…', 'recent')}
    </div>
    <div class="two-col">
      <section class="card"><div class="card-head"><div><h2>Recent repositories</h2><p>Most recently pushed</p></div><button class="btn sm ghost" id="allRepos">View all${ic('chevron-right', 'sm')}</button></div><div class="card-body" id="recentRepos"><div class="skeleton" style="height:120px"></div></div></section>
      <section class="card"><div class="card-head"><div><h2>Recent upload activity</h2><p>Stored only on this device</p></div><button class="btn sm ghost" id="allHist">View all${ic('chevron-right', 'sm')}</button></div><div id="recentUploads"></div></section>
    </div>`);

  $('#qCreate', host).addEventListener('click', async () => { (await import('../repository-manager.js')).openCreateRepo(() => loadAndDraw(true)); });
  $('#qUpload', host).addEventListener('click', () => ctx.navigate('upload'));
  $('#qBrowse', host).addEventListener('click', () => ctx.navigate('repositories'));
  $('#allRepos', host).addEventListener('click', () => ctx.navigate('repositories'));
  $('#allHist', host).addEventListener('click', () => ctx.navigate('history'));

  // Recent uploads
  const ru = $('#recentUploads', host);
  if (!h.length) mount(ru, html`<div class="empty small"><div class="e-icon">${ic('history', 'lg')}</div><h3>No uploads yet</h3><p>Upload a ZIP and its activity will appear here.</p><button class="btn primary" id="firstUp">${ic('cloud-upload', 'sm')}Upload ZIP</button></div>`), $('#firstUp', ru).addEventListener('click', () => ctx.navigate('upload'));
  else mount(ru, html`<ul class="activity">${h.slice(0, 5).map((x) => html`<li>
    <span class="act-ic ${x.status}">${ic(x.status === 'success' ? 'check-circle-2' : 'alert-circle', 'sm')}</span>
    <div class="act-main"><b>${x.zipName}</b><span class="cell-sub">${x.repo} · ${x.files ?? 0} files · ${timeAgo(x.at)}</span></div>
    ${x.commitUrl ? html`<a class="sha" href="${safeUrl(x.commitUrl)}" target="_blank" rel="noopener noreferrer" title="View commit">${shortSha(x.commitSha)}</a>` : html`<span class="badge danger">Failed</span>`}</li>`)}</ul>`);

  async function loadAndDraw(force) {
    try {
      const repos = await loadRepos(force);
      const priv = repos.filter((r) => r.private).length;
      setStat('repos', repos.length.toLocaleString(), `${priv} private · ${repos.length - priv} public`);
      const recent = [...repos].sort((a, b) => new Date(b.pushedAt || b.updatedAt) - new Date(a.pushedAt || a.updatedAt));
      if (!ok[0] && recent[0]) setStat('recent', timeAgoShort(recent[0].pushedAt || recent[0].updatedAt), `Push to ${recent[0].name}`);
      else if (!ok[0]) setStat('recent', '—', 'No activity yet');
      const el = $('#recentRepos', host);
      if (!repos.length) mount(el, html`<div class="empty small"><div class="e-icon">${ic('folder-git-2', 'lg')}</div><h3>No repositories</h3><p>Create your first repository to begin.</p></div>`);
      else { mount(el, html`<ul class="repo-rows">${recent.slice(0, 5).map((r) => html`<li>
        <span class="repo-ic">${ic(r.private ? 'lock' : 'folder-git-2', 'sm')}</span>
        <div class="act-main"><a href="#/explorer?repo=${encodeURIComponent(r.fullName)}"><b>${r.name}</b></a><span class="cell-sub"><span class="badge ${r.private ? 'warning' : 'success'}">${r.private ? 'Private' : 'Public'}</span> <span class="mono">${r.defaultBranch}</span> · ${timeAgo(r.pushedAt || r.updatedAt)}</span></div>
        <a class="btn ghost icon-only sm" href="${safeUrl(r.htmlUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${r.name} on GitHub">${ic('arrow-up-right', 'sm')}</a></li>`)}</ul>`); }
    } catch (e) {
      setStat('repos', '—', 'Unavailable'); if (!ok[0]) setStat('recent', '—', 'Unavailable');
      mount($('#recentRepos', host), html`<div class="alert danger">${ic('alert-circle')}<div>${explain(e)}</div></div>`);
    }
  }
  loadAndDraw(false);
}

function stat(icon, label, value, sub, key) {
  return html`<div class="stat" data-k="${key}"><div class="stat-ic">${ic(icon)}</div><div class="stat-body"><span class="stat-label">${label}</span><b class="stat-val">${value === null ? html`<span class="skeleton" style="display:inline-block;width:56px;height:26px"></span>` : value}</b><span class="stat-sub">${sub}</span></div></div>`;
}
function setStat(key, value, sub) {
  const el = document.querySelector(`.stat[data-k="${key}"]`); if (!el) return;
  el.querySelector('.stat-val').textContent = value; el.querySelector('.stat-sub').textContent = sub;
}
