'use strict';
// Passwords (scrypt, built into Node) and login sessions stored in the database.
const crypto = require('crypto');
const db = require('./db');
const { parseCookies, setCookie, unauthorized, forbidden } = require('./http');

const COOKIE = 'fa_sid';
const SESSION_DAYS = 30;
const isProd = process.env.NODE_ENV === 'production';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(expected, got);
  } catch { return false; }
}

function checkPasswordStrength(pw) {
  if (!pw || String(pw).length < 8) return 'Use at least 8 characters.';
  return null;
}

function randomPassword() {
  // Easy to read and type: no 0/O or 1/l.
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[bytes[i] % chars.length];
  return out.slice(0, 5) + '-' + out.slice(5);
}

async function createSession(res, userId, userAgent) {
  const id = crypto.randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days', $3)`,
    [id, userId, (userAgent || '').slice(0, 300)]
  );
  setCookie(res, COOKIE, id, { maxAge: SESSION_DAYS * 86400, secure: isProd });
  return id;
}

async function destroySession(req, res) {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (sid) await db.query('DELETE FROM sessions WHERE id = $1', [sid]);
  setCookie(res, COOKIE, '', { maxAge: 0, secure: isProd });
}

// Attach req.user if a valid session cookie is present.
async function loadUser(req) {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (!sid || !/^[a-f0-9]{64}$/.test(sid)) return null;
  const row = await db.one(
    `SELECT u.id, u.role, u.name, u.email, u.phone, u.lang, u.must_change_password, s.id AS sid
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now() AND u.active = true`,
    [sid]
  );
  if (!row) return null;
  // Slide the expiry forward at most once a day.
  db.query(`UPDATE sessions SET expires_at = now() + interval '${SESSION_DAYS} days' WHERE id = $1 AND expires_at < now() + interval '${SESSION_DAYS - 1} days'`, [sid]).catch(() => {});
  return row;
}

function requireUser(req) { if (!req.user) throw unauthorized(); return req.user; }
function requireAdmin(req) { requireUser(req); if (req.user.role !== 'admin') throw forbidden(); return req.user; }

// The first studio account is created from environment variables on first start.
async function ensureAdmin() {
  const count = await db.one(`SELECT count(*)::int AS n FROM users WHERE role = 'admin'`);
  if (count && count.n > 0) return;
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    console.warn('\n  No studio account yet. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart, to create it.\n');
    return;
  }
  await db.query(
    `INSERT INTO users (role, name, email, password_hash, lang) VALUES ('admin', $1, $2, $3, 'en')`,
    [process.env.ADMIN_NAME || 'FA Studio', email, hashPassword(password)]
  );
  console.log(`  Studio account created for ${email}.`);
}

module.exports = { hashPassword, verifyPassword, checkPasswordStrength, randomPassword, createSession, destroySession, loadUser, requireUser, requireAdmin, ensureAdmin };
