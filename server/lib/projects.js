'use strict';
// Shared project queries used by both the client portal and the studio.
const db = require('./db');
const { notFound, forbidden } = require('./http');
const { requireUser } = require('./auth');

const DEFAULT_STAGES = ['Brief', 'Concept', 'Detailed design', 'Permits', 'Construction', 'Handover'];

// Load a project the current person is allowed to see.
async function accessProject(req, id) {
  const me = requireUser(req);
  const p = await db.one('SELECT * FROM projects WHERE id = $1', [Number(id) || 0]);
  if (!p) throw notFound('Project not found.');
  if (me.role !== 'admin' && p.client_id !== me.id) throw forbidden();
  if (me.role !== 'admin' && p.status === 'archived') throw notFound('Project not found.');
  return p;
}

const fileUrl = (id) => (id ? `/api/files/${id}` : null);

async function listProjects(me) {
  // Studio sees every project; a client only sees their own, non-archived projects.
  const where = `($1::int IS NULL OR (p.client_id = $1 AND p.status <> 'archived'))`;
  return db.query(
    `SELECT p.id, p.code, p.name, p.location, p.type, p.status, p.progress, p.current_stage, p.handover_label,
            p.client_id, u.name AS client_name, u.email AS client_email,
            (SELECT f.id FROM photos ph JOIN files f ON f.id = ph.file_id WHERE ph.id = p.cover_photo_id) AS cover_file_id,
            (SELECT count(*)::int FROM approvals a WHERE a.project_id = p.id AND a.status = 'pending') AS pending_approvals,
            (SELECT count(*)::int FROM messages m
               LEFT JOIN project_reads r ON r.project_id = p.id AND r.user_id = $2
              WHERE m.project_id = p.id AND m.sender_id IS DISTINCT FROM $2 AND m.created_at > coalesce(r.messages_read_at, 'epoch')) AS unread_messages,
            (SELECT s.name FROM project_stages s WHERE s.project_id = p.id AND s.position = p.current_stage) AS stage_name,
            p.updated_at
       FROM projects p LEFT JOIN users u ON u.id = p.client_id
      WHERE ${where}
      ORDER BY p.status = 'active' DESC, p.updated_at DESC`,
    [me.role === 'admin' ? null : me.id, me.id]
  );
}

async function projectBundle(p, me) {
  const [stages, work, documents, approvals, payments, photos, updates, client, unread] = await Promise.all([
    db.query('SELECT id, position, name, date_label FROM project_stages WHERE project_id = $1 ORDER BY position', [p.id]),
    db.query('SELECT id, title, note, percent, position FROM work_items WHERE project_id = $1 ORDER BY position, id', [p.id]),
    db.query(`SELECT d.id, d.title, d.category, d.version, d.created_at, f.id AS file_id, f.original_name, f.mime, f.size
                FROM documents d JOIN files f ON f.id = d.file_id WHERE d.project_id = $1 ORDER BY d.created_at DESC`, [p.id]),
    db.query(`SELECT a.id, a.title, a.description, a.options, a.due_date, a.file_id, a.status, a.chosen_option, a.client_comment,
                     a.decided_at, a.created_at, u.name AS decided_by_name
                FROM approvals a LEFT JOIN users u ON u.id = a.decided_by
               WHERE a.project_id = $1 ORDER BY (a.status = 'pending') DESC, a.created_at DESC`, [p.id]),
    db.query('SELECT id, label, milestone, amount, due_date, status, paid_on, position FROM payments WHERE project_id = $1 ORDER BY position, due_date NULLS LAST, id', [p.id]),
    db.query(`SELECT ph.id, ph.caption, ph.taken_on, ph.created_at, ph.file_id FROM photos ph WHERE ph.project_id = $1
               ORDER BY coalesce(ph.taken_on, ph.created_at::date) DESC, ph.id DESC`, [p.id]),
    db.query(`SELECT id, kind, title, body, url, params, created_at FROM notifications WHERE user_id = $1 AND project_id = $2
               ORDER BY created_at DESC LIMIT 8`, [me.id, p.id]),
    p.client_id ? db.one('SELECT id, name, email, phone, lang FROM users WHERE id = $1', [p.client_id]) : null,
    db.one(`SELECT count(*)::int AS n FROM messages m LEFT JOIN project_reads r ON r.project_id = m.project_id AND r.user_id = $2
             WHERE m.project_id = $1 AND m.sender_id IS DISTINCT FROM $2 AND m.created_at > coalesce(r.messages_read_at, 'epoch')`, [p.id, me.id]),
  ]);
  const cover = p.cover_photo_id ? photos.find((x) => x.id === p.cover_photo_id) : null;
  return {
    project: {
      id: p.id, code: p.code, name: p.name, location: p.location, type: p.type, status: p.status,
      currentStage: p.current_stage, progress: p.progress, progressNote: p.progress_note, handover: p.handover_label,
      contractValue: p.contract_value === null ? null : Number(p.contract_value), currency: p.currency,
      coverPhotoId: p.cover_photo_id, coverUrl: cover ? fileUrl(cover.file_id) : null,
      clientId: p.client_id, updatedAt: p.updated_at,
    },
    client: me.role === 'admin' ? client : null,
    stages,
    work,
    documents: documents.map((d) => ({ ...d, url: fileUrl(d.file_id) })),
    approvals: approvals.map((a) => ({ ...a, options: Array.isArray(a.options) ? a.options : [], imageUrl: fileUrl(a.file_id) })),
    payments: payments.map((x) => ({ ...x, amount: Number(x.amount) })),
    photos: photos.map((x) => ({ ...x, url: fileUrl(x.file_id) })),
    updates: require('./notify').localize(updates, me.lang),
    unreadMessages: unread ? unread.n : 0,
  };
}

async function touch(projectId) { await db.query('UPDATE projects SET updated_at = now() WHERE id = $1', [projectId]); }

function money(amount, currency) {
  const n = Number(amount || 0);
  const s = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return currency === 'USD' ? `$${s}` : `${s} ${currency || ''}`.trim();
}

module.exports = { DEFAULT_STAGES, accessProject, listProjects, projectBundle, touch, fileUrl, money };
