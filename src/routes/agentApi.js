'use strict';
/** API untuk agent hardware lokal. Autentikasi: header "Authorization: Bearer <token>" (token dibuat admin). */
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const db = require('../config/db');
const agent = require('../services/agent');
const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();
router.use(rateLimit({ windowMs: 60000, limit: config.isTest ? 1000 : 120, standardHeaders: 'draft-7', legacyHeaders: false }));

async function auth(req, res, next) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  if (!m) return res.status(401).json({ ok: false, message: 'Token agent wajib dikirim (Authorization: Bearer ...).' });
  const tok = await db.one('SELECT id, name FROM agent_tokens WHERE token_hash=? AND is_active=1', [agent.hashToken(m[1])]);
  if (!tok) return res.status(401).json({ ok: false, message: 'Token agent tidak valid atau nonaktif.' });
  req.agentToken = tok;
  await db.query('UPDATE agent_tokens SET last_used_at=NOW() WHERE id=?', [tok.id]);
  return next();
}

router.post('/readings', auth, async (req, res) => {
  const v = agent.validatePayload(req.body);
  if (!v.ok) {
    await db.query("INSERT INTO agent_readings (agent_token_id, collected_at, payload_json, validation_status, validation_notes) VALUES (?, NOW(), ?, 'DITOLAK', ?)",
      [req.agentToken.id, JSON.stringify(req.body || {}).slice(0, 200000), v.notes.join('\n')]);
    return res.status(422).json({ ok: false, status: 'DITOLAK', notes: v.notes });
  }
  const d = v.data;
  const assetId = await agent.findAsset(d.device);
  const status = !assetId ? 'DITOLAK' : (v.notes.length ? 'SEBAGIAN' : 'VALID');
  const notes = [...v.notes, ...(assetId ? [] : ['Perangkat tidak cocok dengan aset terdaftar (asset_code / serial_number / hostname).']),
    ...(v.unavailable.length ? [`Parameter tidak tersedia: ${v.unavailable.join(', ')}`] : [])];
  const r = await db.query(`INSERT INTO agent_readings (agent_token_id, asset_id, reported_hostname, reported_serial, agent_version, collected_at, payload_json, validation_status, validation_notes)
                             VALUES (?,?,?,?,?,?,?,?,?)`,
  [req.agentToken.id, assetId, d.device.hostname, d.device.serial_number, d.agent_version, agent.toLocalDateTime(d.collected_at), JSON.stringify(d), status, notes.join('\n') || null]);
  logger.info('Agent reading diterima', { id: r.insertId, asset: assetId, status });
  res.status(assetId ? 201 : 202).json({ ok: !!assetId, id: r.insertId, status, asset_matched: !!assetId, notes });
});

module.exports = router;
