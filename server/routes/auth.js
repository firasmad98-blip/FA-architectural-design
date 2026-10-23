'use strict';
const db = require('../lib/db');
const auth = require('../lib/auth');
const { readJson, bad, unauthorized, str } = require('../lib/http');
const { limiter } = require('../lib/limit');

const loginLimit = limiter({ windowMs: 15 * 60 * 1000, max: 10 });

module.exports = (r) => {
  r.post('/api/auth/login', async (req, res) => {
    loginLimit(req);
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!email || !password) throw bad('Enter your email and password.');
    const user = await db.one('SELECT * FROM users WHERE lower(email) = $1 AND active = true', [email]);
    if (!user || !auth.verifyPassword(password, user.password_hash)) throw unauthorized('Email or password is incorrect.');
    await auth.createSession(res, user.id, req.headers['user-agent'], b.remember !== false);
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    return { user: publicUser(user) };
  });

  r.post('/api/auth/logout', async (req, res) => {
    await auth.destroySession(req, res);
    return { ok: true };
  });

  r.get('/api/auth/me', async (req) => {
    if (!req.user) return { user: null };
    return { user: publicUser(req.user) };
  });

  r.post('/api/auth/password', async (req) => {
    const me = auth.requireUser(req);
    const b = await readJson(req);
    const user = await db.one('SELECT password_hash FROM users WHERE id = $1', [me.id]);
    if (!auth.verifyPassword(String(b.current || ''), user.password_hash)) throw bad('Your current password is incorrect.', 'wrong_password');
    const weak = auth.checkPasswordStrength(b.password);
    if (weak) throw bad(weak, 'weak_password');
    await db.query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [auth.hashPassword(b.password), me.id]);
    // Sign out other devices.
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [me.id, me.sid]);
    return { ok: true };
  });

  r.post('/api/auth/language', async (req) => {
    const me = auth.requireUser(req);
    const b = await readJson(req);
    const lang = ['en', 'fr', 'ar'].includes(b.lang) ? b.lang : 'en';
    await db.query('UPDATE users SET lang = $1 WHERE id = $2', [lang, me.id]);
    return { ok: true, lang };
  });

  r.patch('/api/auth/profile', async (req) => {
    const me = auth.requireUser(req);
    const b = await readJson(req);
    const name = str(b.name, 120);
    if (!name) throw bad('Please enter your name.');
    await db.query('UPDATE users SET name = $1, phone = $2 WHERE id = $3', [name, str(b.phone, 40), me.id]);
    return { ok: true };
  });
};

function publicUser(u) {
  return { id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, lang: u.lang, mustChangePassword: !!u.must_change_password };
}
module.exports.publicUser = publicUser;
