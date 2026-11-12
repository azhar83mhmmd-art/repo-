// Syntax-checks every JS file (API as CommonJS, browser code as ES modules).
const fs = require('fs'); const path = require('path'); const cp = require('child_process'); const os = require('os');
const root = path.resolve(__dirname, '..'); let bad = 0; let n = 0;
function walk(d, out = []) { for (const f of fs.readdirSync(d)) { if (['node_modules', 'dist', 'vendor', '.git'].includes(f)) continue; const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p, out) : /\.js$/.test(f) && out.push(p); } return out; }
for (const f of walk(root)) {
  const esm = f.startsWith(path.join(root, 'src'));
  let target = f;
  if (esm) { target = path.join(os.tmpdir(), 'rf-' + n + '.mjs'); fs.copyFileSync(f, target); }
  const r = cp.spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  n++; if (r.status !== 0) { bad++; console.error('✗', path.relative(root, f), '\n', r.stderr); }
  if (esm) fs.unlinkSync(target);
}
console.log(bad ? `${bad} file(s) failed` : `✓ ${n} files OK`); process.exit(bad ? 1 : 0);
