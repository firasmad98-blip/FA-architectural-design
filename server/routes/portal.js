'use strict';
// Routes used by signed-in people (clients and studio): projects, messages, approvals, files, notifications.
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { readJson, readForm, bad, notFound, forbidden, str } = require('../lib/http');
const { accessProject, listProjects, projectBundle, touch } = require('../lib/projects');
const files = require('../lib/files');
const notify = require('../lib/notify');

module.exports = (r) => {
  r.get('/api/projects', async (req) => {
    const me = requireUser(req);
    return { projects: await listProjects(me) };
  });

  r.get('/api/projects/:id', async (req, res, { params }) => {
    const p = await accessProject(req, params.id);
    return projectBundle(p, req.user);
  });

  // ---- Messages ----
  r.get('/api/projects/:id/messages', async (req, res, { params }) => {
    const p = await accessProject(req, params.id);
    const rows = await db.query(
      `SELECT m.id, m.body, m.created_at, m.sender_id, u.name AS sender_name, u.role AS sender_role,
              f.id AS file_id, f.original_name AS file_name, f.mime AS file_mime, f.size AS file_size
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id LEFT JOIN files f ON f.id = m.file_id
        WHERE m.project_id = $1 ORDER BY m.created_at ASC, m.id ASC LIMIT 500`,
      [p.id]
    );
    await db.query(
      `INSERT INTO project_reads (user_id, project_id, messages_read_at) VALUES ($1,$2,now())
       ON CONFLICT (user_id, project_id) DO UPDATE SET messages_read_at = now()`,
      [req.user.id, p.id]
    );
    return { messages: rows.map((m) => ({ ...m, mine: m.sender_id === req.user.id, fileUrl: m.file_id ? `/api/files/${m.file_id}` : null })) };
  });

  r.post('/api/projects/:id/messages', async (req, res, { params }) => {
    const p = await accessProject(req, params.id);
    const me = req.user;
    let body = ''; let fileRow = null;
    if (/^multipart\//.test(req.headers['content-type'] || '')) {
      const form = await readForm(req, files.MAX_FILE + 1024 * 1024);
      body = str(form.fields.body, 4000) || '';
      if (form.files[0]) fileRow = await files.saveUpload(form.files[0], { projectId: p.id, kind: 'message', userId: me.id });
    } else {
      const b = await readJson(req);
      body = str(b.body, 4000) || '';
    }
    if (!body && !fileRow) throw bad('Write a message or attach a file.');
    const m = await db.one(
      `INSERT INTO messages (project_id, sender_id, body, file_id) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [p.id, me.id, body, fileRow ? fileRow.id : null]
    );
    await db.query(
      `INSERT INTO project_reads (user_id, project_id, messages_read_at) VALUES ($1,$2,now())
       ON CONFLICT (user_id, project_id) DO UPDATE SET messages_read_at = now()`, [me.id, p.id]);
    await touch(p.id);
    const preview = body ? body.slice(0, 140) : (fileRow ? `📎 ${fileRow.original_name}` : '');
    if (me.role === 'admin') await notify.notifyProjectClient(p.id, 'message', { from: firstName(me.name), text: preview }, 'messages');
    else await notify.notifyAdmins('message', { from: me.name, text: `${p.name}: ${preview}` }, { projectId: p.id, url: `/portal/studio/#/projects/${p.id}/messages` });
    return { ok: true, id: m.id };
  });

  // ---- Client decides on an approval ----
  r.post('/api/approvals/:id/decide', async (req, res, { params }) => {
    const me = requireUser(req);
    const a = await db.one('SELECT * FROM approvals WHERE id = $1', [Number(params.id) || 0]);
    if (!a) throw notFound('Approval not found.');
    const p = await accessProject(req, a.project_id);
    if (me.role === 'admin') throw forbidden('Only the client can approve.');
    if (a.status !== 'pending') throw bad('This item was already answered.', 'already_decided');
    const b = await readJson(req);
    const decision = b.decision === 'approve' ? 'approved' : b.decision === 'changes' ? 'changes' : null;
    if (!decision) throw bad('Choose approve or request changes.');
    const options = Array.isArray(a.options) ? a.options : [];
    let chosen = null;
    if (decision === 'approved' && options.length) {
      chosen = options.includes(b.option) ? b.option : null;
      if (!chosen) throw bad('Please choose one of the options.', 'option_required');
    }
    const comment = str(b.comment, 2000);
    if (decision === 'changes' && !comment) throw bad('Please tell us what you would like to change.', 'comment_required');
    await db.query(
      `UPDATE approvals SET status = $1, chosen_option = $2, client_comment = $3, decided_at = now(), decided_by = $4 WHERE id = $5`,
      [decision, chosen, comment, me.id, a.id]
    );
    await touch(p.id);
    await notify.notifyAdmins('decided', { approved: decision === 'approved', title: a.title + (chosen ? ` → ${chosen}` : ''), project: p.name },
      { projectId: p.id, url: `/portal/studio/#/projects/${p.id}/approvals` });
    return { ok: true };
  });

  // ---- Files (only for people who can see the project) ----
  r.get('/api/files/:id', async (req, res, { params, query }) => {
    requireUser(req);
    const f = await db.one('SELECT * FROM files WHERE id = $1', [Number(params.id) || 0]);
    if (!f) throw notFound('File not found.');
    await accessProject(req, f.project_id);
    files.streamFile(res, f, { download: query.get('download') === '1' });
    return undefined; // response handled by the stream
  });

  // ---- Notifications ----
  r.get('/api/notifications', async (req) => {
    const me = requireUser(req);
    const rows = await db.query(
      `SELECT n.id, n.kind, n.title, n.body, n.url, n.params, n.read_at, n.created_at, p.name AS project_name
         FROM notifications n LEFT JOIN projects p ON p.id = n.project_id
        WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 40`, [me.id]);
    const unread = rows.filter((n) => !n.read_at).length;
    return { notifications: notify.localize(rows, me.role === 'admin' ? 'en' : me.lang), unread };
  });

  r.post('/api/notifications/read', async (req) => {
    const me = requireUser(req);
    await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [me.id]);
    return { ok: true };
  });

  // Called by the phone's service worker when a push arrives: returns what to show.
  r.get('/api/notifications/pending', async (req) => {
    if (!req.user) return { notifications: [] };
    const rows = await db.query(
      `UPDATE notifications SET pushed_at = now()
        WHERE id IN (SELECT id FROM notifications WHERE user_id = $1 AND pushed_at IS NULL AND created_at > now() - interval '2 days'
                     ORDER BY created_at DESC LIMIT 5)
        RETURNING id, title, body, url, kind, params`, [req.user.id]);
    return { notifications: notify.localize(rows, req.user.role === 'admin' ? 'en' : req.user.lang) };
  });

  // ---- Push subscriptions ----
  r.get('/api/push/key', async () => ({ publicKey: notify.getPublicKey() }));

  r.post('/api/push/subscribe', async (req) => {
    const me = requireUser(req);
    const b = await readJson(req);
    const endpoint = str(b.endpoint, 1000);
    if (!endpoint || !/^https:\/\//.test(endpoint)) throw bad('Invalid subscription.');
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [me.id, endpoint, str(b.keys && b.keys.p256dh, 200), str(b.keys && b.keys.auth, 100), str(req.headers['user-agent'], 300)]
    );
    return { ok: true };
  });

  r.post('/api/push/unsubscribe', async (req) => {
    const me = requireUser(req);
    const b = await readJson(req);
    await db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [me.id, String(b.endpoint || '')]);
    return { ok: true };
  });

  r.post('/api/push/test', async (req) => {
    const me = requireUser(req);
    await notify.notifyUser(me, 'test', {}, { url: me.role === 'admin' ? '/portal/studio/' : '/portal/' });
    return { ok: true };
  });
};

function firstName(name) { return String(name || '').split(/\s+/)[0] || 'FA Studio'; }
