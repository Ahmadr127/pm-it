'use strict';
/**
 * Portal karyawan: hanya perangkat yang SEDANG ditugaskan kepada karyawan yang tertaut ke akun.
 * Kepemilikan diverifikasi di backend pada setiap request.
 */
const express = require('express');
const db = require('../config/db');
const audit = require('../services/audit');
const notifications = require('../services/notifications');
const { can } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');

const router = express.Router();
const CATEGORIES = ['Performa Lambat', 'Panas Berlebih', 'Suara Kipas', 'Baterai', 'Storage / Disk', 'Layar', 'Keyboard / Mouse', 'Jaringan', 'Lainnya'];

router.get('/', can('self.devices'), async (req, res) => {
  const empId = req.user.employee_id;
  let devices = []; let complaints = []; let followUps = []; let employee = null;
  if (empId) {
    employee = await db.one('SELECT e.*, d.name AS department_name, w.name AS work_unit_name FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN work_units w ON w.id=e.work_unit_id WHERE e.id=?', [empId]);
    devices = await db.query(`SELECT a.id, a.asset_code, a.hostname, a.device_type, a.brand, a.model, a.current_health_status, a.last_maintenance_date, a.next_maintenance_date,
                                     aa.assignment_role, aa.start_date, aa.status AS usage_status
                                FROM asset_assignments aa JOIN assets a ON a.id=aa.asset_id AND a.deleted_at IS NULL
                               WHERE aa.employee_id=? AND aa.is_current=1 ORDER BY a.asset_code`, [empId]);
    const ids = devices.map((d) => d.id);
    if (ids.length) {
      [complaints, followUps] = await Promise.all([
        db.query('SELECT c.*, a.asset_code FROM user_complaints c JOIN assets a ON a.id=c.asset_id WHERE c.reporter_user_id=? ORDER BY c.created_at DESC LIMIT 30', [req.user.id]),
        db.query(`SELECT f.id, f.title, f.status, f.priority, f.target_date, f.updated_at, a.asset_code FROM follow_up_actions f JOIN assets a ON a.id=f.asset_id
                   WHERE f.asset_id IN (?) AND f.deleted_at IS NULL ORDER BY FIELD(f.status,'Terbuka','Dalam Proses','Menunggu Sparepart','Selesai','Dibatalkan'), f.updated_at DESC LIMIT 30`, [ids]),
      ]);
    }
  }
  res.render('self/index', { title: 'Perangkat Saya', employee, devices, complaints, followUps, CATEGORIES });
});

router.post('/complaints', can('self.complaint'), async (req, res) => {
  const v = validate(req.body, {
    asset_id: { label: 'Perangkat', type: 'id', required: true },
    category: { label: 'Kategori', type: 'enum', values: CATEGORIES, required: true },
    description: { label: 'Uraian keluhan', required: true, maxLength: 3000 },
  });
  if (v.data.description && v.data.description.length < 10) v.errors.description = 'Jelaskan keluhan minimal 10 karakter.';
  if (Object.keys(v.errors).length) throw new ValidationError(v.errors);
  const own = req.user.employee_id && await db.one('SELECT 1 x FROM asset_assignments WHERE asset_id=? AND employee_id=? AND is_current=1', [v.data.asset_id, req.user.employee_id]);
  if (!own) throw Object.assign(new Error('Anda hanya dapat melaporkan keluhan untuk perangkat yang menjadi tanggung jawab Anda.'), { status: 403 });
  const r = await db.query('INSERT INTO user_complaints (asset_id, reporter_user_id, employee_id, category, description) VALUES (?,?,?,?,?)',
    [v.data.asset_id, req.user.id, req.user.employee_id, v.data.category, v.data.description]);
  await audit.log(req, 'CREATE', { entity: 'user_complaints', id: r.insertId, description: `Keluhan ${v.data.category}` });
  notifications.clear();
  res.done('Keluhan terkirim ke tim IT. Status dapat dipantau di halaman ini.', '/my-devices');
});

module.exports = router;
