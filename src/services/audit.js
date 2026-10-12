'use strict';
const db = require('../config/db');
const logger = require('../utils/logger');

const SENSITIVE = /pass(word)?|token|secret|hash|_csrf|cookie|session/i;

function scrub(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrub);
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = SENSITIVE.test(k) ? '[DIRAHASIAKAN]' : scrub(v);
  return out;
}

/**
 * Catat tindakan penting. Tidak pernah menyimpan password/token (otomatis disamarkan).
 * @param {object} req  request express (boleh null untuk proses sistem)
 */
async function log(req, action, { entity, id, description, before, after } = {}, conn = db) {
  try {
    const u = req && req.user;
    await conn.query(
      'INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, description, old_values, new_values, ip_address, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [u ? u.id : null, u ? u.username : null, action, entity || null, id !== undefined && id !== null ? String(id) : null,
        description ? String(description).slice(0, 500) : null,
        before ? JSON.stringify(scrub(before)) : null, after ? JSON.stringify(scrub(after)) : null,
        req ? (req.ip || null) : null, req && req.get ? String(req.get('user-agent') || '').slice(0, 255) : null],
    );
  } catch (e) {
    logger.error('Gagal menulis audit log', { action, error: e.message });
    if (conn !== db) throw e; // di dalam transaksi: gagalkan transaksi agar konsisten
  }
}

/** Selisih field yang berubah saja. */
function diff(before, after) {
  const b = {}; const a = {};
  for (const k of Object.keys(after || {})) {
    const bv = before ? before[k] : undefined;
    // eslint-disable-next-line eqeqeq
    if (String(bv ?? '') !== String(after[k] ?? '')) { b[k] = bv ?? null; a[k] = after[k]; }
  }
  return { before: b, after: a };
}

module.exports = { log, diff, scrub };
