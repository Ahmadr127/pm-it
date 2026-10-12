'use strict';
const db = require('../config/db');
const settings = require('./settings');
const { has } = require('../middleware/auth');
const h = require('../utils/helpers');

const cache = new Map();

/** Notifikasi header: jadwal terlambat, segera jatuh tempo, tindak lanjut kritis, menunggu persetujuan, keluhan baru. */
async function forUser(user) {
  const key = `${user.id}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < 60000) return c.data;
  const items = [];
  const today = h.today();
  if (has(user, 'schedule.view')) {
    const dueDays = await settings.getInt('due_soon_days', 14);
    const [overdue] = await db.query(
      `SELECT COUNT(*) c FROM maintenance_schedules s JOIN assets a ON a.id=s.asset_id AND a.deleted_at IS NULL
        WHERE s.deleted_at IS NULL AND s.status IN ('Terjadwal','Ditunda') AND s.scheduled_date < ?`, [today]);
    const [soon] = await db.query(
      `SELECT COUNT(*) c FROM maintenance_schedules s JOIN assets a ON a.id=s.asset_id AND a.deleted_at IS NULL
        WHERE s.deleted_at IS NULL AND s.status='Terjadwal' AND s.scheduled_date BETWEEN ? AND ?`, [today, h.addDays(today, dueDays)]);
    if (overdue.c) items.push({ icon: 'bi-alarm', tone: 'danger', text: `${overdue.c} maintenance terlambat`, href: '/schedules?tab=terlambat' });
    if (soon.c) items.push({ icon: 'bi-calendar-event', tone: 'warning', text: `${soon.c} jadwal jatuh tempo ≤ ${dueDays} hari`, href: '/schedules?tab=mendatang' });
  }
  if (has(user, 'followup.view')) {
    const [fu] = await db.query(`SELECT COUNT(*) c FROM follow_up_actions WHERE deleted_at IS NULL AND status NOT IN ('Selesai','Dibatalkan') AND priority IN ('Tinggi','Kritis')`);
    if (fu.c) items.push({ icon: 'bi-tools', tone: 'danger', text: `${fu.c} tindak lanjut prioritas tinggi/kritis terbuka`, href: '/follow-ups?priority=Kritis,Tinggi' });
  }
  if (has(user, 'maintenance.approve')) {
    const [ap] = await db.query(`SELECT COUNT(*) c FROM maintenance_records WHERE deleted_at IS NULL AND approval_status='Menunggu'`);
    if (ap.c) items.push({ icon: 'bi-patch-check', tone: 'primary', text: `${ap.c} hasil maintenance menunggu persetujuan`, href: '/maintenance?approval=Menunggu' });
  }
  if (has(user, 'sparepart.view')) {
    const [sp] = await db.query('SELECT COUNT(*) c FROM spare_parts WHERE deleted_at IS NULL AND stock <= min_stock');
    if (sp.c) items.push({ icon: 'bi-box-seam', tone: 'warning', text: `${sp.c} spare part stoknya menipis / habis`, href: '/spare-parts?filter=menipis' });
  }
  const data = { total: items.length, items };
  cache.set(key, { at: Date.now(), data });
  return data;
}

function clear() { cache.clear(); }

module.exports = { forUser, clear };
