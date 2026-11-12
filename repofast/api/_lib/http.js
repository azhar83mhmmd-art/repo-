'use strict';
// Shared request pipeline for all serverless functions:
// method check → origin check → rate limit → token extraction → handler → uniform JSON errors.
//
// SECURITY MODEL: the GitHub token lives only on the user's device. The browser sends it in the
// Authorization header of each request; this server forwards it to GitHub and forgets it.
// There is no session, no cookie, no database and the token is never written to any log.

const { gh, redact } = require('./github');
const { HttpError } = require('./validate');

const TOKEN_RE = /^[A-Za-z0-9_\-]{20,255}$/;
const buckets = new Map(); // best-effort, per warm function instance

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimit(req) {
  const limit = Number(process.env.RATE_LIMIT_PER_MIN) || 240;
  const now = Date.now();
  const ip = clientIp(req);
  let b = buckets.get(ip);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + 60_000 };
    buckets.set(ip, b);
  }
  b.count++;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }
  if (b.count > limit) {
    throw new HttpError(429, 'Too many requests. Please slow down and try again shortly.', {
      code: 'app_rate_limited',
    });
  }
}

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return; // same-origin GETs and server-to-server calls carry no Origin
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Origin not allowed.', { code: 'bad_origin' });
  }
  if (originHost === host) return;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return;
  throw new HttpError(403, 'Origin not allowed.', { code: 'bad_origin' });
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(\S+)$/i);
  const token = m ? m[1] : '';
  if (!token || !TOKEN_RE.test(token)) {
    throw new HttpError(401, 'Your GitHub token is invalid or expired.', { code: 'missing_token' });
  }
  return token;
}

function send(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(status).json(payload);
}

/**
 * route({ methods, auth }, async (ctx) => result)
 * ctx: { req, res, token, query, body, gh(method, path, opts) }
 * The returned value is sent as JSON (200). Return { __status, ...data } to override the status.
 */
function route(options, fn) {
  const methods = options.methods || ['GET'];
  const needsAuth = options.auth !== false;

  return async function handler(req, res) {
    let token = null;
    try {
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        throw new HttpError(405, 'Method not allowed.', { code: 'method_not_allowed' });
      }
      checkOrigin(req);
      rateLimit(req);

      if (req.method !== 'GET' && req.headers['x-repofast-client'] !== 'web') {
        throw new HttpError(403, 'Missing client header.', { code: 'bad_client' });
      }

      if (needsAuth) token = extractToken(req);

      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          throw new HttpError(400, 'Request body must be valid JSON.', { code: 'invalid_json' });
        }
      }

      const ctx = {
        req,
        res,
        token,
        query: req.query || {},
        body: body || {},
        gh: (method, path, opts) => gh(token, method, path, opts),
      };

      const result = await fn(ctx);
      if (res.writableEnded) return;
      if (result && result.__status) {
        const { __status, ...rest } = result;
        return send(res, __status, rest);
      }
      return send(res, 200, result === undefined ? { ok: true } : result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (!(err instanceof HttpError)) {
        // Log the error class only. Never log request headers, bodies or tokens.
        console.error('[repofast] unexpected error:', redact(String(err && err.message), token));
      }
      return send(res, status, {
        error: {
          status,
          code: err.code || (status === 500 ? 'internal_error' : null),
          message: err instanceof HttpError ? err.message : 'An unexpected server error occurred.',
          detail: err instanceof HttpError ? err.detail : null,
          rateLimit: err instanceof HttpError ? err.rateLimit : null,
        },
      });
    }
  };
}

module.exports = { route };
