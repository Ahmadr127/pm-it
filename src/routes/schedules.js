'use strict';
const express = require('express');
const db = require('../config/db');
const audit = require('../services/audit');
const settings = require('../services/settings');
const notifications = require('../services/notifications');
const { technicians } = require('./maintenance');
const { lookups } = require('./org');
const { can } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');
const h = require('../utils/helpers');

const router = express.Router();
const STATUS = ['Terjadwal', 'Dalam Proses', 'Selesai', 'Ditunda', 'Dibatalkan'];
const TYPES = ['Mingguan', 'Bulanan', 'Triwulanan', 'Semesteran', 'Tahunan', 'Kustom'];

const FROM = `FROM maintenance_schedules s JOIN assets a ON a.id=s.asset_id AND a.deleted_at IS NULL
  LEFT JOIN users u ON u.id=s.technician_user_id LEFT JOIN employees e ON e.id=a.current_employee_id
  LEFT JOIN departments d ON d.id=a.current_department_id LEFT JOIN work_units wu ON wu.id=a.current_work_unit_id`;

function filters(q, dueDays) {
  const where = ['s.deleted_at IS NULL']; const params = []; const today = h.today();
  const tab = q.tab || 'mendatang';
  if (tab === 'mendatang') { where.push("s.status IN ('Terjadwal','Dalam Proses') AND s.scheduled_date >= ?"); params.push(today); }
  if (tab === 'jatuh-tempo') { where.push("s.status IN ('Terjadwal','Dalam Proses') AND s.scheduled_date BETWEEN ? AND ?"); params.push(today, h.addDays(today, dueDays)); }
  if (tab === 'terlambat') { where.push("s.status IN ('Terjadwal','Ditunda','Dalam Proses') AND s.scheduled_date < ?"); params.push(today); }
  if (tab === 'selesai') where.push("s.status = 'Selesai'");
  if (q.from) { where.push('s.scheduled_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('s.scheduled_date <= ?'); params.push(q.to); }
  if (q.technician_user_id === 'none') where.push('s.technician_user_id IS NULL');
  else if (q.technician_user_id) { where.push('s.technician_user_id = ?'); params.push(q.technician_user_id); }
  for (const [k, col] of Object.entries({ department_id: 'a.current_department_id', work_unit_id: 'a.current_work_unit_id', health: 'a.current_health_status', asset_id: 's.asset_id', status: 's.status' })) {
    if (q[k]) { where.push(`${col} = ?`); params.push(q[k]); }
  }
  if (q.q) { const like = `%${h.likeEscape(q.q)}%`; where.push('(a.asset_code LIKE ? OR a.hostname LIKE ? OR e.full_name LIKE ?)'); params.push(like, like, like); }
  return { where: where.join(' AND '), params, tab };
}

router.get('/', can('schedule.view'), async (req, res) => {
  const dueDays = await settings.getInt('due_soon_days', 14);
  const { page, per, offset } = h.paging(req.query);
  const f = filters(req.query, dueDays);
  const order = f.tab === 'selesai' ? 's.scheduled_date DESC' : 's.scheduled_date ASC';
  const today = h.today();
  const [[{ total }], rows, techs, lk, units, counts, intervals, noSchedule] = await Promise.all([
    db.query(`SELECT COUNT(*) total ${FROM} WHERE ${f.where}`, f.params),
    db.query(`SELECT s.*, a.asset_code, a.hostname, a.device_type, a.current_health_status, a.last_maintenance_date, u.full_name AS technician,
                     e.full_name AS employee_name, d.name AS department_name, wu.name AS work_unit_name ${FROM} WHERE ${f.where} ORDER BY ${order}, s.id LIMIT ? OFFSET ?`, [...f.params, per, offset]),
    technicians(), lookups(),
    db.query('SELECT w.id, w.name, d.name AS department_name FROM work_units w JOIN departments d ON d.id=w.department_id WHERE w.deleted_at IS NULL ORDER BY d.name, w.name'),
    db.one(`SELECT
        SUM(s.status IN ('Terjadwal','Dalam Proses') AND s.scheduled_date >= ?) mendatang,
        SUM(s.status IN ('Terjadwal','Dalam Proses') AND s.scheduled_date BETWEEN ? AND ?) jatuh_tempo,
        SUM(s.status IN ('Terjadwal','Ditunda','Dalam Proses') AND s.scheduled_date < ?) terlambat
      FROM maintenance_schedules s JOIN assets a ON a.id=s.asset_id AND a.deleted_at IS NULL WHERE s.deleted_at IS NULL`, [today, today, h.addDays(today, dueDays), today]),
    db.query("SELECT * FROM maintenance_intervals ORDER BY FIELD(device_type,'Desktop PC','Laptop','Workstation','Lainnya')"),
    db.one(`SELECT COUNT(*) c FROM assets a WHERE a.deleted_at IS NULL AND a.asset_status IN ('Aktif','Dipinjamkan')
             AND NOT EXISTS (SELECT 1 FROM maintenance_schedules s WHERE s.asset_id=a.id AND s.deleted_at IS NULL AND s.status IN ('Terjadwal','Ditunda','Dalam Proses'))`),
  ]);
  let preAsset = null;
  if (req.query.new === '1' && req.query.asset_id) preAsset = await db.one('SELECT id, asset_code, hostname FROM assets WHERE id=? AND deleted_at IS NULL', [req.query.asset_id]);
  res.render('schedules/index', { title: 'Jadwal Preventive Maintenance', rows, pg: { page, per, total }, techs, ...lk, units, counts, tab: f.tab, STATUS, TYPES, intervals, noSchedule: noSchedule.c, dueDays, preAsset });
});

const schema = {
  asset_id: { label: 'Kode aset', type: 'id', required: true },
  scheduled_date: { label: 'Tanggal jadwal', type: 'date', required: true },
  technician_user_id: { label: 'Teknisi', type: 'id' },
  interval_type: { label: 'Jenis jadwal', type: 'enum', values: TYPES },
  notes: { label: 'Catatan', maxLength: 255 },
};

router.post('/', can('schedule.manage'), async (req, res) => {
  const v = validate(req.body, schema); if (!v.ok) throw new ValidationError(v.errors);
  const a = await db.one('SELECT id, asset_code FROM assets WHERE id=? AND deleted_at IS NULL', [v.data.asset_id]);
  if (!a) throw new ValidationError({ asset_id: 'Aset tidak ditemukan.' });
  const r = await db.query("INSERT INTO maintenance_schedules (asset_id, scheduled_date, technician_user_id, interval_type, status, source, notes, created_by) VALUES (?,?,?,?, 'Terjadwal', 'MANUAL', ?, ?)",
    [a.id, v.data.scheduled_date, v.data.technician_user_id, v.data.interval_type, v.data.notes, req.user.id]);
  await db.query('UPDATE assets SET next_maintenance_date = (SELECT MIN(scheduled_date) FROM maintenance_schedules WHERE asset_id=? AND deleted_at IS NULL AND status IN (\'Terjadwal\',\'Ditunda\')) WHERE id=?', [a.id, a.id]);
  await audit.log(req, 'CREATE', { entity: 'maintenance_schedules', id: r.insertId, description: `Jadwal ${a.asset_code} ${v.data.scheduled_date}`, after: v.data });
  notifications.clear();
  res.done('Jadwal maintenance dibuat.', '/schedules');
});

// Penugasan teknisi massal
router.post('/bulk/assign', can('schedule.manage'), async (req, res) => {
  const ids = [].concat(req.body.ids || []).filter((x) => /^\d+$/.test(x)).map(Number).slice(0, 500);
  const tech = /^\d+$/.test(req.body.technician_user_id || '') ? Number(req.body.technician_user_id) : null;
  if (!ids.length) throw new ValidationError({ ids: 'Pilih minimal satu jadwal.' });
  const r = await db.query("UPDATE maintenance_schedules SET technician_user_id=? WHERE id IN (?) AND status <> 'Selesai' AND deleted_at IS NULL", [tech, ids]);
  await audit.log(req, 'UPDATE', { entity: 'maintenance_schedules', description: `Penugasan teknisi massal untuk ${r.affectedRows} jadwal` });
  res.done(`${r.affectedRows} jadwal ditugaskan.`, req.get('referer') || '/schedules');
});

/**
 * Buat jadwal otomatis untuk aset aktif yang belum punya jadwal terbuka.
 * Tanggal = maintenance terakhir + interval (per aset / per jenis perangkat); bila belum pernah, mulai dari tanggal awal yang dipilih.
 */
router.post('/generate', can('schedule.manage'), async (req, res) => {
  const v = validate(req.body, {
    start_date: { label: 'Tanggal mulai untuk aset yang belum pernah maintenance', type: 'date', required: true },
    technician_user_id: { label: 'Teknisi', type: 'id' },
    device_type: { label: 'Jenis perangkat', type: 'enum', values: ['Desktop PC', 'Laptop', 'Workstation', 'Lainnya'] },
    spread_per_day: { label: 'Maks. perangkat per hari', type: 'int', min: 1, max: 200, default: 10 },
  });
  if (!v.ok) throw new ValidationError(v.errors);
  const cfg = await settings.all();
  const assets = await db.query(`SELECT a.* FROM assets a WHERE a.deleted_at IS NULL AND a.asset_status IN ('Aktif','Dipinjamkan') ${v.data.device_type ? 'AND a.device_type = ?' : ''}
      AND NOT EXISTS (SELECT 1 FROM maintenance_schedules s WHERE s.asset_id=a.id AND s.deleted_at IS NULL AND s.status IN ('Terjadwal','Ditunda','Dalam Proses'))
      ORDER BY a.current_department_id, a.asset_code`, v.data.device_type ? [v.data.device_type] : []);
  const perDay = v.data.spread_per_day || 10;
  let created = 0; let dayOffset = 0; let usedToday = 0;
  await db.transaction(async (t) => {
    for (const a of assets) {
      const iv = await settings.intervalFor(a, t);
      let days = iv.days;
      if (a.current_health_status === 'KRITIS') days = Math.min(days, Number(cfg.interval_critical_days || 7));
      else if (a.current_health_status === 'PERHATIAN') days = Math.min(days, Number(cfg.interval_attention_days || 30));
      let date;
      if (a.last_maintenance_date) {
        date = h.addDays(a.last_maintenance_date, days);
        if (date < h.today()) date = h.today();
      } else {
        if (usedToday >= perDay) { dayOffset++; usedToday = 0; }
        date = h.addDays(v.data.start_date, dayOffset); usedToday++;
      }
      await t.query("INSERT INTO maintenance_schedules (asset_id, scheduled_date, technician_user_id, interval_type, status, source, notes, created_by) VALUES (?,?,?,?, 'Terjadwal', 'OTOMATIS', ?, ?)",
        [a.id, date, v.data.technician_user_id, iv.type, 'Dibuat otomatis berdasarkan kebijakan interval', req.user.id]);
      await t.query('UPDATE assets SET next_maintenance_date=? WHERE id=?', [date, a.id]);
      created++;
    }
    await audit.log(req, 'GENERATE', { entity: 'maintenance_schedules', description: `Generate jadwal otomatis: ${created} jadwal` }, t);
  });
  notifications.clear();
  res.done(created ? `${created} jadwal dibuat otomatis sesuai kebijakan interval.` : 'Semua aset aktif sudah memiliki jadwal terbuka.', '/schedules');
});

router.post('/:id', can('schedule.manage'), async (req, res) => {
  const s = await db.one('SELECT * FROM maintenance_schedules WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!s) throw Object.assign(new Error('Jadwal tidak ditemukan.'), { status: 404 });
  const v = validate(req.body, {
    scheduled_date: { label: 'Tanggal jadwal', type: 'date', required: true },
    technician_user_id: { label: 'Teknisi', type: 'id' },
    status: { label: 'Status', type: 'enum', values: STATUS.filter((x) => x !== 'Selesai'), required: true },
    interval_type: { label: 'Jenis jadwal', type: 'enum', values: TYPES },
    notes: { label: 'Catatan', maxLength: 255 },
  });
  if (!v.ok) throw new ValidationError(v.errors);
  if (s.status === 'Selesai') throw new ValidationError({ status: 'Jadwal yang sudah Selesai tidak dapat diubah.' });
  await db.query('UPDATE maintenance_schedules SET scheduled_date=?, technician_user_id=?, status=?, interval_type=?, notes=? WHERE id=?',
    [v.data.scheduled_date, v.data.technician_user_id, v.data.status, v.data.interval_type, v.data.notes, s.id]);
  await db.query('UPDATE assets SET next_maintenance_date = (SELECT MIN(scheduled_date) FROM maintenance_schedules WHERE asset_id=? AND deleted_at IS NULL AND status IN (\'Terjadwal\',\'Ditunda\')) WHERE id=?', [s.asset_id, s.asset_id]);
  await audit.log(req, 'UPDATE', { entity: 'maintenance_schedules', id: s.id, ...audit.diff(s, v.data) });
  notifications.clear();
  res.done('Jadwal diperbarui.', req.get('referer') || '/schedules');
});

// Hapus jadwal (yang belum Selesai). Jadwal Selesai tetap disimpan karena terhubung ke laporan maintenance.
router.post('/:id/delete', can('schedule.manage'), async (req, res) => {
  const s = await db.one('SELECT * FROM maintenance_schedules WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!s) throw Object.assign(new Error('Jadwal tidak ditemukan atau sudah dihapus.'), { status: 404 });
  if (s.status === 'Selesai') throw Object.assign(new Error('Jadwal yang sudah Selesai tidak dapat dihapus karena terhubung ke laporan maintenance.'), { status: 422 });
  await db.query('UPDATE maintenance_schedules SET deleted_at=NOW() WHERE id=?', [s.id]);
  await db.query('UPDATE assets SET next_maintenance_date = (SELECT MIN(scheduled_date) FROM maintenance_schedules WHERE asset_id=? AND deleted_at IS NULL AND status IN (\'Terjadwal\',\'Ditunda\')) WHERE id=?', [s.asset_id, s.asset_id]);
  await audit.log(req, 'DELETE', { entity: 'maintenance_schedules', id: s.id, description: `Hapus jadwal ${s.scheduled_date}`, before: s });
  notifications.clear();
  res.done('Jadwal dihapus.', req.get('referer') || '/schedules');
});

module.exports = router;
