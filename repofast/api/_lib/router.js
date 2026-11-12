'use strict';
// Single entry point for every /api/* request.
// Vercel's Hobby plan allows at most 12 serverless functions, so instead of one file per endpoint
// all handlers live in api/_lib/routes/ (underscore folders are never deployed as functions)
// and are dispatched from here. Routes are listed explicitly so the bundler traces each one.

const routes = {
  'auth/verify': require('./routes/auth/verify'),
  'auth/connect': require('./routes/auth/connect'),
  'auth/disconnect': require('./routes/auth/disconnect'),
  'upload/process-zip': require('./routes/upload/process-zip'),
  'upload/bulk-upload': require('./routes/upload/bulk-upload'),
  'upload/validate-zip': require('./routes/upload/validate-zip'),
  'github/rename-file': require('./routes/github/rename-file'),
  'github/upload-blob': require('./routes/github/upload-blob'),
  'github/update-reference': require('./routes/github/update-reference'),
  'github/repositories': require('./routes/github/repositories'),
  'github/user': require('./routes/github/user'),
  'github/create-repository': require('./routes/github/create-repository'),
  'github/file-content': require('./routes/github/file-content'),
  'github/create-tree': require('./routes/github/create-tree'),
  'github/delete-folder': require('./routes/github/delete-folder'),
  'github/update-file': require('./routes/github/update-file'),
  'github/repository-tree': require('./routes/github/repository-tree'),
  'github/branches': require('./routes/github/branches'),
  'github/delete-file': require('./routes/github/delete-file'),
  'github/commits': require('./routes/github/commits'),
  'github/create-commit': require('./routes/github/create-commit'),
};

function dispatch(req, res) {
  let pathname = '';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    /* fall through to 404 */
  }
  const key = pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  const handler = Object.prototype.hasOwnProperty.call(routes, key) ? routes[key] : null;
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end('{"error":{"status":404,"message":"Not found"}}');
  }
  return handler(req, res);
}

module.exports = { dispatch, routes };
