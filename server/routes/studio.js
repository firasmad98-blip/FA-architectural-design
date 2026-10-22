'use strict';
// Studio-only routes: clients, projects and everything inside them, website requests.
const db = require('../lib/db');
const auth = require('../lib/auth');
const { requireAdmin } = auth;
const { readJson, readForm, bad, notFound, str, int, num, date, clamp } = require('../lib/http');
const { DEFAULT_STAGES, accessProject, touch, money } = require('../lib/projects');
const files = require('../lib/files');
const notify = require('../lib/notify');

const DOC_CATEGORIES = ['Drawings', 'Contracts', 'Permits', 'Reports', 'Invoices', 'Other'];

module.exports = (r) => {
  // ================= Clients =================
  r.get('/api/studio/clients', async (req) => {
    requireAdmin(req);
    const rows = await db.query(
      `SELECT u.id, u.name, u.email, u.phone, u.lang, u.active, u.created_at, u.last_login_at,
              (SELECT count(*)::int FROM projects p WHERE p.client_id = u.id) AS projects
         FROM users u WHERE u.role = 'client' ORDER BY u.active DESC, u.name`);
    return { clients: rows };
  });

  r.post('/api/studio/clients', async (req) => {
    requireAdmin(req);
    const b = await readJson(req);
    const name = str(b.name, 120); const email = str(b.email, 200);
    if (!name) throw bad('Enter the client’s name.');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address.');
    const exists = await db.one('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
    if (exists) throw bad('Someone already uses this email.', 'email_taken');
    const password = auth.randomPassword();
    const lang = ['en', 'fr', 'ar'].includes(b.lang) ? b.lang : 'en';
    const u = await db.one(
      `INSERT INTO users (role, name, email, phone, lang, password_hash, must_change_password)
       VALUES ('client', $1, lower($2), $3, $4, $5, true) RETURNING id, name, email`,
      [name, email, str(b.phone, 40), lang, auth.hashPassword(password)]);
    return { client: u, temporaryPassword: password };
  });

  r.patch('/api/studio/clients/:id', async (req, res, { params }) => {
    requireAdmin(req);
    const b = await readJson(req);
    const u = await db.one(`SELECT * FROM users WHERE id = $1 AND role = 'client'`, [int(params.id, 0)]);
    if (!u) throw notFound('Client not found.');
    const name = str(b.name, 120) || u.name;
    const email = str(b.email, 200) || u.email;
    if (email.toLowerCase() !== u.email.toLowerCase()) {
      const taken = await db.one('SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2', [email, u.id]);
      if (taken) throw bad('Someone already uses this email.', 'email_taken');
    }
    const lang = ['en', 'fr', 'ar'].includes(b.lang) ? b.lang : u.lang;
    const active = typeof b.active === 'boolean' ? b.active : u.active;
    await db.query(`UPDATE users SET name=$1, email=lower($2), phone=$3, lang=$4, active=$5 WHERE id=$6`,
      [name, email, b.phone === undefined ? u.phone : str(b.phone, 40), lang, active, u.id]);
    if (!active) await db.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
    return { ok: true };
  });

  r.post('/api/studio/clients/:id/reset-password', async (req, res, { params }) => {
    requireAdmin(req);
    const u = await db.one(`SELECT id FROM users WHERE id = $1 AND role = 'client'`, [int(params.id, 0)]);
    if (!u) throw notFound('Client not found.');
    const password = auth.randomPassword();
    await db.query('UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2', [auth.hashPassword(password), u.id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
    return { temporaryPassword: password };
  });

  // ================= Projects =================
  r.post('/api/studio/projects', async (req) => {
    requireAdmin(req);
    const b = await readJson(req);
    const name = str(b.name, 160);
    if (!name) throw bad('Enter a project name.');
    const clientId = int(b.clientId);
    if (clientId) {
      const c = await db.one(`SELECT id FROM users WHERE id = $1 AND role = 'client'`, [clientId]);
      if (!c) throw bad('Choose an existing client.');
    }
    const year = new Date().getFullYear();
    const n = await db.one(`SELECT count(*)::int + 1 AS n FROM projects WHERE extract(year FROM created_at) = $1`, [year]);
    const code = str(b.code, 40) || `FA-${year}-${String(n.n).padStart(3, '0')}`;
    const p = await db.one(
      `INSERT INTO projects (code, name, location, type, client_id, contract_value, currency, handover_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [code, name, str(b.location, 160), str(b.type, 80), clientId, num(b.contractValue), str(b.currency, 8) || 'USD', str(b.handover, 60)]);
    for (let i = 0; i < DEFAULT_STAGES.length; i++) {
      await db.query('INSERT INTO project_stages (project_id, position, name) VALUES ($1,$2,$3)', [p.id, i, DEFAULT_STAGES[i]]);
    }
    return { id: p.id };
  });

  r.patch('/api/studio/projects/:id', async (req, res, { params }) => {
    requireAdmin(req);
    const p = await accessProject(req, params.id);
    const b = await readJson(req);
    const pick = (k, v) => (b[k] === undefined ? p[v] : b[k]);
    const clientId = b.clientId === undefined ? p.client_id : int(b.clientId);
    const progress = b.progress === undefined ? p.progress : clamp(int(b.progress, 0), 0, 100);
    const stages = await db.query('SELECT count(*)::int AS n FROM project_stages WHERE project_id = $1', [p.id]);
    const stage = b.currentStage === undefined ? p.current_stage : clamp(int(b.currentStage, 0), 0, Math.max(0, stages[0].n - 1));
    const status = ['active', 'completed', 'archived'].includes(b.status) ? b.status : p.status;
    await db.query(
      `UPDATE projects SET name=$1, code=$2, location=$3, type=$4, client_id=$5, current_stage=$6, progress=$7, progress_note=$8,
              handover_label=$9, contract_value=$10, currency=$11, status=$12, cover_photo_id=$13, updated_at=now() WHERE id=$14`,
      [str(pick('name', 'name'), 160) || p.name, str(pick('code', 'code'), 40), str(pick('location', 'location'), 160), str(pick('type', 'type'), 80),
        clientId, stage, progress, str(pick('progressNote', 'progress_note'), 300), str(pick('handover', 'handover_label'), 60),
        b.contractValue === undefined ? p.contract_value : num(b.contractValue), str(pick('currency', 'currency'), 8) || 'USD', status,
        b.coverPhotoId === undefined ? p.cover_photo_id : int(b.coverPhotoId), p.id]);
    if (b.progress !== undefined && progress !== p.progress && b.notify) {
      await notify.notifyProjectClient(p.id, 'progress', { progress }, 'overview');
    }
    return { ok: true };
  });

  r.del('/api/studio/projects/:id', async (req, res, { params }) => {
    requireAdmin(req);
    const p = await accessProject(req, params.id);
    const fl = await db.query('SELECT id FROM files WHERE project_id = $1', [p.id]);
    for (const f of fl) await files.removeFile(f.id);
    await db.query('DELETE FROM projects WHERE id = $1', [p.id]);
    return { ok: true };
  });

  // Stages: replace the whole list (names + dates).
  r.put('/api/studio/projects/:id/stages', async (req, res, { params }) => {
    requireAdmin(req);
    const p = await accessProject(req, params.id);
    const b = await readJson(req);
    const list = (Array.isArray(b.stages) ? b.stages : []).map((s) => ({ name: str(s.name, 60), date: str(s.date, 40) })).filter((s) => s.name).slice(0, 12);
    if (!list.length) throw bad('Keep at least one stage.');
    await db.query('DELETE FROM project_stages WHERE project_id = $1', [p.id]);
    for (let i = 0; i < list.length; i++) {
      await db.query('INSERT INTO project_stages (project_id, position, name, date_label) VALUES ($1,$2,$3,$4)', [p.id, i, list[i].name, list[i].date]);
    }
    await db.query('UPDATE projects SET current_stage = LEAST(current_stage, $1), updated_at = now() WHERE id = $2', [list.length - 1, p.id]);
    return { ok: true };
  });

  // Work items (construction progress lines): replace the whole list.
  r.put('/api/studio/projects/:id/work', async (req, res, { params }) => {
    requireAdmin(req);
    const p = await accessProject(req, params.id);
    const b = await readJson(req);
    const list = (Array.isArray(b.items) ? b.items : []).map((w) => ({ title: str(w.title, 120), note: str(w.note, 200), percent: clamp(int(w.percent, 0), 0, 100) })).filter((w) => w.title).slice(0, 30);
    await db.query('DELETE FROM work_items WHERE project_id = $1', [p.id]);
    for (let i = 0; i < list.length; i++) {
      await db.query('INSERT INTO work_items (project_id, title, note, percent, position) VALUES ($1,$2,$3,$4,$5)', [p.id, list[i].title, list[i].note, list[i].percent, i]);
    }
    await touch(p.id);
    return { ok: true };
  });

  // ================= Documents =================
  r.post('/api/studio/projects/:id/documents', async (req, res, { params }) => {
    const me = requireAdmin(req);
    const p = await accessProject(req, params.id);
    const form = await readForm(req, files.MAX_FILE * 5);
    if (!form.files.length) throw bad('Choose a file to upload.');
    const category = DOC_CATEGORIES.includes(form.fields.category) ? form.fields.category : 'Other';
    const added = [];
    for (const f of form.files.slice(0, 5)) {
      const fr = await files.saveUpload(f, { projectId: p.id, kind: 'document', userId: me.id });
      const title = (form.files.length === 1 && str(form.fields.title, 160)) || f.name.replace(/\.[^.]+$/, '');
      const d = await db.one('INSERT INTO documents (project_id, file_id, title, category, version) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [p.id, fr.id, title, category, str(form.fields.version, 30)]);
      added.push({ id: d.id, title });
    }
    await touch(p.id);
    if (form.fields.notify !== 'false') {
      await notify.notifyProjectClient(p.id, 'document', { title: added.length === 1 ? added[0].title : `${added.length} documents` }, 'documents');
    }
    return { ok: true, added };
  });

  r.del('/api/studio/documents/:id', async (req, res, { params }) => {
    requireAdmin(req);
    const d = await db.one('SELECT * FROM documents WHERE id = $1', [int(params.id, 0)]);
    if (!d) throw notFound();
    await files.removeFile(d.file_id);
    return { ok: true };
  });

  // ================= Photos =================
  r.post('/api/studio/projects/:id/photos', async (req, res, { params }) => {
    const me = requireAdmin(req);
    const p = await accessProject(req, params.id);
    const form = await readForm(req, files.MAX_FILE * 12);
    if (!form.files.length) throw bad('Choose photos to upload.');
    let count = 0;
    for (const f of form.files.slice(0, 30)) {
      const fr = await files.saveUpload(f, { projectId: p.id, kind: 'photo', userId: me.id, imagesOnly: true });
      const ph = await db.one('INSERT INTO photos (project_id, file_id, caption, taken_on) VALUES ($1,$2,$3,$4) RETURNING id',
        [p.id, fr.id, str(form.fields.caption, 160), date(form.fields.takenOn)]);
      if (!p.cover_photo_id && count === 0) await db.query('UPDATE projects SET cover_photo_id = $1 WHERE id = $2', [ph.id, p.id]);
      count++;
    }
    await touch(p.id);
    if (form.fields.notify !== 'false') await notify.notifyProjectClient(p.id, 'photos', { count }, 'photos');
    return { ok: true, count };
  });

  r.patch('/api/studio/photos/:id', async (req, res, { params }) => {
    requireAdmin(req);
    const b = await readJson(req);
    const ph = await db.one('SELECT * FROM photos WHERE id = $1', [int(params.id, 0)]);
    if (!ph) throw notFound();
    await db.query('UPDATE photos SET caption = $1, taken_on = $2 WHERE id = $3', [str(b.caption, 160), date(b.takenOn), ph.id]);
    return { ok: true };
  });

  r.del('/api/studio/photos/:id', async (req, res, { params }) => {
    requireAdmin(req);
    const ph = await db.one('SELECT * FROM photos WHERE id = $1', [int(params.id, 0)]);
    if (!ph) throw notFound();
    await db.query('UPDATE projects SET cover_photo_id = NULL WHERE cover_photo_id = $1', [ph.id]);
    await files.removeFile(ph.file_id);
    return { ok: true };
  });

  // ================= Approvals =================
  r.post('/api/studio/projects/:id/approvals', async (req, res, { params }) => {
    const me = requireAdmin(req);
    const p = await accessProject(req, params.id);
    const form = await readForm(req, files.MAX_FILE + 1024 * 1024);
    const title = str(form.fields.title, 160);
    if (!title) throw bad('Enter what the client needs to approve.');
    const options = String(form.fields.options || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8);
    let fileId = null;
    if (form.files[0]) fileId = (await files.saveUpload(form.files[0], { projectId: p.id, kind: 'approval', userId: me.id })).id;
    const a = await db.one(
      `INSERT INTO approvals (project_id, title, description, options, due_date, file_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [p.id, title, str(form.fields.description, 2000), JSON.stringify(options), date(form.fields.dueDate), fileId]);
    await touch(p.id);
    await notify.notifyProjectClient(p.id, 'approval', { title }, 'approvals');
    return { ok: true, id: a.id };
  });

  r.post('/api/studio/approvals/:id/reopen', async (req, res, { params }) => {
    requireAdmin(req);
    const a = await db.one('SELECT * FROM approvals WHERE id = $1', [int(params.id, 0)]);
    if (!a) throw notFound();
    await db.query(`UPDATE approvals SET status='pending', chosen_option=NULL, client_comment=NULL, decided_at=NULL, decided_by=NULL WHERE id=$1`, [a.id]);
    await notify.notifyProjectClient(a.project_id, 'approval', { title: a.title }, 'approvals');
    return { ok: true };
  });

  r.del('/api/studio/approvals/:id', async (req, res, { params }) => {
    requireAdmin(req);
    const a = await db.one('DELETE FROM approvals WHERE id = $1 RETURNING file_id', [int(params.id, 0)]);
    if (!a) throw notFound();
    await files.removeFile(a.file_id);
    return { ok: true };
  });

  // ================= Payments =================
  r.post('/api/studio/projects/:id/payments', async (req, res, { params }) => {
    requireAdmin(req);
    const p = await accessProject(req, params.id);
    const b = await readJson(req);
    const label = str(b.label, 80);
    if (!label) throw bad('Enter a name for this payment, for example “Instalment 1 of 4”.');
    const status = ['upcoming', 'due', 'paid'].includes(b.status) ? b.status : 'upcoming';
    const pos = await db.one('SELECT coalesce(max(position),0)+1 AS n FROM payments WHERE project_id = $1', [p.id]);
    await db.query(`INSERT INTO payments (project_id, label, milestone, amount, due_date, status, paid_on, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.id, label, str(b.milestone, 160), num(b.amount) || 0, date(b.dueDate), status, status === 'paid' ? (date(b.paidOn) || today()) : null, pos.n]);
    await touch(p.id);
    if (status === 'due' && b.notify !== false) await notify.notifyProjectClient(p.id, 'payment', { label, amount: money(b.amount, p.currency) }, 'payments');
    return { ok: true };
  });

  r.patch('/api/studio/payments/:id', async (req, res, { params }) => {
    requireAdmin(req);
    const x = await db.one('SELECT pay.*, p.currency FROM payments pay JOIN projects p ON p.id = pay.project_id WHERE pay.id = $1', [int(params.id, 0)]);
    if (!x) throw notFound();
    const b = await readJson(req);
    const status = ['upcoming', 'due', 'paid'].includes(b.status) ? b.status : x.status;
    const amount = b.amount === undefined ? x.amount : (num(b.amount) || 0);
    await db.query(`UPDATE payments SET label=$1, milestone=$2, amount=$3, due_date=$4, status=$5, paid_on=$6 WHERE id=$7`,
      [str(b.label, 80) || x.label, b.milestone === undefined ? x.milestone : str(b.milestone, 160), amount,
        b.dueDate === undefined ? x.due_date : date(b.dueDate), status,
        status === 'paid' ? (date(b.paidOn) || x.paid_on || today()) : null, x.id]);
    await touch(x.project_id);
    if (status === 'due' && x.status !== 'due' && b.notify !== false) {
      await notify.notifyProjectClient(x.project_id, 'payment', { label: str(b.label, 80) || x.label, amount: money(amount, x.currency) }, 'payments');
    }
    return { ok: true };
  });

  r.del('/api/studio/payments/:id', async (req, res, { params }) => {
    requireAdmin(req);
    await db.query('DELETE FROM payments WHERE id = $1', [int(params.id, 0)]);
    return { ok: true };
  });

  // ================= Website requests =================
  r.get('/api/studio/requests', async (req) => {
    requireAdmin(req);
    return { requests: await db.query('SELECT * FROM requests ORDER BY created_at DESC LIMIT 300') };
  });

  r.patch('/api/studio/requests/:id', async (req, res, { params }) => {
    requireAdmin(req);
    const b = await readJson(req);
    if (!['new', 'contacted', 'closed'].includes(b.status)) throw bad('Unknown status.');
    await db.query('UPDATE requests SET status = $1 WHERE id = $2', [b.status, int(params.id, 0)]);
    return { ok: true };
  });

  r.del('/api/studio/requests/:id', async (req, res, { params }) => {
    requireAdmin(req);
    await db.query('DELETE FROM requests WHERE id = $1', [int(params.id, 0)]);
    return { ok: true };
  });

  // Dashboard numbers for the studio home screen.
  r.get('/api/studio/summary', async (req) => {
    requireAdmin(req);
    return db.one(`SELECT
      (SELECT count(*)::int FROM projects WHERE status = 'active') AS active_projects,
      (SELECT count(*)::int FROM users WHERE role = 'client' AND active) AS clients,
      (SELECT count(*)::int FROM approvals WHERE status = 'pending') AS pending_approvals,
      (SELECT count(*)::int FROM approvals WHERE status <> 'pending' AND decided_at > now() - interval '14 days') AS recent_decisions,
      (SELECT count(*)::int FROM requests WHERE status = 'new') AS new_requests,
      (SELECT count(*)::int FROM payments WHERE status = 'due') AS payments_due`);
  });
};

function today() { return new Date().toISOString().slice(0, 10); }
