'use strict';
/**
 * Scan QR label perangkat (dari dalam aplikasi).
 * - /scan        : pemindai (kamera langsung / foto QR / cari manual)
 * - /s/:id       : hasil scan — siapa pemilik terdaftar, riwayat pemegang, maintenance terakhir
 * - /s/:id/pindah: catat temuan bila PC dipakai orang / di ruangan lain (mis. ditukar tanpa izin)
 */
const express = require('express');
const db = require('../config/db');
const audit = require('../services/audit');
const A = require('../services/assets');
const Q = require('../services/quickAsset');
const assignments = require('../services/assignments');
const notifications = require('../services/notifications');
const { can, has } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');

const router = express.Router();
const REASONS = ['Dipindah / ditukar tanpa izin', 'Mutasi / perpindahan resmi', 'Koreksi data'];

router.get('/scan', can('asset.view'), (req, res) => {
  res.render('scan/index', { title: 'Scan QR Perangkat', scripts: ['vendor/jsQR.js', 'scan.js'] });
});

// Cari manual (kode aset / hostname / serial)
router.get('/s', can('asset.view'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.redirect('/scan');
  const a = await db.one(`SELECT id FROM assets WHERE deleted_at IS NULL AND (asset_code=? OR hostname=? OR serial_number=?)
                           ORDER BY (asset_code=?) DESC, id LIMIT 1`, [q, q, q, q]);
  if (!a) { req.flash('danger', `Perangkat "${q}" tidak ditemukan. Periksa kembali kode / hostname.`); return res.redirect('/scan'); }
  return res.redirect(`/s/${a.id}`);
});

router.get('/s/:id', can('asset.view'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const a = await A.getAsset(req.params.id);
  if (!a) throw Object.assign(new Error('Perangkat tidak ditemukan atau sudah dihapus.'), { status: 404 });
  const [history, records, employees, locations] = await Promise.all([
    db.query(`SELECT aa.*, COALESCE(e.full_name, aa.employee_name_snapshot) AS person, u.full_name AS recorder
                FROM asset_assignments aa LEFT JOIN employees e ON e.id=aa.employee_id LEFT JOIN users u ON u.id=aa.created_by
               WHERE aa.asset_id=? AND aa.assignment_role='PENGGUNA_UTAMA' ORDER BY aa.is_current DESC, aa.start_date DESC, aa.id DESC LIMIT 20`, [a.id]),
    db.query(`SELECT r.id, r.maintenance_no, r.maintenance_date, r.status, r.final_condition, r.employee_name_snapshot, r.location_snapshot, r.room_snapshot, u.full_name AS technician
                FROM maintenance_records r LEFT JOIN users u ON u.id=r.technician_user_id
               WHERE r.asset_id=? AND r.deleted_at IS NULL ORDER BY r.maintenance_date DESC, r.id DESC LIMIT 3`, [a.id]),
    db.query("SELECT DISTINCT full_name FROM employees WHERE deleted_at IS NULL ORDER BY full_name LIMIT 2000"),
    db.query('SELECT DISTINCT name FROM locations WHERE deleted_at IS NULL AND is_active=1 ORDER BY name'),
  ]);
  const current = history.find((x) => x.is_current) || null;
  await audit.log(req, 'SCAN', { entity: 'assets', id: a.id, description: `Scan QR ${a.hostname} (${a.asset_code})` });
  res.render('scan/result', { title: `Hasil Scan · ${a.hostname}`, a, current, history, records, employees, locations, REASONS, canMove: has(req.user, 'asset.update') });
});

router.post('/s/:id/pindah', can('asset.update'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const a = await A.getAsset(req.params.id);
  if (!a) throw Object.assign(new Error('Perangkat tidak ditemukan.'), { status: 404 });
  const src = {};
  for (const [k, v] of Object.entries(req.body || {})) src[k] = typeof v === 'string' && Q.PLACEHOLDER.test(v) ? '' : v;
  const v = validate(src, {
    employee_name: { label: 'Nama pengguna sekarang', maxLength: 150 },
    location_name: { label: 'Lokasi / gedung', maxLength: 120 },
    room: { label: 'Ruangan', maxLength: 120 },
    reason_type: { label: 'Keterangan', type: 'enum', values: REASONS, required: true },
    notes: { label: 'Catatan', maxLength: 500 },
  });
  if (!v.data.employee_name && !v.data.location_name && !v.data.room) v.errors.employee_name = 'Isi minimal nama pengguna, lokasi, atau ruangan saat ini.';
  if (Object.keys(v.errors).length) throw new ValidationError(v.errors);
  const d = v.data;
  const before = await db.one("SELECT * FROM asset_assignments WHERE asset_id=? AND assignment_role='PENGGUNA_UTAMA' AND is_current=1", [a.id]);
  const prevText = before ? [before.employee_name_snapshot, before.location_text_snapshot, before.room].filter(Boolean).join(' · ') || '(kosong)' : '(belum tercatat)';
  let followUpId = null;
  await db.transaction(async (t) => {
    const p = await Q.resolvePeople(t, req, { employee_name: d.employee_name, location_name: d.location_name, room: d.room }, { source: 'scan QR' });
    const reason = `${d.reason_type}${d.notes ? `: ${d.notes}` : ''} (dicatat saat scan QR)`;
    await assignments.assign(t, {
      assetId: a.id, employeeId: p.emp ? p.emp.id : (d.employee_name ? null : before && before.employee_id),
      role: 'PENGGUNA_UTAMA', locationId: p.loc ? p.loc.id : (before && before.location_id),
      room: d.room || (d.location_name ? null : before && before.room), reason,
    }, req.user.id);
    const nowText = [d.employee_name || (before && before.employee_name_snapshot), d.location_name || (before && before.location_text_snapshot), d.room || (d.location_name ? null : before && before.room)].filter(Boolean).join(' · ');
    if (d.reason_type === REASONS[0]) {
      const r = await t.query(`INSERT INTO follow_up_actions (asset_id, title, description, priority, status, pic_user_id, created_by)
                                VALUES (?,?,?, 'Sedang', 'Terbuka', ?, ?)`,
      [a.id, `PC ${a.hostname} dipindah / ditukar tanpa izin`,
        [`Pemegang tercatat sebelumnya: ${prevText}`, `Ditemukan dipakai oleh / di: ${nowText || '-'}`, d.notes ? `Catatan: ${d.notes}` : null, `Dicatat oleh ${req.user.full_name} saat scan QR.`].filter(Boolean).join('\n'),
        req.user.id, req.user.id]);
      followUpId = r.insertId;
    }
    await audit.log(req, 'MOVE', { entity: 'assets', id: a.id, description: `${a.hostname}: ${prevText} → ${nowText} (${d.reason_type})` }, t);
  });
  notifications.clear();
  res.done(`Perpindahan ${a.hostname} dicatat.${followUpId ? ' Tindak lanjut "dipindah tanpa izin" dibuat.' : ''} Riwayat pemegang sebelumnya tetap tersimpan.`, `/s/${a.id}`);
});

module.exports = router;
