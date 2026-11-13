import { html, mount, ic, $, $$, formatDate, formatBytes, safeUrl, shortSha } from '../ui/dom.js';
import { Select } from '../ui/select.js';
import { history } from '../store.js';
import { confirmDialog } from '../ui/overlay.js';
import { notify } from '../notification.js';

export async function render(host, ctx) {
  let filter = 'all';
  mount(host, html`
    <div class="page-head"><div><h1>Upload History</h1><p>Uploads made from this browser. Only names, counts and commit links are kept — never your token or ZIP contents.</p></div>
      <div class="page-actions"><div class="tb-select" id="fSlot"></div><button class="btn danger" id="clear">${ic('trash-2')}Clear History</button></div></div>
    <section class="card" id="box"></section>`);
  const sel = new Select({ value: 'all', size: 'sm', icon: 'history', ariaLabel: 'Filter history', options: [{ value: 'all', label: 'All uploads' }, { value: 'success', label: 'Successful', icon: 'check-circle-2' }, { value: 'failed', label: 'Failed', icon: 'alert-circle' }], onChange: (v) => { filter = v; draw(); } });
  $('#fSlot', host).appendChild(sel.el);

  function draw() {
    const all = history.all(); $('#clear', host).disabled = !all.length;
    const rows = all.filter((x) => filter === 'all' || x.status === filter);
    const box = $('#box', host);
    if (!rows.length) { mount(box, html`<div class="empty"><div class="e-icon">${ic('history', 'lg')}</div><h3>${all.length ? 'No matching uploads' : 'No upload history yet'}</h3><p>${all.length ? 'Try another filter.' : 'Your uploads will be listed here after your first one.'}</p>${all.length ? '' : html`<button class="btn primary" id="go">${ic('cloud-upload', 'sm')}Upload ZIP</button>`}</div>`); $('#go', box)?.addEventListener('click', () => ctx.navigate('upload')); return; }
    mount(box, html`<div class="table-wrap"><table class="table"><thead><tr><th>ZIP</th><th>Repository</th><th>Branch</th><th class="num">Files</th><th>Date</th><th>Commit</th><th>Status</th><th class="num">Actions</th></tr></thead><tbody>
      ${rows.map((x) => html`<tr>
        <td data-label="ZIP"><div class="cell-main"><span class="tr-ic">${ic('archive', 'sm')}</span><div><b>${x.zipName}</b>${x.bytes ? html`<div class="cell-sub">${formatBytes(x.bytes)}</div>` : ''}</div></div></td>
        <td data-label="Repository"><span class="mono">${x.repo}</span></td>
        <td data-label="Branch"><span class="mono cell-sub">${x.branch}</span></td>
        <td data-label="Files" class="num">${x.files ?? '—'}</td>
        <td data-label="Date"><span class="cell-sub">${formatDate(x.at)}</span></td>
        <td data-label="Commit">${x.commitSha ? html`<span class="sha">${shortSha(x.commitSha)}</span>` : '—'}</td>
        <td data-label="Status">${x.status === 'success' ? html`<span class="badge success">${ic('check-circle-2')}Success</span>` : html`<span class="badge danger" title="${x.message || ''}">${ic('alert-circle')}Failed</span>`}</td>
        <td class="num"><div class="row-actions">${x.commitUrl ? html`<a class="btn sm" href="${safeUrl(x.commitUrl)}" target="_blank" rel="noopener noreferrer">${ic('git-commit-horizontal', 'sm')}<span>View Commit</span></a>` : ''}${x.repoUrl ? html`<a class="btn sm ghost" href="${safeUrl(x.repoUrl)}" target="_blank" rel="noopener noreferrer">${ic('arrow-up-right', 'sm')}<span>View Repository</span></a>` : ''}</div></td></tr>`)}
    </tbody></table></div>`);
  }
  $('#clear', host).addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Clear upload history?', message: 'This only removes the list stored in this browser. Your commits on GitHub are not affected.', confirmText: 'Clear history', danger: true }))) return;
    history.clear(); notify.success('History cleared'); draw();
  });
  draw();
  return { cleanup: () => sel.destroy() };
}
