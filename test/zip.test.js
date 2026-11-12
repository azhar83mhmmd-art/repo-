// Unit tests for ZIP path sanitising (ZIP Slip protection). Run: node test/zip.test.js
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = path.join(os.tmpdir(), 'rf-zip.mjs'); fs.copyFileSync(path.join(__dirname, '../src/js/zip-manager.js'), tmp);
import(tmp).then(({ sanitizeEntryPath: s, resolvePath: r }) => {
  const bad = ['../x', 'a/../../x', '/etc/passwd', 'C:\\win\\x', 'a/.git/config', '.git/HEAD', 'a\\..\\..\\x', 'a/b\0c', '', '///', 'a/\x01b'];
  for (const b of bad) assert.strictEqual(s(b), null, `should reject ${JSON.stringify(b)}`);
  assert.strictEqual(s('a//b/./c.txt'), 'a/b/c.txt'); assert.strictEqual(s('dir\\file.js'), 'dir/file.js'); assert.strictEqual(s('.github/workflows/ci.yml'), '.github/workflows/ci.yml');
  assert.strictEqual(r('proj/a.js', { structure: 'strip-root', rootFolder: 'proj', destination: 'x/y' }), 'x/y/a.js');
  assert.strictEqual(r('proj/a.js', { structure: 'preserve', rootFolder: 'proj', destination: '' }), 'proj/a.js');
  console.log('✓ ZIP path sanitising: all checks passed'); fs.unlinkSync(tmp);
}).catch((e) => { console.error('✗', e.message); process.exit(1); });
