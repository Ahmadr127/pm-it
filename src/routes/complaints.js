'use strict';
const express = require('express');
const db = require('../config/db');
const audit = require('../services/audit');
const notifications = require('../services/notifications');
const { technicians } = require('./maintenance');
const { can } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');
const h = require('../utils/helpers');

const router = express.Router();
const STATUS = ['Baru', 'Ditinjau', 'Ditindaklanjuti', 'Selesai', 'Ditolak'];

router.get('/', can('complaint.manage'), async (req, res) => {
  const { page, per, offset } = h.paging(req.query);
  const where = ['1=1']; const params = [];
  if (req.query.status && STATUS.includes(req.query.status)) { where.push('c.status = ?'); params.push(req.query.status); }
  const from = `FROM user_complaints c JOIN assets a ON a.id=c.asset_id JOIN users ru ON ru.id=c.reporter_user_id LEFT JOIN users hu ON hu.id=c.handled_by
                LEFT JOIN follow_up_actions f ON f.complaint_id=c.id AND f.deleted_at IS NULL`;
  const [[{ total }], rows, techs] = await Promise.all([
    db.query(`SELECT COUNT(*) total ${from} WHERE ${where.join(' AND ')}`, params),
    db.query(`SELECT c.*, a.asset_code, a.hostname, ru.full_name AS reporter, hu.full_name AS handler, f.id AS follow_up_id, f.status AS follow_up_status
               ${from} WHERE ${where.join(' AND ')} ORDER BY FIELD(c.status,'Baru','Ditinjau','Ditindaklanjuti','Selesai','Ditolak'), c.created_at DESC LIMIT ? OFFSET ?`, [...params, per, offset]),
    technicians(),
  ]);
  res.render('complaints/index', { title: 'Keluhan Pengguna', rows, pg: { page, per, total }, STATUS, techs });
});

router.post('/:id', can('complaint.manage'), async (req, res) => {
  const c = await db.one('SELECT c.*, a.asset_code FROM user_complaints c JOIN assets a ON a.id=c.asset_id WHERE c.id=?', [req.params.id]);
  if (!c) throw Object.assign(new Error('Keluhan tidak ditemukan.'), { status: 404 });
  const v = validate(req.body, {
    status: { label: 'Status', type: 'enum', values: STATUS, required: true },
    it_response: { label: 'Tanggapan IT', maxLength: 5000 },
    create_follow_up: { type: 'bool' },
    pic_user_id: { label: 'PIC', type: 'id' },
    priority: { label: 'Prioritas', type: 'enum', values: ['Rendah', 'Sedang', 'Tinggi', 'Kritis'], default: 'Sedang' },
  });
  if (['Ditolak', 'Selesai'].includes(v.data.status) && !v.data.it_response) v.errors.it_response = 'Tanggapan wajib diisi untuk status ini.';
  if (Object.keys(v.errors).length) throw new ValidationError(v.errors);
  await db.transaction(async (t) => {
    await t.query('UPDATE user_complaints SET status=?, it_response=?, handled_by=? WHERE id=?', [v.data.create_follow_up ? 'Ditindaklanjuti' : v.data.status, v.data.it_response, req.user.id, c.id]);
    if (v.data.create_follow_up) {
      const ex = await t.one('SELECT id FROM follow_up_actions WHERE complaint_id=? AND deleted_at IS NULL', [c.id]);
      if (!ex) {
        await t.query(`INSERT INTO follow_up_actions (asset_id, complaint_id, title, description, priority, status, pic_user_id, created_by) VALUES (?,?,?,?,?, 'Terbuka', ?, ?)`,
          [c.asset_id, c.id, `Keluhan pengguna ${c.asset_code}: ${c.category}`, c.description, v.data.priority, v.data.pic_user_id, req.user.id]);
      }
    }
    await audit.log(req, 'UPDATE', { entity: 'user_complaints', id: c.id, description: `Keluhan #${c.id} → ${v.data.status}`, after: v.data }, t);
  });
  notifications.clear();
  res.done('Keluhan diperbarui.', '/complaints');
});

module.exports = router;
