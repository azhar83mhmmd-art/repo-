// Lazy syntax highlighter (highlight.js, vendored). Falls back to escaped plain text.
import { esc } from './dom.js';

let hljsPromise = null;
const load = () => (hljsPromise ||= import('/vendor/highlight.min.js').then((m) => m.default).catch(() => null));

const MAP = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml', vue: 'xml', css: 'css', scss: 'scss', md: 'markdown', py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', sql: 'sql', php: 'php', java: 'java', go: 'go', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', rb: 'ruby', kt: 'kotlin', swift: 'swift', toml: 'ini', ini: 'ini', env: 'ini', diff: 'diff', dockerfile: 'dockerfile' };

export function languageFor(name) {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const i = lower.lastIndexOf('.');
  return MAP[i >= 0 ? lower.slice(i + 1) : ''] || null;
}

export async function highlightLib() { return load(); }

/** Returns highlighted HTML (safe) for code. */
export async function highlight(code, name) {
  const lang = languageFor(name);
  const lib = await load();
  if (!lib || !lang || code.length > 250000) return esc(code);
  try { return lib.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { return esc(code); }
}

export function highlightSync(lib, code, name) {
  const lang = languageFor(name);
  if (!lib || !lang || code.length > 250000) return esc(code);
  try { return lib.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { return esc(code); }
}
