'use strict';
// Minimal in-memory GitHub used to test the API layer end-to-end without network access.
const http = require('http');
const crypto = require('crypto');

function sha(s) { return crypto.createHash('sha1').update(String(s) + Math.random()).digest('hex'); }

function createMock() {
  const TOKEN = 'ghp_' + 'a'.repeat(36);
  const state = { blobs: {}, trees: {}, commits: {}, refs: {}, requests: [] };
  const repo = { id: 1, name: 'demo', full_name: 'tester/demo', owner: { login: 'tester' }, private: true, visibility: 'private', default_branch: 'main', html_url: 'https://github.com/tester/demo', updated_at: '2026-01-01T00:00:00Z' };

  // seed: one commit with README.md
  const readme = sha('readme'); state.blobs[readme] = Buffer.from('# hi');
  const t0 = sha('t0'); state.trees[t0] = [{ path: 'README.md', mode: '100644', type: 'blob', sha: readme }];
  const c0 = sha('c0'); state.commits[c0] = { sha: c0, tree: { sha: t0 }, parents: [], message: 'init' };
  state.refs['main'] = c0;

  function flatten(sha) { const t = state.commits[sha] ? state.commits[sha].tree.sha : sha; return state.trees[t] || []; }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      const body = raw ? JSON.parse(raw) : {};
      state.requests.push(`${req.method} ${p}`);
      const out = (code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };

      if (req.headers.authorization !== `Bearer ${TOKEN}`) return out(401, { message: 'Bad credentials' });
      let m;
      if (p === '/user') return out(200, { login: 'tester', name: 'Test', avatar_url: 'x', html_url: 'u', type: 'User', id: 1, public_repos: 0 }, { 'x-oauth-scopes': 'repo', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '1' });
      if (p === '/user/repos' && req.method === 'GET') return out(200, [repo]);
      if (p === '/user/repos' && req.method === 'POST') return out(201, { ...repo, name: body.name, full_name: 'tester/' + body.name, private: body.private });
      if ((m = p.match(/^\/repos\/tester\/demo$/))) return out(200, repo);
      if ((m = p.match(/^\/repos\/tester\/demo\/git\/ref\/heads\/(.+)$/))) {
        const b = decodeURIComponent(m[1]);
        return state.refs[b] ? out(200, { object: { sha: state.refs[b] } }) : out(404, { message: 'Not Found' });
      }
      if (p === '/repos/tester/demo/git/refs' && req.method === 'POST') { state.refs[body.ref.replace('refs/heads/', '')] = body.sha; return out(201, { ref: body.ref, object: { sha: body.sha } }); }
      if ((m = p.match(/^\/repos\/tester\/demo\/git\/refs\/heads\/(.+)$/)) && req.method === 'PATCH') {
        const b = decodeURIComponent(m[1]); state.refs[b] = body.sha; return out(200, { ref: 'refs/heads/' + b, object: { sha: body.sha } });
      }
      if (p === '/repos/tester/demo/git/blobs' && req.method === 'POST') { const s = sha(body.content); state.blobs[s] = Buffer.from(body.content, 'base64'); return out(201, { sha: s }); }
      if ((m = p.match(/^\/repos\/tester\/demo\/git\/commits\/([0-9a-f]{40})$/))) return state.commits[m[1]] ? out(200, state.commits[m[1]]) : out(404, { message: 'Not Found' });
      if (p === '/repos/tester/demo/git/commits' && req.method === 'POST') {
        const s = sha('c'); state.commits[s] = { sha: s, tree: { sha: body.tree }, parents: body.parents, message: body.message }; return out(201, { sha: s, html_url: 'https://github.com/tester/demo/commit/' + s });
      }
      if (p === '/repos/tester/demo/git/trees' && req.method === 'POST') {
        const base = body.base_tree ? flatten(body.base_tree).slice() : [];
        for (const e of body.tree) {
          const i = base.findIndex((x) => x.path === e.path);
          if (i >= 0) base.splice(i, 1);
          if (e.sha !== null) base.push({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha });
        }
        const s = sha('t'); state.trees[s] = base; return out(201, { sha: s });
      }
      if ((m = p.match(/^\/repos\/tester\/demo\/git\/trees\/([0-9a-f]{40})$/))) return out(200, { sha: m[1], truncated: false, tree: flatten(m[1]) });

      if (p === '/repos/tester/demo/branches') return out(200, Object.entries(state.refs).map(([name, sha_]) => ({ name, commit: { sha: sha_ }, protected: false })));
      if (p === '/repos/tester/demo/commits') {
        const head = state.refs[url.searchParams.get('sha') || 'main']; const list = []; let c = head;
        while (c && state.commits[c] && list.length < 30) { list.push({ sha: c, html_url: 'https://github.com/tester/demo/commit/' + c, commit: { message: state.commits[c].message, author: { name: 'Test', date: '2026-11-10T10:00:00Z' } }, author: { login: 'tester', avatar_url: 'x' } }); c = state.commits[c].parents[0]; }
        return out(200, list);
      }
      if ((m = p.match(/^\/repos\/tester\/demo\/contents\/?(.*)$/))) {
        const path = decodeURIComponent(m[1]); const files = flatten(state.refs.main);
        if (req.method === 'PUT') { const bl = sha('b'); state.blobs[bl] = Buffer.from(body.content, 'base64'); const t = sha('t'); const base = files.filter((x) => x.path !== path); base.push({ path, mode: '100644', type: 'blob', sha: bl }); state.trees[t] = base; const cs = sha('c'); state.commits[cs] = { sha: cs, tree: { sha: t }, parents: [state.refs.main], message: body.message }; state.refs.main = cs; return out(200, { content: { path, sha: bl, size: Buffer.from(body.content, 'base64').length, html_url: 'u' }, commit: { sha: cs, html_url: 'https://github.com/tester/demo/commit/' + cs } }); }
        const exact = files.find((x) => x.path === path);
        if (exact) { const buf = state.blobs[exact.sha]; return out(200, { type: 'file', name: path.split('/').pop(), path, sha: exact.sha, size: buf.length, content: buf.toString('base64'), html_url: 'https://github.com/tester/demo/blob/main/' + path, download_url: 'x' }); }
        const prefix = path ? path + '/' : ''; const seen = new Map();
        for (const f of files) { if (!f.path.startsWith(prefix)) continue; const rest = f.path.slice(prefix.length); const [first, ...more] = rest.split('/'); if (more.length) seen.set(first, { name: first, path: prefix + first, type: 'dir', size: 0, sha: 'd'.repeat(40), html_url: 'u' }); else seen.set(first, { name: first, path: f.path, type: 'file', size: state.blobs[f.sha].length, sha: f.sha, html_url: 'https://github.com/tester/demo/blob/main/' + f.path, download_url: 'x' }); }
        return seen.size || !path ? out(200, [...seen.values()]) : out(404, { message: 'Not Found' });
      }
      return out(404, { message: 'Not Found' });
    });
  });
  return { server, state, TOKEN };
}
module.exports = { createMock };
