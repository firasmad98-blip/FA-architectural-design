'use strict';
// Uploaded files live on disk (a Railway volume in production). The database keeps the details.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { bad } = require('./http');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILE = 30 * 1024 * 1024; // 30 MB per file

const TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  dwg: 'application/acad', dxf: 'application/dxf', skp: 'application/octet-stream', rvt: 'application/octet-stream',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', txt: 'text/plain', mp4: 'video/mp4', mov: 'video/quicktime',
};
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const INLINE_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'txt']);

function extOf(name) { const m = /\.([a-z0-9]{1,5})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }

function cleanName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(-120) || 'file';
}

async function saveUpload(file, { projectId, kind, userId, imagesOnly = false }) {
  const ext = extOf(file.name);
  if (!TYPES[ext]) throw bad(`Files of type “.${ext || '?'}” can't be uploaded. Use PDF, images, DWG, Office files or ZIP.`, 'file_type');
  if (imagesOnly && !IMAGE_EXT.has(ext)) throw bad('Please choose a photo (JPG, PNG, WEBP or HEIC).', 'file_type');
  if (file.size > MAX_FILE) throw bad('This file is larger than 30 MB.', 'too_large');
  const stored = `${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, stored), file.data);
  return db.one(
    `INSERT INTO files (project_id, kind, original_name, stored_name, mime, size, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, original_name, mime, size, created_at`,
    [projectId, kind, cleanName(file.name), stored, TYPES[ext], file.size, userId]
  );
}

async function removeFile(fileId) {
  if (!fileId) return;
  const f = await db.one('DELETE FROM files WHERE id = $1 RETURNING stored_name', [fileId]);
  if (f) fs.promises.unlink(path.join(UPLOAD_DIR, f.stored_name)).catch(() => {});
}

function streamFile(res, f, { download = false } = {}) {
  const full = path.join(UPLOAD_DIR, f.stored_name);
  fs.stat(full, (err, st) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('File not found'); return; }
    const inline = !download && INLINE_EXT.has(extOf(f.stored_name));
    const encName = encodeURIComponent(f.original_name);
    res.writeHead(200, {
      'Content-Type': f.mime,
      'Content-Length': st.size,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encName}`,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      // Only known-safe types are shown in the browser; everything else downloads.
      ...(inline ? {} : { 'Content-Security-Policy': "default-src 'none'; sandbox" }),
    });
    fs.createReadStream(full).pipe(res);
  });
}

module.exports = { UPLOAD_DIR, MAX_FILE, saveUpload, removeFile, streamFile, extOf, IMAGE_EXT };
