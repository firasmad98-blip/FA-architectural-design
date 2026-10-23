'use strict';
// Access links, Face ID / fingerprint sign-in, and "I can't sign in" help.
const db = require('../lib/db');
const auth = require('../lib/auth');
const access = require('../lib/access');
const passkeys = require('../lib/passkeys');
const notify = require('../lib/notify');
const mail = require('../lib/email');
const { readJson, bad, notFound, str, int } = require('../lib/http');
const { limiter } = require('../lib/limit');
const { publicUser } = require('./auth');

const linkLimit = limiter({ windowMs: 15 * 60 * 1000, max: 30 });
const helpLimit = limiter({ windowMs: 60 * 60 * 1000, max: 5 });
const passkeyLimit = limiter({ windowMs: 15 * 60 * 1000, max: 30 });

module.exports = (r) => {
  // ---- Access links (client side) ----
  r.get('/api/access/:token', async (req, res, { params }) => {
    linkLimit(req);
    const l = await access.findValid(params.token);
    if (!l) return { valid: false };
    return { valid: true, purpose: l.purpose, name: l.name, email: l.email, lang: l.lang };
  });

  r.post('/api/access/:token', async (req, res, { params }) => {
    linkLimit(req);
    const l = await access.findValid(params.token);
    if (!l) throw bad('This link has expired or was already used. Ask the studio for a new one.', 'link_invalid');
    const b = await readJson(req);
    const weak = auth.checkPasswordStrength(b.password);
    if (weak) throw bad(weak, 'weak_password');
    await db.query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [auth.hashPassword(b.password), l.user_id]);
    await access.markUsed(l.id);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [l.user_id]); // signs out any other device
    await auth.createSession(res, l.user_id, req.headers['user-agent'], true);
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [l.user_id]);
    if (l.purpose === 'invite' && l.role === 'client') {
      await notify.notifyAdmins('joined', { name: l.name }, { url: '/portal/studio/#/clients' });
    }
    const user = await db.one('SELECT * FROM users WHERE id = $1', [l.user_id]);
    return { user: publicUser(user) };
  });

  // ---- "Forgot password": emails a new one-time link automatically ----
  // The answer is the same whether or not the email exists, so nobody can test which emails are clients.
  // Without an email service set up, the studio is notified instead and sends the link by WhatsApp.
  r.post('/api/auth/help', async (req) => {
    helpLimit(req);
    const b = await readJson(req, 4096);
    const email = String(b.email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter your email.');
    const mode = mail.enabled() ? 'email' : 'studio';
    const u = await db.one(`SELECT id, name, email, lang, role, last_login_at FROM users WHERE lower(email) = $1 AND active`, [email]);
    if (!u) return { ok: true, mode };
    if (mode === 'email') {
      // At most one email every 2 minutes per person, so repeated taps don't flood their inbox.
      const recent = await db.one(`SELECT 1 AS x FROM access_links WHERE user_id = $1 AND created_at > now() - interval '2 minutes'`, [u.id]);
      if (recent) return { ok: true, mode };
      const purpose = u.role === 'client' && !u.last_login_at ? 'invite' : 'reset';
      const link = await access.createLink(u.id, purpose);
      const sent = await mail.sendAccessLink(u, purpose, access.linkUrl(req, link.token));
      if (sent.sent) {
        if (u.role === 'client') await notify.notifyAdmins('helpSent', { name: u.name }, { url: '/portal/studio/#/clients' });
        return { ok: true, mode };
      }
      // The email service failed: fall through and let the studio know, so the client isn't stuck.
    }
    if (u.role === 'client') await notify.notifyAdmins('help', { name: u.name }, { url: '/portal/studio/#/clients' });
    return { ok: true, mode: 'studio' };
  });

  // ---- Face ID / fingerprint ----
  r.post('/api/passkeys/register-options', async (req) => passkeys.registerOptions(req, auth.requireUser(req)));
  r.post('/api/passkeys/register', async (req) => passkeys.register(req, auth.requireUser(req), await readJson(req, 64 * 1024)));
  r.get('/api/passkeys', async (req) => {
    const me = auth.requireUser(req);
    return { passkeys: await db.query('SELECT id, label, created_at, last_used_at FROM passkeys WHERE user_id = $1 ORDER BY created_at DESC', [me.id]) };
  });
  r.del('/api/passkeys/:id', async (req, res, { params }) => {
    const me = auth.requireUser(req);
    const row = await db.one('DELETE FROM passkeys WHERE id = $1 AND user_id = $2 RETURNING id', [int(params.id, 0), me.id]);
    if (!row) throw notFound();
    return { ok: true };
  });
  r.post('/api/passkeys/login-options', async (req) => { passkeyLimit(req); return passkeys.loginOptions(req); });
  r.post('/api/passkeys/login', async (req, res) => {
    passkeyLimit(req);
    const user = await passkeys.login(req, await readJson(req, 64 * 1024));
    await auth.createSession(res, user.id, req.headers['user-agent'], true);
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    return { user: publicUser(user) };
  });
};
