// Lightweight code editor: line numbers, syntax highlighting (highlight.js overlay), find, tab handling.
// Implementation: a transparent <textarea> sits above a highlighted <pre>; scroll positions are mirrored.
import { create, html, ic, esc } from './dom.js';
import { highlightLib, highlightSync } from './highlight.js';

export function codeEditor({ value, name, readOnly = false, onChange, onSave }) {
  const el = create(html`
    <div class="ce">
      <div class="ce-find" hidden>
        <div class="input-wrap">${ic('search', 'sm')}<input class="input" type="text" placeholder="Find in file" aria-label="Find in file" spellcheck="false"></div>
        <span class="ce-count" aria-live="polite"></span>
        <button class="btn sm icon-only ghost" data-prev aria-label="Previous match">${ic('chevron-left', 'sm')}</button>
        <button class="btn sm icon-only ghost" data-next aria-label="Next match">${ic('chevron-right', 'sm')}</button>
        <button class="btn sm icon-only ghost" data-close aria-label="Close search">${ic('x', 'sm')}</button>
      </div>
      <div class="ce-body">
        <div class="ce-gutter" aria-hidden="true"><div class="ce-gutter-in"></div></div>
        <div class="ce-code">
          <pre class="ce-hl" aria-hidden="true"><code></code></pre>
          <textarea class="ce-ta" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="File contents"></textarea>
        </div>
      </div>
    </div>`);
  const ta = el.querySelector('.ce-ta');
  const code = el.querySelector('.ce-hl code');
  const pre = el.querySelector('.ce-hl');
  const gutterIn = el.querySelector('.ce-gutter-in');
  const findBar = el.querySelector('.ce-find');
  const findIn = findBar.querySelector('input');
  const countEl = findBar.querySelector('.ce-count');
  ta.value = value; ta.readOnly = readOnly;
  let lib = null; let timer = null; let lines = 0; let matches = []; let mi = -1;

  const paintGutter = () => {
    const n = ta.value.split('\n').length;
    if (n !== lines) { lines = n; gutterIn.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); }
  };
  const paint = () => { code.innerHTML = highlightSync(lib, ta.value, name) + '\n '; paintGutter(); };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, ta.value.length > 60000 ? 180 : 40); };
  const sync = () => { const t = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; pre.style.transform = t; gutterIn.style.transform = `translateY(${-ta.scrollTop}px)`; };

  ta.addEventListener('scroll', sync);
  ta.addEventListener('input', () => { schedule(); paintGutter(); onChange && onChange(ta.value); if (!findBar.hidden) runFind(false); });
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave && onSave(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); return; }
    if (readOnly) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      if (e.shiftKey) {
        const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
        if (ta.value.slice(ls, ls + 2) === '  ') { ta.setRangeText('', ls, ls + 2, 'preserve'); ta.setSelectionRange(Math.max(ls, s - 2), Math.max(ls, en - 2)); }
      } else ta.setRangeText('  ', s, en, 'end');
      ta.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter') {
      const s = ta.selectionStart; const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
      const indent = ta.value.slice(ls, s).match(/^[ \t]*/)[0];
      if (indent) { e.preventDefault(); ta.setRangeText('\n' + indent, s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    }
  });

  /* find */
  function runFind(jump = true) {
    const q = findIn.value; matches = []; mi = -1;
    if (q) { const hay = ta.value.toLowerCase(); const nq = q.toLowerCase(); let i = hay.indexOf(nq); while (i !== -1 && matches.length < 5000) { matches.push(i); i = hay.indexOf(nq, i + nq.length || 1); } }
    countEl.textContent = q ? (matches.length ? `${matches.length} found` : 'No results') : '';
    if (jump && matches.length) go(1);
  }
  function go(dir) {
    if (!matches.length) return;
    const caret = ta.selectionEnd;
    if (mi === -1) { mi = matches.findIndex((m) => m >= caret - (dir < 0 ? 1 : 0)); if (mi === -1) mi = 0; if (dir < 0) mi = (mi - 1 + matches.length) % matches.length; }
    else mi = (mi + dir + matches.length) % matches.length;
    const at = matches[mi]; const len = findIn.value.length;
    ta.setSelectionRange(at, at + len);
    const line = ta.value.slice(0, at).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
    const col = at - (ta.value.lastIndexOf('\n', at - 1) + 1);
    const cw = 7.8; if (col * cw < ta.scrollLeft || col * cw > ta.scrollLeft + ta.clientWidth - 40) ta.scrollLeft = Math.max(0, col * cw - 80);
    sync(); countEl.textContent = `${mi + 1} of ${matches.length}`;
  }
  function openFind() { findBar.hidden = false; const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd); if (sel && !sel.includes('\n')) findIn.value = sel; findIn.focus(); findIn.select(); runFind(false); }
  findIn.addEventListener('input', () => runFind(true));
  findIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { e.stopPropagation(); closeFind(); } });
  findBar.querySelector('[data-next]').addEventListener('click', () => go(1));
  findBar.querySelector('[data-prev]').addEventListener('click', () => go(-1));
  const closeFind = () => { findBar.hidden = true; ta.focus(); };
  findBar.querySelector('[data-close]').addEventListener('click', closeFind);

  // First paint plain, then upgrade once highlight.js has loaded
  paint();
  highlightLib().then((l) => { lib = l; paint(); sync(); });

  return {
    el, get value() { return ta.value; },
    setValue(v) { ta.value = v; paint(); sync(); },
    focus() { ta.focus(); }, find: openFind,
    jumpToLine(n) { ta.focus(); },
  };
}
