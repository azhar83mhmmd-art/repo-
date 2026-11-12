// Copies the static frontend into dist/ so Vercel serves a predictable layout:
//   dist/index.html, dist/src/**, and everything in public/ at the site root.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function copy(from, to) {
  fs.cpSync(path.join(root, from), path.join(dist, to), { recursive: true });
}

copy('index.html', 'index.html');
copy('src', 'src');
for (const entry of fs.readdirSync(path.join(root, 'public'))) {
  copy(path.join('public', entry), entry);
}
console.log('RepoFast build complete → dist/');
