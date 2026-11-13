// Video-style tutorial player: how to create a GitHub token. Fully self-contained (works under the strict CSP,
// no external host). If /tutorial.mp4 exists in public/, the real video is shown instead.
import { html, raw, mount, $, $$ } from './dom.js';

const PAT_CLASSIC = 'https://github.com/settings/tokens/new?scopes=repo,delete_repo&description=RepoFast';
const D = 5200; // ms per chapter
const row = (l, x = '', c = '') => `<div class="tt-row ${c}"><span>${l}</span>${x}</div>`;
const page = (url, body) => `<div class="tt-bar"><i></i><i></i><i></i><span class="tt-url">${url}</span></div><div class="tt-page">${body}</div>`;

const STEPS = [
  { t: 'Buka Settings', url: 'github.com', x: 'Login ke github.com, ketuk foto profil di kanan atas, lalu pilih <b>Settings</b>.',
    s: page('github.com', `<div class="tt-top"><b>GitHub</b><span class="tt-avatar tt-hl"></span></div><div class="tt-menu">${row('Your profile')}${row('Your repositories')}${row('Settings', '', 'tt-hl')}${row('Sign out')}</div>`) },
  { t: 'Developer settings', url: 'github.com/settings/profile', x: 'Gulir menu kiri ke paling bawah, lalu ketuk <b>Developer settings</b>.',
    s: page('github.com/settings/profile', `<div class="tt-menu">${row('Public profile')}${row('Account')}${row('Security')}${row('…')}${row('Developer settings', '', 'tt-hl')}</div>`) },
  { t: 'Tokens (classic)', url: 'github.com/settings/developers', x: 'Buka <b>Personal access tokens → Tokens (classic)</b>, lalu <b>Generate new token (classic)</b>.',
    s: page('github.com/settings/tokens', `<div class="tt-menu">${row('GitHub Apps')}${row('OAuth Apps')}${row('Personal access tokens', '▾')}${row('&nbsp;&nbsp;Tokens (classic)', '', 'tt-hl')}</div><div class="tt-btn">Generate new token (classic)</div>`) },
  { t: 'Pilih izin (scope)', url: 'github.com/settings/tokens/new', x: 'Note: <b>RepoFast</b>. Centang <b>repo</b>. Mau hapus repository dari RepoFast? Centang juga <b>delete_repo</b>.',
    s: page('github.com/settings/tokens/new', `<div class="tt-field"><small>Note</small><div class="tt-input">RepoFast</div></div><div class="tt-check tt-hl"><i class="tt-box on">✓</i><b>repo</b><span>Full control of repositories</span></div><div class="tt-check"><i class="tt-box on">✓</i><b>delete_repo</b><span>Delete repositories</span></div>`) },
  { t: 'Generate & salin', url: 'github.com/settings/tokens', x: 'Ketuk <b>Generate token</b>. Token <code>ghp_…</code> hanya tampil <b>sekali</b> — salin sekarang!',
    s: page('github.com/settings/tokens', `<div class="tt-btn ok">Generate token</div><div class="tt-token tt-hl"><code>ghp_a1B2c3D4e5F6g7H8…</code><i>⧉</i></div><div class="tt-note">⚠ Copy your token now. You won't be able to see it again!</div>`) },
  { t: 'Tempel di RepoFast', url: 'repofast', x: 'Tempel token ke kolom <b>GitHub Personal Access Token</b>, lalu ketuk <b>Connect GitHub</b>. Selesai!',
    s: page('repofast', `<div class="tt-field"><small>GitHub Personal Access Token</small><div class="tt-input"><code>ghp_••••••••••••••••</code></div></div><div class="tt-btn primary tt-hl">Connect GitHub</div>`) },
];
const TOTAL = STEPS.length * D;
const fmt = (ms) => { const s = Math.floor(ms / 1000); return `0:${String(s).padStart(2, '0')}`; };

function view(real) {
  return html`
    <section class="card tt" id="tokenTutorial" aria-label="Video tutorial mengambil token GitHub">
      <div class="tt-head">
        <div><span class="tt-badge">Video tutorial · 1:36</span><h3>Cara mendapatkan token GitHub</h3><p>Ikuti langkah singkat ini. Token disimpan hanya di perangkat kamu.</p></div>
        <a class="btn primary sm" href="${PAT_CLASSIC}" target="_blank" rel="noopener noreferrer">Buat token sekarang ↗</a>
      </div>
      ${real ? raw(`<div class="tt-real"><div class="tt-vphone"><video class="tt-video" controls playsinline preload="metadata" poster="/tutorial-poster.jpg" src="/tutorial.mp4"></video></div>
        <ol class="tt-guide">${STEPS.map((s, i) => `<li><b>${i + 1}</b><div><strong>${s.t}</strong><span>${s.x}</span></div></li>`).join('')}</ol></div>`) : raw(`
      <div class="tt-player">
        <div class="tt-stage" id="ttStage"><div class="tt-win" id="ttScreen"></div><i class="tt-cursor" id="ttCursor"></i><i class="tt-ripple" id="ttRipple"></i>
          <button type="button" class="tt-bigplay" id="ttBig" aria-label="Putar">▶</button></div>
        <div class="tt-side"><div class="tt-count" id="ttCount"></div><h4 id="ttTitle"></h4><p id="ttText"></p>
          <ol class="tt-chap">${STEPS.map((s, i) => `<li><button type="button" data-i="${i}"><b>${i + 1}</b>${s.t}</button></li>`).join('')}</ol></div>
      </div>
      <div class="tt-ctl"><button type="button" class="btn sm icon-only" id="ttPlay" aria-label="Putar atau jeda">⏸</button>
        <input type="range" id="ttSeek" min="0" max="${TOTAL}" value="0" step="50" aria-label="Posisi video"><span class="tt-time" id="ttTime">0:00 / ${fmt(TOTAL)}</span></div>`)}
    </section>`;
}

export async function mountTokenTutorial(host) {
  mount(host, view(true));
  const vid = $('video', host);
  if (vid) { vid.addEventListener('error', () => { if (host.isConnected) { mount(host, view(false)); initAnim(host); } }, { once: true }); return; }
  initAnim(host);
}

function initAnim(host) {

  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const screen = $('#ttScreen', host), stage = $('#ttStage', host), cur = $('#ttCursor', host), rip = $('#ttRipple', host);
  const seek = $('#ttSeek', host), big = $('#ttBig', host), btns = $$('.tt-chap button', host);
  let t = 0, playing = false, last = 0, raf = 0, idx = -1, moved = false, clicked = false;

  const target = () => $('.tt-hl', screen);
  const place = (el, ox = 0.5, oy = 0.5) => { const a = stage.getBoundingClientRect(), b = el.getBoundingClientRect(); return [b.left - a.left + b.width * ox, b.top - a.top + b.height * oy]; };
  const setCur = (x, y) => { cur.style.transform = `translate(${x}px,${y}px)`; };

  function load(i) {
    idx = i; moved = clicked = false;
    const s = STEPS[i];
    screen.classList.remove('in'); void screen.offsetWidth; screen.innerHTML = s.s; screen.classList.add('in');
    $('#ttCount', host).textContent = `Langkah ${i + 1} dari ${STEPS.length}`;
    $('#ttTitle', host).textContent = s.t; $('#ttText', host).innerHTML = s.x;
    btns.forEach((b, k) => b.classList.toggle('on', k === i));
    const a = stage.getBoundingClientRect(); cur.classList.remove('click'); setCur(a.width * 0.85, a.height * 0.9);
  }
  function frame() {
    const i = Math.min(STEPS.length - 1, Math.floor(t / D)), lt = t - i * D;
    if (i !== idx) load(i);
    const tg = target();
    if (tg && (lt > 700 || reduce) && !moved) { moved = true; setCur(...place(tg, 0.6, 0.6)); }
    if (lt < 700 && moved) { moved = false; const a = stage.getBoundingClientRect(); setCur(a.width * 0.85, a.height * 0.9); }
    const c = lt > 1900;
    if (c !== clicked) { clicked = c; tg && tg.classList.toggle('tt-press', c); if (c && tg) { const [x, y] = place(tg, 0.6, 0.6); rip.style.transform = `translate(${x}px,${y}px)`; rip.classList.remove('go'); void rip.offsetWidth; rip.classList.add('go'); } }
    seek.value = t; seek.style.setProperty('--p', `${(t / TOTAL) * 100}%`);
    $('#ttTime', host).textContent = `${fmt(t)} / ${fmt(TOTAL)}`;
  }
  function tick(now) {
    if (!host.isConnected) return;
    if (playing) { t += now - last; if (t >= TOTAL) t = 0; frame(); }
    last = now; raf = requestAnimationFrame(tick);
  }
  const setPlaying = (p) => { playing = p; stage.classList.toggle('paused', !p); $('#ttPlay', host).textContent = p ? '⏸' : '▶'; };
  const jump = (ms) => { t = Math.max(0, Math.min(TOTAL - 1, ms)); idx = -1; frame(); };

  $('#ttPlay', host).addEventListener('click', () => setPlaying(!playing));
  big.addEventListener('click', () => setPlaying(true));
  stage.addEventListener('click', (e) => { if (e.target === stage || e.target.closest('.tt-win')) setPlaying(!playing); });
  seek.addEventListener('input', () => jump(Number(seek.value)));
  btns.forEach((b) => b.addEventListener('click', () => { jump(Number(b.dataset.i) * D); setPlaying(true); }));

  jump(0); setPlaying(false);
  raf = requestAnimationFrame((n) => { last = n; tick(n); });
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) { setPlaying(true); io.disconnect(); } }, { threshold: 0.5 });
    io.observe(stage);
  }
}
