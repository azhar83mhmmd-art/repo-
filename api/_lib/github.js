'use strict';
// Thin, stateless GitHub REST client used by every serverless function.
// The token is passed in per request and is never stored, cached or logged.

const { HttpError } = require('./validate');

const API_BASE = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const API_VERSION = '2022-11-28';
const DEFAULT_TIMEOUT_MS = 25000;

const FRIENDLY = {
  401: 'Your GitHub token is invalid or expired.',
  403: 'Your token does not have sufficient permissions.',
  404: 'Repository or branch not found.',
  409: 'Repository has changed. Please refresh and try again.',
  413: 'Upload exceeds the configured request size limit.',
  422: 'GitHub rejected the requested operation.',
  429: 'GitHub API rate limit reached. Please try again later.',
  500: 'An unexpected server error occurred.',
  502: 'GitHub is temporarily unavailable. Please try again.',
  503: 'GitHub is temporarily unavailable. Please try again.',
  504: 'GitHub took too long to respond. Please try again.',
};

function redact(text, token) {
  if (typeof text !== 'string') return text;
  let out = text;
  if (token) out = out.split(token).join('[redacted]');
  return out.replace(/(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]+/g, '[redacted]');
}

function rateInfo(headers) {
  const get = (k) => headers.get(k);
  if (get('x-ratelimit-limit') === null) return null;
  return {
    limit: Number(get('x-ratelimit-limit')),
    remaining: Number(get('x-ratelimit-remaining')),
    reset: Number(get('x-ratelimit-reset')) * 1000 || null,
  };
}

function isRateLimited(res, payload) {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  if (res.headers.get('x-ratelimit-remaining') === '0') return true;
  if (res.headers.get('retry-after')) return true;
  const msg = String(payload && payload.message || '').toLowerCase();
  return msg.includes('rate limit') || msg.includes('abuse') || msg.includes('secondary');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeDetail(payload, token) {
  if (!payload || typeof payload !== 'object') return null;
  const parts = [];
  if (payload.message) parts.push(String(payload.message));
  if (Array.isArray(payload.errors)) {
    for (const e of payload.errors.slice(0, 5)) {
      parts.push(typeof e === 'string' ? e : e.message || [e.resource, e.field, e.code].filter(Boolean).join(' '));
    }
  }
  const text = parts.filter(Boolean).join(' — ').slice(0, 500);
  return text ? redact(text, token) : null;
}

/**
 * Performs a GitHub API request.
 * opts: { query, body, timeout, retry, accept, raw }
 * Returns { status, data, headers, rate, link }.
 * Throws HttpError with a friendly message on any non-2xx.
 */
async function gh(token, method, path, opts = {}) {
  const url = new URL(API_BASE() + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const retryable = opts.retry !== undefined ? opts.retry : method === 'GET';
  const maxAttempts = retryable ? 3 : 1;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Accept: opts.accept || 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': API_VERSION,
          'User-Agent': 'RepoFast/1.0',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeout || DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      lastError = new HttpError(timedOut ? 504 : 502, FRIENDLY[timedOut ? 504 : 502], {
        code: timedOut ? 'github_timeout' : 'github_unreachable',
      });
      if (attempt < maxAttempts) {
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
      throw lastError;
    }

    const rate = rateInfo(res.headers);
    const link = res.headers.get('link');

    if (res.ok) {
      if (res.status === 204) return { status: 204, data: null, headers: res.headers, rate, link };
      if (opts.raw) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { status: res.status, data: buf, headers: res.headers, rate, link };
      }
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: res.status, data, headers: res.headers, rate, link };
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* body was not JSON */
    }

    if (isRateLimited(res, payload)) {
      const retryAfter = Number(res.headers.get('retry-after'));
      if (attempt < maxAttempts && retryAfter > 0 && retryAfter <= 8) {
        await sleep(retryAfter * 1000);
        continue;
      }
      throw new HttpError(429, FRIENDLY[429], {
        code: 'rate_limited',
        rateLimit: rate,
        detail: safeDetail(payload, token),
      });
    }

    if ([500, 502, 503, 504].includes(res.status) && attempt < maxAttempts) {
      await sleep(400 * 2 ** (attempt - 1));
      continue;
    }

    const status = res.status;
    let message = FRIENDLY[status] || 'GitHub returned an unexpected response.';
    let code = null;

    if (status === 403) {
      // Fine-grained tokens report the missing permission here.
      const needed = res.headers.get('x-accepted-github-permissions');
      if (needed) message += ` Required permission: ${needed}.`;
      code = 'insufficient_permission';
    } else if (status === 401) {
      code = 'bad_credentials';
    } else if (status === 409 && payload && /empty/i.test(String(payload.message))) {
      code = 'empty_repository';
      message = 'This repository is empty.';
    } else if (status === 409) {
      code = 'conflict';
    } else if (status === 404) {
      code = 'not_found';
    } else if (status === 422) {
      code = 'unprocessable';
    }

    throw new HttpError(status, message, {
      code,
      detail: safeDetail(payload, token),
      rateLimit: rate,
    });
  }
  throw lastError || new HttpError(500, FRIENDLY[500]);
}

/** Parses a GitHub `Link` header into { next, prev, last } page numbers. */
function parseLink(link) {
  const out = {};
  if (!link) return out;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="(\w+)"/);
    if (!m) continue;
    try {
      const page = new URL(m[1]).searchParams.get('page');
      if (page) out[m[2]] = Number(page);
    } catch {
      /* ignore malformed link */
    }
  }
  return out;
}

/** Runs async tasks with a bounded concurrency, preserving result order. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

module.exports = { gh, parseLink, mapLimit, redact, encodePath, FRIENDLY };
