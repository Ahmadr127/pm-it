'use strict';
/**
 * Akses file unggahan HANYA melalui route ini (bukan folder publik), dengan pemeriksaan izin:
 *  - hanya akun tim IT (Administrator, Manager IT & Staff IT) dengan izin maintenance.view atau asset.view
 */
const fs = require('fs');
const express = require('express');
const db = require('../config/db');
const uploads = require('../services/uploads');
const { has } = require('../middleware/auth');

const router = express.Router();
const deny = () => Object.assign(new Error('Anda tidak memiliki akses ke file ini.'), { status: 403 });
const missing = () => Object.assign(new Error('File tidak ditemukan.'), { status: 404 });

function stream(res, abs, mime, name, inline = true) {
  if (!fs.existsSync(abs)) throw missing();
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"`);
  fs.createReadStream(abs).pipe(res);
}

router.get('/asset-photo/:id', async (req, res) => {
  const a = await db.one('SELECT id, photo_path, asset_code FROM assets WHERE id=?', [req.params.id]);
  if (!a || !a.photo_path) throw missing();
  if (!has(req.user, 'asset.view') && !has(req.user, 'maintenance.view')) throw deny();
  const abs = uploads.absolutePath(a.photo_path);
  const mime = uploads.detectMime(abs) || 'application/octet-stream';
  stream(res, abs, mime, `${a.asset_code}-foto`);
});

router.get('/:id', async (req, res) => {
  const f = await db.one(`SELECT at.*, r.asset_id FROM maintenance_attachments at JOIN maintenance_records r ON r.id=at.maintenance_record_id
                           WHERE at.id=? AND at.deleted_at IS NULL`, [req.params.id]);
  if (!f) throw missing();
  if (!has(req.user, 'maintenance.view')) throw deny();
  stream(res, uploads.absolutePath(f.stored_path), f.mime_type, f.original_name, req.query.download !== '1');
});

module.exports = router;
