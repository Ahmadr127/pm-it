'use strict';
const db = require('../config/db');

let cache = null;
let cacheAt = 0;

async function all() {
  if (cache && Date.now() - cacheAt < 30000) return cache;
  const rows = await db.query('SELECT setting_key, setting_value FROM app_settings');
  cache = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  cacheAt = Date.now();
  return cache;
}
async function get(key, def = null) { const s = await all(); return s[key] ?? def; }
async function getInt(key, def) { const v = parseInt(await get(key), 10); return isNaN(v) ? def : v; }
function invalidate() { cache = null; }

async function intervalFor(asset, conn = db) {
  if (asset.maintenance_interval_days) return { days: Number(asset.maintenance_interval_days), type: 'Kustom (per aset)' };
  const row = await conn.one('SELECT interval_days, interval_type FROM maintenance_intervals WHERE device_type = ?', [asset.device_type]);
  return row ? { days: row.interval_days, type: row.interval_type } : { days: 90, type: 'Triwulanan' };
}

module.exports = { all, get, getInt, invalidate, intervalFor };
