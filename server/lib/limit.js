'use strict';
// Simple in-memory rate limiting (per visitor IP) to slow down password guessing and spam.
const { HttpError } = require('./http');

function ipOf(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

function limiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req) => {
    const key = ipOf(req);
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
    h.count += 1;
    if (h.count > max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.', 'rate_limited');
  };
}

module.exports = { limiter, ipOf };
