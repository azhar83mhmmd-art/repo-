// Settings page.
import { html, mount, ic, $, $$, avatarImg } from './ui/dom.js';
import { Select } from './ui/select.js';
import { prefs, DEFAULT_PREFS } from './store.js';
import { state } from './app-state.js';
import { disconnect } from './session.js';
import { notify } from './notification.js';
import { confirmDialog, modal } from './ui/overlay.js';

export async function render(host, ctx) {
  const sels = [];
  const draw = () => {
    const p = prefs.get();
    mount(host, html`
      <div class="page-head"><div><h1>Settings</h1><p>Preferences are saved in this browser only.</p></div></div>
      <div class="settings">
        <section class="card"><div class="card-head"><div><h2>GitHub Connection</h2><p>Account linked to RepoFast</p></div></div><div class="card-body">
          ${state.connected ? html`<div class="set-row"><div class="cell-main">${avatarImg(state.user, 64)}<div><b>${state.user.login}</b><div class="cell-sub">${state.user.type} · ${state.token.type === 'classic' ? 'Classic' : 'Fine-grained'} token</div></div></div><span class="badge success"><i class="dot ok"></i>Connected</span></div>
            <div class="set-row"><div><b>Permissions</b><div class="cell-sub">${state.token.scopes.length ? state.token.scopes.join(', ') : 'Fine-grained: set per repository'}</div></div><div class="row-actions"><button class="btn sm" id="conn">${ic('key-round', 'sm')}Manage</button><button class="btn sm danger" id="disc">${ic('log-out', 'sm')}Disconnect</button></div></div>`
            : html`<div class="set-row"><div><b>Not connected</b><div class="cell-sub">Connect a Personal Access Token to get started.</div></div><button class="btn primary sm" id="conn">${ic('github', 'sm')}Connect GitHub</button></div>`}
        </div></section>

        <section class="card"><div class="card-head"><div><h2>Upload Preferences</h2><p>Defaults for new uploads</p></div></div><div class="card-body stack">
          <div class="field"><label for="pm">Default commit message</label><input class="input" id="pm" value="${p.commitMessage}" maxlength="200"></div>
          <div class="field-row"><div class="field"><label>Default branch behavior</label><div id="sBranch"></div></div><div class="field"><label>Default ZIP structure</label><div id="sStruct"></div></div></div>
          <div class="field-row"><div class="field"><label>Conflict handling</label><div id="sConf"></div></div><div class="field"><label for="pmax">Maximum upload size (MB)</label><input class="input" id="pmax" type="number" min="1" max="1024" value="${p.maxUploadMB}"><span class="hint">Applies to the ZIP file you select. Max 1024.</span></div></div>
          <div class="switch-row"><div><b>Ignore system files</b><small>Skip __MACOSX, .DS_Store, Thumbs.db when reading a ZIP.</small></div><label class="switch"><input type="checkbox" id="pign" ${p.ignoreSystemFiles ? 'checked' : ''}><i></i></label></div>
        </div></section>

        <section class="card"><div class="card-head"><div><h2>Appearance</h2><p>Choose how RepoFast looks</p></div></div><div class="card-body">
          <div class="segmented" id="theme">${[['dark', 'moon', 'Dark'], ['light', 'sun', 'Light'], ['system', 'monitor', 'System']].map(([v, i, l]) => html`<button data-v="${v}" class="${p.theme === v ? 'active' : ''}">${ic(i, 'sm')}${l}</button>`)}</div>
        </div></section>

        <section class="card"><div class="card-head"><div><h2>Application</h2></div></div><div class="card-body">
          <dl class="kv"><div><dt>App version</dt><dd class="mono">1.0.0</dd></div><div><dt>Storage</dt><dd>This browser only</dd></div></dl>
          <div class="row-actions" style="margin-top:14px;flex-wrap:wrap"><button class="btn sm" id="docs">${ic('book-open', 'sm')}Documentation</button><button class="btn sm" id="privacy">${ic('shield-check', 'sm')}Privacy</button><button class="btn sm" id="about">${ic('info', 'sm')}About RepoFast</button><button class="btn sm ghost" id="reset">${ic('undo-2', 'sm')}Reset preferences</button></div>
        </div></section>
      </div>`);

    const mk = (slot, value, options, key, icon) => { const s = new Select({ value, options, icon, ariaLabel: key, onChange: (v) => { prefs.set({ [key]: v }); notify.success('Setting saved'); } }); $(slot, host).appendChild(s.el); sels.push(s); };
    mk('#sBranch', p.branchBehavior, [{ value: 'default', label: 'Use repository default branch' }, { value: 'last', label: 'Remember last used branch' }], 'branchBehavior', 'git-branch');
    mk('#sStruct', p.structure === 'custom' ? 'preserve' : p.structure, [{ value: 'preserve', label: 'Preserve ZIP structure' }, { value: 'strip-root', label: 'Remove root folder' }, { value: 'custom', label: 'Custom destination' }], 'structure', 'folder');
    mk('#sConf', p.conflict, [{ value: 'replace', label: 'Replace existing files' }, { value: 'skip', label: 'Skip existing files' }, { value: 'cancel', label: 'Cancel upload' }], 'conflict', 'files');

    $('#pm', host).addEventListener('change', (e) => { const v = e.target.value.trim() || DEFAULT_PREFS.commitMessage; e.target.value = v; prefs.set({ commitMessage: v }); notify.success('Setting saved'); });
    $('#pmax', host).addEventListener('change', (e) => { const v = Math.min(1024, Math.max(1, Math.round(Number(e.target.value)) || 100)); e.target.value = v; prefs.set({ maxUploadMB: v }); notify.success('Setting saved'); });
    $('#pign', host).addEventListener('change', (e) => { prefs.set({ ignoreSystemFiles: e.target.checked }); notify.success('Setting saved'); });
    $$('#theme button', host).forEach((b) => b.addEventListener('click', () => { prefs.set({ theme: b.dataset.v }); window.dispatchEvent(new Event('repofast:theme')); $$('#theme button', host).forEach((x) => x.classList.toggle('active', x === b)); }));
    $('#conn', host).addEventListener('click', () => ctx.navigate('connection'));
    $('#disc', host)?.addEventListener('click', async () => { if (!(await confirmDialog({ title: 'Disconnect GitHub?', message: 'Your token will be erased from this device.', confirmText: 'Disconnect', danger: true }))) return; await disconnect(); notify.info('Disconnected'); draw(); });
    $('#reset', host).addEventListener('click', async () => { if (!(await confirmDialog({ title: 'Reset preferences?', message: 'All settings return to their defaults. Your connection and history are kept.', confirmText: 'Reset' }))) return; prefs.reset(); window.dispatchEvent(new Event('repofast:theme')); notify.success('Preferences reset'); sels.forEach((s) => s.destroy()); sels.length = 0; draw(); });
    $('#docs', host).addEventListener('click', () => info('Documentation', html`<ol class="steps"><li><b>Connect</b> with a Personal Access Token (Contents: read/write).</li><li><b>Upload ZIP</b>: drop a ZIP, pick repository, branch and folder, then upload. Everything lands in one commit.</li><li><b>File Explorer</b>: browse, edit, rename and delete files. Each change is a commit.</li><li><b>History</b> lists your uploads from this browser.</li></ol><p class="cell-sub">Shortcut: <span class="mono">Ctrl/⌘ K</span> opens search.</p>`));
    $('#privacy', host).addEventListener('click', () => info('Privacy', html`<ul class="tick-list"><li>No accounts, no database, no analytics.</li><li>Your token is stored only in this browser (encrypted) and is sent to RepoFast's stateless API solely to call GitHub for you.</li><li>ZIP files are processed in your browser and never stored.</li><li>Upload history and settings live in this browser's local storage and never include your token or file contents.</li></ul>`));
    $('#about', host).addEventListener('click', () => info('About RepoFast', html`<p><b>RepoFast 1.0.0</b> — Upload once. Organize everything. Push to GitHub.</p><p class="cell-sub">Built with vanilla JavaScript, JSZip, highlight.js and Lucide icons.</p>`));
  };
  function info(title, body) { const m = modal({ title, body, footer: html`<button class="btn primary" data-close>Done</button>` }); m.el.querySelector('[data-close]').addEventListener('click', () => m.close()); }
  draw();
  return { cleanup: () => sels.forEach((s) => s.destroy()) };
}
