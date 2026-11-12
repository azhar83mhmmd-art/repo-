// Upload ZIP page: dropzone → ZIP preview/tree → configuration → live progress → success.
import { html, mount, create, ic, $, $$, formatBytes, ext, debounce, copyText, safeUrl, shortSha } from './ui/dom.js';
import { Select } from './ui/select.js';
import { confirmDialog } from './ui/overlay.js';
import { repoPicker } from './ui/repo-picker.js';
import { readZip, buildTree, resolvePath, ZipError, LIMITS } from './zip-manager.js';
import { runUpload, UploadCancelled, MAX_DIRECT_BYTES } from './upload-engine.js';
import { api, explain } from './github-client.js';
import { notify } from './notification.js';
import { prefs, history } from './store.js';
import { state } from './app-state.js';
import { invalidateRepos } from './repos.js';

const PRESET_DIRS = ['src', 'public', 'assets', 'uploads'];
const BRANCH_BAD = /[\x00-\x20~^:?*[\\\x7f]|\.\.|@\{|\/\/|^[-/]|[/.]$|\.lock$/;

const PHASES = [
  ['prepare', 'Preparing ZIP'], ['validating', 'Validating files'], ['blobs', 'Creating Git blobs'],
  ['tree', 'Building Git tree'], ['commit', 'Creating commit'], ['branch', 'Updating branch'], ['done', 'Completed'],
];

export async function render(host, ctx) {
  const P = prefs.get();
  const S = {
    zip: null, removed: new Set(), selected: new Set(), expanded: new Set(), q: '', rows: 300,
    structure: P.structure, conflict: P.conflict, dest: '', destMode: 'root', // root | preset | custom
    message: P.commitMessage, createBranch: false, newBranch: '', authorName: '', authorEmail: '',
    picker: null, info: null, repoDirs: [], running: false, abort: null,
  };
  if (ctx.params.dest) { S.destMode = 'custom'; S.dest = ctx.params.dest; S.structure = 'custom'; }
  let destSel = null;
  const cleanups = [];

  /* ---------------------------------------------------------------- landing */
  function drawLanding() {
    mount(host, html`
      <div class="page-head"><div><h1>Upload your project</h1><p>Upload an entire project to GitHub in seconds. No need to upload files individually.</p></div></div>
      <div class="dropzone" id="drop" tabindex="0" role="button" aria-label="Choose a ZIP file to upload">
        <div class="dz-icon">${ic('cloud-upload', 'xl')}</div>
        <h2>Drag and Drop your ZIP file here</h2>
        <p>Or <button type="button" class="link-btn" id="browse">browse files</button></p>
        <div class="dz-meta"><span class="badge">${ic('archive', 'sm')}.ZIP</span><span class="badge">Max ${P.maxUploadMB} MB</span><span class="badge">Up to ${LIMITS.MAX_FILES.toLocaleString()} files</span></div>
        <input type="file" id="file" accept=".zip,application/zip,application/x-zip-compressed" hidden>
      </div>
      <div class="dz-notes">
        <div>${ic('shield-check')}<span>Processed in your browser. The ZIP is never stored on a server.</span></div>
        <div>${ic('git-commit-horizontal')}<span>All files land in a single commit.</span></div>
        <div>${ic('folder')}<span>Your folder structure is preserved.</span></div>
      </div>`);
    const drop = $('#drop', host); const input = $('#file', host);
    const pick = () => input.click();
    $('#browse', host).addEventListener('click', (e) => { e.stopPropagation(); pick(); });
    drop.addEventListener('click', pick);
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    input.addEventListener('change', () => input.files[0] && load(input.files[0]));
    let depth = 0;
    drop.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; drop.classList.add('over'); });
    drop.addEventListener('dragover', (e) => e.preventDefault());
    drop.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.classList.remove('over'); } });
    drop.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) load(f); });
  }

  async function load(file) {
    const max = P.maxUploadMB * 1024 * 1024;
    if (file.size > max) { notify.error('ZIP is too large', `This ZIP is ${formatBytes(file.size)}. Your limit is ${P.maxUploadMB} MB (change it in Settings).`); return; }
    if (file.size > 50 * 1024 * 1024) notify.warning('Large ZIP file', 'Large uploads take longer and use more memory. Keep this tab open.');
    mount(host, html`<div class="page-head"><div><h1>Upload your project</h1></div></div><div class="card pad extracting"><div class="spinner-lg">${ic('loader-2', 'xl spin')}</div><div><h3>Extracting ${file.name}</h3><p class="cell-sub">Validating structure and checking for unsafe paths…</p></div></div>`);
    try {
      const zip = await readZip(file, { ignoreSystem: P.ignoreSystemFiles, maxBytes: LIMITS.MAX_TOTAL_UNCOMPRESSED });
      S.zip = zip; S.removed = new Set(); S.selected = new Set(zip.files.map((f) => f.path)); S.expanded = new Set(); S.q = ''; S.rows = 300;
      notify.success('ZIP extracted successfully', `${zip.files.length.toLocaleString()} files, ${zip.folders.length.toLocaleString()} folders.`);
      const sk = zip.skipped.system + zip.skipped.unsafe + zip.skipped.git;
      if (sk) notify.warning('Some files will be skipped', `${zip.skipped.system} system, ${zip.skipped.git} .git and ${zip.skipped.unsafe} unsafe entries were ignored.`);
      if (zip.duplicates.length) notify.warning('Duplicate paths ignored', `${zip.duplicates.length} entries differ only by letter case.`);
      drawWorkspace();
    } catch (e) {
      notify.error(e instanceof ZipError ? 'Invalid ZIP file' : 'Could not read ZIP', e instanceof ZipError ? e.message : explain(e));
      drawLanding();
    }
  }

  /* ---------------------------------------------------------------- derived data */
  const liveFiles = () => S.zip.files.filter((f) => !S.removed.has(f.path));
  const chosenFiles = () => liveFiles().filter((f) => S.selected.has(f.path));
  const destination = () => (S.destMode === 'root' ? '' : S.dest.trim().replace(/^\/+|\/+$/g, ''));
  const finalPath = (f) => resolvePath(f.path, { structure: S.structure, rootFolder: S.zip.rootFolder, destination: destination() });
  const target = () => ({ repo: S.picker && S.picker.repo, branch: S.picker && S.picker.branch });

  function summary() {
    const files = chosenFiles();
    const dirs = new Set();
    files.forEach((f) => { const p = f.path.split('/'); for (let i = 1; i < p.length; i++) dirs.add(p.slice(0, i).join('/')); });
    return { files, count: files.length, folders: dirs.size, bytes: files.reduce((n, f) => n + f.size, 0) };
  }

  /* ---------------------------------------------------------------- workspace */
  function drawWorkspace() {
    const z = S.zip;
    mount(host, html`
      <div class="page-head"><div><h1>Upload your project</h1><p>Review the files, choose where they go, then push everything in one commit.</p></div></div>
      <section class="card zip-card">
        <div class="zip-ic">${ic('archive', 'lg')}</div>
        <div class="zip-main"><b class="zip-name">${z.name}</b>
          <div class="zip-stats"><span>${formatBytes(z.size)}</span><span>${z.files.length.toLocaleString()} files</span><span>${z.folders.length.toLocaleString()} folders</span><span class="badge success">${ic('check-circle-2', 'sm')}Extracted</span>${z.rootFolder ? html`<span class="badge info mono">${ic('folder', 'sm')}${z.rootFolder}/</span>` : ''}</div></div>
        <div class="zip-actions"><button class="btn sm" id="change">${ic('refresh-cw', 'sm')}Change ZIP</button><button class="btn sm ghost" id="removeZip">${ic('trash-2', 'sm')}Remove ZIP</button></div>
        <input type="file" id="file2" accept=".zip,application/zip,application/x-zip-compressed" hidden>
      </section>
      <div class="upload-grid">
        <section class="card tree-card">
          <div class="card-head"><div><h2>File structure</h2><p id="treeSummary"></p></div>
            <div class="tree-tools"><button class="btn sm" id="selAll">Select all</button><button class="btn sm" id="selNone">Deselect all</button></div></div>
          <div class="tree-search"><div class="input-wrap">${ic('search')}<input class="input" id="treeQ" type="search" placeholder="Search filename…" aria-label="Search files"></div></div>
          <div class="tree" id="tree" role="tree"></div>
        </section>
        <aside class="config" id="config"></aside>
      </div>`);

    $('#change', host).addEventListener('click', () => $('#file2', host).click());
    $('#file2', host).addEventListener('change', (e) => e.target.files[0] && load(e.target.files[0]));
    $('#removeZip', host).addEventListener('click', () => { teardown(); S.zip = null; drawLanding(); });
    $('#selAll', host).addEventListener('click', () => { liveFiles().forEach((f) => S.selected.add(f.path)); drawTree(); drawConfigState(); });
    $('#selNone', host).addEventListener('click', () => { S.selected.clear(); drawTree(); drawConfigState(); });
    $('#treeQ', host).addEventListener('input', debounce((e) => { S.q = e.target.value.trim().toLowerCase(); S.rows = 300; drawTree(); }, 120));
    drawConfig();
    drawTree();
  }

  function teardown() { S.picker && S.picker.destroy(); S.picker = null; destSel && destSel.destroy(); destSel = null; }

  /* ---------------------------------------------------------------- tree */
  function liveTree() {
    const t = buildTree(liveFiles());
    const annotate = (n) => { if (n.type === 'file') return [n.path]; n.files = []; for (const c of n.children.values()) n.files.push(...annotate(c)); return n.files; };
    annotate(t);
    return t;
  }

  function drawTree() {
    const treeEl = $('#tree', host); if (!treeEl) return;
    const root = liveTree();
    const rows = [];
    const matches = S.q ? liveFiles().filter((f) => f.path.toLowerCase().includes(S.q)) : null;
    if (matches) {
      matches.forEach((f) => rows.push({ node: { name: f.path.split('/').pop(), path: f.path, type: 'file', size: f.size }, depth: 0, sub: f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '' }));
    } else {
      const walk = (n, d) => {
        const kids = [...n.children.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
        for (const c of kids) {
          rows.push({ node: c, depth: d });
          if (c.type === 'dir' && S.expanded.has(c.path)) walk(c, d + 1);
        }
      };
      // Auto-expand the first level once
      if (!S._autoExpanded) { S._autoExpanded = true; for (const c of root.children.values()) if (c.type === 'dir') S.expanded.add(c.path); }
      walk(root, 0);
    }
    const shown = rows.slice(0, S.rows);
    if (!rows.length) { mount(treeEl, html`<div class="empty small"><p>${matches ? 'No files match your search.' : 'No files left in the upload.'}</p></div>`); drawSummary(); return; }
    mount(treeEl, html`${shown.map(({ node, depth, sub }) => {
      const isDir = node.type === 'dir';
      const paths = isDir ? node.files : [node.path];
      const sel = paths.filter((p) => S.selected.has(p)).length;
      const state = sel === 0 ? 0 : sel === paths.length ? 2 : 1;
      return html`<div class="tr" role="treeitem" style="--d:${depth}" data-path="${node.path}" data-type="${node.type}">
        ${isDir ? html`<button class="tr-chev" data-toggle aria-label="${S.expanded.has(node.path) ? 'Collapse' : 'Expand'} ${node.name}">${ic(S.expanded.has(node.path) ? 'chevron-down' : 'chevron-right', 'sm')}</button>` : html`<span class="tr-chev"></span>`}
        <label class="check"><input type="checkbox" data-check ${state === 2 ? 'checked' : ''} data-ind="${state === 1}" aria-label="Select ${node.name}"></label>
        <span class="tr-ic ${isDir ? 'dir' : ''}">${ic(isDir ? (S.expanded.has(node.path) ? 'folder-open' : 'folder') : /\.(js|ts|jsx|tsx|json|html|css|py|go|rs|java|php|sh|md|yml|yaml)$/i.test(node.name) ? 'file-code' : 'file', 'sm')}</span>
        <span class="tr-name" title="${node.path}">${node.name}${sub ? html`<small class="mono">${sub}</small>` : ''}</span>
        <span class="tr-meta">${isDir ? `${paths.length} file${paths.length === 1 ? '' : 's'}` : html`${ext(node.name) ? html`<span class="ext mono">.${ext(node.name)}</span>` : ''}${formatBytes(node.size)}`}</span>
        <button class="btn ghost icon-only sm tr-x" data-remove aria-label="Remove ${node.name} from upload" title="Remove from upload">${ic('x', 'sm')}</button>
      </div>`;
    })}${rows.length > shown.length ? html`<div class="more-row"><button class="btn sm" id="moreRows">Show ${Math.min(300, rows.length - shown.length)} more <span class="cell-sub">(${(rows.length - shown.length).toLocaleString()} hidden)</span></button></div>` : ''}`);

    $$('.tr', treeEl).forEach((row) => {
      const path = row.dataset.path; const isDir = row.dataset.type === 'dir';
      const cb = $('[data-check]', row);
      cb.indeterminate = cb.dataset.ind === 'true';
      cb.addEventListener('change', () => {
        const node = findNode(root, path);
        const list = isDir ? node.files : [path];
        list.forEach((p) => (cb.checked ? S.selected.add(p) : S.selected.delete(p)));
        drawTree(); drawConfigState();
      });
      const tg = $('[data-toggle]', row);
      if (tg) tg.addEventListener('click', () => { S.expanded.has(path) ? S.expanded.delete(path) : S.expanded.add(path); drawTree(); });
      if (isDir) $('.tr-name', row).addEventListener('click', () => { S.expanded.has(path) ? S.expanded.delete(path) : S.expanded.add(path); drawTree(); });
      $('[data-remove]', row).addEventListener('click', () => {
        const node = findNode(root, path);
        (isDir ? node.files : [path]).forEach((p) => { S.removed.add(p); S.selected.delete(p); });
        drawTree(); drawConfigState();
      });
    });
    const more = $('#moreRows', treeEl); if (more) more.addEventListener('click', () => { S.rows += 300; drawTree(); });
    drawSummary();
  }
  function findNode(root, path) { let n = root; for (const part of path.split('/')) n = n.children.get(part); return n; }

  function drawSummary() {
    const s = summary(); const el = $('#treeSummary', host); if (!el) return;
    el.textContent = `${s.count.toLocaleString()} files · ${s.folders.toLocaleString()} folders · ${formatBytes(s.bytes)} selected`;
  }

  /* ---------------------------------------------------------------- config panel */
  function drawConfig() {
    const cfg = $('#config', host);
    mount(cfg, html`
      <section class="card cfg">
        <div class="card-head"><div><h2>Repository destination</h2><p>Where should these files go?</p></div></div>
        <div class="card-body stack">
          <div id="pickerSlot"></div>
          <div class="field"><label>Destination folder</label><div id="destSlot"></div></div>
          <div class="field" id="customWrap" hidden><label for="customDest">Custom path</label><input class="input mono" id="customDest" placeholder="e.g. apps/website" spellcheck="false"><div class="field-error" id="destErr" hidden></div></div>
        </div>
      </section>
      <section class="card cfg">
        <div class="card-head"><div><h2>ZIP structure</h2></div></div>
        <div class="card-body option-cards">
          ${[['preserve', 'Preserve ZIP Structure', 'Keep every folder exactly as in the ZIP.'],
             ['strip-root', 'Remove Root Folder', 'Drop the single wrapper folder around the project.'],
             ['custom', 'Custom Destination', 'Place the ZIP contents inside a path you choose.']].map(([v, t, d]) => html`
            <label class="option-card"><input type="radio" name="structure" value="${v}" ${S.structure === v ? 'checked' : ''}><span class="radio"></span><span><b>${t}</b><small>${d}</small></span></label>`)}
        </div>
      </section>
      <section class="card cfg">
        <div class="card-head"><div><h2>If a file already exists</h2></div></div>
        <div class="card-body option-cards">
          ${[['replace', 'Replace Existing Files', 'Overwrite files with the same path. Other files are never touched.'],
             ['skip', 'Skip Existing Files', 'Only add files that are not in the repository yet.'],
             ['cancel', 'Cancel Upload', 'Stop if any file would be overwritten.']].map(([v, t, d]) => html`
            <label class="option-card"><input type="radio" name="conflict" value="${v}" ${S.conflict === v ? 'checked' : ''}><span class="radio"></span><span><b>${t}</b><small>${d}</small></span></label>`)}
        </div>
      </section>
      <section class="card cfg">
        <div class="card-head"><div><h2>Commit</h2></div></div>
        <div class="card-body stack">
          <div class="field"><label for="msg">Commit message</label><input class="input" id="msg" maxlength="200" value="${S.message}"></div>
          <div class="switch-row"><div><b>Create new branch</b><small>Commit to a new branch instead of the selected one.</small></div><label class="switch"><input type="checkbox" id="newBranchSw" ${S.createBranch ? 'checked' : ''}><i></i></label></div>
          <div class="field" id="nbWrap" ${S.createBranch ? '' : 'hidden'}><label for="nb">New branch name</label><input class="input mono" id="nb" placeholder="feature/upload" value="${S.newBranch}" spellcheck="false"><div class="field-error" id="nbErr" hidden></div></div>
          <details class="author"><summary>Commit author (optional)</summary>
            <div class="field-row" style="margin-top:12px"><div class="field"><label for="an">Name</label><input class="input" id="an" value="${S.authorName}" autocomplete="off"></div><div class="field"><label for="ae">Email</label><input class="input" id="ae" type="email" value="${S.authorEmail}" autocomplete="off"></div></div>
            <p class="hint">Leave empty to use your GitHub identity.</p></details>
        </div>
      </section>
      <section class="card cfg preview-card">
        <div class="card-head"><div><h2>Final path preview</h2><p id="pvTarget"></p></div></div>
        <div class="card-body"><div class="path-preview mono" id="pv"></div><div id="pvAlerts"></div></div>
      </section>
      <button class="btn primary lg block" id="startUpload">${ic('cloud-upload')}Upload to GitHub</button>`);

    // Repo + branch picker
    S.picker = repoPicker($('#pickerSlot', host), {
      initialRepo: ctx.params.repo,
      onChange: async (v) => { S.info = v; await loadDirs(); drawConfigState(); },
    });

    destSel = new Select({ value: S.destMode === 'root' ? '/' : S.destMode === 'custom' ? '__custom' : S.dest, icon: 'folder', searchable: false, ariaLabel: 'Destination folder', options: destOptions(), onChange: (v) => {
      if (v === '/') { S.destMode = 'root'; S.dest = ''; }
      else if (v === '__custom') { S.destMode = 'custom'; if (S.structure !== 'custom') { S.structure = 'custom'; setRadio('structure', 'custom'); } }
      else { S.destMode = 'preset'; S.dest = v; }
      drawConfigState(); if (v === '__custom') setTimeout(() => $('#customDest', host).focus(), 0);
    } });
    $('#destSlot', host).appendChild(destSel.el);

    $$('input[name=structure]', host).forEach((r) => r.addEventListener('change', () => {
      S.structure = r.value;
      if (r.value === 'custom' && S.destMode !== 'custom') { S.destMode = 'custom'; destSel.setValue('__custom'); setTimeout(() => $('#customDest', host).focus(), 0); }
      drawConfigState();
    }));
    $$('input[name=conflict]', host).forEach((r) => r.addEventListener('change', () => { S.conflict = r.value; }));
    $('#customDest', host).addEventListener('input', (e) => { S.dest = e.target.value; drawConfigState(); });
    $('#msg', host).addEventListener('input', (e) => { S.message = e.target.value; drawConfigState(); });
    $('#newBranchSw', host).addEventListener('change', (e) => { S.createBranch = e.target.checked; $('#nbWrap', host).hidden = !S.createBranch; drawConfigState(); });
    $('#nb', host).addEventListener('input', (e) => { S.newBranch = e.target.value.trim(); drawConfigState(); });
    $('#an', host).addEventListener('input', (e) => { S.authorName = e.target.value; });
    $('#ae', host).addEventListener('input', (e) => { S.authorEmail = e.target.value; });
    $('#startUpload', host).addEventListener('click', start);
    drawConfigState();
  }

  const setRadio = (name, v) => { const r = $(`input[name=${name}][value=${v}]`, host); if (r) r.checked = true; };

  function destOptions() {
    const dirs = [...new Set([...PRESET_DIRS, ...S.repoDirs])].sort();
    return [{ value: '/', label: '/ (repository root)', icon: 'folder-git-2' }, ...dirs.map((d) => ({ value: d, label: `/${d}`, icon: 'folder', sub: S.repoDirs.includes(d) ? 'exists' : '' })), { value: '__custom', label: 'Custom path…', icon: 'pencil' }];
  }

  async function loadDirs() {
    const { repo, branch } = target();
    if (!repo || !branch) { S.repoDirs = []; destSel && destSel.setOptions(destOptions()); return; }
    try {
      const res = await api.list(repo.owner, repo.name, '', branch);
      S.repoDirs = res.entries.filter((e) => e.type === 'dir').map((e) => e.name).slice(0, 40);
    } catch { S.repoDirs = []; }
    destSel && destSel.setOptions(destOptions());
  }

  function problems() {
    const out = []; const { repo, branch } = target(); const s = summary();
    if (!repo) out.push('Select a repository.');
    else if (S.info && !S.info.branches.length) { /* empty repo is allowed */ }
    else if (!branch) out.push('Select a branch.');
    if (S.info && S.info.permissions && S.info.permissions.push === false) out.push('Your token cannot push to this repository.');
    if (!s.count) out.push('Select at least one file.');
    if (!S.message.trim()) out.push('Enter a commit message.');
    if (S.createBranch && (!S.newBranch || BRANCH_BAD.test(S.newBranch))) out.push('Enter a valid new branch name.');
    if (S.structure === 'custom' && !destination()) out.push('Enter a custom destination path.');
    if (S.destMode === 'custom') { try { if (destination() && /(^|\/)\.\.?(\/|$)|(^|\/)\.git(\/|$)/i.test(destination())) out.push('Destination path is not allowed.'); } catch { /* */ } }
    return out;
  }

  function drawConfigState() {
    if (!$('#pv', host)) return;
    const { repo, branch } = target();
    const files = chosenFiles();
    const sample = files.slice(0, 8).map(finalPath);
    const branchLabel = S.createBranch && S.newBranch ? `${S.newBranch} (new, from ${branch || '…'})` : branch || '…';
    $('#pvTarget', host).textContent = repo ? `${repo.fullName} @ ${branchLabel}` : 'Select a repository to see the final location';
    mount($('#pv', host), files.length ? html`${sample.map((p) => html`<div><span class="dim">/</span>${p}</div>`)}${files.length > 8 ? html`<div class="dim">… and ${(files.length - 8).toLocaleString()} more</div>` : ''}` : html`<div class="dim">No files selected.</div>`);
    $('#customWrap', host).hidden = S.destMode !== 'custom';
    const alerts = [];
    if (S.structure === 'strip-root' && !S.zip.rootFolder) alerts.push(html`<div class="alert" style="margin-top:12px">${ic('info')}<div>This ZIP has no single root folder, so paths stay unchanged.</div></div>`);
    const big = files.filter((f) => f.size > MAX_DIRECT_BYTES);
    if (big.length) alerts.push(html`<div class="alert warning" style="margin-top:12px">${ic('alert-triangle')}<div>${big.length} file(s) over 50 MB will be skipped — use Git LFS for large files.</div></div>`);
    mount($('#pvAlerts', host), html`${alerts}`);
    const errs = problems();
    const btn = $('#startUpload', host);
    btn.disabled = errs.length > 0; btn.title = errs[0] || '';
    const nbErr = $('#nbErr', host);
    if (nbErr) { const bad = S.createBranch && S.newBranch && BRANCH_BAD.test(S.newBranch); nbErr.hidden = !bad; nbErr.textContent = bad ? 'That is not a valid branch name.' : ''; }
    drawSummary();
  }

  /* ---------------------------------------------------------------- upload flow */
  async function start() {
    const errs = problems(); if (errs.length) { notify.warning('Cannot upload yet', errs[0]); return; }
    const { repo } = target();
    const baseBranch = S.picker.branch || repo.defaultBranch;
    const files = chosenFiles().map((f) => ({ ...f, path: finalPath(f) })).filter((f) => f.size <= MAX_DIRECT_BYTES);
    if (!files.length) { notify.warning('Nothing to upload', 'All selected files are over 50 MB.'); return; }

    const btn = $('#startUpload', host); btn.classList.add('loading'); btn.innerHTML = `${ic('loader-2', 'spin')}Checking repository…`;
    let plan;
    try {
      plan = await api.checkConflicts({ owner: repo.owner, repo: repo.name, branch: baseBranch, paths: files.map((f) => f.path) });
    } catch (e) {
      // An empty repository has no branch yet.
      if (S.info && !S.info.branches.length) plan = { empty: true, existing: [], head: null, baseTree: null };
      else { notify.error('Could not check the repository', explain(e)); btn.classList.remove('loading'); btn.innerHTML = `${ic('cloud-upload')}Upload to GitHub`; return; }
    }
    btn.classList.remove('loading'); btn.innerHTML = `${ic('cloud-upload')}Upload to GitHub`;

    let list = files;
    if (plan.truncated) notify.warning('Large repository', 'GitHub truncated the file list, so existing-file detection may be incomplete.');
    if (plan.existing.length) {
      const names = plan.existing.slice(0, 5).map((e) => e.path).join(', ');
      notify.warning('Existing files detected', `${plan.existing.length} file(s) already exist in ${repo.name}.`);
      if (S.conflict === 'cancel') { notify.error('Upload cancelled', `${plan.existing.length} file(s) already exist: ${names}${plan.existing.length > 5 ? '…' : ''}`); return; }
      if (S.conflict === 'skip') {
        const ex = new Set(plan.existing.map((e) => e.path)); list = files.filter((f) => !ex.has(f.path));
        notify.warning('Some files will be skipped', `${plan.existing.length} existing file(s) will be left untouched.`);
        if (!list.length) { notify.info('Nothing to upload', 'Every file already exists in the repository.'); return; }
      } else if (!(await confirmDialog({ title: `Replace ${plan.existing.length} existing file(s)?`, message: 'These files will be overwritten in the new commit. Files not in your ZIP are kept.', confirmText: 'Replace and upload', details: html`<span class="mono">${names}${plan.existing.length > 5 ? ' …' : ''}</span>` }))) return;
    }

    const branchName = S.createBranch ? S.newBranch : baseBranch;
    const author = S.authorName.trim() && S.authorEmail.trim() ? { name: S.authorName.trim(), email: S.authorEmail.trim() } : undefined;
    await execute({ repo, list, plan, branchName, baseBranch, author });
  }

  async function execute({ repo, list, plan, branchName, baseBranch, author }) {
    S.running = true; S.abort = new AbortController();
    drawProgress({ phase: 'validating', done: 0, totalOps: 1, filesDone: 0, totalFiles: list.length, bytesDone: 0, totalBytes: list.reduce((n, f) => n + f.size, 0), current: 'Starting…', percent: 0 }, repo, branchName);
    const started = Date.now();
    try {
      const res = await runUpload(list, {
        owner: repo.owner, repo: repo.name, branch: branchName, baseBranch, createBranch: S.createBranch, message: S.message.trim(), author, plan, signal: S.abort.signal,
        onProgress: (p) => updateProgress(p),
      });
      S.running = false; invalidateRepos();
      history.add({ zipName: S.zip.name, repo: repo.fullName, repoUrl: repo.htmlUrl, branch: branchName, files: res.files, folders: new Set(list.map((f) => f.path.split('/').slice(0, -1).join('/')).filter(Boolean)).size, commitSha: res.commitSha, commitUrl: res.commitUrl, message: S.message.trim(), status: 'success', bytes: list.reduce((n, f) => n + f.size, 0) });
      notify.success('Files uploaded successfully', `${res.files} files → ${repo.name}`);
      notify.success('Commit created successfully', shortSha(res.commitSha), { href: res.commitUrl, linkText: 'View commit', duration: 6000 });
      drawSuccess(res, repo, list, Date.now() - started);
    } catch (e) {
      S.running = false;
      const cancelled = e instanceof UploadCancelled;
      history.add({ zipName: S.zip.name, repo: repo.fullName, repoUrl: repo.htmlUrl, branch: branchName, files: list.length, status: 'failed', message: cancelled ? 'Cancelled' : explain(e), bytes: 0 });
      drawFailure(e, cancelled, { repo, list, plan, branchName, baseBranch, author });
    }
  }

  function drawProgress(p, repo, branch) {
    mount(host, html`
      <div class="page-head"><div><h1>Uploading to GitHub</h1><p>${repo.fullName} · <span class="mono">${branch}</span></p></div></div>
      <section class="card prog-card">
        <div class="prog-top"><div class="prog-pct" id="pPct">0%</div><div class="prog-status"><b id="pStatus">Preparing</b><span id="pCur" class="mono"></span></div><button class="btn danger sm" id="cancel">${ic('x', 'sm')}Cancel</button></div>
        <div class="progress lg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="pBar"><i></i></div>
        <div class="prog-stats">
          <div><span>Files processed</span><b id="pDone">0</b></div><div><span>Files remaining</span><b id="pLeft">0</b></div>
          <div><span>Size processed</span><b id="pBytes">0 B</b></div><div><span>Total size</span><b id="pTotal">0 B</b></div>
        </div>
        <ol class="phases" id="phases">${PHASES.map(([k, l]) => html`<li data-k="${k}"><span class="ph-dot"></span>${l}</li>`)}</ol>
      </section>`);
    $('#cancel', host).addEventListener('click', () => { S.abort && S.abort.abort(); });
    updateProgress(p);
  }

  function updateProgress(p) {
    if (!$('#pBar', host)) return;
    $('#pPct', host).textContent = `${p.percent}%`;
    const bar = $('#pBar', host); bar.setAttribute('aria-valuenow', p.percent); bar.firstElementChild.style.width = `${p.percent}%`;
    const label = { validating: 'Validating files', blobs: 'Creating Git blobs', tree: 'Building Git tree', commit: 'Creating commit', branch: 'Updating branch', done: 'Completed' }[p.phase] || 'Working';
    $('#pStatus', host).textContent = label; $('#pCur', host).textContent = p.current || '';
    $('#pDone', host).textContent = `${p.filesDone.toLocaleString()} / ${p.totalFiles.toLocaleString()}`;
    $('#pLeft', host).textContent = Math.max(0, p.totalFiles - p.filesDone).toLocaleString();
    $('#pBytes', host).textContent = formatBytes(p.bytesDone); $('#pTotal', host).textContent = formatBytes(p.totalBytes);
    const order = ['prepare', 'validating', 'blobs', 'tree', 'commit', 'branch', 'done'];
    const idx = order.indexOf(p.phase);
    $$('#phases li', host).forEach((li) => { const i = order.indexOf(li.dataset.k); li.className = i < idx || p.phase === 'done' ? 'done' : i === idx ? 'active' : ''; });
    const cancel = $('#cancel', host); if (cancel && ['commit', 'branch', 'done'].includes(p.phase)) cancel.disabled = true;
  }

  function drawSuccess(res, repo, list, ms) {
    const folders = new Set(list.map((f) => f.path.split('/').slice(0, -1).join('/')).filter(Boolean)).size;
    mount(host, html`
      <section class="card success-card">
        <div class="hero-icon ok">${ic('check-circle-2', 'xl')}</div>
        <h1>Your project has been uploaded successfully.</h1>
        <p class="cell-sub">Finished in ${(ms / 1000).toFixed(1)}s${res.commitsCreated > 1 ? ' · the first file initialised the empty repository (2 commits)' : ' · one commit for every file'}.</p>
        <dl class="kv wide">
          <div><dt>Repository</dt><dd>${repo.fullName}</dd></div><div><dt>Branch</dt><dd class="mono">${res.branch}</dd></div>
          <div><dt>Total files</dt><dd>${res.files.toLocaleString()}</dd></div><div><dt>Total folders</dt><dd>${folders.toLocaleString()}</dd></div>
          <div class="span2"><dt>Commit message</dt><dd>${S.message}</dd></div>
          <div class="span2"><dt>Commit SHA</dt><dd><span class="sha">${res.commitSha}</span> <button class="btn ghost icon-only sm" id="cpSha" aria-label="Copy SHA">${ic('copy', 'sm')}</button></dd></div>
          <div class="span2"><dt>Commit URL</dt><dd><a class="mono" href="${safeUrl(res.commitUrl)}" target="_blank" rel="noopener noreferrer">${res.commitUrl}</a></dd></div>
        </dl>
        <div class="success-actions"><a class="btn primary" href="${safeUrl(repo.htmlUrl)}" target="_blank" rel="noopener noreferrer">${ic('arrow-up-right', 'sm')}View Repository</a><a class="btn" href="${safeUrl(res.commitUrl)}" target="_blank" rel="noopener noreferrer">${ic('git-commit-horizontal', 'sm')}View Commit</a><button class="btn" id="again">${ic('cloud-upload', 'sm')}Upload Another ZIP</button></div>
      </section>`);
    $('#cpSha', host).addEventListener('click', () => copyText(res.commitSha).then(() => notify.success('SHA copied')));
    $('#again', host).addEventListener('click', () => { teardown(); S.zip = null; drawLanding(); });
  }

  function drawFailure(e, cancelled, job) {
    const conflict = e && (e.code === 'branch_changed' || e.status === 409);
    mount(host, html`
      <section class="card success-card">
        <div class="hero-icon ${cancelled ? 'warn' : 'bad'}">${ic(cancelled ? 'alert-triangle' : 'alert-circle', 'xl')}</div>
        <h1>${cancelled ? 'Upload cancelled' : 'Upload failed'}</h1>
        <p class="cell-sub" style="max-width:56ch">${cancelled ? 'Nothing was committed. Your repository is unchanged.' : explain(e)}</p>
        ${!cancelled && conflict ? html`<div class="alert warning" style="max-width:520px;text-align:left">${ic('alert-triangle')}<div><b>Branch has changed</b><br>Someone pushed while you were uploading. Retry to build on the latest commit.</div></div>` : ''}
        ${!cancelled ? html`<p class="cell-sub">No partial commit was created — GitHub only changes the branch in the final step.</p>` : ''}
        <div class="success-actions"><button class="btn primary" id="retry">${ic('refresh-cw', 'sm')}Try again</button><button class="btn" id="back">${ic('arrow-left', 'sm')}Back to settings</button></div>
      </section>`);
    $('#retry', host).addEventListener('click', async () => {
      try { const plan = await api.checkConflicts({ owner: job.repo.owner, repo: job.repo.name, branch: job.baseBranch, paths: [] }); await execute({ ...job, plan }); }
      catch (er) { notify.error('Could not retry', explain(er)); }
    });
    $('#back', host).addEventListener('click', () => { drawWorkspace(); });
  }

  // Warn before leaving mid-upload
  const beforeUnload = (e) => { if (S.running) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  cleanups.push(() => window.removeEventListener('beforeunload', beforeUnload));

  drawLanding();
  return { cleanup() { if (S.running && S.abort) S.abort.abort(); teardown(); cleanups.forEach((f) => f()); } };
}
