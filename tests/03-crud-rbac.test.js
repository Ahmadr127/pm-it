'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let app; let admin; let db;
const ids = {};
test.before(async () => {
  app = await H.setup();
  db = require('../src/config/db');
  admin = await H.adminAgent(app);
});
test.after(async () => { await H.teardown(app); });

test('master unit kerja: departemen, lokasi, unit (dengan validasi & nonaktif)', async () => {
  assert.equal((await admin.postForm('/org/departments', { code: 'it', name: 'IT' })).status, 200);
  assert.equal((await admin.postForm('/org/departments', { code: 'fin', name: 'Finance' })).status, 200);
  const dup = await admin.postForm('/org/departments', { name: 'IT' });
  assert.equal(dup.status, 409);
  ids.it = (await db.one("SELECT id, code FROM departments WHERE name='IT'"));
  assert.equal(ids.it.code, 'IT');
  ids.fin = (await db.one("SELECT id FROM departments WHERE name='Finance'")).id;
  assert.equal((await admin.postForm('/org/locations', { name: 'Kantor Pusat', building: 'Gedung A', room: 'Ruang IT' })).status, 200);
  assert.equal((await admin.postForm('/org/locations', { name: 'Kantor Pusat', building: 'Gedung A', room: 'Ruang Finance' })).status, 200);
  const locs = await db.query('SELECT id FROM locations ORDER BY id');
  ids.loc1 = locs[0].id; ids.loc2 = locs[1].id;
  assert.equal((await admin.postForm('/org/units', { department_id: ids.it.id, name: 'Infrastruktur', location_id: ids.loc1 })).status, 200);
  assert.equal((await admin.postForm('/org/units', { department_id: ids.fin, name: 'Treasury', location_id: ids.loc2 })).status, 200);
  ids.unitIt = (await db.one("SELECT id FROM work_units WHERE name='Infrastruktur'")).id;
  ids.unitFin = (await db.one("SELECT id FROM work_units WHERE name='Treasury'")).id;
  const deact = await admin.postForm(`/org/departments/${ids.fin}`, { name: 'Finance', is_active: '0' });
  assert.equal(deact.status, 200);
  assert.equal((await db.one('SELECT is_active FROM departments WHERE id=?', [ids.fin])).is_active, 0);
  await admin.postForm(`/org/departments/${ids.fin}`, { name: 'Finance', is_active: '1' });
});

test('aset: tambah, validasi, kode unik, ubah, cari', async () => {
  const bad = await admin.postMultipart('/assets').field('asset_code', 'ADEV IT').field('hostname', '').field('device_type', 'X').field('asset_status', 'Aktif').field('ip_address', '999.1.1.1');
  assert.equal(bad.status, 422);
  for (const k of ['asset_code', 'device_type', 'ip_address']) assert.ok(bad.body.errors[k], `error ${k}`);
  assert.equal(bad.body.errors.hostname, undefined, 'hostname tidak wajib lagi');
  const ok = await admin.postMultipart('/assets').field('asset_code', 'adev-it-pc-0008').field('hostname', 'IT-PC-08').field('device_type', 'Desktop PC')
    .field('asset_status', 'Aktif').field('ram_gb', '16').field('mac_address', '00-1a-2b-3c-4d-5e').field('location_id', String(ids.loc1))
    .attach('photo', H.png(), 'foto.png');
  assert.equal(ok.status, 200, ok.text);
  const a = await db.one("SELECT * FROM assets WHERE asset_code='ADEV-IT-PC-0008'");
  assert.equal(a.mac_address, '00:1A:2B:3C:4D:5E');
  assert.ok(a.photo_path);
  assert.equal(a.has_battery, 0);
  ids.pc = a.id;
  const dup = await admin.postMultipart('/assets').field('asset_code', 'ADEV-IT-PC-0008').field('hostname', 'X').field('device_type', 'Laptop').field('asset_status', 'Aktif');
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /unik/);
  const lt = await admin.postMultipart('/assets').field('asset_code', 'ADEV-IT-LT-0001').field('hostname', 'IT-LT-01').field('device_type', 'Laptop').field('asset_status', 'Aktif').field('has_battery', '1');
  assert.equal(lt.status, 200);
  ids.lt = (await db.one("SELECT id FROM assets WHERE asset_code='ADEV-IT-LT-0001'")).id;
  const upd = await admin.postMultipart(`/assets/${ids.pc}`).field('asset_code', 'ADEV-IT-PC-0008').field('hostname', 'IT-PC-08').field('device_type', 'Desktop PC')
    .field('asset_status', 'Dalam Perbaikan').field('location_id', String(ids.loc2)).field('change_reason', 'Uji');
  assert.equal(upd.status, 200);
  const kept = await db.one('SELECT hostname, mac_address FROM assets WHERE id=?', [ids.pc]);
  assert.equal(kept.mac_address, '00:1A:2B:3C:4D:5E', 'kolom yang tidak ada di form tidak terhapus saat diubah');
  // Form ringkas: tanpa hostname -> nama perangkat memakai kode aset
  const noHost = await admin.postMultipart('/assets').field('device_type', 'Desktop PC').field('asset_status', 'Aktif').field('processor', 'i5');
  assert.equal(noHost.status, 200, noHost.text);
  const nh = await db.one("SELECT asset_code, hostname FROM assets WHERE processor='i5' ORDER BY id DESC LIMIT 1");
  assert.equal(nh.hostname, nh.asset_code);
  const form = await admin.get('/assets/new');
  for (const k of ['inventory_number', 'hostname', 'brand', 'model', 'serial_number', 'mac_address', 'purchase_date', 'warranty_status', 'warranty_until', 'maintenance_interval_days']) assert.doesNotMatch(form.text, new RegExp(`name="${k}"`), k);
  const moves = await db.query('SELECT movement_type FROM asset_movements WHERE asset_id=?', [ids.pc]);
  assert.deepEqual(moves.map((m) => m.movement_type).sort(), ['LOKASI', 'STATUS']);
  const list = await admin.get('/assets?q=PC-0008');
  assert.equal(list.status, 200);
  assert.match(list.text, /ADEV-IT-PC-0008/);
  const search = await admin.get('/api/assets/search?q=lt-0001').set('Accept', 'application/json');
  assert.equal(search.body.items[0].asset_code, 'ADEV-IT-LT-0001');
});

test('pengguna PC: tambah dengan perangkat, pindah unit -> riwayat tetap ada', async () => {
  const r = await admin.postForm('/employees', { nik: 'emp001', full_name: 'Budi Santoso', department_id: ids.it.id, work_unit_id: ids.unitIt, location_id: ids.loc1, status: 'Aktif',
    asset_id: ids.pc, start_date: '2026-01-05', usage_status: 'Aktif', assignment_role: 'PENGGUNA_UTAMA' });
  assert.equal(r.status, 200, r.text);
  ids.emp = (await db.one("SELECT id FROM employees WHERE nik='EMP001'")).id;
  let a = await db.one('SELECT current_employee_id, current_work_unit_id FROM assets WHERE id=?', [ids.pc]);
  assert.equal(a.current_employee_id, ids.emp);
  assert.equal((await db.one('SELECT department_id FROM employees WHERE id=?', [ids.emp])).department_id, ids.it.id, 'departemen diambil dari unit kerja');
  const form = await admin.get('/employees');
  assert.doesNotMatch(form.text, /name="department_id" data-dept-select|name="phone_ext"/);
  // Form tanpa departemen: departemen otomatis mengikuti unit kerja baru
  const moved = await admin.postForm(`/employees/${ids.emp}`, { nik: 'EMP001', full_name: 'Budi Santoso', work_unit_id: ids.unitFin, location_id: ids.loc2, status: 'Aktif', transfer_reason: 'Rotasi' });
  assert.equal(moved.status, 200);
  assert.equal((await db.one('SELECT department_id FROM employees WHERE id=?', [ids.emp])).department_id, ids.fin);
  const hist = await db.query('SELECT is_current, work_unit_name_snapshot, end_date FROM asset_assignments WHERE asset_id=? ORDER BY id', [ids.pc]);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].is_current, 0); assert.equal(hist[0].work_unit_name_snapshot, 'Infrastruktur'); assert.ok(hist[0].end_date);
  assert.equal(hist[1].is_current, 1); assert.equal(hist[1].work_unit_name_snapshot, 'Treasury');
  a = await db.one('SELECT current_work_unit_id FROM assets WHERE id=?', [ids.pc]);
  assert.equal(a.current_work_unit_id, ids.unitFin);
  const types = (await db.query('SELECT movement_type FROM asset_movements WHERE asset_id=?', [ids.pc])).map((m) => m.movement_type);
  assert.ok(types.includes('DEPARTEMEN') && types.includes('UNIT_KERJA'));
  for (const q of ['Budi', 'EMP001', 'PC-0008', 'Finance', 'Treasury']) {
    const s = await admin.get(`/employees?q=${encodeURIComponent(q)}`);
    assert.match(s.text, /Budi Santoso/, `pencarian ${q}`);
  }
});

test('RBAC: IT Staff tidak boleh hapus aset / kelola akun; User hanya portal sendiri', async () => {
  const staff = await H.createUser(app, admin, { username: 'staff1', role: 'IT_STAFF' });
  assert.equal((await staff.get('/assets')).status, 200);
  assert.equal((await staff.postForm(`/assets/${ids.pc}/delete`, {})).status, 403);
  assert.equal((await staff.get('/admin/users')).status, 403);
  assert.equal((await staff.postForm('/admin/thresholds', { parameter: 'CPU_TEMP', warning_value: 1, critical_value: 2 })).status, 403);

  // Tiga role: Administrator, Manager IT, Staff IT. Tidak ada portal/akun karyawan.
  const roleCodes = (await db.query('SELECT code FROM roles ORDER BY code')).map((x) => x.code);
  assert.deepEqual(roleCodes, ['ADMIN', 'IT_STAFF', 'MANAGER_IT']);
  assert.equal((await db.one("SELECT name FROM roles WHERE code='ADMIN'")).name, 'Administrator');
  assert.equal((await db.one("SELECT name FROM roles WHERE code='MANAGER_IT'")).name, 'Manager IT');
  const mgr = await H.createUser(app, admin, { username: 'manager1', role: 'MANAGER_IT' });
  assert.equal((await mgr.get('/assets')).status, 200);
  assert.equal((await mgr.get('/assets/new')).status, 403);
  assert.equal((await mgr.get('/admin/users')).status, 403);
  assert.equal((await mgr.get('/admin/audit')).status, 200);
  assert.equal((await db.one("SELECT name FROM roles WHERE code='IT_STAFF'")).name, 'Staff IT');
  assert.equal((await staff.get('/my-devices')).status, 404);
  assert.equal((await staff.get('/complaints')).status, 404);
  const usersPage = await admin.get('/admin/users');
  assert.doesNotMatch(usersPage.text, /Tautkan ke data karyawan/);

  // Perubahan hak akses berlaku seketika: cabut asset.view dari IT Staff
  const staffRole = await db.one("SELECT id FROM roles WHERE code='IT_STAFF'");
  const perms = await db.query("SELECT p.id FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.code<>'asset.view'", [staffRole.id]);
  assert.equal((await admin.postForm(`/admin/roles/${staffRole.id}/permissions`, { perms: perms.map((p) => String(p.id)) })).status, 200);
  assert.equal((await staff.get('/assets')).status, 403);
  // Role ADMIN terkunci
  const adminRole = await db.one("SELECT id FROM roles WHERE code='ADMIN'");
  assert.equal((await admin.postForm(`/admin/roles/${adminRole.id}/permissions`, { perms: [] })).status, 422);
});

test('hapus aset = soft delete dengan konfirmasi, riwayat tetap', async () => {
  const r = await admin.postForm(`/assets/${ids.lt}/delete`, {});
  assert.equal(r.status, 200);
  const a = await db.one('SELECT deleted_at FROM assets WHERE id=?', [ids.lt]);
  assert.ok(a.deleted_at);
  assert.equal((await admin.get(`/assets/${ids.lt}`)).status, 404);
});

test('impor aset: validasi semua baris dulu, gagal total bila ada kesalahan', async () => {
  const csvBad = 'Kode Aset,Hostname,Jenis Perangkat,Status Aset,Lokasi\nADEV-X-0001,X1,Laptop,Aktif,\nADEV-X-0002,X2,Tablet,Aktif,\nADEV-X-0003,X3,Desktop PC,Aktif,Lokasi Fiktif\n';
  const bad = await admin.post('/assets/import').set('X-CSRF-Token', admin.csrf).attach('file', Buffer.from(csvBad), 'aset.csv');
  assert.equal(bad.status, 422);
  assert.match(bad.text, /2 baris bermasalah/);
  assert.equal((await db.one("SELECT COUNT(*) c FROM assets WHERE asset_code LIKE 'ADEV-X-%'")).c, 0);
  const csvOk = 'Kode Aset,Hostname,Jenis Perangkat,Status Aset,Lokasi,Gedung,Ruangan,Punya Baterai\nADEV-X-0001,X1,Laptop,Aktif,Kantor Pusat,Gedung A,Ruang IT,Ya\nADEV-X-0002,X2,Desktop PC,Cadangan,,,,Tidak\n';
  const ok = await admin.post('/assets/import').set('X-CSRF-Token', admin.csrf).attach('file', Buffer.from(csvOk), 'aset.csv');
  assert.equal(ok.status, 200);
  assert.match(ok.text, /Impor berhasil/);
  const x1 = await db.one("SELECT has_battery, location_id FROM assets WHERE asset_code='ADEV-X-0001'");
  assert.equal(x1.has_battery, 1); assert.equal(x1.location_id, ids.loc1);
  const xlsx = await admin.get('/assets/export.xlsx');
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers['content-type'], /spreadsheetml/);
});

test('kode aset opsional: PC tanpa kode diberi nomor otomatis, dapat diganti kode resmi nanti', async () => {
  const r = await admin.postMultipart('/assets').field('hostname', 'GDG-PC-01').field('device_type', 'Desktop PC').field('asset_status', 'Aktif');
  assert.equal(r.status, 200, r.text);
  const a = await db.one("SELECT id, asset_code FROM assets WHERE hostname='GDG-PC-01'");
  assert.match(a.asset_code, /^AST-PC-\d{4}$/);
  // Ubah tanpa mengisi kode -> nomor lama tetap
  const u = await admin.postMultipart(`/assets/${a.id}`).field('hostname', 'GDG-PC-01').field('device_type', 'Desktop PC').field('asset_status', 'Aktif');
  assert.equal(u.status, 200, u.text);
  assert.equal((await db.one('SELECT asset_code FROM assets WHERE id=?', [a.id])).asset_code, a.asset_code);
  // Setelah kode resmi tersedia
  await admin.postMultipart(`/assets/${a.id}`).field('asset_code', 'ADEV-GDG-PC-0001').field('hostname', 'GDG-PC-01').field('device_type', 'Desktop PC').field('asset_status', 'Aktif');
  assert.equal((await db.one('SELECT asset_code FROM assets WHERE id=?', [a.id])).asset_code, 'ADEV-GDG-PC-0001');
  // Impor tanpa kolom kode aset
  const csv = 'Hostname,Jenis Perangkat,Status Aset\nGDG-LT-01,Laptop,Aktif\nGDG-LT-02,Laptop,Aktif\n';
  const imp = await admin.post('/assets/import').set('X-CSRF-Token', admin.csrf).attach('file', Buffer.from(csv), 'aset.csv');
  assert.equal(imp.status, 200, imp.text);
  const lts = await db.query("SELECT asset_code FROM assets WHERE hostname IN ('GDG-LT-01','GDG-LT-02') ORDER BY hostname");
  assert.equal(lts.length, 2);
  for (const x of lts) assert.match(x.asset_code, /^AST-LT-\d{4}$/);
  assert.notEqual(lts[0].asset_code, lts[1].asset_code);
  // Form tidak lagi mewajibkan kode aset
  const f = await admin.get('/assets/new');
  assert.doesNotMatch(f.text, /name="asset_code"[^>]*required/);
  const m = await admin.get('/maintenance/new');
  assert.doesNotMatch(m.text, /name="na\[asset_code\]"/);
});

test('impor sederhana daftar PC: pengguna & lokasi dibuat otomatis, hostname yang ada dilewati, salah = batal semua', async () => {
  const tpl = await admin.get('/assets/import/template-sederhana.xlsx');
  assert.equal(tpl.status, 200);
  const bad = 'Hostname,Jenis Perangkat,Merek,Nama Pengguna,Lokasi / Gedung,Ruangan\nIMP-01,PC,HP,Andi,Gedung B,Lab\nIMP-02,Printer,-,-,-,-\n';
  const r1 = await admin.post('/assets/import').set('X-CSRF-Token', admin.csrf).attach('file', Buffer.from(bad), 'pc.csv');
  assert.equal(r1.status, 422);
  assert.match(r1.text, /tidak dikenal/);
  assert.equal(await db.one("SELECT id FROM assets WHERE hostname='IMP-01'"), null);
  const ok = 'Hostname,Jenis Perangkat,Merek,Nama Pengguna,Lokasi / Gedung,Ruangan\nIMP-01,PC,HP,Andi Imp,Gedung B,Lab\nIMP-02,laptop,-,Andi Imp,Gedung B,-\nGDG-PC-01,PC,,,,\n';
  const r2 = await admin.post('/assets/import').set('X-CSRF-Token', admin.csrf).attach('file', Buffer.from(ok), 'pc.csv');
  assert.equal(r2.status, 200, r2.text);
  assert.match(r2.text, /<strong>2<\/strong> aset baru/);
  assert.match(r2.text, /1 PC dilewati/);
  const a1 = await db.one("SELECT * FROM assets WHERE hostname='IMP-01'");
  const a2 = await db.one("SELECT * FROM assets WHERE hostname='IMP-02'");
  assert.equal(a1.brand, 'HP'); assert.equal(a2.device_type, 'Laptop'); assert.equal(a2.brand, null); assert.equal(a2.has_battery, 1);
  assert.equal(a1.current_employee_id, a2.current_employee_id);
  assert.equal((await db.one("SELECT COUNT(*) n FROM employees WHERE full_name='Andi Imp'")).n, 1);
  assert.ok(await db.one("SELECT id FROM locations WHERE name='Gedung B'"));
  assert.equal((await db.one("SELECT room FROM asset_assignments WHERE asset_id=? AND is_current=1", [a1.id])).room, 'Lab');
});
