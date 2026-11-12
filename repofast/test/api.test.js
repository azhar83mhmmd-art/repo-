'use strict';
// End-to-end API test against an in-memory GitHub mock. Run: npm test
const assert = require('assert');
const { createMock } = require('./mock-github');
const { createServer } = require('../dev-server');

(async () => {
  const mock = createMock();
  await new Promise((r) => mock.server.listen(0, r));
  process.env.GITHUB_API_URL = `http://127.0.0.1:${mock.server.address().port}`;
  const app = createServer();
  await new Promise((r) => app.listen(0, r));
  const base = `http://127.0.0.1:${app.address().port}`;

  const call = async (method, path, { token = mock.TOKEN, body, headers } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-RepoFast-Client': 'web' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  let n = 0; const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

  // auth
  let r = await call('POST', '/api/auth/connect');
  assert.equal(r.status, 200); assert.equal(r.json.user.login, 'tester'); assert.equal(r.json.token.type, 'classic');
  assert(!JSON.stringify(r.json).includes(mock.TOKEN)); ok('connect validates token and never echoes it');
  r = await call('POST', '/api/auth/connect', { token: 'ghp_' + 'b'.repeat(36) });
  assert.equal(r.status, 401); assert.equal(r.json.error.message, 'Your GitHub token is invalid or expired.'); ok('bad token → friendly 401');
  r = await call('POST', '/api/auth/connect', { token: null });
  assert.equal(r.status, 401); ok('missing token → 401');
  r = await call('POST', '/api/auth/connect', { headers: { 'X-RepoFast-Client': '' } });
  assert.equal(r.status, 403); ok('CSRF client header required on POST');
  r = await call('POST', '/api/auth/connect', { headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403); ok('cross-origin request rejected');
  r = await call('GET', '/api/auth/connect'); assert.equal(r.status, 405); ok('wrong method → 405');
  r = await call('GET', '/api/_lib/http'); assert.equal(r.status, 404); ok('_lib is not routable');

  // repos
  r = await call('GET', '/api/github/repositories'); assert.equal(r.json.repositories[0].fullName, 'tester/demo'); ok('list repositories');
  r = await call('POST', '/api/github/create-repository', { body: { name: 'new-one', visibility: 'public' } });
  assert.equal(r.status, 201); assert.equal(r.json.repository.private, false); ok('create repository');
  r = await call('POST', '/api/github/create-repository', { body: { name: '../bad' } }); assert.equal(r.status, 400); ok('invalid repo name rejected');

  // validate-zip
  r = await call('POST', '/api/upload/validate-zip', { token: null, body: { files: [{ path: 'a/b.txt', size: 5 }, { path: '../evil.sh', size: 1 }, { path: 'a/b.txt', size: 5 }, { path: '.git/config', size: 1 }, { path: 'big.bin', size: 200 * 1024 * 1024 }], destination: 'src' } });
  assert.equal(r.json.accepted.length, 1); assert.equal(r.json.accepted[0].path, 'src/a/b.txt'); assert.equal(r.json.rejected.length, 4); ok('validate-zip blocks traversal, .git, duplicates, >100MB');

  // process-zip conflict detection
  r = await call('POST', '/api/upload/process-zip', { body: { owner: 'tester', repo: 'demo', branch: 'main', paths: ['README.md', 'new.txt'] } });
  assert.equal(r.json.existing.length, 1); assert.equal(r.json.existing[0].path, 'README.md'); const head = r.json.head; assert(/^[0-9a-f]{40}$/.test(r.json.baseTree)); ok('process-zip detects existing files');

  // blobs
  const b64 = (s) => Buffer.from(s).toString('base64');
  r = await call('POST', '/api/github/upload-blob', { body: { owner: 'tester', repo: 'demo', files: [{ path: 'src/app.js', content: b64('console.log(1)') }, { path: 'logo.bin', content: b64(Buffer.from([0, 255, 1])) }] } });
  assert.equal(r.json.blobs.length, 2); const blobs = r.json.blobs; ok('create blobs (batch)');
  r = await call('POST', '/api/github/upload-blob', { body: { owner: 'tester', repo: 'demo', files: [{ path: '../x', content: 'AAAA' }] } }); assert.equal(r.status, 400); ok('blob path traversal rejected');
  r = await call('POST', '/api/github/upload-blob', { body: { owner: 'tester', repo: 'demo', files: [{ path: 'x', content: 'A'.repeat(3.3 * 1024 * 1024) }] } }); assert.equal(r.status, 413); ok('oversized batch → 413');

  // bulk upload: single commit, existing file preserved
  const before = mock.state.requests.filter((x) => x.includes('git/commits') && x.startsWith('POST')).length;
  r = await call('POST', '/api/upload/bulk-upload', { body: { owner: 'tester', repo: 'demo', branch: 'main', expectedHead: head, message: 'Upload', entries: blobs.map((b) => ({ path: b.path, sha: b.sha })) } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.files, 2);
  const after = mock.state.requests.filter((x) => x.includes('git/commits') && x.startsWith('POST')).length;
  assert.equal(after - before, 1); ok('bulk upload creates exactly ONE commit');
  const tree = mock.state.trees[mock.state.commits[mock.state.refs.main].tree.sha].map((t) => t.path).sort();
  assert.deepEqual(tree, ['README.md', 'logo.bin', 'src/app.js']); ok('untouched files preserved (README.md kept)');
  assert.equal(mock.state.commits[mock.state.refs.main].parents[0], head); ok('commit parent = previous head (no force push)');

  // branch changed detection
  r = await call('POST', '/api/upload/bulk-upload', { body: { owner: 'tester', repo: 'demo', branch: 'main', expectedHead: head, message: 'x', entries: [{ path: 'z.txt', sha: blobs[0].sha }] } });
  assert.equal(r.status, 409); assert.equal(r.json.error.code, 'branch_changed'); ok('stale head → 409 branch_changed');

  // new branch
  r = await call('POST', '/api/upload/bulk-upload', { body: { owner: 'tester', repo: 'demo', branch: 'feature', createBranch: true, baseBranch: 'main', message: 'x', entries: [{ path: 'z.txt', sha: blobs[0].sha }] } });
  assert.equal(r.status, 200); assert(mock.state.refs.feature); ok('create new branch from base');

  // chunked trees (>1000 entries) still ONE commit
  const many = Array.from({ length: 2300 }, (_, i) => ({ path: `many/f${i}.txt`, sha: blobs[0].sha }));
  const c1 = mock.state.requests.filter((x) => x === 'POST /repos/tester/demo/git/commits').length;
  r = await call('POST', '/api/upload/bulk-upload', { body: { owner: 'tester', repo: 'demo', branch: 'main', message: 'many', entries: many } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.treeChunks, 3);
  assert.equal(mock.state.requests.filter((x) => x === 'POST /repos/tester/demo/git/commits').length - c1, 1); ok('2300 files → 3 tree chunks, still 1 commit');

  // rename
  const t = mock.state.trees[mock.state.commits[mock.state.refs.main].tree.sha].find((e) => e.path === 'src/app.js');
  r = await call('POST', '/api/github/rename-file', { body: { owner: 'tester', repo: 'demo', branch: 'main', from: 'src/app.js', to: 'src/main.js', sha: t.sha } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const paths = mock.state.trees[mock.state.commits[mock.state.refs.main].tree.sha].map((e) => e.path);
  assert(paths.includes('src/main.js') && !paths.includes('src/app.js')); ok('rename moves file in one commit');
  r = await call('POST', '/api/github/rename-file', { body: { owner: 'tester', repo: 'demo', branch: 'main', from: 'src/main.js', to: 'src/main.js', sha: t.sha } }); assert.equal(r.status, 400); ok('rename to same name rejected');

  // delete folder (one commit, every file under it)
  const treeNow = () => mock.state.trees[mock.state.commits[mock.state.refs.main].tree.sha].map((e) => e.path);
  const underMany = treeNow().filter((x) => x.startsWith('many/')).length; assert(underMany > 0);
  const c2 = mock.state.requests.filter((x) => x === 'POST /repos/tester/demo/git/commits').length;
  r = await call('POST', '/api/github/delete-folder', { body: { owner: 'tester', repo: 'demo', branch: 'main', path: 'many' } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.deleted, underMany);
  assert(!treeNow().some((x) => x.startsWith('many/')));
  assert.equal(mock.state.requests.filter((x) => x === 'POST /repos/tester/demo/git/commits').length - c2, 1); ok('delete folder removes all files in one commit');
  r = await call('POST', '/api/github/delete-folder', { body: { owner: 'tester', repo: 'demo', branch: 'main', path: 'many' } }); assert.equal(r.status, 404); ok('delete missing folder → 404');
  r = await call('POST', '/api/github/delete-folder', { body: { owner: 'tester', repo: 'demo', branch: 'main', path: '../x' } }); assert.equal(r.status, 400); ok('delete folder rejects unsafe path');

  // token never leaks into any error output
  r = await call('POST', '/api/github/update-reference', { body: { owner: 'tester', repo: 'demo', branch: 'bad..name', sha: head } });
  assert.equal(r.status, 400); assert(!JSON.stringify(r.json).includes(mock.TOKEN)); ok('invalid branch rejected, no token in response');

  console.log(`\nAll ${n} API checks passed.`);
  mock.server.close(); app.close(); process.exit(0);
})().catch((e) => { console.error('\n✗ FAILED:', e.message); process.exit(1); });
