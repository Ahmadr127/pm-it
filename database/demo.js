'use strict';
/**
 * DATA DEMONSTRASI — hanya untuk pelatihan / uji coba. BUKAN data operasional.
 * Semua baris yang dibuat dicatat di tabel demo_registry agar dapat dihapus tuntas:
 *   npm run demo:load     |  npm run demo:remove   (atau dari menu Pengaturan Sistem)
 * Maintenance demo dibuat melalui service yang sama dengan aplikasi (evaluasi, jadwal, tindak lanjut).
 */
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const M = require('../src/services/maintenance');
const assignments = require('../src/services/assignments');
const h = require('../src/utils/helpers');

let seed = 20261009;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b, d = 0) => Number((a + rnd() * (b - a)).toFixed(d));

async function reg(t, table, id) { await t.query('INSERT INTO demo_registry (table_name, record_id) VALUES (?,?)', [table, id]); return id; }

const DEPTS = [['IT', 'IT'], ['HRGA', 'HRGA'], ['FIN', 'Finance'], ['ACC', 'Accounting'], ['PUR', 'Purchasing'], ['WH', 'Warehouse'], ['PRD', 'Produksi'], ['QC', 'Quality Control'], ['REG', 'Regulatory'], ['MKT', 'Marketing']];
const UNITS = [['IT', 'Infrastruktur'], ['IT', 'Aplikasi'], ['HRGA', 'Personalia'], ['HRGA', 'General Affair'], ['FIN', 'Treasury'], ['ACC', 'Akuntansi Umum'], ['PUR', 'Pengadaan'], ['WH', 'Gudang Bahan Baku'], ['PRD', 'Produksi Lini 1'], ['PRD', 'PPIC'], ['QC', 'Laboratorium QC'], ['REG', 'Registrasi Produk'], ['MKT', 'Brand Management'], ['MKT', 'Sales Admin']];
const LOCS = [['Kantor Pusat', 'Gedung A', '2', 'Ruang IT'], ['Kantor Pusat', 'Gedung A', '3', 'Ruang Finance'], ['Kantor Pusat', 'Gedung B', '1', 'Ruang HRGA'], ['Kantor Pusat', 'Gedung B', '2', 'Ruang Marketing'], ['Pabrik Cikarang', 'Plant 1', '1', 'Ruang Produksi'], ['Pabrik Cikarang', 'Plant 1', '2', 'Laboratorium QC'], ['Pabrik Cikarang', 'Gudang', '1', 'Kantor Gudang']];
const UNIT_LOC = { Infrastruktur: 0, Aplikasi: 0, Personalia: 2, 'General Affair': 2, Treasury: 1, 'Akuntansi Umum': 1, Pengadaan: 1, 'Gudang Bahan Baku': 6, 'Produksi Lini 1': 4, PPIC: 4, 'Laboratorium QC': 5, 'Registrasi Produk': 3, 'Brand Management': 3, 'Sales Admin': 3 };
const FIRST = ['Andi', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fajar', 'Gita', 'Hendra', 'Indah', 'Joko', 'Kartika', 'Lukman', 'Maya', 'Nanda', 'Oki', 'Putri', 'Rizky', 'Sari', 'Teguh', 'Umi', 'Vina', 'Wahyu', 'Yuni', 'Zaki', 'Bayu', 'Rina', 'Agus', 'Lestari'];
const LAST = ['Pratama', 'Santoso', 'Wijaya', 'Lestari', 'Saputra', 'Kurniawan', 'Hidayat', 'Permata', 'Nugroho', 'Wibowo'];
const MODELS = {
  'Desktop PC': [['Dell', 'OptiPlex 7010', 'Intel Core i5-13500', 16], ['HP', 'ProDesk 400 G9', 'Intel Core i5-12500', 8], ['Lenovo', 'ThinkCentre M70s', 'Intel Core i7-12700', 16]],
  Laptop: [['Lenovo', 'ThinkPad E14 Gen 5', 'Intel Core i5-1335U', 16], ['Dell', 'Latitude 5440', 'Intel Core i7-1355U', 16], ['HP', 'ProBook 440 G10', 'Intel Core i5-1335U', 8], ['ASUS', 'ExpertBook B1', 'Intel Core i3-1215U', 8]],
  Workstation: [['Dell', 'Precision 3660', 'Intel Core i9-13900', 64], ['HP', 'Z2 G9', 'Intel Core i7-13700', 32]],
};
const SSDS = [['Samsung', '980 PRO', 'NVMe', 512], ['WD', 'SN770', 'NVMe', 512], ['Kingston', 'A400', 'SATA', 480], ['Crucial', 'MX500', 'SATA', 500], ['SK hynix', 'PC801', 'NVMe', 256]];
const HDDS = [['Seagate', 'BarraCuda ST1000DM010', 1000], ['WD', 'Blue WD10EZEX', 1000], ['Toshiba', 'P300 HDWD120', 2000]];

async function load({ silent = false } = {}) {
  const log = (...a) => { if (!silent) console.log(...a); };
  const existing = await db.one('SELECT COUNT(*) c FROM demo_registry');
  if (existing.c) throw new Error('Data demonstrasi sudah ada. Jalankan "npm run demo:remove" terlebih dahulu.');
  const roles = Object.fromEntries((await db.query('SELECT id, code FROM roles')).map((r) => [r.code, r.id]));
  const admin = await db.one("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='ADMIN' ORDER BY u.id LIMIT 1");
  const ids = { dept: {}, unit: {}, loc: [], emp: [], users: {} };

  await db.transaction(async (t) => {
    for (const [code, name] of DEPTS) {
      const ex = await t.one('SELECT id FROM departments WHERE name=?', [name]);
      ids.dept[code] = ex ? ex.id : await reg(t, 'departments', (await t.query('INSERT INTO departments (code, name, description) VALUES (?,?,?)', [`D-${code}`, name, 'Data demo'])).insertId);
    }
    for (const [n, b, f, r] of LOCS) {
      const ex = await t.one('SELECT id FROM locations WHERE name=? AND building=? AND room=?', [n, b, r]);
      ids.loc.push(ex ? ex.id : await reg(t, 'locations', (await t.query('INSERT INTO locations (name, building, floor, room) VALUES (?,?,?,?)', [n, b, f, r])).insertId));
    }
    for (const [dc, name] of UNITS) {
      const ex = await t.one('SELECT id FROM work_units WHERE department_id=? AND name=?', [ids.dept[dc], name]);
      ids.unit[name] = { id: ex ? ex.id : await reg(t, 'work_units', (await t.query('INSERT INTO work_units (department_id, name, location_id) VALUES (?,?,?)', [ids.dept[dc], name, ids.loc[UNIT_LOC[name]]])).insertId), dept: ids.dept[dc], loc: ids.loc[UNIT_LOC[name]] };
    }
    const unitNames = Object.keys(ids.unit);
    for (let i = 0; i < 28; i++) {
      const u = ids.unit[unitNames[i % unitNames.length]];
      const name = `${FIRST[i]} ${pick(LAST)}`;
      const id = (await t.query(`INSERT INTO employees (nik, full_name, position, department_id, work_unit_id, location_id, room, phone_ext, email, supervisor_name, status)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'Aktif')`, [`DEMO${String(1001 + i)}`, name, pick(['Staff', 'Senior Staff', 'Supervisor', 'Officer', 'Analyst']), u.dept, u.id, u.loc, `R-${100 + (i % 9)}`,
        String(2100 + i), `${name.toLowerCase().replace(/\s+/g, '.')}@demo.local`, 'Kepala Unit (demo)'])).insertId;
      await reg(t, 'employees', id);
      ids.emp.push({ id, unit: u });
    }
    for (const [u, n, role, emp] of [['demo.it', 'Rizky (Demo IT Staff)', 'IT_STAFF', null], ['demo.it2', 'Sari (Demo IT Staff)', 'IT_STAFF', null], ['demo.mgr', 'Teguh (Demo Manager IT)', 'MANAGER_IT', null]]) {
      if (await t.one('SELECT id FROM users WHERE username=?', [u])) continue;
      ids.users[u] = await reg(t, 'users', (await t.query('INSERT INTO users (role_id, employee_id, username, full_name, password_hash, must_change_password, password_changed_at) VALUES (?,?,?,?,?,0,NOW())',
        [roles[role], emp, u, n, await bcrypt.hash('Demo#2026pass', 10)])).insertId);
    }
  });

  // Aset + storage + penugasan
  const assets = [];
  const types = [...Array(14).fill('Desktop PC'), ...Array(14).fill('Laptop'), ...Array(4).fill('Workstation')];
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    const [brand, model, cpu, ram] = pick(MODELS[type]);
    const emp = ids.emp[i % ids.emp.length];
    const code = `ADEV-${type === 'Laptop' ? 'LT' : type === 'Workstation' ? 'WS' : 'PC'}-${String(i + 1).padStart(4, '0')}`;
    await db.transaction(async (t) => {
      const ssd = pick(SSDS); const withHdd = type !== 'Laptop' && rnd() < 0.55; const hdd = pick(HDDS);
      const purchase = h.addDays(h.today(), -Math.round(between(200, 1900)));
      const id = (await t.query(`INSERT INTO assets (asset_code, inventory_number, hostname, device_type, brand, model, serial_number, processor, ram_gb, storage_summary, gpu, operating_system,
          ip_address, mac_address, location_id, purchase_date, warranty_status, physical_condition, asset_status, has_battery, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, `INV-DEMO-${String(5000 + i)}`, `${code.replace('ADEV-', 'D')}-${emp.unit.id}`, type, brand, model, `SN${Math.floor(rnd() * 1e9)}`, cpu, ram,
        `SSD ${ssd[2]} ${ssd[3]} GB${withHdd ? ` + HDD ${hdd[2] / 1000} TB` : ''}`, type === 'Workstation' ? 'NVIDIA RTX A2000' : 'Intel UHD Graphics', 'Windows 11 Pro',
        `10.10.${10 + (i % 5)}.${20 + i}`, `00:1A:2B:${String(10 + i).padStart(2, '0')}:4D:5E`, emp.unit.loc, purchase,
        h.diffDays(h.today(), purchase) < 1095 ? 'Aktif' : 'Habis', 'Baik', 'Aktif', type === 'Laptop' ? 1 : 0, admin && admin.id])).insertId;
      await reg(t, 'assets', id);
      await reg(t, 'storage_devices', (await t.query('INSERT INTO storage_devices (asset_id, storage_type, interface, brand, model, serial_number, capacity_gb, installed_at) VALUES (?,?,?,?,?,?,?,?)',
        [id, 'SSD', ssd[2], ssd[0], ssd[1], `SSD${Math.floor(rnd() * 1e8)}`, ssd[3], purchase])).insertId);
      if (withHdd) await reg(t, 'storage_devices', (await t.query('INSERT INTO storage_devices (asset_id, storage_type, interface, brand, model, serial_number, capacity_gb, installed_at) VALUES (?,?,?,?,?,?,?,?)', [id, 'HDD', 'SATA', hdd[0], hdd[1], `HDD${Math.floor(rnd() * 1e8)}`, hdd[2], purchase])).insertId);
      await assignments.assign(t, { assetId: id, employeeId: emp.id, startDate: h.addDays(purchase, 7), reason: 'Penugasan awal (demo)' }, admin && admin.id);
      assets.push({ id, type, profile: rnd() });
    });
  }
  // Satu contoh perpindahan pengguna (riwayat tetap tersimpan)
  await db.transaction(async (t) => { await assignments.assign(t, { assetId: assets[1].id, employeeId: ids.emp[20].id, startDate: h.addDays(h.today(), -40), reason: 'Rotasi karyawan (demo)' }, admin && admin.id); });

  // Riwayat maintenance via service aplikasi
  const techs = Object.entries(ids.users).filter(([u]) => u.startsWith('demo.it')).map(([, id]) => id);
  const fakeReq = (uid) => ({ user: { id: uid, username: 'demo-seed' }, ip: null, get: () => '' });
  const nowYm = h.today();
  let recordCount = 0;
  for (const a of assets) {
    const asset = await db.one('SELECT * FROM assets WHERE id=?', [a.id]);
    const storages = await db.query('SELECT * FROM storage_devices WHERE asset_id=?', [a.id]);
    const defs = await M.taskDefinitions(asset.device_type);
    const visits = a.profile < 0.12 ? 0 : (a.profile < 0.5 ? 2 : 3);
    // profil kesehatan: sebagian kecil memburuk agar dashboard menampilkan variasi nyata
    const degrade = a.profile > 0.82 ? 'kritis' : a.profile > 0.62 ? 'perhatian' : 'baik';
    for (let v = 0; v < visits; v++) {
      const daysAgo = Math.round((visits - v - 1) * 85 + between(4, 45));
      const date = h.addDays(nowYm, -daysAgo);
      const last = v === visits - 1;
      const sev = last ? degrade : 'baik';
      const body = {
        maintenance_date: date, check_time: `${String(Math.round(between(8, 16))).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`, technician_user_id: String(pick(techs)), status: 'Selesai',
        cpu_temp_c: rnd() < 0.08 ? '' : String(sev === 'kritis' && rnd() < 0.5 ? between(92, 99, 1) : sev === 'perhatian' ? between(84, 90, 1) : between(42, 68, 1)),
        cpu_load_condition: pick(['Idle', 'Normal']), cpu_reading_tool: 'HWiNFO64',
        get cpu_unavailable() { return this.cpu_temp_c === '' ? '1' : '0'; },
        hdd_presence: storages.some((s) => s.storage_type === 'HDD') ? 'ADA' : 'TIDAK_ADA',
        ssd_presence: storages.some((s) => s.storage_type === 'SSD') ? 'ADA' : 'TIDAK_ADA',
        physical_condition: sev === 'kritis' && rnd() < 0.3 ? 'Rusak Ringan' : 'Baik',
        final_condition: sev === 'kritis' ? pick(['Perlu Perbaikan', 'Kritis']) : sev === 'perhatian' ? 'Perlu Monitoring' : pick(['Baik', 'Baik', 'Baik dengan catatan']),
        findings: sev === 'baik' ? 'Perangkat berfungsi normal, debu ringan pada fan.' : sev === 'perhatian' ? 'Suhu cenderung tinggi dan health storage menurun dibanding pemeriksaan sebelumnya.' : 'Storage menunjukkan penurunan health signifikan / SMART bermasalah.',
        actions_taken: 'Pembersihan fan & heatsink, pembersihan debu internal.', recommendation: sev === 'kritis' ? 'Backup data dan ajukan penggantian storage.' : '',
        ssd: {}, hdd: {}, tasks: {}, battery: {},
      };
      storages.forEach((s, i) => {
        const healthy = s.storage_type === 'SSD' ? between(93, 100) : between(91, 99);
        const health = sev === 'kritis' && i === 0 ? between(48, 68) : sev === 'perhatian' && i === 0 ? between(76, 88) : healthy - v;
        const target = s.storage_type === 'SSD' ? body.ssd : body.hdd;
        const idx = Object.keys(target).length;
        target[idx] = { storage_device_id: String(s.id), interface: s.interface, brand: s.brand, model: s.model, serial_number: s.serial_number, capacity_gb: String(s.capacity_gb),
          temperature_c: rnd() < 0.1 ? '' : String(s.storage_type === 'SSD' ? between(32, sev === 'perhatian' ? 66 : 52) : between(30, 45)),
          health_percent: String(Math.max(0, Math.min(100, health))), used_percent: String(between(30, 85)),
          smart_status: sev === 'kritis' && i === 0 && rnd() < 0.5 ? 'Kritis' : rnd() < 0.06 ? 'Tidak Tersedia' : sev === 'perhatian' && i === 0 ? 'Peringatan' : 'Baik', reading_tool: 'CrystalDiskInfo', data_source: 'MANUAL' };
      });
      for (const d of defs) body.tasks[d.code] = { status: ['FAN_CLEAN', 'DUST_INTERNAL', 'PHYSICAL', 'AIRFLOW', 'CABLE_CHECK', 'KEYBOARD_CASING'].includes(d.code) ? 'Sudah dilakukan' : d.code === 'THERMAL_PASTE' && (v % 2 === 1) ? 'Sudah dilakukan' : 'Tidak diperlukan' };
      if (asset.has_battery) {
        const design = 50000; const full = Math.round(design * (sev === 'kritis' ? between(0.52, 0.62, 3) : sev === 'perhatian' ? between(0.7, 0.79, 3) : between(0.86, 0.97, 3)));
        body.battery = { design_capacity_mwh: String(design), full_charge_capacity_mwh: String(full), cycle_count: String(Math.round(between(80, 600))),
          battery_status: sev === 'kritis' ? 'Perlu Penggantian' : sev === 'perhatian' ? 'Menurun' : 'Baik', data_source: 'MANUAL' };
      }
      const parsed = await M.parse(body, 'complete', asset, defs);
      if (Object.keys(parsed.errors).length) throw new Error(`Data demo tidak valid: ${JSON.stringify(parsed.errors)}`);
      const r = await M.save({ req: fakeReq(Number(body.technician_user_id)), asset, parsed, files: null, existing: null });
      recordCount++;
      // persetujuan oleh Manager IT demo untuk sebagian record
      if (ids.users['demo.mgr'] && rnd() < 0.7) await db.query("UPDATE maintenance_records SET approval_status='Disetujui', approved_by=?, approved_at=NOW() WHERE id=? AND approval_status='Menunggu'", [ids.users['demo.mgr'], r.id]);
    }
  }
  // Satu draft & satu jadwal terlambat agar alur terlihat
  const late = assets.find((x) => x.profile < 0.12);
  if (late) {
    await db.query("INSERT INTO maintenance_schedules (asset_id, scheduled_date, technician_user_id, interval_type, status, source, notes) VALUES (?,?,?,?, 'Terjadwal', 'MANUAL', 'Jadwal demo terlambat')", [late.id, h.addDays(h.today(), -9), techs[0], 'Triwulanan']);
    await db.query('UPDATE assets SET next_maintenance_date=? WHERE id=?', [h.addDays(h.today(), -9), late.id]);
  }
  const total = await db.one('SELECT COUNT(*) c FROM demo_registry');
  log(`Data demonstrasi dimuat: ${assets.length} aset, ${ids.emp.length} karyawan, ${recordCount} maintenance.`);
  log('Akun demo (password: Demo#2026pass): demo.it, demo.it2 (Staff IT), demo.mgr (Manager IT)');
  return { rows: total.c + recordCount };
}

/** Hapus SELURUH data demo beserta turunannya (berdasarkan registri). Data operasional tidak disentuh. */
async function remove({ silent = false } = {}) {
  const log = (...a) => { if (!silent) console.log(...a); };
  const regRows = await db.query('SELECT table_name, record_id FROM demo_registry');
  const by = (t) => regRows.filter((r) => r.table_name === t).map((r) => r.record_id);
  const assetIds = by('assets'); const empIds = by('employees'); const userIds = by('users');
  let rows = 0;
  const fs = require('fs'); const uploads = require('../src/services/uploads');
  await db.transaction(async (t) => {
    const del = async (sql, params) => { const r = await t.query(sql, params); rows += r.affectedRows || 0; };
    if (assetIds.length) {
      const recIds = (await t.query('SELECT id FROM maintenance_records WHERE asset_id IN (?)', [assetIds])).map((r) => r.id);
      const files = recIds.length ? await t.query('SELECT stored_path FROM maintenance_attachments WHERE maintenance_record_id IN (?)', [recIds]) : [];
      await del('UPDATE maintenance_schedules SET maintenance_record_id=NULL WHERE asset_id IN (?)', [assetIds]);
      await del('DELETE FROM agent_readings WHERE asset_id IN (?)', [assetIds]);
      if (recIds.length) await del('UPDATE agent_readings SET used_in_record_id=NULL WHERE used_in_record_id IN (?)', [recIds]);
      await del('DELETE FROM repair_records WHERE asset_id IN (?)', [assetIds]);
      await del('DELETE FROM follow_up_actions WHERE asset_id IN (?)', [assetIds]);
      await del('DELETE FROM user_complaints WHERE asset_id IN (?)', [assetIds]);
      if (recIds.length) await del('DELETE FROM maintenance_attachments WHERE maintenance_record_id IN (?)', [recIds]);
      await del('DELETE FROM maintenance_records WHERE asset_id IN (?)', [assetIds]);
      await del('DELETE FROM maintenance_schedules WHERE asset_id IN (?)', [assetIds]);
      await del('DELETE FROM asset_movements WHERE asset_id IN (?)', [assetIds]);
      await del('DELETE FROM asset_assignments WHERE asset_id IN (?)', [assetIds]);
      await del('DELETE FROM storage_devices WHERE asset_id IN (?)', [assetIds]);
      await del('DELETE FROM assets WHERE id IN (?)', [assetIds]);
      for (const f of files) { try { fs.unlinkSync(uploads.absolutePath(f.stored_path)); } catch (_) { /* abaikan */ } }
    }
    if (userIds.length) {
      for (const tbl of ['maintenance_records:technician_user_id', 'maintenance_records:approved_by', 'maintenance_schedules:technician_user_id', 'follow_up_actions:pic_user_id', 'repair_records:technician_user_id']) {
        const [tb, col] = tbl.split(':'); await t.query(`UPDATE ${tb} SET ${col}=NULL WHERE ${col} IN (?)`, [userIds]);
      }
      await del('DELETE FROM user_complaints WHERE reporter_user_id IN (?)', [userIds]);
      await del('DELETE FROM users WHERE id IN (?)', [userIds]);
    }
    if (empIds.length) {
      await t.query('UPDATE work_units SET pic_employee_id=NULL WHERE pic_employee_id IN (?)', [empIds]);
      await del('DELETE FROM employees WHERE id IN (?)', [empIds]);
    }
    for (const tb of ['work_units', 'locations', 'departments']) { const list = by(tb); if (list.length) await del(`DELETE FROM ${tb} WHERE id IN (?)`, [list]); }
    await t.query('DELETE FROM demo_registry');
  });
  require('../src/services/notifications').clear();
  log(`Data demonstrasi dihapus (${rows} baris).`);
  return { rows };
}

if (require.main === module) {
  const fn = process.argv.includes('--remove') ? remove : load;
  fn().then(() => process.exit(0)).catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
}

module.exports = { load, remove };
