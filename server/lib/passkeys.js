'use strict';
// Face ID / fingerprint sign-in using passkeys (WebAuthn), built on Node's own crypto.
// The phone keeps the private key; we only store the public key, so nothing secret is saved here.
const crypto = require('crypto');
const db = require('./db');
const { bad, unauthorized } = require('./http');

const challenges = new Map(); // challenge -> { type, userId, expires }
setInterval(() => { const now = Date.now(); for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k); }, 60000).unref();

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');

function hostOf(req) { return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim(); }
function rpId(req) { return process.env.PASSKEY_RP_ID || hostOf(req).replace(/:\d+$/, ''); }
function expectedOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http')).split(',')[0].trim();
  return `${proto}://${hostOf(req)}`;
}

function newChallenge(type, userId) {
  const c = b64u(crypto.randomBytes(32));
  challenges.set(c, { type, userId: userId || null, expires: Date.now() + 5 * 60 * 1000 });
  return c;
}

function checkClientData(req, clientDataB64, type) {
  let cd;
  try { cd = JSON.parse(fromB64u(clientDataB64).toString('utf8')); } catch { throw bad('Sign-in data could not be read.'); }
  const entry = challenges.get(cd.challenge);
  if (!entry || entry.type !== type || entry.expires < Date.now()) throw bad('This request expired. Please try again.', 'challenge');
  challenges.delete(cd.challenge);
  if (cd.type !== (type === 'reg' ? 'webauthn.create' : 'webauthn.get')) throw bad('Wrong kind of sign-in data.');
  if (cd.origin !== expectedOrigin(req)) throw bad('Sign-in came from an unexpected address.', 'origin');
  return entry;
}

function checkAuthData(req, authData) {
  if (authData.length < 37) throw bad('Sign-in data is incomplete.');
  const rpHash = crypto.createHash('sha256').update(rpId(req)).digest();
  if (!crypto.timingSafeEqual(rpHash, authData.subarray(0, 32))) throw bad('Sign-in is for a different website.', 'rp');
  const flags = authData[32];
  if (!(flags & 0x01)) throw bad('Please confirm on your device.', 'presence');
  if (!(flags & 0x04)) throw bad('Face ID, fingerprint or device PIN is required.', 'verification');
  return { signCount: authData.readUInt32BE(33) };
}

async function registerOptions(req, user) {
  const existing = await db.query('SELECT credential_id FROM passkeys WHERE user_id = $1', [user.id]);
  return {
    challenge: newChallenge('reg', user.id),
    rp: { id: rpId(req), name: 'FA Architectural Design' },
    user: { id: b64u(Buffer.from(`fa-user-${user.id}`)), name: user.email, displayName: user.name },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    timeout: 120000,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    excludeCredentials: existing.map((c) => ({ type: 'public-key', id: c.credential_id })),
  };
}

async function register(req, user, body) {
  const entry = checkClientData(req, body.clientDataJSON, 'reg');
  if (entry.userId !== user.id) throw bad('This request belongs to someone else.');
  checkAuthData(req, fromB64u(body.authenticatorData));
  const alg = Number(body.alg);
  if (alg !== -7 && alg !== -257) throw bad('This device uses an unsupported key type.');
  let key;
  try { key = crypto.createPublicKey({ key: fromB64u(body.publicKey), format: 'der', type: 'spki' }); } catch { throw bad('The device key could not be read.'); }
  const credentialId = String(body.id || '');
  if (!/^[A-Za-z0-9_-]{16,1400}$/.test(credentialId)) throw bad('Invalid device id.');
  const label = String(body.label || '').trim().slice(0, 60) || 'This device';
  await db.query(
    `INSERT INTO passkeys (user_id, credential_id, public_key, alg, label) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (credential_id) DO UPDATE SET user_id = EXCLUDED.user_id, public_key = EXCLUDED.public_key, alg = EXCLUDED.alg, label = EXCLUDED.label`,
    [user.id, credentialId, key.export({ format: 'der', type: 'spki' }).toString('base64'), alg, label]
  );
  return { ok: true };
}

function loginOptions(req) {
  return { challenge: newChallenge('get'), rpId: rpId(req), timeout: 120000, userVerification: 'required', allowCredentials: [] };
}

// Checks the signature from the device and returns the person to sign in.
async function login(req, body) {
  const cred = await db.one(
    `SELECT p.*, u.active FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.credential_id = $1`,
    [String(body.id || '')]
  );
  checkClientData(req, body.clientDataJSON, 'get'); // always consume the challenge
  if (!cred || !cred.active) throw unauthorized('This Face ID / fingerprint is not linked to an account here. Sign in with your password.');
  const authData = fromB64u(body.authenticatorData);
  const { signCount } = checkAuthData(req, authData);
  const data = Buffer.concat([authData, crypto.createHash('sha256').update(fromB64u(body.clientDataJSON)).digest()]);
  const key = crypto.createPublicKey({ key: Buffer.from(cred.public_key, 'base64'), format: 'der', type: 'spki' });
  const sig = fromB64u(body.signature);
  const ok = cred.alg === -7
    ? crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig)
    : crypto.verify('sha256', data, key, sig);
  if (!ok) throw unauthorized('Face ID / fingerprint could not be confirmed. Try again or use your password.');
  const stored = Number(cred.sign_count || 0);
  if (stored > 0 && signCount > 0 && signCount <= stored) throw unauthorized('This device could not be trusted. Sign in with your password.');
  await db.query('UPDATE passkeys SET sign_count = $1, last_used_at = now() WHERE id = $2', [signCount, cred.id]);
  return db.one('SELECT * FROM users WHERE id = $1', [cred.user_id]);
}

module.exports = { registerOptions, register, loginOptions, login };
