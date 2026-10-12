'use strict';
/**
 * Seeder DATA DASAR (wajib, bukan data dummy): role, hak akses, akun admin awal,
 * threshold awal (contoh kebijakan — wajib ditinjau admin), interval, pengaturan, checklist.
 * Aman dijalankan berulang (idempotent).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const { PERMISSIONS, ROLE_DEFAULTS } = require('../src/config/permissions');

const SETTINGS = [
  ['due_soon_days', '14', 'Jumlah hari sebelum jadwal dianggap "segera jatuh tempo"'],
  ['smart_unavailable_level', 'PERHATIAN', 'Perlakuan bila SMART "Tidak Tersedia": PERHATIAN atau INFO (hanya ditampilkan)'],
  ['health_drop_significant', '5', 'Penurunan health storage (poin %) dibanding pemeriksaan sebelumnya yang dianggap signifikan'],
  ['battery_drop_significant', '10', 'Penurunan battery health (poin %) yang dianggap signifikan'],
  ['temp_rise_significant', '10', 'Kenaikan suhu (°C) dibanding pemeriksaan sebelumnya yang dianggap signifikan'],
  ['approval_mode', 'KRITIS', 'Persetujuan Manager IT: SEMUA, KRITIS (hanya hasil Perhatian/Kritis), atau TIDAK'],
  ['interval_attention_days', '30', 'Interval maksimum (hari) jadwal berikutnya bila hasil evaluasi PERHATIAN'],
  ['interval_critical_days', '7', 'Interval maksimum (hari) jadwal berikutnya bila hasil evaluasi KRITIS'],
  ['auto_followup', '1', 'Buat tindak lanjut otomatis bila ditemukan masalah (1 = ya, 0 = tidak)'],
  ['temp_min_valid', '-10', 'Batas bawah suhu yang dapat diterima input (°C)'],
  ['temp_max_valid', '130', 'Batas atas suhu yang dapat diterima input (°C)'],
  ['password_min_length', '8', 'Panjang minimal password akun'],
  ['password_require_mix', '0', 'Wajib kombinasi huruf besar, kecil & angka (1 = ya, 0 = tidak)'],
  ['company_name', 'RS Azra', 'Nama instansi pada tampilan & laporan'],
  ['public_base_url', '', 'Alamat aplikasi untuk HP / label QR (kosong = otomatis dari IP server)'],
];

const THRESHOLDS = [
  // parameter, device_type, interface, warning, critical, direction, notes
  ['CPU_TEMP', null, null, 85, 95, 'HIGHER_IS_WORSE', 'Umum; sesuaikan dengan Tjmax prosesor (Intel/AMD) & kondisi beban'],
  ['CPU_TEMP', 'Laptop', null, 90, 98, 'HIGHER_IS_WORSE', 'Laptop umumnya berjalan lebih panas; cek spesifikasi produsen'],
  ['SSD_TEMP', null, 'NVMe', 65, 75, 'HIGHER_IS_WORSE', 'NVMe umumnya throttling ±70–80°C; cek datasheet model'],
  ['SSD_TEMP', null, 'SATA', 60, 70, 'HIGHER_IS_WORSE', 'SSD SATA umumnya spesifikasi operasi 0–70°C'],
  ['SSD_TEMP', null, null, 60, 70, 'HIGHER_IS_WORSE', 'Default SSD bila antarmuka tidak diketahui'],
  ['HDD_TEMP', null, null, 50, 55, 'HIGHER_IS_WORSE', 'HDD umumnya spesifikasi operasi 0/5–60°C'],
  ['SSD_HEALTH', null, null, 90, 70, 'LOWER_IS_WORSE', '>90 indikasi baik; 70–90 pantau; <70 evaluasi penggantian'],
  ['HDD_HEALTH', null, null, 90, 70, 'LOWER_IS_WORSE', '>90 indikasi baik; 70–90 pantau; <70 evaluasi penggantian'],
  ['BATTERY_HEALTH', null, null, 80, 60, 'LOWER_IS_WORSE', 'Persentase full charge capacity terhadap design capacity'],
];

const INTERVALS = [
  ['Desktop PC', 'Triwulanan', 90], ['Laptop', 'Triwulanan', 90],
  ['Workstation', 'Bulanan', 60], ['Lainnya', 'Semesteran', 180],
];

const TASKS = [
  ['FAN_CLEAN', 'Cleaning fan', 'SEMUA'],
  ['HEATSINK_CLEAN', 'Cleaning heatsink', 'SEMUA'],
  ['THERMAL_PASTE', 'Penggantian thermal paste', 'SEMUA'],
  ['DUST_INTERNAL', 'Pembersihan debu internal', 'SEMUA'],
  ['KEYBOARD_CASING', 'Pembersihan keyboard dan casing', 'SEMUA'],
  ['CABLE_CHECK', 'Pemeriksaan kabel power dan data', 'SEMUA'],
  ['USB_PORT', 'Pemeriksaan port USB', 'SEMUA'],
  ['AIRFLOW', 'Pemeriksaan kipas dan airflow', 'SEMUA'],
  ['PHYSICAL', 'Pemeriksaan kondisi fisik', 'SEMUA'],
  ['CHARGER', 'Pemeriksaan adaptor dan charger laptop', 'LAPTOP'],
  ['PERIPHERAL', 'Pemeriksaan fungsi printer/peripheral (jika relevan)', 'SEMUA'],
];

async function seedBase({ silent = false, adminPassword } = {}) {
  const log = (...a) => { if (!silent) console.log(...a); };

  for (const [code, name, group] of PERMISSIONS) {
    await db.query('INSERT INTO permissions (code, name, group_name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), group_name=VALUES(group_name)', [code, name, group]);
  }
  for (const [code, r] of Object.entries(ROLE_DEFAULTS)) {
    const existing = await db.one('SELECT id FROM roles WHERE code=?', [code]);
    let roleId = existing && existing.id;
    if (!roleId) {
      const res = await db.query('INSERT INTO roles (code, name, description, is_system) VALUES (?,?,?,1)', [code, r.name, r.description]);
      roleId = res.insertId;
      for (const p of r.perms) {
        await db.query('INSERT IGNORE INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code=?', [roleId, p]);
      }
    } else if (code === 'ADMIN') {
      // Administrator selalu memiliki seluruh hak akses (termasuk permission baru).
      await db.query('INSERT IGNORE INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions', [roleId]);
    }
  }

  const admin = await db.one('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!admin) {
    const pwd = adminPassword || process.env.ADMIN_INITIAL_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const hash = await bcrypt.hash(pwd, 12);
    const role = await db.one("SELECT id FROM roles WHERE code='ADMIN'");
    await db.query('INSERT INTO users (role_id, username, full_name, password_hash, must_change_password, password_changed_at) VALUES (?,?,?,?,1,NOW())',
      [role.id, 'admin', 'Administrator Sistem', hash]);
    if (!adminPassword && !process.env.ADMIN_INITIAL_PASSWORD) {
      log('\n================================================================');
      log(' Akun administrator dibuat.  Username: admin');
      log(` Password awal (catat sekarang, tidak ditampilkan lagi): ${pwd}`);
      log(' Anda akan diminta mengganti password saat login pertama.');
      log('================================================================\n');
    } else {
      log('Akun administrator "admin" dibuat dengan password dari ADMIN_INITIAL_PASSWORD (wajib diganti saat login pertama).');
    }
  }

  for (const [k, v, d] of SETTINGS) {
    await db.query('INSERT INTO app_settings (setting_key, setting_value, description) VALUES (?,?,?) ON DUPLICATE KEY UPDATE description=VALUES(description)', [k, v, d]);
  }
  const thrCount = await db.one('SELECT COUNT(*) c FROM hardware_thresholds');
  if (!thrCount.c) {
    for (const [p, dt, itf, w, c, dir, notes] of THRESHOLDS) {
      await db.query('INSERT INTO hardware_thresholds (parameter, device_type, interface, warning_value, critical_value, direction, reference, notes) VALUES (?,?,?,?,?,?,?,?)',
        [p, dt, itf, w, c, dir, 'Contoh kebijakan awal — tinjau sesuai datasheet produsen', notes]);
    }
  }
  for (const [t, it, days] of INTERVALS) {
    await db.query('INSERT IGNORE INTO maintenance_intervals (device_type, interval_type, interval_days) VALUES (?,?,?)', [t, it, days]);
  }
  let order = 1;
  for (const [code, name, applies] of TASKS) {
    await db.query('INSERT IGNORE INTO task_definitions (code, name, applies_to, sort_order) VALUES (?,?,?,?)', [code, name, applies, order++]);
  }
  log('Seeder data dasar selesai.');
}

if (require.main === module) {
  seedBase().then(() => process.exit(0)).catch((e) => { console.error('Seeder gagal:', e.message); process.exit(1); });
}

module.exports = { seedBase };
