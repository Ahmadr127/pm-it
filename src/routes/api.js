'use strict';
const express = require('express');
const db = require('../config/db');
const A = require('../services/assets');
const { can, has } = require('../middleware/auth');
const h = require('../utils/helpers');

const router = express.Router();

// Pencarian kode aset untuk dropdown (form maintenance, penugasan, jadwal)
router.get('/assets/search', can('asset.view', 'maintenance.create', 'employee.manage', 'schedule.manage'), async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const like = `%${h.likeEscape(q)}%`;
  const items = await db.query(
    `SELECT a.id, a.asset_code, a.hostname, a.device_type, a.inventory_number, e.full_name AS employee_name, d.name AS department_name
       FROM assets a LEFT JOIN employees e ON e.id=a.current_employee_id LEFT JOIN departments d ON d.id=a.current_department_id
      WHERE a.deleted_at IS NULL AND a.asset_status <> 'Nonaktif'
        AND (a.asset_code LIKE ? OR a.hostname LIKE ? OR a.inventory_number LIKE ? OR e.full_name LIKE ? OR e.nik LIKE ?)
      ORDER BY a.asset_code LIMIT 30`, [like, like, like, like, like]);
  res.json({ ok: true, items });
});

// Data perangkat + pengguna aktif untuk auto-fill form maintenance (read-only)
router.get('/assets/:id/context', can('maintenance.create', 'maintenance.update'), async (req, res) => {
  const ctx = await A.maintenanceContext(req.params.id);
  if (!ctx) return res.status(404).json({ ok: false, message: 'Aset tidak ditemukan.' });
  res.json({ ok: true, asset: ctx });
});

// Pencarian cepat di topbar: perangkat (kode, nama, serial, IP, pengguna, ruangan, lokasi, unit) & pengguna PC
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 2) return res.json({ ok: true, q, assets: [], employees: [] });
  const like = `%${h.likeEscape(q)}%`;
  const [assets, employees] = await Promise.all([
    has(req.user, 'asset.view') ? db.query(
      `SELECT a.id, a.asset_code, a.hostname, a.device_type, a.current_health_status AS health, e.full_name AS employee_name,
              l.name AS loc_name, aa.room, w.name AS unit_name
         FROM assets a
         LEFT JOIN employees e ON e.id=a.current_employee_id
         LEFT JOIN locations l ON l.id=a.location_id
         LEFT JOIN work_units w ON w.id=a.current_work_unit_id
         LEFT JOIN asset_assignments aa ON aa.asset_id=a.id AND aa.is_current=1 AND aa.assignment_role='PENGGUNA_UTAMA'
        WHERE a.deleted_at IS NULL
          AND (a.asset_code LIKE ? OR a.hostname LIKE ? OR COALESCE(a.serial_number,'') LIKE ? OR COALESCE(a.ip_address,'') LIKE ?
               OR COALESCE(e.full_name,'') LIKE ? OR COALESCE(aa.room,'') LIKE ? OR COALESCE(l.name,'') LIKE ? OR COALESCE(w.name,'') LIKE ?)
        ORDER BY (a.asset_code = ?) DESC, (a.asset_code LIKE ?) DESC, a.asset_code LIMIT 8`,
      [like, like, like, like, like, like, like, like, q, `${h.likeEscape(q)}%`]) : [],
    has(req.user, 'employee.view') ? db.query(
      `SELECT e.id, e.full_name, e.nik, w.name AS unit_name,
              (SELECT COUNT(*) FROM asset_assignments x WHERE x.employee_id=e.id AND x.is_current=1) AS device_count
         FROM employees e LEFT JOIN work_units w ON w.id=e.work_unit_id
        WHERE e.deleted_at IS NULL AND (e.full_name LIKE ? OR e.nik LIKE ?) ORDER BY e.full_name LIMIT 5`, [like, like]) : [],
  ]);
  res.json({
    ok: true, q,
    assets: assets.map((a) => ({ id: a.id, code: a.asset_code, name: h.deviceName(a.asset_code, a.hostname, a.device_type), type: a.device_type, health: a.health,
      sub: [a.employee_name, [a.loc_name, a.room].filter(Boolean).join(' · ') || a.unit_name].filter(Boolean).join(' — ') })),
    employees: employees.map((e) => ({ id: e.id, name: e.full_name, sub: [e.nik, e.unit_name, e.device_count ? `${e.device_count} perangkat` : null].filter(Boolean).join(' · ') })),
  });
});

module.exports = router;
