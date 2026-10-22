'use strict';
// Small HTTP toolkit: routing, cookies, JSON and file-upload parsing, errors.
const { Readable } = require('stream');

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || 'error'; }
}
const bad = (msg, code) => new HttpError(400, msg, code || 'bad_request');
const notFound = (msg) => new HttpError(404, msg || 'Not found', 'not_found');
const forbidden = (msg) => new HttpError(403, msg || 'Not allowed', 'forbidden');
const unauthorized = (msg) => new HttpError(401, msg || 'Please sign in', 'unauthorized');

function createRouter() {
  const routes = [];
  const add = (method) => (pattern, ...handlers) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handlers });
  };
  function match(method, pathname) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handlers: r.handlers, params };
    }
    return null;
  }
  return { get: add('GET'), post: add('POST'), patch: add('PATCH'), put: add('PUT'), del: add('DELETE'), match };
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [].concat(prev || [], parts.join('; ')));
}

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

// Read the raw body with a size limit.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > limit) { reject(new HttpError(413, 'This file is too large.', 'too_large')); req.resume(); return; }
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'This file is too large.', 'too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 1024 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw bad('Invalid data sent.'); }
}

// Multipart (file upload) parsing using the web-standard FormData parser built into Node.
async function readForm(req, limit) {
  const type = req.headers['content-type'] || '';
  if (!/^multipart\/form-data/i.test(type) && !/^application\/x-www-form-urlencoded/i.test(type)) {
    throw bad('Expected a form upload.');
  }
  const buf = await readBody(req, limit);
  const request = new Request('http://local/upload', { method: 'POST', headers: { 'content-type': type }, body: buf });
  const fd = await request.formData();
  const fields = {}; const files = [];
  for (const [key, value] of fd.entries()) {
    if (typeof value === 'string') fields[key] = value;
    else if (value && value.size > 0) files.push({ field: key, name: value.name || 'file', type: value.type || 'application/octet-stream', size: value.size, data: Buffer.from(await value.arrayBuffer()) });
  }
  return { fields, files };
}

// Helpers for reading values from request bodies safely.
const str = (v, max = 500) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const int = (v, def = null) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : def; };
const num = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(/[, ]/g, '')); return Number.isFinite(n) ? n : null; };
const date = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

module.exports = { HttpError, bad, notFound, forbidden, unauthorized, createRouter, parseCookies, setCookie, send, readJson, readForm, str, int, num, date, clamp, Readable };
