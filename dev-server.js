'use strict';
// Local development server: serves the static frontend and runs /api/* handlers the way Vercel does.
//   npm run dev   →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { dispatch } = require('./api/_lib/router');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function staticFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  if (clean === '/' || !path.extname(clean)) return path.join(ROOT, 'index.html');
  const candidates = [path.join(ROOT, 'public', clean), path.join(ROOT, clean)];
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (!resolved.startsWith(ROOT + path.sep)) continue;
    if (resolved.includes(`${path.sep}api${path.sep}`) || resolved.includes('node_modules')) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return null;
}

function readBody(req, limit = 4.5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      try {
        req.query = Object.fromEntries(url.searchParams);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const raw = await readBody(req);
          try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
        }
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
        return await dispatch(req, res);
      } catch (e) {
        res.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { status: e.status || 500, message: e.status === 413 ? 'Upload exceeds the configured request size limit.' : 'An unexpected server error occurred.' } }));
      }
    }

    const f = staticFile(url.pathname);
    if (!f) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(f)] || 'application/octet-stream';
    const size = fs.statSync(f).size;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {   // Range support so <video> can seek
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(f, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`RepoFast running → http://localhost:${PORT}`));
}
module.exports = { createServer };
