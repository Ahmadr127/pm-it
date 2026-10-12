'use strict';
const express = require('express');
const db = require('../config/db');
const audit = require('../services/audit');
const notifications = require('../services/notifications');
const { technicians } = require('./maintenance');
const { lookups } = require('./org');
const { can } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');
const h = require('../utils/helpers');

const router = express.Router();
const STATUS = ['Terbuka', 'Dalam Proses', 'Menunggu Sparepart', 'Selesai', 'Dibatalkan'];
const PRIORITY = ['Rendah', 'Sedang', 'Tinggi', 'Kritis'];

router.get('/', can('followup.view'), async (req, res) => {
  const { page, per, offset } = h.paging(req.query);
  const where = ['f.deleted_at IS NULL']; const params = [];
  const st = req.query.status || 'open';
  if (st === 'open') where.push("f.status NOT IN ('Selesai','Dibatalkan')");
  else if (STATUS.includes(st)) { where.push('f.status = ?'); params.push(st); }
  if (req.query.priority) { const ps = String(req.query.priority).split(',').filter((p) => PRIORITY.includes(p)); if (ps.length) { where.push('f.priority IN (?)'); params.push(ps); } }
  if (req.query.pic_user_id) { where.push('f.pic_user_id = ?'); params.push(req.query.pic_user_id); }
  if (req.query.department_id) { where.push('a.current_department_id = ?'); params.push(req.query.department_id); }
  if (req.query.asset_id) { where.push('f.asset_id = ?'); params.push(req.query.asset_id); }
  if (req.query.overdue === '1') where.push("f.target_date < CURDATE() AND f.status NOT IN ('Selesai','Dibatalkan')");
  if (req.query.q) { const like = `%${h.likeEscape(req.query.q)}%`; where.push('(f.title LIKE ? OR a.asset_code LIKE ? OR a.hostname LIKE ?)'); params.push(like, like, like); }
  const from = `FROM follow_up_actions f JOIN assets a ON a.id=f.asset_id LEFT JOIN users u ON u.id=f.pic_user_id
                LEFT JOIN maintenance_records r ON r.id=f.maintenance_record_id LEFT JOIN departments d ON d.id=a.current_department_id LEFT JOIN users rv ON rv.id=f.reviewed_by`;
  const w = where.join(' AND ');
  const [[{ total }], rows, techs, lk] = await Promise.all([
    db.query(`SELECT COUNT(*) total ${from} WHERE ${w}`, params),
    db.query(`SELECT f.*, a.asset_code, a.hostname, u.full_name AS pic, r.maintenance_no, d.name AS department_name, rv.full_name AS reviewer ${from} WHERE ${w}
               ORDER BY FIELD(f.status,'Terbuka','Dalam Proses','Menunggu Sparepart','Selesai','Dibatalkan'), FIELD(f.priority,'Kritis','Tinggi','Sedang','Rendah'), f.target_date IS NULL, f.target_date, f.id DESC
               LIMIT ? OFFSET ?`, [...params, per, offset]),
    technicians(), lookups(),
  ]);
  res.render('followups/index', { title: 'Tindak Lanjut IT', rows, pg: { page, per, total }, techs, ...lk, STATUS, PRIORITY, st });
});

const schema = {
  title: { label: 'Judul', required: true, maxLength: 200 },
  description: { label: 'Deskripsi', maxLength: 60000 },
  priority: { label: 'Prioritas', type: 'enum', values: PRIORITY, required: true },
  status: { label: 'Status', type: 'enum', values: STATUS, required: true },
  pic_user_id: { label: 'PIC', type: 'id' },
  target_date: { label: 'Target penyelesaian', type: 'date' },
  resolution: { label: 'Hasil penyelesaian', maxLength: 10000 },
};

router.post('/', can('followup.manage'), async (req, res) => {
  const v = validate(req.body, { ...schema, asset_id: { label: 'Kode aset', type: 'id', required: true } });
  if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  const r = await db.query(`INSERT INTO follow_up_actions (asset_id, title, description, priority, status, pic_user_id, target_date, resolution, completed_at, created_by)
                             VALUES (?,?,?,?,?,?,?,?,?,?)`, [d.asset_id, d.title, d.description, d.priority, d.status, d.pic_user_id, d.target_date, d.resolution, d.status === 'Selesai' ? h.nowDateTime() : null, req.user.id]);
  await audit.log(req, 'CREATE', { entity: 'follow_up_actions', id: r.insertId, after: d });
  notifications.clear();
  res.done('Tindak lanjut dibuat.', '/follow-ups');
});

// Catat perbaikan / penggantian komponen (dari detail aset, detail maintenance, atau tindak lanjut)
router.post('/repairs', can('followup.manage'), async (req, res) => {
  const v = validate(req.body, {
    asset_id: { label: 'Aset', type: 'id', required: true },
    maintenance_record_id: { type: 'id' }, follow_up_id: { type: 'id' },
    repair_date: { label: 'Tanggal', type: 'date', required: true },
    repair_type: { label: 'Jenis', type: 'enum', values: ['Perbaikan', 'Penggantian Komponen', 'Upgrade'], required: true },
    component: { label: 'Komponen', required: true, maxLength: 120 },
    old_part: { label: 'Komponen lama', maxLength: 200 }, new_part: { label: 'Komponen baru', maxLength: 200 },
    new_part_serial: { label: 'Serial komponen baru', maxLength: 100 },
    cost: { label: 'Biaya', type: 'decimal', min: 0, max: 999999999999 },
    vendor: { label: 'Vendor', maxLength: 150 },
    technician_user_id: { label: 'Teknisi', type: 'id' },
    description: { label: 'Keterangan', maxLength: 5000 },
  });
  if (v.data.repair_date && v.data.repair_date > h.today()) v.errors.repair_date = 'Tanggal tidak boleh di masa depan.';
  if (Object.keys(v.errors).length) throw new ValidationError(v.errors);
  const d = v.data;
  const a = await db.one('SELECT id, asset_code FROM assets WHERE id=? AND deleted_at IS NULL', [d.asset_id]);
  if (!a) throw new ValidationError({ asset_id: 'Aset tidak ditemukan.' });
  if (d.maintenance_record_id) {
    const r = await db.one('SELECT id FROM maintenance_records WHERE id=? AND asset_id=?', [d.maintenance_record_id, a.id]);
    if (!r) d.maintenance_record_id = null;
  }
  const r = await db.query(`INSERT INTO repair_records (asset_id, maintenance_record_id, follow_up_id, repair_date, repair_type, component, old_part, new_part, new_part_serial, cost, vendor, technician_user_id, description, created_by)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [a.id, d.maintenance_record_id, d.follow_up_id, d.repair_date, d.repair_type, d.component, d.old_part, d.new_part, d.new_part_serial, d.cost, d.vendor, d.technician_user_id, d.description, req.user.id]);
  await audit.log(req, 'CREATE', { entity: 'repair_records', id: r.insertId, description: `${d.repair_type} ${d.component} pada ${a.asset_code}`, after: d });
  res.done('Catatan perbaikan disimpan.', req.get('referer') || `/assets/${a.id}#tab-repair`);
});

router.post('/:id', can('followup.manage'), async (req, res) => {
  const f = await db.one('SELECT * FROM follow_up_actions WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!f) throw Object.assign(new Error('Tindak lanjut tidak ditemukan.'), { status: 404 });
  const v = validate(req.body, schema); if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  if (d.status === 'Selesai' && !d.resolution) throw new ValidationError({ resolution: 'Isi hasil penyelesaian sebelum menutup tindak lanjut.' });
  await db.transaction(async (t) => {
    await t.query(`UPDATE follow_up_actions SET title=?, description=?, priority=?, status=?, pic_user_id=?, target_date=?, resolution=?,
                     completed_at=IF(?='Selesai', COALESCE(completed_at, NOW()), NULL), reviewed_by=?, reviewed_at=NOW() WHERE id=?`,
    [d.title, d.description, d.priority, d.status, d.pic_user_id, d.target_date, d.resolution, d.status, req.user.id, f.id]);
    if (f.maintenance_record_id) {
      const map = { Terbuka: 'Perlu Tindak Lanjut', 'Dalam Proses': 'Dalam Proses', 'Menunggu Sparepart': 'Dalam Proses', Selesai: 'Selesai' };
      if (map[d.status]) await t.query('UPDATE maintenance_records SET follow_up_status=? WHERE id=?', [map[d.status], f.maintenance_record_id]);
    }
    if (f.complaint_id && d.status === 'Selesai') await t.query("UPDATE user_complaints SET status='Selesai', it_response=COALESCE(?, it_response) WHERE id=?", [d.resolution, f.complaint_id]);
    await audit.log(req, 'UPDATE', { entity: 'follow_up_actions', id: f.id, ...audit.diff(f, d) }, t);
  });
  notifications.clear();
  res.done('Tindak lanjut diperbarui.', req.get('referer') || '/follow-ups');
});

module.exports = router;
module.exports.STATUS = STATUS;
