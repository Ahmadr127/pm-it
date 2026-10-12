'use strict';
const express = require('express');
const db = require('../config/db');
const settings = require('../services/settings');
const { lookups, locText } = require('./org');
const { can } = require('../middleware/auth');
const { isValidDate } = require('../utils/validate');
const h = require('../utils/helpers');

const router = express.Router();

router.get('/', can('dashboard.view'), async (req, res) => {
  const today = h.today();
  const q = req.query;
  const from = isValidDate(q.from || '') ? q.from : `${today.slice(0, 4)}-01-01`;
  const to = isValidDate(q.to || '') && q.to >= from ? q.to : today;
  const dueDays = await settings.getInt('due_soon_days', 14);

  // Filter aset (unit kerja, lokasi, jenis perangkat)
  const aw = ['a.deleted_at IS NULL']; const ap = [];
  if (q.work_unit_id) { aw.push('a.current_work_unit_id = ?'); ap.push(q.work_unit_id); }
  if (q.location_id) { aw.push('a.location_id = ?'); ap.push(q.location_id); }
  if (q.device_type) { aw.push('a.device_type = ?'); ap.push(q.device_type); }
  const AW = aw.join(' AND ');
  const ACTIVE = `${AW} AND a.asset_status <> 'Nonaktif'`;

  const [stats] = await db.query(`SELECT
      COUNT(*) total,
      SUM(a.asset_status <> 'Nonaktif') active,
      SUM(a.asset_status <> 'Nonaktif' AND a.current_health_status='BAIK') baik,
      SUM(a.asset_status <> 'Nonaktif' AND a.current_health_status='PERHATIAN') perhatian,
      SUM(a.asset_status <> 'Nonaktif' AND a.current_health_status='KRITIS') kritis,
      SUM(a.asset_status <> 'Nonaktif' AND a.current_health_status='BELUM_DIEVALUASI') belum,
      SUM(a.asset_status <> 'Nonaktif' AND a.next_maintenance_date BETWEEN ? AND ?) due_soon,
      SUM(a.asset_status <> 'Nonaktif' AND a.next_maintenance_date < ?) overdue,
      SUM(a.asset_status <> 'Nonaktif' AND EXISTS (SELECT 1 FROM maintenance_records r WHERE r.asset_id=a.id AND r.status='Selesai' AND r.deleted_at IS NULL AND r.maintenance_date BETWEEN ? AND ?)) maintained
    FROM assets a WHERE ${AW}`, [today, h.addDays(today, dueDays), today, from, to, ...ap]);
  for (const k of Object.keys(stats)) stats[k] = Number(stats[k] || 0);
  stats.not_maintained = stats.active - stats.maintained;

  // Grafik bulanan (maks 24 bulan terakhir dari periode)
  const months = [];
  let cur = `${to.slice(0, 7)}-01`;
  while (months.length < 24 && cur >= `${from.slice(0, 7)}-01`) {
    months.unshift(cur.slice(0, 7));
    const d = new Date(`${cur}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); cur = d.toISOString().slice(0, 10);
  }
  const monthly = await db.query(`SELECT ${db.yearMonth('r.maintenance_date')} ym, r.evaluated_status st, COUNT(*) c
       FROM maintenance_records r JOIN assets a ON a.id=r.asset_id WHERE ${AW} AND r.deleted_at IS NULL AND r.status='Selesai' AND r.maintenance_date BETWEEN ? AND ?
       GROUP BY ym, st`, [...ap, from, to]);
  const series = (st) => months.map((m) => Number((monthly.find((x) => x.ym === m && x.st === st) || {}).c || 0));
  const monthLabels = months.map((m) => `${h.BLN[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`);
  const chartMonthly = {
    type: 'bar',
    data: { labels: monthLabels, datasets: [
      { label: 'Baik', data: series('BAIK'), backgroundColor: '#1f9d62', borderRadius: 4, stack: 's' },
      { label: 'Perlu Perhatian', data: series('PERHATIAN'), backgroundColor: '#f0b400', borderRadius: 4, stack: 's' },
      { label: 'Kritis', data: series('KRITIS'), backgroundColor: '#d93a3a', borderRadius: 4, stack: 's' },
    ] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
  };
  const chartHealth = {
    type: 'doughnut',
    data: { labels: ['Baik', 'Perlu Perhatian', 'Kritis', 'Belum Dievaluasi'], datasets: [{ data: [stats.baik, stats.perhatian, stats.kritis, stats.belum], backgroundColor: ['#1f9d62', '#f0b400', '#d93a3a', '#c4c9dc'], borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom' } } },
  };
  const hasMonthly = monthly.length > 0;

  const [recent, actions, lk, units, approvals] = await Promise.all([
    db.query(`SELECT r.id, r.maintenance_no, r.maintenance_date, r.status, r.final_condition, r.evaluated_status, r.asset_code_snapshot, r.hostname_snapshot,
                     r.employee_name_snapshot, u.full_name AS technician
                FROM maintenance_records r JOIN assets a ON a.id=r.asset_id LEFT JOIN users u ON u.id=r.technician_user_id
               WHERE ${AW} AND r.deleted_at IS NULL AND r.status <> 'Draft' ORDER BY r.maintenance_date DESC, r.id DESC LIMIT 8`, ap),
    db.query(`SELECT a.id, a.asset_code, a.hostname, a.device_type, a.current_health_status, a.next_maintenance_date, a.last_maintenance_date,
                     e.full_name AS employee_name, d.name AS department_name,
                     (SELECT COUNT(*) FROM follow_up_actions f WHERE f.asset_id=a.id AND f.deleted_at IS NULL AND f.status NOT IN ('Selesai','Dibatalkan')) open_fu,
                     (SELECT f.title FROM follow_up_actions f WHERE f.asset_id=a.id AND f.deleted_at IS NULL AND f.status NOT IN ('Selesai','Dibatalkan') ORDER BY ${db.orderField('f.priority', ['Kritis', 'Tinggi', 'Sedang', 'Rendah'])} LIMIT 1) fu_title
                FROM assets a LEFT JOIN employees e ON e.id=a.current_employee_id LEFT JOIN departments d ON d.id=a.current_department_id
               WHERE ${ACTIVE} AND (a.current_health_status IN ('KRITIS','PERHATIAN') OR a.next_maintenance_date < ?
                     OR EXISTS (SELECT 1 FROM follow_up_actions f WHERE f.asset_id=a.id AND f.deleted_at IS NULL AND f.status NOT IN ('Selesai','Dibatalkan')))
               ORDER BY ${db.orderField('a.current_health_status', ['KRITIS', 'PERHATIAN', 'BELUM_DIEVALUASI', 'BAIK'])}, a.next_maintenance_date IS NULL, a.next_maintenance_date LIMIT 12`, [...ap, today]),
    lookups(),
    db.query('SELECT w.id, w.name, d.name AS department_name FROM work_units w JOIN departments d ON d.id=w.department_id WHERE w.deleted_at IS NULL ORDER BY d.name, w.name'),
    db.one("SELECT COUNT(*) c FROM maintenance_records WHERE deleted_at IS NULL AND approval_status='Menunggu'"),
  ]);

  res.render('dashboard/index', {
    title: 'Dashboard', stats, from, to, dueDays, recent, actions, ...lk, units, locText, charts: true,
    chartMonthly, chartHealth, hasMonthly, approvals: approvals.c,
  });
});

module.exports = router;
