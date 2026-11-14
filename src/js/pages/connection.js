import { html, mount, ic, $, $$, formatDate, avatarImg } from '../ui/dom.js';
import { connect, testConnection, probeToken, disconnect } from '../session.js';
import { vaultSupported } from '../vault.js';
import { explain } from '../github-client.js';
import { notify } from '../notification.js';
import { confirmDialog } from '../ui/overlay.js';
import { prefs } from '../store.js';
import { state } from '../app-state.js';
import { mountTokenTutorial } from '../ui/token-tutorial.js';
import { expirySnapshot, longDate, refreshExpiryNow } from '../token-expiry.js';

const PAT_NEW = 'https://github.com/settings/personal-access-tokens/new';
const PAT_CLASSIC = 'https://github.com/settings/tokens/new?scopes=repo,delete_repo&description=RepoFast';
const DEV_SETTINGS = 'https://github.com/settings/developers';
const TOKENS_FINE = 'https://github.com/settings/personal-access-tokens';
const TOKENS_CLASSIC = 'https://github.com/settings/tokens';

export async function render(host, ctx) {
  const draw = () => {
    mount(host, state.connected ? connectedView() : formView(ctx.redirected));
    bind();
    refreshExpiryNow();
  };

  function endedNotice() {
    const n = state.sessionEnded;
    if (!n) return '';
    if (n.reason === 'expired') {
      return html`<div class="alert danger" style="margin-bottom:18px">${ic('alert-circle')}<div>
        <b>Your GitHub token expired</b>${n.expiresAt ? html` on <b>${longDate(n.expiresAt)}</b>` : ''}${n.login ? html` (account <span class="mono">@${n.login}</span>)` : ''}. RepoFast stopped using it and erased it from this device.
        <ol class="steps" style="margin-top:8px">
          <li>Open <a href="${TOKENS_FINE}" target="_blank" rel="noopener noreferrer">your tokens on GitHub</a> (classic tokens: <a href="${TOKENS_CLASSIC}" target="_blank" rel="noopener noreferrer">here</a>), choose the expired one and press <b>Regenerate token</b> — or create a new one with a later expiry date.</li>
          <li>Paste the new token below and press <b>Connect GitHub</b>. Your repositories and settings are still here.</li>
        </ol></div></div>`;
    }
    return html`<div class="alert warning" style="margin-bottom:18px">${ic('alert-triangle')}<div><b>GitHub rejected your token</b> — it was revoked, deleted or has expired. It was erased from this device. Create a new token and connect again.</div></div>`;
  }

  function expiryCard() {
    const snap = expirySnapshot();
    if (!snap.has) {
      return html`<section class="card pad info-card"><h3>${ic('clock')}Token expiry</h3><p style="margin:0;color:var(--text-2);font-size:13px">GitHub did not report an expiry date for this token (a classic token created with “No expiration”). RepoFast keeps using it until you disconnect or GitHub rejects it.</p></section>`;
    }
    return html`<section class="card pad info-card expiry-card"><h3>${ic('clock')}Token expiry</h3>
      <div class="exp-big mono" data-expiry-level data-level="${snap.level}"><span data-expiry-countdown>${snap.text}</span></div>
      <div class="exp-date">Expires ${longDate(snap.iso)}</div>
      <ul class="exp-logic">
        <li>You get a warning 7 days, 3 days, 24 hours, 1 hour and 10 minutes before.</li>
        <li>At the exact expiry time RepoFast stops sending the token, erases it from this device and brings you back here.</li>
        <li>Then regenerate it (or create a new one) on GitHub and connect again.</li>
      </ul></section>`;
  }

  function formView(redirected) {
    return html`
      <div class="page-head"><div><h1>GitHub Connection</h1><p>Connect with a Personal Access Token. It stays on this device — RepoFast has no accounts and no database.</p></div></div>
      ${endedNotice()}
      ${redirected && !state.sessionEnded ? html`<div class="alert" style="margin-bottom:18px">${ic('info')}<div>Connect your GitHub account to continue.</div></div>` : ''}
      <div id="tutorialSlot"></div>
      <div class="connect-grid">
        <section class="card connect-card">
          <div class="connect-hero">
            <div class="hero-icon">${ic('github', 'xl')}</div>
            <h2>Connect your GitHub Account</h2>
            <p>Connect your GitHub account to create repositories, upload files, and manage your projects directly from RepoFast.</p>
          </div>
          <form id="tokenForm" autocomplete="off" novalidate>
            <div class="field">
              <label for="tokenInput">GitHub Personal Access Token</label>
              <div class="input-wrap">
                ${ic('key-round')}
                <input class="input mono has-action" id="tokenInput" type="password" placeholder="ghp_… or github_pat_…" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off" data-lpignore="true" data-1p-ignore>
                <button type="button" class="btn ghost icon-only sm input-action" id="toggleToken" aria-label="Show token" aria-pressed="false">${ic('eye')}</button>
              </div>
              <div class="field-error" id="tokenError" role="alert" hidden></div>
            </div>
            <label class="check remember"><input type="checkbox" id="remember" ${prefs.get().rememberToken && vaultSupported() ? 'checked' : ''} ${vaultSupported() ? '' : 'disabled'}><span>Remember on this device <small>(encrypted, never sent to a server)</small></span></label>
            <div class="connect-actions">
              <button type="submit" class="btn primary lg" id="connectBtn">${ic('github')}Connect GitHub</button>
              <button type="button" class="btn lg" id="testBtn">${ic('shield-check')}Test Connection</button>
            </div>
            <div id="probeResult"></div>
          </form>
        </section>
        <aside class="side-stack">
          <section class="card pad info-card">
            <h3>${ic('shield-check')}How your token is protected</h3>
            <ul class="tick-list">
              <li>Stored <b>only in this browser</b> — encrypted with a non-extractable key. Never in a database, cookie, URL or log.</li>
              <li>Sent over HTTPS to RepoFast's stateless API, which forwards it to GitHub and forgets it.</li>
              <li>Hidden after you connect. Disconnect wipes it instantly.</li>
            </ul>
          </section>
          <section class="card pad info-card">
            <h3>${ic('key-round')}Create a token</h3>
            <ol class="steps">
              <li>Open <a href="${PAT_NEW}" target="_blank" rel="noopener noreferrer">fine-grained tokens</a> (recommended) in GitHub Developer Settings.</li>
              <li>Choose the repositories, then grant <b>Contents: Read and write</b> and <b>Metadata: Read</b>.</li>
              <li>To create repositories from RepoFast, also grant <b>Administration: Read and write</b> (all repositories).</li>
              <li>Prefer a classic token? <a href="${PAT_CLASSIC}" target="_blank" rel="noopener noreferrer">Create one</a> with only the <code>repo</code> scope.</li>
            </ol>
            <a class="btn sm" href="${DEV_SETTINGS}" target="_blank" rel="noopener noreferrer">${ic('arrow-up-right', 'sm')}GitHub Developer Settings</a>
          </section>
        </aside>
      </div>`;
  }

  function connectedView() {
    const u = state.user; const t = state.token;
    const perms = [];
    if (t.type === 'classic') {
      perms.push({ ok: t.canWriteRepos, label: 'Write to repositories', hint: t.canWriteRepos ? 'Scope "repo" or "public_repo" granted' : 'Missing "repo" scope' });
      perms.push({ ok: t.scopes.includes('repo'), label: 'Access private repositories', hint: t.scopes.includes('repo') ? 'Scope "repo" granted' : 'Needs "repo" scope' });
      perms.push({ ok: t.canCreateRepos, label: 'Create repositories', hint: 'Included in "repo" scope' });
    } else {
      perms.push({ ok: null, label: 'Contents: Read and write', hint: 'Fine-grained tokens report permissions per repository. RepoFast checks it when you open a repository.' });
      perms.push({ ok: null, label: 'Administration: Read and write', hint: 'Only needed to create new repositories.' });
    }
    return html`
      <div class="page-head"><div><h1>GitHub Connection</h1><p>Your account is connected. The token is stored on this device only.</p></div>
        <div class="page-actions"><button class="btn" id="testBtn">${ic('refresh-cw')}Test Connection</button><button class="btn danger" id="disconnectBtn">${ic('log-out')}Disconnect</button></div></div>
      <div class="connect-grid">
        <section class="card profile-card">
          <div class="profile-top">
            ${avatarImg(u, 160, "avatar xl-avatar", 72)}
            <div><h2>${u.name || u.login}</h2><a class="mono" href="${u.htmlUrl}" target="_blank" rel="noopener noreferrer">@${u.login}</a></div>
            <span class="badge success" style="margin-left:auto"><i class="dot ok"></i>Connected</span>
          </div>
          <dl class="kv">
            <div><dt>Account type</dt><dd>${u.type}</dd></div>
            <div><dt>Token type</dt><dd>${t.type === 'classic' ? 'Classic PAT' : 'Fine-grained PAT'}</dd></div>
            <div><dt>Public repositories</dt><dd>${u.publicRepos ?? '—'}</dd></div>
            <div><dt>Plan</dt><dd>${u.plan || '—'}</dd></div>
            <div><dt>Token expires</dt><dd>${t.expiresAt ? longDate(t.expiresAt) : 'No expiry reported'}</dd></div>
            ${state.rateLimit ? html`<div><dt>API rate limit</dt><dd>${state.rateLimit.remaining} / ${state.rateLimit.limit} left</dd></div>` : ''}
            ${t.scopes.length ? html`<div><dt>Scopes</dt><dd class="scopes">${t.scopes.map((s) => html`<span class="badge primary mono">${s}</span>`)}</dd></div>` : ''}
          </dl>
        </section>
        <aside class="side-stack">
          ${expiryCard()}
          <section class="card pad info-card">
            <h3>${ic('shield-check')}Token permission validation</h3>
            <ul class="perm-list">${perms.map((p) => html`<li class="${p.ok === true ? 'ok' : p.ok === false ? 'bad' : 'unk'}">${ic(p.ok === true ? 'check-circle-2' : p.ok === false ? 'alert-circle' : 'info')}<div><b>${p.label}</b><small>${p.hint}</small></div></li>`)}</ul>
            ${state.warnings.length ? html`<div class="alert warning" style="margin-top:12px">${ic('alert-triangle')}<div>${state.warnings.map((w) => html`<div>${w}</div>`)}</div></div>` : ''}
          </section>
        </aside>
      </div>`;
  }

  function bind() {
    const slot = $('#tutorialSlot', host);
    if (slot) mountTokenTutorial(slot);
    const input = $('#tokenInput', host);
    const err = $('#tokenError', host);
    const showErr = (m) => { if (!err) return; err.hidden = !m; err.textContent = m || ''; input && input.classList.toggle('invalid', !!m); };

    if (input) {
      $('#toggleToken', host).addEventListener('click', (e) => {
        const b = e.currentTarget; const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.innerHTML = ic(show ? 'eye-off' : 'eye').toString(); b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
      });
      input.addEventListener('input', () => showErr(''));

      $('#tokenForm', host).addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#connectBtn', host);
        btn.classList.add('loading'); btn.innerHTML = `${ic('loader-2', 'spin')}Connecting…`;
        try {
          const remember = $('#remember', host).checked;
          prefs.set({ rememberToken: remember });
          const res = await connect(input.value, { remember });
          input.value = '';          // never keep the token in the DOM
          notify.success('GitHub connected', `Signed in as ${res.user.login}.`);
          ctx.navigate('overview');
        } catch (er) {
          showErr(explain(er));
          btn.classList.remove('loading'); btn.innerHTML = `${ic('github')}Connect GitHub`;
        }
      });

      $('#testBtn', host).addEventListener('click', async () => {
        const out = $('#probeResult', host);
        if (!input.value.trim()) { showErr('Paste a token first.'); input.focus(); return; }
        const b = $('#testBtn', host); b.classList.add('loading');
        try {
          const res = await probeToken(input.value);
          mount(out, html`<div class="alert ${res.warnings.length ? 'warning' : 'success'}" style="margin-top:14px">${ic(res.warnings.length ? 'alert-triangle' : 'check-circle-2')}<div><b>Token is valid</b> — ${res.user.login} (${res.token.type}).${res.warnings.length ? html`<ul>${res.warnings.map((w) => html`<li>${w}</li>`)}</ul>` : ''}</div></div>`);
        } catch (er) { out.innerHTML = ''; showErr(explain(er)); }
        finally { b.classList.remove('loading'); }
      });
    } else {
      $('#testBtn', host).addEventListener('click', async () => {
        const b = $('#testBtn', host); b.classList.add('loading');
        try { await testConnection(); notify.success('Connection is healthy', 'Your token is valid.'); draw(); }
        catch (er) { notify.error('Connection test failed', explain(er)); }
        finally { b.classList.remove('loading'); }
      });
      $('#disconnectBtn', host).addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Disconnect GitHub?', message: 'Your token will be erased from this device. You can reconnect any time with a token.', confirmText: 'Disconnect', danger: true }))) return;
        await disconnect(); notify.info('Disconnected', 'Your token was removed from this device.'); draw();
      });
    }
  }

  draw();
}
