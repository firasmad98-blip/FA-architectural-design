'use strict';
// Public routes: the website's project request form and a health check.
const db = require('../lib/db');
const { readJson, bad, str } = require('../lib/http');
const { limiter } = require('../lib/limit');
const notify = require('../lib/notify');

const requestLimit = limiter({ windowMs: 60 * 60 * 1000, max: 8 });

module.exports = (r) => {
  r.get('/healthz', async () => ({ ok: true }));

  r.post('/api/requests', async (req) => {
    requestLimit(req);
    const b = await readJson(req, 64 * 1024);
    if (b['bot-field']) return { ok: true }; // spam trap: real visitors never fill this
    const name = str(b.name, 120);
    const contact = str(b.contact, 160);
    if (!name) throw bad('Please enter your name.');
    if (!contact) throw bad('Please enter a phone number or email so we can reply.');
    await db.query(
      `INSERT INTO requests (name, contact, project_type, location, budget, timeline, message, language)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [name, contact, str(b.type, 80), str(b.loc, 160), str(b.budget, 80), str(b.time, 80), str(b.msg, 4000), str(b.language, 4)]
    );
    await notify.notifyAdmins('request', { name, type: str(b.type, 80) }, { url: '/portal/studio/#/requests' });
    return { ok: true };
  });
};
