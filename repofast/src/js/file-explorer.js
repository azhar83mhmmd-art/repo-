// File Explorer: browse, preview, edit, rename, delete, create folder, upload files — all via GitHub API.
import { html, mount, create, ic, $, $$, formatBytes, ext, timeAgo, debounce, safeUrl, esc, copyText } from './ui/dom.js';
import { Select } from './ui/select.js';
import { modal, confirmDialog, popMenu } from './ui/overlay.js';
import { repoPicker } from './ui/repo-picker.js';
import { codeEditor } from './ui/code-editor.js';
import { highlight } from './ui/highlight.js';
import { renderMarkdown } from './ui/markdown.js';
import { api, explain, ApiError } from './github-client.js';
import { runUpload } from './upload-engine.js';
import { toBase64 } from './zip-manager.js';
import { notify } from './notification.js';
import { navigate } from './router.js';
import { state } from './app-state.js';
import { history } from './store.js';

const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif']);
const TEXT = new Set(['txt', 'md', 'markdown', 'json', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'xml', 'yml', 'yaml', 'toml', 'ini', 'env', 'sh', 'bash', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'php', 'c', 'h', 'cpp', 'cs', 'sql', 'svg', 'vue', 'lock', 'gitignore', 'gitattributes', 'editorconfig', 'csv', 'log', 'cfg', 'conf', 'swift', 'dockerfile', 'license', 'mod', 'sum']);
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif' };

const isImage = (n) => IMG.has(ext(n));
const isText = (n) => TEXT.has(ext(n)) || TEXT.has(n.toLowerCase()) || !n.includes('.') || n.startsWith('.');
const fileIcon = (n) => (isImage(n) ? 'image' : /\.(md|txt|log|csv)$/i.test(n) ? 'file-text' : isText(n) ? 'file-code' : 'file');
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const b64ToText = (b64) => new TextDecoder('utf-8').decode(b64ToBytes(b64));
const textToB64 = (t) => toBase64(new TextEncoder().encode(t));
const joinPath = (a, b) => (a ? `${a}/${b}` : b);

export async function render(host, ctx) {
  const S = { repo: null, branch: null, path: ctx.params.path || '', q: '', sort: 'name', entries: [], loading: false, cache: new Map(), dates: new Map(), expanded: new Set(['']), writable: true, empty: false };
  let picker; let sortSel; let alive = true; let dateRun = 0;

  mount(host, html`
    <div class="page-head"><div><h1>File Explorer</h1><p>Browse your repository like a file manager. Every change is committed straight to GitHub.</p></div></div>
    <section class="card explorer-top"><div id="pickerSlot"></div></section>
    <div class="explorer" id="explorer" hidden>
      <aside class="card ex-tree"><div class="ex-tree-head">Folders</div><div id="folderTree" role="tree"></div></aside>
      <section class="card ex-main">
        <div class="ex-bar">
          <nav class="path-crumbs" id="crumbs" aria-label="Path"></nav>
          <div class="ex-actions">
            <button class="btn sm" id="newFolder">${ic('folder-plus', 'sm')}<span>New folder</span></button>
            <button class="btn sm" id="newFile">${ic('file-plus', 'sm')}<span>New file</span></button>
            <button class="btn sm" id="upFile">${ic('upload', 'sm')}<span>Upload files</span></button>
            <button class="btn sm" id="upDir">${ic('folder-up', 'sm')}<span>Upload folder</span></button>
            <button class="btn sm" id="upZip">${ic('archive', 'sm')}<span>Upload ZIP</span></button>
            <button class="btn sm icon-only" id="refresh" aria-label="Refresh" title="Refresh">${ic('refresh-cw', 'sm')}</button>
            <button class="btn sm icon-only" id="openGh" aria-label="Open on GitHub" title="Open on GitHub">${ic('arrow-up-right', 'sm')}</button>
            <input type="file" id="fileIn" multiple hidden>
            <input type="file" id="dirIn" webkitdirectory directory multiple hidden>
          </div>
        </div>
        <div class="ex-filter"><div class="input-wrap grow">${ic('search')}<input class="input" id="filter" type="search" placeholder="Filter this folder…" aria-label="Filter files"></div><div id="sortSlot" class="tb-select"></div></div>
        <div id="listing"></div>
      </section>
    </div>
    <div class="card" id="placeholder"><div class="empty"><div class="e-icon">${ic('files', 'lg')}</div><h3>Choose a repository</h3><p>Select a repository and branch above to start browsing.</p></div></div>`);

  sortSel = new Select({ value: 'name', size: 'sm', icon: 'arrow-up-down', ariaLabel: 'Sort files', options: [{ value: 'name', label: 'Name' }, { value: 'size', label: 'Size' }, { value: 'type', label: 'Type' }], onChange: (v) => { S.sort = v; drawList(); } });
  $('#sortSlot', host).appendChild(sortSel.el);

  picker = repoPicker($('#pickerSlot', host), {
    initialRepo: ctx.params.repo, initialBranch: ctx.params.branch,
    onChange: async ({ repo, branch, permissions, branches }) => {
      const changed = !S.repo || !repo || S.repo.fullName !== repo.fullName || S.branch !== branch;
      S.repo = repo; S.branch = branch; S.writable = !permissions || permissions.push !== false; S.empty = !!repo && !branches.length;
      $('#explorer', host).hidden = !repo; $('#placeholder', host).hidden = !!repo;
      if (!repo) return;
      if (changed) { S.cache.clear(); S.dates.clear(); S.expanded = new Set(['']); if (S.repo && ctx.params.repo !== repo.fullName) S.path = ''; await open(S.path); }
      toggleWrite();
    },
  });

  const toggleWrite = () => ['newFolder', 'newFile', 'upFile', 'upDir'].forEach((id) => { const b = $('#' + id, host); b.disabled = !S.writable || S.empty && id === 'newFile' && false; b.title = S.writable ? '' : 'Your token cannot write to this repository'; });
  const ghUrl = () => `${S.repo.htmlUrl}/tree/${encodeURIComponent(S.branch)}${S.path ? '/' + S.path.split('/').map(encodeURIComponent).join('/') : ''}`;
  const sync = () => history_replace();
  function history_replace() { const p = new URLSearchParams({ repo: S.repo.fullName, branch: S.branch, ...(S.path ? { path: S.path } : {}) }); try { window.history.replaceState(null, '', `#/explorer?${p}`); } catch { /* ignore */ } }

  /* ----------------------------- data */
  async function list(path, force = false) {
    const key = path;
    if (!force && S.cache.has(key)) return S.cache.get(key);
    const res = await api.list(S.repo.owner, S.repo.name, path, S.branch);
    S.cache.set(key, res.entries); return res.entries;
  }

  async function open(path, force = false) {
    S.path = path; S.q = ''; const f = $('#filter', host); if (f) f.value = '';
    S.loading = true; drawCrumbs(); mount($('#listing', host), html`<div class="ex-skel">${[1, 2, 3, 4, 5].map(() => html`<div class="skeleton" style="height:44px"></div>`)}</div>`);
    try { S.entries = S.empty ? [] : await list(path, force); } catch (e) { S.entries = []; S.loading = false; mount($('#listing', host), html`<div class="empty"><div class="e-icon">${ic('alert-circle', 'lg')}</div><h3>Could not open this folder</h3><p>${explain(e)}</p></div>`); return; }
    S.loading = false; sync(); drawList(); drawTree(); loadDates();
  }

  async function loadDates() {
    const run = ++dateRun; const files = S.entries.filter((e) => !S.dates.has(e.path)).slice(0, 30); let i = 0;
    const worker = async () => { while (i < files.length && alive && run === dateRun) { const e = files[i++]; try { const r = await api.commits(S.repo.owner, S.repo.name, S.branch, { path: e.path, per_page: 1 }); S.dates.set(e.path, r.commits[0] ? r.commits[0].date : null); } catch { S.dates.set(e.path, null); } const c = $(`[data-date="${CSS.escape(e.path)}"]`, host); if (c) c.textContent = S.dates.get(e.path) ? timeAgo(S.dates.get(e.path)) : '—'; } };
    await Promise.all([worker(), worker(), worker()]);
  }

  /* ----------------------------- drawing */
  function drawCrumbs() {
    const parts = S.path ? S.path.split('/') : [];
    mount($('#crumbs', host), html`<button data-p="">${ic('folder-git-2', 'sm')}${S.repo.name}</button>${parts.map((p, i) => html`${ic('chevron-right', 'sm')}<button data-p="${parts.slice(0, i + 1).join('/')}">${p}</button>`)}`);
    $$('#crumbs [data-p]', host).forEach((b) => b.addEventListener('click', () => open(b.dataset.p)));
  }

  function sorted() {
    let rows = S.entries.filter((e) => !S.q || e.name.toLowerCase().includes(S.q));
    const cmp = { name: (a, b) => a.name.localeCompare(b.name), size: (a, b) => (b.size || 0) - (a.size || 0), type: (a, b) => ext(a.name).localeCompare(ext(b.name)) || a.name.localeCompare(b.name) }[S.sort];
    return rows.sort((a, b) => (a.type === b.type ? cmp(a, b) : a.type === 'dir' ? -1 : 1));
  }

  function drawList() {
    const rows = sorted(); const el = $('#listing', host);
    if (!S.entries.length) {
      mount(el, html`<div class="empty"><div class="e-icon">${ic('folder', 'lg')}</div><h3>${S.empty ? 'This repository is empty' : 'This folder is empty'}</h3><p>${S.writable ? 'Upload files or a ZIP to get started.' : 'Nothing here yet.'}</p>${S.writable ? html`<button class="btn primary" id="emptyUp">${ic('cloud-upload', 'sm')}Upload ZIP</button>` : ''}</div>`);
      const b = $('#emptyUp', el); b && b.addEventListener('click', goZip); return;
    }
    if (!rows.length) { mount(el, html`<div class="empty small"><p>No files match “${S.q}”.</p></div>`); return; }
    mount(el, html`<div class="table-wrap"><table class="table files"><thead><tr><th>Name</th><th>Type</th><th class="num">Size</th><th>Last updated</th><th class="num">Actions</th></tr></thead><tbody>
      ${S.path ? html`<tr class="up" data-up><td colspan="5"><div class="cell-main">${ic('folder-open', 'sm')}<b>..</b><span class="cell-sub">Parent folder</span></div></td></tr>` : ''}
      ${rows.map((e) => html`<tr data-path="${e.path}" data-type="${e.type}" tabindex="0">
        <td data-label="Name"><div class="cell-main"><span class="tr-ic ${e.type === 'dir' ? 'dir' : ''}">${ic(e.type === 'dir' ? 'folder' : fileIcon(e.name), 'sm')}</span><b class="fname">${e.name}</b></div></td>
        <td data-label="Type"><span class="cell-sub mono">${e.type === 'dir' ? 'Folder' : ext(e.name) ? ext(e.name).toUpperCase() : 'File'}</span></td>
        <td data-label="Size" class="num"><span class="cell-sub">${e.type === 'dir' ? '—' : formatBytes(e.size)}</span></td>
        <td data-label="Updated"><span class="cell-sub" data-date="${e.path}">${S.dates.has(e.path) ? (S.dates.get(e.path) ? timeAgo(S.dates.get(e.path)) : '—') : '…'}</span></td>
        <td class="num"><button class="btn ghost icon-only sm" data-more aria-label="Actions for ${e.name}">${ic('more-horizontal', 'sm')}</button></td></tr>`)}
    </tbody></table></div>`);
    $('[data-up]', el)?.addEventListener('click', () => open(S.path.split('/').slice(0, -1).join('/')));
    $$('tbody tr[data-path]', el).forEach((tr) => {
      const e = S.entries.find((x) => x.path === tr.dataset.path);
      const act = () => (e.type === 'dir' ? open(e.path) : openFile(e));
      tr.addEventListener('click', (ev) => { if (!ev.target.closest('[data-more]')) act(); });
      tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') act(); });
      $('[data-more]', tr).addEventListener('click', (ev) => { ev.stopPropagation(); rowMenu(ev.currentTarget, e); });
    });
  }

  function rowMenu(anchor, e) {
    const w = S.writable;
    const items = e.type === 'dir'
      ? [{ label: 'Open', icon: 'folder-open', onClick: () => open(e.path) }, { label: 'Upload ZIP / folder here', icon: 'archive', onClick: () => goZip(e.path) }, { label: 'Open on GitHub', icon: 'arrow-up-right', href: safeUrl(e.htmlUrl) },
         ...(w ? ['sep', { label: 'Delete folder', icon: 'trash-2', danger: true, onClick: () => removeFolder(e) }] : [])]
      : [{ label: 'Preview', icon: 'eye', onClick: () => openFile(e) },
         ...(w && isText(e.name) ? [{ label: 'Edit', icon: 'pencil', onClick: () => openFile(e, true) }] : []),
         { label: 'Download', icon: 'download', onClick: () => download(e) },
         ...(w ? [{ label: 'Rename / move', icon: 'pencil', onClick: () => rename(e) }] : []),
         { label: 'Copy path', icon: 'copy', onClick: () => copyText(e.path).then(() => notify.success('Path copied')) },
         { label: 'Open on GitHub', icon: 'arrow-up-right', href: safeUrl(e.htmlUrl) },
         ...(w ? ['sep', { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => remove(e) }] : [])];
    popMenu(anchor, items);
  }

  /* folder tree (lazy) */
  async function drawTree() {
    const el = $('#folderTree', host); if (!el) return;
    const rows = [];
    const walk = (path, depth) => {
      const kids = (S.cache.get(path) || []).filter((x) => x.type === 'dir');
      for (const k of kids) { rows.push({ k, depth }); if (S.expanded.has(k.path)) walk(k.path, depth + 1); }
    };
    rows.push({ k: { name: S.repo.name, path: '', root: true }, depth: 0 }); walk('', 1);
    mount(el, html`${rows.map(({ k, depth }) => html`<div class="ft ${k.path === S.path ? 'active' : ''}" style="--d:${depth}" data-path="${k.path}" role="treeitem">
      <button class="tr-chev" data-t aria-label="Toggle ${k.name}">${ic(S.expanded.has(k.path) ? 'chevron-down' : 'chevron-right', 'sm')}</button>${ic(k.root ? 'folder-git-2' : S.expanded.has(k.path) ? 'folder-open' : 'folder', 'sm')}<span class="ft-name">${k.name}</span></div>`)}`);
    $$('.ft', el).forEach((n) => {
      const p = n.dataset.path;
      n.addEventListener('click', (ev) => { if (ev.target.closest('[data-t]')) return; open(p); });
      $('[data-t]', n).addEventListener('click', async () => {
        if (S.expanded.has(p)) S.expanded.delete(p); else { S.expanded.add(p); if (!S.cache.has(p) && !S.empty) { try { await list(p); } catch (e) { notify.error('Could not open folder', explain(e)); } } }
        drawTree();
      });
    });
  }

  /* ----------------------------- file actions */
  async function fetchFile(e) {
    const f = await api.file(S.repo.owner, S.repo.name, e.path, S.branch);
    return f;
  }

  async function download(e) {
    try {
      const f = await fetchFile(e);
      if (f.tooLarge) { window.open(safeUrl(f.downloadUrl || f.htmlUrl), '_blank', 'noopener'); return; }
      const blob = new Blob([b64ToBytes(f.content)], { type: MIME[ext(e.name)] || 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = e.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (er) { notify.error('Download failed', explain(er)); }
  }

  async function openFile(e, edit = false) {
    const m = modal({ title: e.name, subtitle: e.path, wide: true, body: html`<div class="viewer-loading"><div class="skeleton" style="height:240px"></div></div>`, footer: html`<span></span>` });
    m.el.querySelector('.modal').classList.add('viewer');
    try {
      const f = await fetchFile(e);
      if (f.tooLarge) return viewerFallback(m, e, 'This file is larger than 3 MB, so it can only be downloaded.');
      if (isImage(e.name)) {
        const bytes = b64ToBytes(f.content); const url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext(e.name)] }));
        mount(m.body, html`<div class="img-preview"><img src="${url}" alt="${e.name}"></div>`);
        footerBasic(m, e, f, null); return;
      }
      if (!isText(e.name)) return viewerFallback(m, e, 'No preview is available for this file type.');
      const text = b64ToText(f.content);
      if (text.includes('\u0000')) return viewerFallback(m, e, 'This looks like a binary file.');
      showText(m, e, f, text, edit);
    } catch (er) { mount(m.body, html`<div class="alert danger">${ic('alert-circle')}<div>${explain(er)}</div></div>`); }
  }

  function viewerFallback(m, e, msg) {
    mount(m.body, html`<div class="empty"><div class="e-icon">${ic('file', 'lg')}</div><h3>${e.name}</h3><p>${msg}</p></div>`);
    mount(m.foot, html`<button class="btn" data-close>Close</button><button class="btn primary" id="dl">${ic('download', 'sm')}Download</button>`);
    m.foot.querySelector('[data-close]').addEventListener('click', () => m.close()); $('#dl', m.foot).addEventListener('click', () => download(e));
  }

  function footerBasic(m, e, f) {
    mount(m.foot, html`<button class="btn" data-close>Close</button><a class="btn" href="${safeUrl(e.htmlUrl)}" target="_blank" rel="noopener noreferrer">${ic('arrow-up-right', 'sm')}Open on GitHub</a><button class="btn primary" id="dl">${ic('download', 'sm')}Download</button>`);
    m.foot.querySelector('[data-close]').addEventListener('click', () => m.close()); $('#dl', m.foot).addEventListener('click', () => download(e));
  }

  async function showText(m, e, f, text, startEdit) {
    const ex = ext(e.name); let original = text; let sha = f.sha; let mode = 'view'; let editor = null; let dirty = false;
    const canEdit = S.writable;
    const draw = async () => {
      m.body.innerHTML = '';
      const tabs = [];
      if (['md', 'markdown'].includes(ex)) tabs.push(['rendered', 'Rendered']); if (['html', 'htm'].includes(ex)) tabs.push(['rendered', 'Preview']); if (ex === 'svg') tabs.push(['rendered', 'Preview']);
      if (mode === 'rendered') {
        const box = document.createElement('div');
        if (['md', 'markdown'].includes(ex)) { box.className = 'md-preview'; box.innerHTML = renderMarkdown(original); }
        else if (ex === 'svg') { box.className = 'img-preview'; const img = document.createElement('img'); img.alt = e.name; img.src = URL.createObjectURL(new Blob([original], { type: 'image/svg+xml' })); box.appendChild(img); }
        else { box.className = 'html-preview'; const fr = document.createElement('iframe'); fr.setAttribute('sandbox', ''); fr.srcdoc = original; fr.title = `${e.name} preview`; box.appendChild(fr); }
        m.body.appendChild(box);
      } else if (mode === 'edit') {
        editor = codeEditor({ value: original, name: e.name, onChange: (v) => { dirty = v !== original; setFoot(); }, onSave: save });
        m.body.appendChild(editor.el); editor.focus();
      } else {
        const box = document.createElement('div'); box.className = 'code-view';
        const pre = document.createElement('pre'); const code = document.createElement('code'); pre.appendChild(code); box.appendChild(pre); m.body.appendChild(box);
        code.textContent = original; code.innerHTML = await highlight(original, e.name);
      }
      setFoot(tabs);
    };
    const setFoot = (tabs = []) => {
      mount(m.foot, html`
        <div class="foot-left">${tabs.length ? html`<div class="segmented"><button data-m="view" class="${mode !== 'rendered' ? 'active' : ''}">Code</button><button data-m="rendered" class="${mode === 'rendered' ? 'active' : ''}">${tabs[0][1]}</button></div>` : ''}<span class="cell-sub">${formatBytes(new TextEncoder().encode(editor ? editor.value : original).length)}${dirty ? ' · unsaved changes' : ''}</span></div>
        ${mode === 'edit' ? html`<input class="input commit-in" id="cm" value="Update ${e.name} via RepoFast" aria-label="Commit message"><button class="btn" id="discard">${ic('undo-2', 'sm')}Discard Changes</button><button class="btn primary" id="save" ${dirty ? '' : 'disabled'}>${ic('save', 'sm')}Save Changes</button>`
          : html`<button class="btn" data-close>Close</button>${canEdit ? html`<button class="btn" id="edit">${ic('pencil', 'sm')}Edit</button>` : ''}<button class="btn" id="dl">${ic('download', 'sm')}Download</button>`}`);
      $$('[data-m]', m.foot).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; draw(); }));
      $('[data-close]', m.foot)?.addEventListener('click', () => m.close());
      $('#edit', m.foot)?.addEventListener('click', () => { mode = 'edit'; dirty = false; draw(); });
      $('#dl', m.foot)?.addEventListener('click', () => download(e));
      $('#discard', m.foot)?.addEventListener('click', async () => { if (dirty && !(await confirmDialog({ title: 'Discard changes?', message: 'Your unsaved edits will be lost.', confirmText: 'Discard', danger: true }))) return; dirty = false; mode = 'view'; draw(); });
      $('#save', m.foot)?.addEventListener('click', save);
    };
    async function save() {
      if (!dirty) return;
      const btn = $('#save', m.foot); btn.classList.add('loading'); btn.innerHTML = `${ic('loader-2', 'sm spin')}Saving…`;
      const content = editor.value;
      try {
        const res = await api.updateFile({ owner: S.repo.owner, repo: S.repo.name, path: e.path, content: textToB64(content), message: ($('#cm', m.foot).value || `Update ${e.name} via RepoFast`).trim(), branch: S.branch, sha });
        sha = res.file.sha; original = content; dirty = false; e.sha = sha; e.size = res.file.size; S.cache.delete(S.path); S.dates.set(e.path, new Date().toISOString());
        notify.success('Changes saved', 'Commit created.', { href: res.commit.htmlUrl, linkText: 'View commit' });
        mode = 'view'; draw(); open(S.path, true);
      } catch (er) {
        const stale = er instanceof ApiError && (er.status === 409 || er.status === 422);
        notify.error(stale ? 'File changed on GitHub' : 'Could not save', stale ? 'Someone else changed this file. Close the editor and reopen it to get the latest version.' : explain(er));
        btn.classList.remove('loading'); btn.innerHTML = `${ic('save', 'sm')}Save Changes`;
      }
    }
    mode = startEdit && canEdit ? 'edit' : 'view'; draw();
    // Warn on close with unsaved changes
    const closeBtn = m.el.querySelector('[data-close]'); const orig = m.close.bind(m);
    m.close = async (r) => { if (dirty && !(await confirmDialog({ title: 'Discard unsaved changes?', message: 'You have edits that were not saved.', confirmText: 'Discard', danger: true }))) return; orig(r); };
    closeBtn && closeBtn.addEventListener('click', (ev) => { ev.stopImmediatePropagation(); m.close(); }, true);
  }

  function nameDialog({ title, label, value = '', confirmText, hint, placeholder }) {
    return new Promise((resolve) => {
      let out = null;
      const m = modal({ title, body: html`<div class="field"><label for="nm">${label}</label><input class="input mono" id="nm" value="${value}" placeholder="${placeholder || ''}" spellcheck="false" autocomplete="off"><div class="field-error" id="nmErr" hidden></div>${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`, footer: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">${confirmText}</button>`, onClose: () => resolve(out) });
      const input = $('#nm', m.el); input.focus(); input.select();
      const go = () => {
        const v = input.value.trim().replace(/^\/+|\/+$/g, ''); const err = $('#nmErr', m.el);
        const bad = !v ? 'This field is required.' : /(^|\/)\.\.?(\/|$)|(^|\/)\.git(\/|$)|\\|[\x00-\x1f]/i.test(v) ? 'That path is not allowed.' : '';
        if (bad) { err.hidden = false; err.textContent = bad; input.classList.add('invalid'); return; }
        out = v; m.close();
      };
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      $('#ok', m.el).addEventListener('click', go); input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
    });
  }

  async function rename(e) {
    const to = await nameDialog({ title: 'Rename or move file', label: 'New path', value: e.path, confirmText: 'Rename', hint: 'Use slashes to move it into another folder.' });
    if (!to || to === e.path) return;
    try {
      const res = await api.renameFile({ owner: S.repo.owner, repo: S.repo.name, branch: S.branch, from: e.path, to, sha: e.sha });
      notify.success('File renamed', `${e.path} → ${to}`, { href: res.commit.htmlUrl, linkText: 'View commit' });
      S.cache.clear(); await open(S.path, true);
    } catch (er) { notify.error('Rename failed', explain(er)); }
  }

  async function remove(e) {
    if (!(await confirmDialog({ title: `Delete ${e.name}?`, message: 'This creates a commit that removes the file. You can restore it from the commit history.', confirmText: 'Delete file', danger: true, details: html`<span class="mono">${e.path}</span>` }))) return;
    const m = modal({ title: 'Deleting file', body: html`<div class="del-progress"><span class="spin-wrap">${ic('loader-2', 'lg spin')}</span><div><b>${e.path}</b><p class="cell-sub">Creating a commit…</p></div></div>`, dismissable: false });
    try {
      const res = await api.deletePath({ owner: S.repo.owner, repo: S.repo.name, path: e.path, branch: S.branch });
      m.close();
      notify.success('File deleted', e.path, { href: res.commit.htmlUrl, linkText: 'View commit' });
      S.cache.clear(); S.dates.clear(); await open(S.path, true);
    } catch (er) { m.close(); notify.error('Delete failed', explain(er)); }
  }

  async function removeFolder(e) {
    const ok = await confirmDialog({ title: `Delete folder “${e.name}”?`, message: 'Every file inside this folder (including subfolders) will be removed in a single commit. You can restore them from the commit history.', confirmText: 'Delete folder', danger: true, details: html`<span class="mono">${e.path}/</span>` });
    if (!ok) return;
    const m = modal({ title: 'Deleting folder', body: html`<div class="del-progress"><span class="spin-wrap">${ic('loader-2', 'lg spin')}</span><div><b>${e.path}/</b><p class="cell-sub">Creating one commit that removes every file…</p></div></div>`, dismissable: false });
    try {
      const res = await api.deletePath({ owner: S.repo.owner, repo: S.repo.name, branch: S.branch, path: e.path });
      m.close();
      notify.success('Folder deleted', `${res.deleted} file(s) removed from ${e.path}`, { href: res.commit.htmlUrl, linkText: 'View commit' });
      S.cache.clear(); S.dates.clear(); S.expanded.delete(e.path);
      if (S.path === e.path || S.path.startsWith(e.path + '/')) S.path = e.path.split('/').slice(0, -1).join('/');
      await open(S.path, true);
    } catch (er) { m.close(); notify.error('Could not delete folder', explain(er)); }
  }

  async function newFolder() {
    const name = await nameDialog({ title: 'New folder', label: 'Folder name', confirmText: 'Create folder', placeholder: 'docs', hint: 'Git cannot store empty folders, so a .gitkeep file is added inside.' });
    if (!name) return;
    try {
      const res = await api.updateFile({ owner: S.repo.owner, repo: S.repo.name, path: joinPath(joinPath(S.path, name), '.gitkeep'), content: '', message: `Create folder ${joinPath(S.path, name)} via RepoFast`, branch: S.branch });
      notify.success('Folder created', joinPath(S.path, name), { href: res.commit.htmlUrl, linkText: 'View commit' });
      S.cache.clear(); S.empty = false; await open(S.path, true);
    } catch (er) { notify.error('Could not create folder', explain(er)); }
  }

  async function newFile() {
    const name = await nameDialog({ title: 'New file', label: 'File name', confirmText: 'Create file', placeholder: 'notes.md' });
    if (!name) return;
    const path = joinPath(S.path, name);
    try {
      const res = await api.updateFile({ owner: S.repo.owner, repo: S.repo.name, path, content: '', message: `Create ${path} via RepoFast`, branch: S.branch });
      notify.success('File created', path, { href: res.commit.htmlUrl, linkText: 'View commit' });
      S.cache.clear(); S.empty = false; await open(S.path, true);
      const e = S.entries.find((x) => x.path === path); if (e) openFile(e, true);
    } catch (er) { notify.error('Could not create file', explain(er)); }
  }

  /** Uploads several local files in ONE commit via the same engine used for ZIPs. */
  async function uploadFiles(files) {
    const list = [...files].filter((f) => !/(^|\/)(\.git|node_modules|__MACOSX)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(f.webkitRelativePath || f.name)).map((f) => ({ path: joinPath(S.path, f.webkitRelativePath || f.name), size: f.size, entry: { async: async () => new Uint8Array(await f.arrayBuffer()) } }));
    if (!list.length) return;
    const msg = list.length === 1 ? `Add ${list[0].path} via RepoFast` : `Add ${list.length} files via RepoFast`;
    let plan;
    try { plan = await api.checkConflicts({ owner: S.repo.owner, repo: S.repo.name, branch: S.branch, paths: list.map((f) => f.path) }); }
    catch (er) { if (S.empty) plan = { empty: true, existing: [], head: null, baseTree: null }; else { notify.error('Could not check the repository', explain(er)); return; } }
    if (plan.existing.length && !(await confirmDialog({ title: `Replace ${plan.existing.length} existing file(s)?`, message: 'Files with the same name in this folder will be overwritten.', confirmText: 'Replace and upload' }))) return;
    const ctl = new AbortController();
    const m = modal({ title: 'Uploading files', body: html`<div class="progress lg"><i id="upb"></i></div><p class="cell-sub mono" id="upc">Starting…</p><div class="flog mini" id="upl"></div>`, dismissable: false });
    const recent = [];
    const onFile = (ev) => {
      if (ev.status === 'reading') return;
      const i = recent.findIndex((r) => r.path === ev.path); if (i >= 0) recent.splice(i, 1);
      recent.push(ev); if (recent.length > 8) recent.shift();
      const box = $('#upl', m.el); if (!box) return;
      const T = { uploading: ['loader-2', 'Uploading'], done: ['check-circle-2', 'Uploaded'], error: ['alert-circle', 'Failed'], cancelled: ['x', 'Cancelled'] };
      box.innerHTML = recent.map((r) => `<div class="fl ${r.status}"><span class="fl-ic">${ic(T[r.status][0], 'sm' + (r.status === 'uploading' ? ' spin' : ''))}</span><span class="fl-name mono">${esc(r.path)}</span><span class="fl-meta">${T[r.status][1]}</span></div>`).join('');
    };
    try {
      const res = await runUpload(list, { owner: S.repo.owner, repo: S.repo.name, branch: S.branch, message: msg, plan, signal: ctl.signal, onFile, onProgress: (p) => { const b = $('#upb', m.el); if (b) b.style.width = `${p.percent}%`; const c = $('#upc', m.el); if (c) c.textContent = `${p.percent}% · ${p.current}`; } });
      m.close(); S.cache.clear(); S.empty = false;
      history.add({ zipName: list.length === 1 ? list[0].path.split('/').pop() : `${list.length} files`, repo: S.repo.fullName, repoUrl: S.repo.htmlUrl, branch: S.branch, files: list.length, commitSha: res.commitSha, commitUrl: res.commitUrl, message: msg, status: 'success', bytes: list.reduce((n, f) => n + f.size, 0) });
      notify.success('Files uploaded successfully', `${list.length} file(s) in one commit.`, { href: res.commitUrl, linkText: 'View commit' });
      await open(S.path, true);
    } catch (er) { m.close(); notify.error('Upload failed', explain(er)); }
  }

  function goZip(path) { navigate('upload', { repo: S.repo.fullName, ...(typeof path === 'string' && path ? { dest: path } : S.path ? { dest: S.path } : {}) }); }

  /* ----------------------------- wiring */
  $('#newFolder', host).addEventListener('click', newFolder);
  $('#newFile', host).addEventListener('click', newFile);
  $('#upFile', host).addEventListener('click', () => $('#fileIn', host).click());
  $('#fileIn', host).addEventListener('change', (e) => { const f = e.target.files; if (f.length) uploadFiles(f).finally(() => { e.target.value = ''; }); });
  $('#upDir', host).addEventListener('click', () => $('#dirIn', host).click());
  $('#dirIn', host).addEventListener('change', (e) => { const f = e.target.files; if (f.length) uploadFiles(f).finally(() => { e.target.value = ''; }); });
  $('#upZip', host).addEventListener('click', () => goZip());
  $('#refresh', host).addEventListener('click', async (e) => { const b = e.currentTarget; b.classList.add('loading'); S.cache.clear(); S.dates.clear(); await picker.refreshBranches(); await open(S.path, true); b.classList.remove('loading'); });
  $('#openGh', host).addEventListener('click', () => window.open(ghUrl(), '_blank', 'noopener'));
  $('#filter', host).addEventListener('input', debounce((e) => { S.q = e.target.value.trim().toLowerCase(); drawList(); }, 120));
  // Drop files onto the listing to upload
  const lst = $('#listing', host);
  lst.addEventListener('dragover', (e) => { if (S.writable) e.preventDefault(); });
  lst.addEventListener('drop', (e) => { if (!S.writable || !e.dataTransfer.files.length) return; e.preventDefault(); uploadFiles(e.dataTransfer.files); });

  return { cleanup() { alive = false; picker.destroy(); sortSel.destroy(); } };
}
