'use strict';
const express = require('express');
const db = require('../config/db');
const audit = require('../services/audit');
const { can, has } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');

const router = express.Router();

async function lookups() {
  const [departments, locations, employees] = await Promise.all([
    db.query('SELECT id, code, name, is_active FROM departments WHERE deleted_at IS NULL ORDER BY name'),
    db.query('SELECT id, name, building, floor, room, is_active FROM locations WHERE deleted_at IS NULL ORDER BY name, building, room'),
    db.query("SELECT id, nik, full_name FROM employees WHERE deleted_at IS NULL AND status <> 'Tidak Aktif' ORDER BY full_name"),
  ]);
  return { departments, locations, employees };
}

const locText = (l) => [l.name, l.building, l.floor ? `Lt. ${l.floor}` : null, l.room].filter(Boolean).join(' · ');

router.get('/', can('master.view'), async (req, res) => {
  // Unit kerja & lokasi sekarang dikelola di menu Pengaturan Data (menu ganda dihapus)
  if (has(req.user, 'data.settings') && req.query.tab !== 'departemen') return res.redirect(`/pengaturan?tab=${req.query.tab === 'lokasi' ? 'lokasi' : 'unit'}`);
  const tab = ['departemen', 'unit', 'lokasi'].includes(req.query.tab) ? req.query.tab : 'unit';
  const q = (req.query.q || '').trim();
  const showInactive = req.query.inactive === '1';
  const like = `%${q}%`;
  const act = showInactive ? '' : 'AND x.is_active = 1';
  const [depts, units, locs] = await Promise.all([
    db.query(`SELECT x.*, (SELECT COUNT(*) FROM work_units w WHERE w.department_id=x.id AND w.deleted_at IS NULL) AS unit_count,
                (SELECT COUNT(*) FROM employees e WHERE e.department_id=x.id AND e.deleted_at IS NULL) AS emp_count
               FROM departments x WHERE x.deleted_at IS NULL ${act} AND (x.name LIKE ? OR COALESCE(x.code,'') LIKE ?) ORDER BY x.name`, [like, like]),
    db.query(`SELECT x.*, d.name AS department_name, l.name AS loc_name, l.building, l.room,
                COALESCE(e.full_name, x.pic_name) AS pic_display,
                (SELECT COUNT(*) FROM asset_assignments aa WHERE aa.work_unit_id=x.id AND aa.is_current=1) AS device_count
               FROM work_units x JOIN departments d ON d.id=x.department_id
               LEFT JOIN locations l ON l.id=x.location_id LEFT JOIN employees e ON e.id=x.pic_employee_id
              WHERE x.deleted_at IS NULL ${act} AND (x.name LIKE ? OR d.name LIKE ?) ORDER BY d.name, x.name`, [like, like]),
    db.query(`SELECT x.*, (SELECT COUNT(*) FROM assets a WHERE a.location_id=x.id AND a.deleted_at IS NULL) AS asset_count
               FROM locations x WHERE x.deleted_at IS NULL ${act} AND (x.name LIKE ? OR COALESCE(x.building,'') LIKE ? OR COALESCE(x.room,'') LIKE ?)
              ORDER BY x.name, x.building, x.room`, [like, like, like]),
  ]);
  res.render('org/index', { title: 'Master Unit Kerja', tab, q, showInactive, depts, units, locs, ...(await lookups()), locText });
});

// ---------- Departemen ----------
const deptSchema = {
  code: { label: 'Kode', type: 'code', maxLength: 30, upper: true },
  name: { label: 'Nama departemen', required: true, maxLength: 120 },
  description: { label: 'Keterangan', maxLength: 255 },
  is_active: { type: 'bool' },
};
router.post('/departments', can('master.manage'), async (req, res) => {
  const v = validate(req.body, deptSchema); if (!v.ok) throw new ValidationError(v.errors);
  const r = await db.query('INSERT INTO departments (code, name, description, is_active) VALUES (?,?,?,?)', [v.data.code, v.data.name, v.data.description, 1]);
  await audit.log(req, 'CREATE', { entity: 'departments', id: r.insertId, after: v.data });
  res.done('Departemen ditambahkan.', '/org?tab=departemen');
});
router.post('/departments/:id', can('master.manage'), async (req, res) => {
  const before = await db.one('SELECT * FROM departments WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!before) throw Object.assign(new Error('Departemen tidak ditemukan.'), { status: 404 });
  const v = validate(req.body, deptSchema); if (!v.ok) throw new ValidationError(v.errors);
  await db.query('UPDATE departments SET code=?, name=?, description=?, is_active=? WHERE id=?', [v.data.code, v.data.name, v.data.description, v.data.is_active, before.id]);
  await audit.log(req, 'UPDATE', { entity: 'departments', id: before.id, ...audit.diff(before, v.data) });
  res.done('Departemen diperbarui.', '/org?tab=departemen');
});

// ---------- Unit kerja ----------
const unitSchema = {
  department_id: { label: 'Departemen', type: 'id', required: true },
  name: { label: 'Nama unit kerja', required: true, maxLength: 120 },
  location_id: { label: 'Lokasi', type: 'id' },
  pic_employee_id: { label: 'PIC unit (karyawan)', type: 'id' },
  pic_name: { label: 'Nama PIC (bila bukan karyawan terdaftar)', maxLength: 150 },
  is_active: { type: 'bool' },
};
router.post('/units', can('master.manage'), async (req, res) => {
  const v = validate(req.body, unitSchema); if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  const r = await db.query('INSERT INTO work_units (department_id, name, location_id, pic_employee_id, pic_name, is_active) VALUES (?,?,?,?,?,1)',
    [d.department_id, d.name, d.location_id, d.pic_employee_id, d.pic_name]);
  await audit.log(req, 'CREATE', { entity: 'work_units', id: r.insertId, after: d });
  res.done('Unit kerja ditambahkan.', '/org?tab=unit');
});
router.post('/units/:id', can('master.manage'), async (req, res) => {
  const before = await db.one('SELECT * FROM work_units WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!before) throw Object.assign(new Error('Unit kerja tidak ditemukan.'), { status: 404 });
  const v = validate(req.body, unitSchema); if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  await db.query('UPDATE work_units SET department_id=?, name=?, location_id=?, pic_employee_id=?, pic_name=?, is_active=? WHERE id=?',
    [d.department_id, d.name, d.location_id, d.pic_employee_id, d.pic_name, d.is_active, before.id]);
  await audit.log(req, 'UPDATE', { entity: 'work_units', id: before.id, ...audit.diff(before, d) });
  res.done('Unit kerja diperbarui.', '/org?tab=unit');
});

// ---------- Lokasi ----------
const locSchema = {
  name: { label: 'Nama lokasi', required: true, maxLength: 120 },
  building: { label: 'Gedung', maxLength: 120 },
  floor: { label: 'Lantai', maxLength: 30 },
  room: { label: 'Ruangan', maxLength: 120 },
  is_active: { type: 'bool' },
};
router.post('/locations', can('master.manage'), async (req, res) => {
  const v = validate(req.body, locSchema); if (!v.ok) throw new ValidationError(v.errors);
  const r = await db.query('INSERT INTO locations (name, building, floor, room, is_active) VALUES (?,?,?,?,1)', [v.data.name, v.data.building, v.data.floor, v.data.room]);
  await audit.log(req, 'CREATE', { entity: 'locations', id: r.insertId, after: v.data });
  res.done('Lokasi ditambahkan.', '/org?tab=lokasi');
});
router.post('/locations/:id', can('master.manage'), async (req, res) => {
  const before = await db.one('SELECT * FROM locations WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!before) throw Object.assign(new Error('Lokasi tidak ditemukan.'), { status: 404 });
  const v = validate(req.body, locSchema); if (!v.ok) throw new ValidationError(v.errors);
  await db.query('UPDATE locations SET name=?, building=?, floor=?, room=?, is_active=? WHERE id=?', [v.data.name, v.data.building, v.data.floor, v.data.room, v.data.is_active, before.id]);
  await audit.log(req, 'UPDATE', { entity: 'locations', id: before.id, ...audit.diff(before, v.data) });
  res.done('Lokasi diperbarui.', '/org?tab=lokasi');
});

module.exports = router;
module.exports.lookups = lookups;
module.exports.locText = locText;
