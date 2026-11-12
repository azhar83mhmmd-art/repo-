import { html, mount, ic, $, $$, timeAgo, formatDate, safeUrl, shortSha, avatarImg } from '../ui/dom.js';
import { repoPicker } from '../ui/repo-picker.js';
import { api, explain } from '../github-client.js';
import { notify } from '../notification.js';

export async function render(host, ctx) {
  let ctxRepo = null; let page = 1; let loading = false;
  mount(host, html`
    <div class="page-head"><div><h1>Recent Commits</h1><p>The latest commits on the selected repository and branch.</p></div><div class="page-actions"><button class="btn" id="refresh">${ic('refresh-cw')}Refresh</button></div></div>
    <section class="card explorer-top"><div id="pickerSlot"></div></section>
    <section class="card" id="box" style="margin-top:18px"><div class="empty"><div class="e-icon">${ic('git-commit-horizontal', 'lg')}</div><h3>Choose a repository</h3><p>Select a repository and branch to see its commits.</p></div></section>`);

  const picker = repoPicker($('#pickerSlot', host), { initialRepo: ctx.params.repo, onChange: ({ repo, branch }) => { ctxRepo = repo && branch ? { repo, branch } : null; page = 1; load(false); } });

  async function load(append) {
    const box = $('#box', host); if (!ctxRepo || loading) return;
    loading = true;
    if (!append) mount(box, html`<div class="card-body">${[1, 2, 3, 4].map(() => html`<div class="skeleton" style="height:56px;margin-bottom:10px"></div>`)}</div>`);
    try {
      const { repo, branch } = ctxRepo;
      const res = await api.commits(repo.owner, repo.name, branch, { page, per_page: 20 });
      if (!res.commits.length && !append) { mount(box, html`<div class="empty"><div class="e-icon">${ic('git-commit-horizontal', 'lg')}</div><h3>No commits yet</h3><p>This ${res.empty ? 'repository is empty' : 'branch has no commits'}.</p></div>`); return; }
      const rowsHtml = res.commits.map((c) => html`<li class="commit">
        <span class="c-dot"></span>
        <div class="c-main"><b class="c-msg">${(c.message || '').split('\n')[0]}</b><span class="cell-sub">${c.authorAvatar ? html`${avatarImg({ avatarUrl: c.authorAvatar, login: c.author }, 40, "avatar tiny", 18)}` : ''}${c.author} · <span title="${formatDate(c.date)}">${timeAgo(c.date)}</span> · <span class="mono">${branch}</span></span></div>
        <span class="sha">${shortSha(c.sha)}</span>
        <div class="row-actions"><a class="btn sm" href="${safeUrl(c.htmlUrl)}" target="_blank" rel="noopener noreferrer">${ic('git-commit-horizontal', 'sm')}<span>View Commit</span></a><a class="btn sm ghost icon-only" href="${safeUrl(c.htmlUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open on GitHub">${ic('arrow-up-right', 'sm')}</a></div></li>`);
      if (!append) mount(box, html`<ul class="commits" id="cl"></ul><div class="more-row" id="moreWrap"></div>`);
      $('#cl', box).insertAdjacentHTML('beforeend', rowsHtml.map(String).join(''));
      mount($('#moreWrap', box), res.hasNext ? html`<button class="btn" id="more">Load more</button>` : html``);
      $('#more', box)?.addEventListener('click', () => { page++; load(true); });
    } catch (e) { notify.error('Could not load commits', explain(e)); if (!append) mount(box, html`<div class="empty"><div class="e-icon">${ic('alert-circle', 'lg')}</div><h3>Could not load commits</h3><p>${explain(e)}</p></div>`); }
    finally { loading = false; }
  }
  $('#refresh', host).addEventListener('click', () => { page = 1; load(false); });
  return { cleanup: () => picker.destroy() };
}
