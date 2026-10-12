'use strict';
/**
 * Pengaturan Data (Administrator & Manager IT):
 *  - Unit kerja   : tambah / ubah / hapus (departemen opsional, otomatis "Umum")
 *  - Lokasi kerja : tambah / ubah / hapus
 *  - Kode aset    : ganti kode aset (mis. kode otomatis AST-PC-0001 -> kode resmi)
 */
const express = require('express');
const db = require('../config/db');
const audit = require('../services/audit');
const notifications = require('../services/notifications');
const { can } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');
const h = require('../utils/helpers');
const { locText } = require('./org');

const router = express.Router();
router.use(can('data.settings'));
const TABS = ['unit', 'lokasi', 'kode'];
const DEFAULT_DEPT = 'Umum';
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const back = (tab) => `/pengaturan?tab=${tab}`;

router.get('/', async (req, res) => {
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'unit';
  const q = String(req.query.q || '').trim();
  const like = `%${h.likeEscape(q)}%`;
  const [units, locations, depts, assets] = await Promise.all([
    db.query(`SELECT w.*, d.name AS department_name, l.name AS loc_name, l.building, l.floor, l.room,
                (SELECT COUNT(*) FROM employees e WHERE e.work_unit_id=w.id AND e.deleted_at IS NULL) AS emp_count
                FROM work_units w JOIN departments d ON d.id=w.department_id LEFT JOIN locations l ON l.id=w.location_id
               WHERE w.deleted_at IS NULL ORDER BY w.name, d.name`),
    db.query(`SELECT l.*, (SELECT COUNT(*) FROM assets a WHERE a.location_id=l.id AND a.deleted_at IS NULL) AS asset_count,
                (SELECT COUNT(*) FROM employees e WHERE e.location_id=l.id AND e.deleted_at IS NULL) AS emp_count
                FROM locations l WHERE l.deleted_at IS NULL ORDER BY l.name, l.building, l.room`),
    db.query('SELECT name FROM departments WHERE deleted_at IS NULL AND is_active=1 ORDER BY name'),
    tab === 'kode'
      ? db.query(`SELECT a.id, a.asset_code, a.hostname, a.device_type, e.full_name AS employee_name, l.name AS loc_name
                    FROM assets a LEFT JOIN employees e ON e.id=a.current_employee_id LEFT JOIN locations l ON l.id=a.location_id
                   WHERE a.deleted_at IS NULL ${q ? 'AND (a.asset_code LIKE ? OR a.hostname LIKE ? OR COALESCE(e.full_name,\'\') LIKE ? OR COALESCE(l.name,\'\') LIKE ?)' : ''}
                   ORDER BY (a.asset_code ${db.isPg ? '~' : 'REGEXP'} '^AST-') DESC, a.asset_code LIMIT 300`, q ? [like, like, like, like] : [])
      : [],
  ]);
  res.render('data-settings/index', { title: 'Pengaturan Data', tab, q, units, locations, depts, assets, locText });
});

// ===== Unit kerja =====
const unitSchema = {
  name: { label: 'Nama unit kerja', required: true, maxLength: 120 },
  department_name: { label: 'Departemen', maxLength: 120 },
  location_id: { label: 'Lokasi', type: 'id' },
};
async function deptId(name) {
  const n = String(name || '').trim() || DEFAULT_DEPT;
  const d = await db.one('SELECT id, deleted_at, is_active FROM departments WHERE name=? LIMIT 1', [n]);
  if (d) {
    if (d.deleted_at || !d.is_active) await db.query('UPDATE departments SET deleted_at=NULL, is_active=1 WHERE id=?', [d.id]);
    return d.id;
  }
  return (await db.query('INSERT INTO departments (name, is_active) VALUES (?,1)', [n])).insertId;
}
async function unitData(body, selfId = null) {
  const v = validate(body, unitSchema);
  if (!v.ok) throw new ValidationError(v.errors);
  const dept = await deptId(v.data.department_name);
  const dup = await db.one('SELECT id FROM work_units WHERE department_id=? AND name=? AND deleted_at IS NULL AND id<>?', [dept, v.data.name, selfId || 0]);
  if (dup) throw new ValidationError({ name: `Unit kerja "${v.data.name}" sudah ada.` });
  return { ...v.data, department_id: dept };
}
router.post('/units', async (req, res) => {
  const d = await unitData(req.body);
  // Unit yang pernah dihapus dengan nama sama dipulihkan (nama unik per departemen)
  const old = await db.one('SELECT id FROM work_units WHERE department_id=? AND name=? AND deleted_at IS NOT NULL', [d.department_id, d.name]);
  let id;
  if (old) { await db.query('UPDATE work_units SET deleted_at=NULL, is_active=1, location_id=? WHERE id=?', [d.location_id, old.id]); id = old.id; }
  else id = (await db.query('INSERT INTO work_units (department_id, name, location_id, is_active) VALUES (?,?,?,1)', [d.department_id, d.name, d.location_id])).insertId;
  await audit.log(req, 'CREATE', { entity: 'work_units', id, description: `Unit kerja ${d.name} ditambahkan`, after: d });
  res.done(`Unit kerja ${d.name} ditambahkan.`, back('unit'));
});
router.post('/units/:id', async (req, res) => {
  const before = await db.one('SELECT * FROM work_units WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!before) throw fail('Unit kerja tidak ditemukan.', 404);
  const d = await unitData(req.body, before.id);
  await db.query('UPDATE work_units SET name=?, department_id=?, location_id=? WHERE id=?', [d.name, d.department_id, d.location_id, before.id]);
  // Pengguna di unit ini ikut berpindah departemen bila departemen unit diubah
  if (before.department_id !== d.department_id) await db.query('UPDATE employees SET department_id=? WHERE work_unit_id=?', [d.department_id, before.id]);
  await audit.log(req, 'UPDATE', { entity: 'work_units', id: before.id, ...audit.diff(before, d) });
  res.done('Unit kerja diperbarui.', back('unit'));
});
router.post('/units/:id/delete', async (req, res) => {
  const u = await db.one('SELECT * FROM work_units WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!u) throw fail('Unit kerja tidak ditemukan atau sudah dihapus.', 404);
  const used = await db.one('SELECT COUNT(*) c FROM employees WHERE work_unit_id=? AND deleted_at IS NULL', [u.id]);
  if (used.c) throw fail(`Unit kerja ${u.name} masih dipakai ${used.c} pengguna PC. Pindahkan penggunanya ke unit lain terlebih dahulu.`);
  await db.query('UPDATE work_units SET deleted_at=NOW() WHERE id=?', [u.id]);
  await audit.log(req, 'DELETE', { entity: 'work_units', id: u.id, description: `Unit kerja ${u.name} dihapus` });
  res.done(`Unit kerja ${u.name} dihapus.`, back('unit'));
});

// ===== Lokasi kerja =====
const locSchema = {
  name: { label: 'Nama lokasi', required: true, maxLength: 120 },
  building: { label: 'Gedung', maxLength: 120 },
  floor: { label: 'Lantai', maxLength: 30 },
  room: { label: 'Ruangan', maxLength: 120 },
};
async function locData(body, selfId = null) {
  const v = validate(body, locSchema);
  if (!v.ok) throw new ValidationError(v.errors);
  const dup = await db.one(`SELECT id FROM locations WHERE name=? AND COALESCE(building,'')=? AND COALESCE(room,'')=? AND deleted_at IS NULL AND id<>?`,
    [v.data.name, v.data.building || '', v.data.room || '', selfId || 0]);
  if (dup) throw new ValidationError({ name: 'Lokasi dengan nama, gedung & ruangan yang sama sudah ada.' });
  return v.data;
}
router.post('/locations', async (req, res) => {
  const d = await locData(req.body);
   const old = await db.one(`SELECT id FROM locations WHERE name=? AND COALESCE(building,'')=? AND COALESCE(room,'')=? AND deleted_at IS NOT NULL`, [d.name, d.building || '', d.room || '']);
  let id;
  if (old) { await db.query('UPDATE locations SET deleted_at=NULL, is_active=1, floor=? WHERE id=?', [d.floor, old.id]); id = old.id; }
  else id = (await db.query('INSERT INTO locations (name, building, floor, room, is_active) VALUES (?,?,?,?,1)', [d.name, d.building, d.floor, d.room])).insertId;
  await audit.log(req, 'CREATE', { entity: 'locations', id, description: `Lokasi ${locText(d)} ditambahkan`, after: d });
  res.done(`Lokasi ${d.name} ditambahkan.`, back('lokasi'));
});
router.post('/locations/:id', async (req, res) => {
  const before = await db.one('SELECT * FROM locations WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!before) throw fail('Lokasi tidak ditemukan.', 404);
  const d = await locData(req.body, before.id);
  await db.query('UPDATE locations SET name=?, building=?, floor=?, room=? WHERE id=?', [d.name, d.building, d.floor, d.room, before.id]);
  await audit.log(req, 'UPDATE', { entity: 'locations', id: before.id, ...audit.diff(before, d) });
  res.done('Lokasi diperbarui.', back('lokasi'));
});
router.post('/locations/:id/delete', async (req, res) => {
  const l = await db.one('SELECT * FROM locations WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!l) throw fail('Lokasi tidak ditemukan atau sudah dihapus.', 404);
  const [a, e] = await Promise.all([
    db.one('SELECT COUNT(*) c FROM assets WHERE location_id=? AND deleted_at IS NULL', [l.id]),
    db.one('SELECT COUNT(*) c FROM employees WHERE location_id=? AND deleted_at IS NULL', [l.id]),
  ]);
  if (a.c || e.c) throw fail(`Lokasi ${l.name} masih dipakai ${[a.c && `${a.c} perangkat`, e.c && `${e.c} pengguna PC`].filter(Boolean).join(' dan ')}. Pindahkan ke lokasi lain terlebih dahulu.`);
  await db.query('UPDATE locations SET deleted_at=NOW() WHERE id=?', [l.id]);
  await db.query('UPDATE work_units SET location_id=NULL WHERE location_id=?', [l.id]);
  await audit.log(req, 'DELETE', { entity: 'locations', id: l.id, description: `Lokasi ${locText(l)} dihapus` });
  res.done(`Lokasi ${l.name} dihapus.`, back('lokasi'));
});

// ===== Kode aset =====
router.post('/asset-code/:id', async (req, res) => {
  const a = await db.one('SELECT id, asset_code, hostname FROM assets WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!a) throw fail('Perangkat tidak ditemukan.', 404);
  const v = validate(req.body, { asset_code: { label: 'Kode aset baru', type: 'code', required: true, maxLength: 50, upper: true } });
  if (!v.ok) throw new ValidationError(v.errors);
  const code = v.data.asset_code;
  if (code === a.asset_code) return res.done('Kode aset tidak berubah.', back('kode'));
  const dup = await db.one('SELECT id, hostname, deleted_at FROM assets WHERE asset_code=? AND id<>?', [code, a.id]);
  if (dup) throw new ValidationError({ asset_code: `Kode ${code} sudah dipakai perangkat lain (${dup.hostname}${dup.deleted_at ? ', sudah dihapus' : ''}).` });
  await db.transaction(async (t) => {
    // Nama perangkat yang sama dengan kode lama (diberi otomatis) ikut diganti
    await t.query('UPDATE assets SET asset_code=?, hostname=CASE WHEN hostname=? THEN ? ELSE hostname END, updated_by=? WHERE id=?', [code, a.asset_code, code, req.user.id, a.id]);
    await audit.log(req, 'UPDATE', { entity: 'assets', id: a.id, description: `Kode aset ${a.asset_code} diganti menjadi ${code}`, before: { asset_code: a.asset_code }, after: { asset_code: code } }, t);
  });
  notifications.clear();
  const ref = String(req.get('referer') || '');
  res.done(`Kode aset ${a.asset_code} diganti menjadi ${code}.`, /\/pengaturan\?/.test(ref) ? ref : back('kode'));
});

module.exports = router;
