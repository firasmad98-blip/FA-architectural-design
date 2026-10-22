'use strict';
// Notifications: saved in the database, then a "wake-up" push is sent to the person's devices.
// The phone's service worker fetches the text from /api/notifications/pending and shows it,
// so no message content ever travels through the push services.
const crypto = require('crypto');
const db = require('./db');

let vapid = null; // { publicKey (base64url, raw 65 bytes), jwk }

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function initVapid() {
  const row = await db.one(`SELECT value FROM settings WHERE key = 'vapid'`);
  if (row) { vapid = row.value; return vapid; }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-65);
  vapid = { publicKey: b64u(raw), jwk };
  await db.query(`INSERT INTO settings (key, value) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(vapid)]);
  const again = await db.one(`SELECT value FROM settings WHERE key = 'vapid'`);
  vapid = again.value;
  return vapid;
}

function vapidHeader(endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || 'mailto:studio@example.com' }));
  const key = crypto.createPrivateKey({ key: vapid.jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

async function wakeDevices(userId) {
  if (!vapid) return;
  const subs = await db.query('SELECT id, endpoint FROM push_subscriptions WHERE user_id = $1', [userId]);
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await fetch(s.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'high', Authorization: vapidHeader(s.endpoint), 'Content-Length': '0' } });
      if (r.status === 404 || r.status === 410) await db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
      else if (r.status >= 400) console.warn('Push refused', r.status, await r.text().catch(() => ''));
    } catch (e) { console.warn('Push failed:', e.message); }
  }));
}

// ---- Texts, in the person's language ----
const T = {
  en: {
    document: (p) => ['New document', `${p.title} was added to ${p.project}.`],
    photos: (p) => ['New site photos', `${p.count} new photo${p.count === 1 ? '' : 's'} added to ${p.project}.`],
    approval: (p) => ['Your approval is needed', `${p.title} · ${p.project}`],
    message: (p) => [`New message from ${p.from}`, p.text],
    payment: (p) => ['Payment due', `${p.label} · ${p.amount} · ${p.project}`],
    progress: (p) => ['Project update', `${p.project} is now at ${p.progress}%.`],
    decided: (p) => [p.approved ? 'Approved by client' : 'Changes requested', `${p.title} · ${p.project}`],
    request: (p) => ['New website request', `${p.name} · ${p.type || 'Project'}`],
    test: () => ['Notifications are on', 'You will be notified here about your project.'],
  },
  fr: {
    document: (p) => ['Nouveau document', `${p.title} a été ajouté à ${p.project}.`],
    photos: (p) => ['Nouvelles photos du chantier', `${p.count} nouvelle${p.count === 1 ? '' : 's'} photo${p.count === 1 ? '' : 's'} pour ${p.project}.`],
    approval: (p) => ['Votre validation est requise', `${p.title} · ${p.project}`],
    message: (p) => [`Nouveau message de ${p.from}`, p.text],
    payment: (p) => ['Paiement à régler', `${p.label} · ${p.amount} · ${p.project}`],
    progress: (p) => ['Mise à jour du projet', `${p.project} est maintenant à ${p.progress} %.`],
    test: () => ['Notifications activées', 'Vous serez averti ici des nouveautés de votre projet.'],
  },
  ar: {
    document: (p) => ['مستند جديد', `تمت إضافة ${p.title} إلى ${p.project}.`],
    photos: (p) => ['صور جديدة من الموقع', `تمت إضافة ${p.count} صورة جديدة إلى ${p.project}.`],
    approval: (p) => ['مطلوب موافقتك', `${p.title} · ${p.project}`],
    message: (p) => [`رسالة جديدة من ${p.from}`, p.text],
    payment: (p) => ['دفعة مستحقة', `${p.label} · ${p.amount} · ${p.project}`],
    progress: (p) => ['تحديث المشروع', `وصل ${p.project} إلى ${p.progress}%.`],
    test: () => ['تم تفعيل الإشعارات', 'ستصلك هنا إشعارات حول مشروعك.'],
  },
};

function render(kind, params, lang) {
  const l = T[lang] && T[lang][kind] ? lang : 'en';
  const [title, body] = T[l][kind](params || {});
  return [title, String(body || '').slice(0, 240)];
}

// Show stored notifications in the person's current language.
function localize(rows, lang) {
  return rows.map((n) => {
    if (!n.params || !T.en[n.kind]) { const { params, ...rest } = n; return rest; }
    const [title, body] = render(n.kind, n.params, lang);
    const { params, ...rest } = n;
    return { ...rest, title, body };
  });
}

// Create a notification for one person (in their language) and wake their devices.
async function notifyUser(user, kind, params, { projectId = null, url = '/portal/' } = {}) {
  if (!user) return;
  const [title, body] = render(kind, params, user.lang);
  await db.query(
    `INSERT INTO notifications (user_id, project_id, kind, title, body, url, params) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [user.id, projectId, kind, title, String(body || '').slice(0, 240), url, JSON.stringify(params || {})]
  );
  wakeDevices(user.id).catch(() => {});
}

async function notifyProjectClient(projectId, kind, params, view) {
  const row = await db.one(
    `SELECT u.id, u.lang, p.name AS project FROM projects p JOIN users u ON u.id = p.client_id WHERE p.id = $1 AND u.active`,
    [projectId]
  );
  if (!row) return;
  await notifyUser(row, kind, { project: row.project, ...params }, { projectId, url: `/portal/#/p/${projectId}/${view || 'overview'}` });
}

async function notifyAdmins(kind, params, { projectId = null, url = '/portal/studio/' } = {}) {
  const admins = await db.query(`SELECT id, lang FROM users WHERE role = 'admin' AND active`);
  for (const a of admins) await notifyUser({ ...a, lang: 'en' }, kind, params, { projectId, url });
}

module.exports = { render, localize, vapidHeader, initVapid, getPublicKey: () => vapid && vapid.publicKey, notifyUser, notifyProjectClient, notifyAdmins, wakeDevices };
