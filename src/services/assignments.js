'use strict';
/**
 * Penugasan perangkat ke pengguna / PIC unit.
 * Riwayat TIDAK pernah dihapus: penugasan lama ditutup (end_date, is_current=0) lalu dibuat baris baru.
 * Setiap perubahan pengguna / departemen / unit / lokasi dicatat di asset_movements.
 */
const h = require('../utils/helpers');

const locText = (l) => (l ? [l.name, l.building, l.floor ? `Lt. ${l.floor}` : null, l.room].filter(Boolean).join(' · ') : null);

async function snapshot(conn, { employeeId, departmentId, workUnitId, locationId }) {
  const emp = employeeId ? await conn.one('SELECT id, full_name, nik, department_id, work_unit_id, location_id, room FROM employees WHERE id=? AND deleted_at IS NULL', [employeeId]) : null;
  if (employeeId && !emp) throw Object.assign(new Error('Karyawan tidak ditemukan.'), { status: 422 });
  const deptId = departmentId || (emp && emp.department_id) || null;
  const unitId = workUnitId || (emp && emp.work_unit_id) || null;
  const locId = locationId || (emp && emp.location_id) || null;
  const dept = deptId ? await conn.one('SELECT id, name FROM departments WHERE id=?', [deptId]) : null;
  const unit = unitId ? await conn.one('SELECT id, name, department_id FROM work_units WHERE id=?', [unitId]) : null;
  const loc = locId ? await conn.one('SELECT * FROM locations WHERE id=?', [locId]) : null;
  if (unit && dept && unit.department_id !== dept.id) throw Object.assign(new Error('Unit kerja tidak berada di bawah departemen yang dipilih.'), { status: 422, errors: { work_unit_id: 'Unit kerja tidak sesuai departemen.' } });
  return { emp, dept, unit, loc };
}

async function movement(conn, assetId, type, from, to, reason, userId, at) {
  if ((from || null) === (to || null)) return;
  await conn.query('INSERT INTO asset_movements (asset_id, movement_type, from_value, to_value, moved_at, reason, moved_by) VALUES (?,?,?,?,?,?,?)',
    [assetId, type, from || '(kosong)', to || '(kosong)', at || h.nowDateTime(), reason || null, userId || null]);
}

/**
 * Tetapkan pengguna utama / PIC unit untuk sebuah aset.
 * @param conn helper transaksi dari db.transaction
 */
async function assign(conn, {
  assetId, employeeId = null, role = 'PENGGUNA_UTAMA', departmentId = null, workUnitId = null, locationId = null,
  room = null, startDate = null, status = 'Aktif', reason = null, notes = null,
}, userId) {
  const asset = await conn.one('SELECT id, location_id FROM assets WHERE id=? AND deleted_at IS NULL FOR UPDATE', [assetId]);
  if (!asset) throw Object.assign(new Error('Aset tidak ditemukan.'), { status: 404 });
  const start = startDate || h.today();
  const snap = await snapshot(conn, { employeeId, departmentId, workUnitId, locationId });
  const current = await conn.one('SELECT * FROM asset_assignments WHERE asset_id=? AND assignment_role=? AND is_current=1 FOR UPDATE', [assetId, role]);
  const newRoom = room || (snap.emp && snap.emp.room) || null;

  if (current && current.employee_id === (employeeId || null) && current.work_unit_id === (snap.unit ? snap.unit.id : null)
      && current.department_id === (snap.dept ? snap.dept.id : null) && current.location_id === (snap.loc ? snap.loc.id : null)
      && (current.room || null) === newRoom) {
    await conn.query('UPDATE asset_assignments SET status=?, notes=COALESCE(?, notes) WHERE id=?', [status, notes, current.id]);
    return current.id;
  }
  if (current) {
    if (current.start_date > start) throw Object.assign(new Error('Tanggal mulai tidak boleh sebelum tanggal mulai penugasan sebelumnya.'), { status: 422, errors: { start_date: `Minimal ${current.start_date}.` } });
    await conn.query("UPDATE asset_assignments SET is_current=0, end_date=?, status=CASE WHEN status='Aktif' THEN 'Dipindahkan' ELSE status END WHERE id=?", [start, current.id]);
  }
  const r = await conn.query(
    `INSERT INTO asset_assignments (asset_id, employee_id, assignment_role, department_id, work_unit_id, location_id, room,
       employee_name_snapshot, department_name_snapshot, work_unit_name_snapshot, location_text_snapshot,
       start_date, status, is_current, reason, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    [assetId, employeeId || null, role, snap.dept && snap.dept.id, snap.unit && snap.unit.id, snap.loc && snap.loc.id, newRoom,
      snap.emp && snap.emp.full_name, snap.dept && snap.dept.name, snap.unit && snap.unit.name, locText(snap.loc),
      start, status, reason, notes, userId]);

  const label = role === 'PIC_UNIT' ? 'PIC unit' : 'Pengguna';
  const at = `${start} ${h.nowDateTime().slice(11)}`;
  await movement(conn, assetId, 'PENGGUNA', current ? (current.employee_name_snapshot ? `${label}: ${current.employee_name_snapshot}` : null) : null,
    snap.emp ? `${label}: ${snap.emp.full_name}` : null, reason, userId, at);
  if (role === 'PENGGUNA_UTAMA') {
    await movement(conn, assetId, 'DEPARTEMEN', current && current.department_name_snapshot, snap.dept && snap.dept.name, reason, userId, at);
    await movement(conn, assetId, 'UNIT_KERJA', current && current.work_unit_name_snapshot, snap.unit && snap.unit.name, reason, userId, at);
    const fromLoc = [current && current.location_text_snapshot, current && current.room].filter(Boolean).join(' · R. ') || null;
    const toLoc = [locText(snap.loc), newRoom].filter(Boolean).join(' · R. ') || null;
    await movement(conn, assetId, 'LOKASI', current ? fromLoc : null, toLoc, reason, userId, at);
    await conn.query('UPDATE assets SET current_employee_id=?, current_department_id=?, current_work_unit_id=?, location_id=COALESCE(?, location_id) WHERE id=?',
      [employeeId || null, snap.dept && snap.dept.id, snap.unit && snap.unit.id, snap.loc && snap.loc.id, assetId]);
  }
  return r.insertId;
}

/** Lepaskan penugasan aktif (mis. perangkat ditarik ke gudang/cadangan). Riwayat tetap tersimpan. */
async function release(conn, assetId, role, { endDate, reason, status = 'Tidak Aktif' } = {}, userId) {
  const current = await conn.one('SELECT * FROM asset_assignments WHERE asset_id=? AND assignment_role=? AND is_current=1 FOR UPDATE', [assetId, role]);
  if (!current) return false;
  const end = endDate || h.today();
  await conn.query('UPDATE asset_assignments SET is_current=0, end_date=?, status=? WHERE id=?', [end, status, current.id]);
  await movement(conn, assetId, 'PENGGUNA', current.employee_name_snapshot ? `${role === 'PIC_UNIT' ? 'PIC unit' : 'Pengguna'}: ${current.employee_name_snapshot}` : null, '(dilepas)', reason, userId);
  if (role === 'PENGGUNA_UTAMA') await conn.query('UPDATE assets SET current_employee_id=NULL, current_department_id=NULL, current_work_unit_id=NULL WHERE id=?', [assetId]);
  return true;
}

/** Bila karyawan pindah departemen/unit/lokasi, penugasan perangkatnya ikut dipindah dengan riwayat tetap utuh. */
async function syncEmployeeTransfer(conn, employeeId, reason, userId) {
  const rows = await conn.query("SELECT asset_id, assignment_role, status FROM asset_assignments WHERE employee_id=? AND is_current=1", [employeeId]);
  for (const r of rows) {
    await assign(conn, { assetId: r.asset_id, employeeId, role: r.assignment_role, status: r.status, reason: reason || 'Perpindahan unit/lokasi karyawan' }, userId);
  }
  return rows.length;
}

module.exports = { assign, release, syncEmployeeTransfer, movement, locText };
