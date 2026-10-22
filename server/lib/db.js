'use strict';
// Database connection (PostgreSQL). Railway gives us DATABASE_URL automatically.
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// Keep calendar dates as plain "YYYY-MM-DD" text (no time-zone surprises).
types.setTypeParser(1082, (v) => v);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\n  DATABASE_URL is missing. On Railway, set it to ${{Postgres.DATABASE_URL}} on the app service.\n');
  process.exit(1);
}

// Railway's private network (…railway.internal) does not use SSL; public proxy URLs do.
const needsSsl = /sslmode=require/.test(url) || process.env.PGSSL === 'true' ||
  (/proxy\.rlwy\.net|railway\.app/.test(url) && !/railway\.internal/.test(url));

const pool = new Pool({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});
pool.on('error', (err) => console.error('Database pool error:', err.message));

async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}
async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
  // Run statement by statement so a clear error points at the failing one.
  const statements = sql.split(/;\s*\n/).map((s) => s.replace(/--[^\n]*\n/g, '\n').trim()).filter(Boolean);
  for (const st of statements) await pool.query(st);
}

module.exports = { pool, query, one, migrate };
