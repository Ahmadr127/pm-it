'use strict';
const express = require('express');
const db = require('../config/db');
const audit = require('../services/audit');
const assignments = require('../services/assignments');
const exporter = require('../services/exporter');
const { lookups, locText } = require('./org');
const { can } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');
const h = require('../utils/helpers');

const router = express.Router();
const STATUS = ['Aktif', 'Dipindahkan', 'Dipinjamkan', 'Tidak Aktif'];

const schema = {
  nik: { label: 'NIK / ID karyawan', required: true, maxLength: 40, type: 'code', upper: true },
  full_name: { label: 'Nama lengkap', required: true, maxLength: 150 },
  position: { label: 'Jabatan', maxLength: 120 },
  work_unit_id: { label: 'Unit kerja', type: 'id' },
  location_id: { label: 'Lokasi kerja', type: 'id' },
  room: { label: 'Ruangan', maxLength: 120 },
  email: { label: 'Email perusahaan', type: 'email' },
  supervisor_name: { label: 'Nama atasan / PIC unit', maxLength: 150 },
  status: { label: 'Status', type: 'enum', values: STATUS, required: true },
  notes: { label: 'Keterangan tambahan', maxLength: 3000 },
};
const assignSchema = {
  asset_id: { label: 'Kode aset PC/laptop', type: 'id' },
  start_date: { label: 'Tanggal mulai penggunaan', type: 'date' },
  usage_status: { label: 'Status penggunaan', type: 'enum', values: ['Aktif', 'Dipinjamkan'], default: 'Aktif' },
  assignment_role: { label: 'Peran', type: 'enum', values: ['PENGGUNA_UTAMA', 'PIC_UNIT'], default: 'PENGGUNA_UTAMA' },
};

async function validateEmployee(body, conn = db) {
  const v = validate(body, schema);
  // Departemen tidak diisi di form: diambil otomatis dari unit kerja yang dipilih
  v.data.department_id = null;
  if (v.data.work_unit_id) {
    const u = await conn.one('SELECT department_id FROM work_units WHERE id=? AND deleted_at IS NULL', [v.data.work_unit_id]);
    if (!u) v.errors.work_unit_id = 'Unit kerja tidak ditemukan.';
    else v.data.department_id = u.department_id;
  }
  const a = validate(body, assignSchema);
  Object.assign(v.errors, a.errors);
  if (a.data.asset_id && !a.data.start_date) v.errors.start_date = 'Tanggal mulai penggunaan wajib diisi bila memilih perangkat.';
  if (a.data.start_date && a.data.start_date > h.today()) v.errors.start_date = 'Tanggal mulai tidak boleh di masa depan.';
  v.assign = a.data;
  v.ok = Object.keys(v.errors).length === 0;
  return v;
}

function filters(q) {
  const where = ['e.deleted_at IS NULL']; const params = [];
  if (q.q) {
    const like = `%${h.likeEscape(String(q.q).trim())}%`;
    where.push(`(e.full_name LIKE ? OR e.nik LIKE ? OR e.email LIKE ? OR d.name LIKE ? OR wu.name LIKE ? OR l.name LIKE ? OR e.room LIKE ?
      OR EXISTS (SELECT 1 FROM asset_assignments aa JOIN assets a ON a.id=aa.asset_id WHERE aa.employee_id=e.id AND aa.is_current=1 AND (a.asset_code LIKE ? OR a.hostname LIKE ?)))`);
    params.push(like, like, like, like, like, like, like, like, like);
  }
  for (const [k, col] of Object.entries({ department_id: 'e.department_id', work_unit_id: 'e.work_unit_id', location_id: 'e.location_id', status: 'e.status' })) {
    if (q[k]) { where.push(`${col} = ?`); params.push(q[k]); }
  }
  return { where: where.join(' AND '), params };
}
const FROM = `FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN work_units wu ON wu.id=e.work_unit_id LEFT JOIN locations l ON l.id=e.location_id`;
const COLS = `e.*, d.name AS department_name, wu.name AS work_unit_name, l.name AS location_name, l.building AS location_building,
  (SELECT ${db.groupConcat(`CONCAT(a.id,'|',a.asset_code,'|',a.device_type,'|',aa.assignment_role)`, ';')} FROM asset_assignments aa JOIN assets a ON a.id=aa.asset_id AND a.deleted_at IS NULL
     WHERE aa.employee_id=e.id AND aa.is_current=1) AS devices`;
const SORTS = { name: 'e.full_name', nik: 'e.nik', dept: 'd.name', unit: 'wu.name', status: 'e.status', updated: 'e.updated_at' };

const parseDevices = (s) => (s ? s.split(';').map((x) => { const [id, code, type, role] = x.split('|'); return { id, code, type, role }; }) : []);

router.get('/', can('employee.view'), async (req, res) => {
  const { page, per, offset } = h.paging(req.query);
  const s = h.sorting(req.query, SORTS, 'name');
  const f = filters(req.query);
  const [[{ total }], rows, lk, units] = await Promise.all([
    db.query(`SELECT COUNT(*) total ${FROM} WHERE ${f.where}`, f.params),
    db.query(`SELECT ${COLS} ${FROM} WHERE ${f.where} ORDER BY ${s.sql} LIMIT ? OFFSET ?`, [...f.params, per, offset]),
    lookups(),
    db.query('SELECT w.id, w.name, w.department_id, d.name AS department_name FROM work_units w JOIN departments d ON d.id=w.department_id WHERE w.deleted_at IS NULL ORDER BY d.name, w.name'),
  ]);
  rows.forEach((r) => { r.deviceList = parseDevices(r.devices); });
  res.render('employees/index', { title: 'Pengguna PC', rows, pg: { page, per, total }, ...lk, units, STATUS, locText });
});

router.get('/export.:fmt', can('employee.view'), async (req, res) => {
  if (!['csv', 'xlsx'].includes(req.params.fmt)) throw Object.assign(new Error('Format tidak dikenal'), { status: 404 });
  const f = filters(req.query);
  const rows = await db.query(`SELECT ${COLS} ${FROM} WHERE ${f.where} ORDER BY e.full_name`, f.params);
  const cols = [
    { header: 'NIK', key: 'nik' }, { header: 'Nama', key: 'full_name', width: 24 }, { header: 'Jabatan', key: 'position', width: 18 },
    { header: 'Departemen', key: 'department_name', width: 16 }, { header: 'Unit Kerja', key: 'work_unit_name', width: 16 },
    { header: 'Lokasi', value: (r) => [r.location_name, r.location_building].filter(Boolean).join(' · '), width: 20 }, { header: 'Ruangan', key: 'room' },
    { header: 'Ext.', key: 'phone_ext' }, { header: 'Email', key: 'email', width: 24 }, { header: 'Atasan / PIC', key: 'supervisor_name', width: 18 },
    { header: 'Status', key: 'status' }, { header: 'Perangkat', value: (r) => parseDevices(r.devices).map((d) => d.code).join(', '), width: 30 },
  ];
  await audit.log(req, 'EXPORT', { entity: 'employees', description: `Ekspor ${rows.length} pengguna PC` });
  const name = `pengguna-pc-${h.today()}.${req.params.fmt}`;
  if (req.params.fmt === 'csv') return exporter.send(res, exporter.toCsv(cols, rows), name, 'csv');
  return exporter.send(res, await exporter.toXlsx([{ name: 'Pengguna PC', title: 'Data Pengguna PC', columns: cols, rows }], { by: req.user.full_name }), name, 'xlsx');
});

router.get('/:id', can('employee.view'), async (req, res) => {
  const emp = await db.one(`SELECT ${COLS} ${FROM} WHERE e.id=? AND e.deleted_at IS NULL`, [req.params.id]);
  if (!emp) throw Object.assign(new Error('Pengguna tidak ditemukan.'), { status: 404 });
  const history = await db.query(`SELECT aa.*, a.asset_code, a.hostname, a.device_type FROM asset_assignments aa JOIN assets a ON a.id=aa.asset_id
                                   WHERE aa.employee_id=? ORDER BY aa.is_current DESC, aa.start_date DESC`, [emp.id]);
  const lk = await lookups();
  const units = await db.query('SELECT w.id, w.name, w.department_id, d.name AS department_name FROM work_units w JOIN departments d ON d.id=w.department_id WHERE w.deleted_at IS NULL AND w.is_active=1 ORDER BY d.name, w.name');
  res.render('employees/show', { title: emp.full_name, emp, history, ...lk, units, STATUS, locText });
});

router.post('/', can('employee.manage'), async (req, res) => {
  const v = await validateEmployee(req.body); if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  const id = await db.transaction(async (t) => {
    const r = await t.query(`INSERT INTO employees (nik, full_name, position, department_id, work_unit_id, location_id, room, phone_ext, email, supervisor_name, status, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [d.nik, d.full_name, d.position, d.department_id, d.work_unit_id, d.location_id, d.room, null, d.email, d.supervisor_name, d.status, d.notes]);
    if (v.assign.asset_id) {
      await assignments.assign(t, { assetId: v.assign.asset_id, employeeId: r.insertId, role: v.assign.assignment_role, startDate: v.assign.start_date, status: v.assign.usage_status, reason: 'Penugasan saat pendaftaran pengguna' }, req.user.id);
    }
    await audit.log(req, 'CREATE', { entity: 'employees', id: r.insertId, description: `Pengguna ${d.full_name} ditambahkan`, after: { ...d, ...v.assign } }, t);
    return r.insertId;
  });
  res.done('Pengguna PC ditambahkan.', `/employees/${id}`);
});

router.post('/:id', can('employee.manage'), async (req, res) => {
  const before = await db.one('SELECT * FROM employees WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!before) throw Object.assign(new Error('Pengguna tidak ditemukan.'), { status: 404 });
  const v = await validateEmployee(req.body); if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  if (!d.work_unit_id) d.department_id = before.department_id; // tanpa unit kerja: departemen lama dipertahankan
  d.phone_ext = before.phone_ext; // tidak ada di form lagi; nilai lama dipertahankan
  await db.transaction(async (t) => {
    await t.query(`UPDATE employees SET nik=?, full_name=?, position=?, department_id=?, work_unit_id=?, location_id=?, room=?, phone_ext=?, email=?, supervisor_name=?, status=?, notes=? WHERE id=?`,
      [d.nik, d.full_name, d.position, d.department_id, d.work_unit_id, d.location_id, d.room, d.phone_ext, d.email, d.supervisor_name, d.status, d.notes, before.id]);
    const moved = ['department_id', 'work_unit_id', 'location_id', 'room'].some((k) => String(before[k] ?? '') !== String(d[k] ?? ''));
    if (d.status === 'Tidak Aktif' && before.status !== 'Tidak Aktif') {
      const cur = await t.query('SELECT asset_id, assignment_role FROM asset_assignments WHERE employee_id=? AND is_current=1', [before.id]);
      for (const c of cur) await assignments.release(t, c.asset_id, c.assignment_role, { reason: 'Karyawan berstatus Tidak Aktif' }, req.user.id);
    } else if (moved) {
      await assignments.syncEmployeeTransfer(t, before.id, req.body.transfer_reason || 'Perpindahan departemen/unit/lokasi karyawan', req.user.id);
    }
    if (v.assign.asset_id) {
      await assignments.assign(t, { assetId: v.assign.asset_id, employeeId: before.id, role: v.assign.assignment_role, startDate: v.assign.start_date, status: v.assign.usage_status, reason: req.body.transfer_reason || 'Penugasan perangkat' }, req.user.id);
    }
    await audit.log(req, 'UPDATE', { entity: 'employees', id: before.id, description: `Pengguna ${d.full_name} diubah${moved ? ' (pindah unit/lokasi)' : ''}`, ...audit.diff(before, d) }, t);
  });
  res.done('Data pengguna diperbarui. Riwayat penggunaan perangkat tetap tersimpan.', `/employees/${before.id}`);
});

router.post('/:id/delete', can('employee.manage'), async (req, res) => {
  const e = await db.one('SELECT id, full_name FROM employees WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!e) throw Object.assign(new Error('Pengguna tidak ditemukan.'), { status: 404 });
  await db.transaction(async (t) => {
    const cur = await t.query('SELECT asset_id, assignment_role FROM asset_assignments WHERE employee_id=? AND is_current=1', [e.id]);
    for (const c of cur) await assignments.release(t, c.asset_id, c.assignment_role, { reason: 'Data pengguna dihapus' }, req.user.id);
    await t.query("UPDATE employees SET deleted_at=NOW(), status='Tidak Aktif' WHERE id=?", [e.id]);
    await audit.log(req, 'DELETE', { entity: 'employees', id: e.id, description: `Pengguna ${e.full_name} dihapus (soft delete)` }, t);
  });
  res.done('Pengguna dihapus. Riwayat penggunaan perangkat dan maintenance tetap tersimpan.', '/employees');
});

module.exports = router;
