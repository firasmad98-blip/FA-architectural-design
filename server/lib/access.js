'use strict';
// One-time access links: a client taps the link from the studio's WhatsApp/email message
// and chooses their own password. Used for first invitations and for "I forgot my password".
const crypto = require('crypto');
const db = require('./db');

const LIFETIME = { invite: '7 days', reset: '48 hours' };
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Creates a new link and cancels any older unused links for the same person.
async function createLink(userId, purpose) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query('UPDATE access_links SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  const row = await db.one(
    `INSERT INTO access_links (user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, now() + interval '${LIFETIME[purpose]}') RETURNING expires_at`,
    [userId, hash(token), purpose]
  );
  return { token, purpose, expiresAt: row.expires_at };
}

// Returns the link with its person if it is still valid, otherwise null.
async function findValid(token) {
  if (!token || !/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  return db.one(
    `SELECT l.id, l.purpose, l.expires_at, u.id AS user_id, u.name, u.email, u.lang, u.role
       FROM access_links l JOIN users u ON u.id = l.user_id
      WHERE l.token_hash = $1 AND l.used_at IS NULL AND l.expires_at > now() AND u.active = true`,
    [hash(token)]
  );
}

async function markUsed(id) { await db.query('UPDATE access_links SET used_at = now() WHERE id = $1', [id]); }

// The web address the studio sends. The token sits after "#", so it never appears in server logs.
function linkUrl(req, token) {
  const proto = String(req.headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http')).split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const base = (process.env.PUBLIC_URL || `${proto}://${host}`).replace(/\/+$/, '');
  return `${base}/portal/#/access/${token}`;
}

module.exports = { createLink, findValid, markUsed, linkUrl };
