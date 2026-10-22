'use strict';
// FA Architectural Design · website + client portal server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');

const db = require('./lib/db');
const auth = require('./lib/auth');
const notify = require('./lib/notify');
const { createRouter, send, HttpError } = require('./lib/http');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const isProd = process.env.NODE_ENV === 'production';

const router = createRouter();
require('./routes/public')(router);
require('./routes/auth')(router);
require('./routes/portal')(router);
require('./routes/studio')(router);

// ---------- Static files (website, portal pages, images) ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR)) return false;
  let st;
  try { st = fs.statSync(full); } catch { return false; }
  if (st.isDirectory()) { res.writeHead(301, { Location: pathname + '/' }); res.end(); return true; }
  const ext = path.extname(full).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  const base = path.basename(full);
  if (ext === '.html' || base === 'sw.js' || ext === '.webmanifest') headers['Cache-Control'] = 'no-cache';
  else if (ext === '.js' || ext === '.css') headers['Cache-Control'] = 'public, max-age=3600';
  else headers['Cache-Control'] = 'public, max-age=604800';
  if (base === 'sw.js') headers['Service-Worker-Allowed'] = '/portal/';
  const etag = `"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
  headers.ETag = etag;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(full).pipe(zlib.createGzip()).pipe(res);
  } else {
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(full).pipe(res);
  }
  return true;
}

function notFoundPage(res) {
  const f = path.join(PUBLIC_DIR, '404.html');
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(f).on('error', () => res.end('Page not found')).pipe(res);
}

// ---------- Request handling ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000');

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/api/') || pathname === '/healthz') {
      // Protection against other websites sending requests on a visitor's behalf.
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'fa') {
        throw new HttpError(403, 'Request blocked.', 'csrf');
      }
      const match = router.match(req.method, pathname);
      if (!match) throw new HttpError(404, 'Not found', 'not_found');
      req.user = await auth.loadUser(req);
      const result = await match.handlers[0](req, res, { params: match.params, query: url.searchParams });
      if (result !== undefined) send(res, 200, result);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (!serveStatic(req, res, pathname)) notFoundPage(res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`${req.method} ${pathname}:`, err);
    send(res, status, { error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message, code: err.code || 'error' });
  }
});

async function start() {
  console.log('Starting FA portal…');
  await db.migrate();
  await auth.ensureAdmin();
  await notify.initVapid();
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
  server.listen(PORT, () => console.log(`FA portal running on port ${PORT}`));
}

start().catch((err) => { console.error('Could not start:', err); process.exit(1); });

process.on('SIGTERM', () => server.close(() => db.pool.end().then(() => process.exit(0))));
