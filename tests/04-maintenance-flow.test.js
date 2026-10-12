'use strict';
// Alur utama IT Staff (bagian 17): pilih aset -> isi pemeriksaan -> upload -> simpan -> evaluasi -> tindak lanjut -> jadwal -> cetak
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const H = require('./helpers');

let app; let admin; let staff; let mgr; let db;
const ids = {};
test.before(async () => {
  app = await H.setup();
  db = require('../src/config/db');
  admin = await H.adminAgent(app);
  await admin.postForm('/org/departments', { name: 'Produksi' });
  ids.dept = (await db.one("SELECT id FROM departments WHERE name='Produksi'")).id;
  await admin.postForm('/org/units', { department_id: ids.dept, name: 'Lini 1' });
  ids.unit = (await db.one("SELECT id FROM work_units WHERE name='Lini 1'")).id;
  await admin.postMultipart('/assets').field('asset_code', 'ADEV-PRD-PC-0001').field('hostname', 'PRD-PC-01').field('device_type', 'Desktop PC').field('asset_status', 'Aktif').field('processor', 'Intel Core i5');
  await admin.postMultipart('/assets').field('asset_code', 'ADEV-PRD-LT-0001').field('hostname', 'PRD-LT-01').field('device_type', 'Laptop').field('asset_status', 'Aktif').field('has_battery', '1');
  ids.pc = (await db.one("SELECT id FROM assets WHERE asset_code='ADEV-PRD-PC-0001'")).id;
  ids.lt = (await db.one("SELECT id FROM assets WHERE asset_code='ADEV-PRD-LT-0001'")).id;
  await admin.postForm('/employees', { nik: 'P001', full_name: 'Siti Operator', department_id: ids.dept, work_unit_id: ids.unit, status: 'Aktif', asset_id: ids.pc, start_date: '2026-02-01', usage_status: 'Aktif', assignment_role: 'PENGGUNA_UTAMA' });
  ids.emp = (await db.one("SELECT id FROM employees WHERE nik='P001'")).id;
  staff = await H.createUser(app, admin, { username: 'teknisi1', role: 'IT_STAFF' });
  mgr = await H.createUser(app, admin, { username: 'managerit', role: 'MANAGER_IT' });
  ids.staff = (await db.one("SELECT id FROM users WHERE username='teknisi1'")).id;
  ids.tasks = (await db.query('SELECT code, applies_to FROM task_definitions WHERE is_active=1'));
});
test.after(async () => { await H.teardown(app); fs.rmSync(require('path').join(__dirname, '..', 'storage', 'test-uploads'), { recursive: true, force: true }); });

function baseForm(req, { assetId, action, tasksFor = 'Desktop PC' } = {}) {
  req.field('asset_id', String(assetId)).field('action', action).field('maintenance_date', '2026-10-01').field('check_time', '09:30')
    .field('technician_user_id', String(ids.staff)).field('status', 'Dalam Proses');
  for (const t of ids.tasks) if (t.applies_to === 'SEMUA' || (t.applies_to === 'LAPTOP' && tasksFor === 'Laptop')) req.field(`tasks[${t.code}][status]`, t.code === 'THERMAL_PASTE' ? 'Belum dilakukan' : 'Sudah dilakukan');
  return req;
}

test('konteks aset otomatis (read-only) untuk form', async () => {
  const r = await staff.get(`/api/assets/${ids.pc}/context`).set('Accept', 'application/json');
  assert.equal(r.status, 200);
  assert.equal(r.body.asset.employee_name, 'Siti Operator');
  assert.equal(r.body.asset.department_name, 'Produksi');
  assert.equal(r.body.asset.has_battery, false);
  assert.equal((await staff.get(`/maintenance/new?asset_id=${ids.pc}`)).status, 200);
});

test('draft cukup aset & tanggal; validasi wajib saat Tandai Selesai', async () => {
  const draft = await staff.postMultipart('/maintenance').field('asset_id', String(ids.pc)).field('action', 'draft').field('maintenance_date', '2026-10-01');
  assert.equal(draft.status, 200, draft.text);
  ids.draft = (await db.one("SELECT id FROM maintenance_records WHERE status='Draft'")).id;
  const rec = await db.one('SELECT maintenance_no, evaluated_status FROM maintenance_records WHERE id=?', [ids.draft]);
  assert.match(rec.maintenance_no, /^PM-202610-\d{4}$/);
  assert.equal(rec.evaluated_status, 'BELUM_DIEVALUASI');

  const incomplete = await staff.postMultipart(`/maintenance/${ids.draft}`).field('action', 'complete').field('maintenance_date', '2026-10-01').field('check_time', '09:30')
    .field('technician_user_id', String(ids.staff)).field('ssd[0][health_percent]', '150').field('ssd[0][temperature_c]', 'panas');
  assert.equal(incomplete.status, 422);
  const e = incomplete.body.errors;
  assert.ok(e['ssd[0][health_percent]'], 'health > 100 ditolak');
  assert.ok(e['ssd[0][temperature_c]'], 'suhu harus angka');
  assert.ok(e['ssd[0][smart_status]'], 'SMART wajib saat selesai');
  assert.ok(e.cpu_temp_c && /perkiraan/.test(e.cpu_temp_c), 'CPU wajib diukur atau ditandai tidak terbaca');
  assert.ok(e.hdd_presence && e.final_condition && e.physical_condition);
  assert.ok(Object.keys(e).some((k) => k.startsWith('tasks[')), 'checklist wajib dikonfirmasi');
});

test('file tidak valid ditolak di backend (isi bukan gambar meski ekstensi .png)', async () => {
  const r = await baseForm(staff.postMultipart(`/maintenance/${ids.draft}`), { assetId: ids.pc, action: 'draft' })
    .attach('dokumentasi', Buffer.from('<?php echo 1; ?>'), 'shell.png');
  assert.equal(r.status, 422);
  assert.match(JSON.stringify(r.body.errors), /bukan gambar/);
  assert.equal((await db.one('SELECT COUNT(*) c FROM maintenance_attachments')).c, 0);
  const tmp = fs.readdirSync(require('path').join(__dirname, '..', 'storage', 'test-uploads', 'tmp'));
  assert.equal(tmp.length, 0, 'file sementara dibersihkan');
});

test('selesai dengan kondisi kritis: konfirmasi -> simpan transaksi -> evaluasi, tindak lanjut, jadwal', async () => {
  const build = (confirm) => baseForm(staff.postMultipart(`/maintenance/${ids.draft}`), { assetId: ids.pc, action: 'complete' })
    .field('cpu_temp_c', '61.5').field('cpu_load_condition', 'Normal').field('hdd_presence', 'TIDAK_ADA')
    .field('ssd[0][interface]', 'NVMe').field('ssd[0][brand]', 'Samsung').field('ssd[0][model]', '980 PRO').field('ssd[0][serial_number]', 'S5GXNX0R1')
    .field('ssd[0][capacity_gb]', '512').field('ssd[0][temperature_c]', '44').field('ssd[0][health_percent]', '97').field('ssd[0][smart_status]', 'Kritis')
    .field('hdd[0][health_percent]', '10')
    .field('physical_condition', 'Baik').field('final_condition', 'Perlu Perbaikan').field('findings', 'SMART reallocated sector meningkat')
    .field('follow_up_target_date', '2026-10-10').field('confirm_followup', confirm)
    .attach('dokumentasi', H.png(), 'sebelum.png').attach('dokumentasi', H.pdf(), 'smart-report.pdf');
  const first = await build('0');
  assert.equal(first.status, 200);
  assert.equal(first.body.needs_confirmation, true);
  assert.equal(first.body.evaluation.overall, 'KRITIS');
  assert.equal((await db.one('SELECT status FROM maintenance_records WHERE id=?', [ids.draft])).status, 'Draft', 'belum tersimpan sebelum konfirmasi');

  const ok = await build('1');
  assert.equal(ok.status, 200, ok.text);
  assert.match(ok.body.message, /tindak lanjut dibuat otomatis/);
  const r = await db.one('SELECT * FROM maintenance_records WHERE id=?', [ids.draft]);
  assert.equal(r.status, 'Selesai');
  assert.equal(r.evaluated_status, 'KRITIS');
  assert.equal(r.storage_status, 'KRITIS');
  assert.equal(r.approval_status, 'Menunggu');
  assert.equal(r.employee_name_snapshot, 'Siti Operator');
  assert.equal(r.hdd_presence, 'TIDAK_ADA');
  const st = await db.query('SELECT * FROM maintenance_storage_readings WHERE maintenance_record_id=?', [r.id]);
  assert.equal(st.length, 1, 'tidak ada baris HDD (bukan 0%)');
  assert.equal(st[0].evaluated_level, 'KRITIS');
  assert.ok(st[0].storage_device_id, 'storage baru didaftarkan ke aset');
  const bat = await db.one('SELECT * FROM maintenance_battery_readings WHERE maintenance_record_id=?', [r.id]);
  assert.equal(bat.is_applicable, 0); assert.equal(bat.health_percent, null);
  const tasks = await db.query('SELECT status FROM maintenance_tasks WHERE maintenance_record_id=?', [r.id]);
  assert.ok(tasks.every((t) => t.status));
  const att = await db.query('SELECT * FROM maintenance_attachments WHERE maintenance_record_id=?', [r.id]);
  assert.equal(att.length, 2);
  for (const a of att) {
    assert.match(a.stored_path, /^maintenance\/2026-10\/\d+\/[0-9a-f-]{36}\.(png|pdf)$/);
    assert.ok(fs.existsSync(require('../src/services/uploads').absolutePath(a.stored_path)));
    assert.equal(a.sha256.length, 64);
  }
  const fu = await db.one('SELECT * FROM follow_up_actions WHERE maintenance_record_id=?', [r.id]);
  assert.equal(fu.priority, 'Kritis'); assert.equal(fu.is_auto_generated, 1);
  const asset = await db.one('SELECT * FROM assets WHERE id=?', [ids.pc]);
  assert.equal(asset.current_health_status, 'KRITIS');
  assert.equal(asset.last_maintenance_date, '2026-10-01');
  assert.equal(asset.next_maintenance_date, '2026-10-08', 'interval dipersingkat (kritis = 7 hari)');
  const sched = await db.one("SELECT * FROM maintenance_schedules WHERE asset_id=? AND status='Terjadwal'", [ids.pc]);
  assert.equal(sched.scheduled_date, '2026-10-08'); assert.equal(sched.source, 'OTOMATIS');
  ids.rec = r.id; ids.att = att[0].id;
});

test('laptop: baterai wajib; health dihitung dari kapasitas; Tidak Ada HDD', async () => {
  const noBattery = await baseForm(staff.postMultipart('/maintenance'), { assetId: ids.lt, action: 'complete', tasksFor: 'Laptop' })
    .field('cpu_unavailable', '1').field('hdd_presence', 'TIDAK_ADA').field('ssd[0][smart_status]', 'Tidak Tersedia').field('ssd[0][health_percent]', '99')
    .field('physical_condition', 'Baik').field('final_condition', 'Baik');
  assert.equal(noBattery.status, 422);
  assert.ok(noBattery.body.errors['battery[battery_status]']);
  const ok = await baseForm(staff.postMultipart('/maintenance'), { assetId: ids.lt, action: 'complete', tasksFor: 'Laptop' })
    .field('cpu_unavailable', '1').field('hdd_presence', 'TIDAK_ADA').field('ssd[0][smart_status]', 'Baik').field('ssd[0][health_percent]', '99')
    .field('battery[design_capacity_mwh]', '50000').field('battery[full_charge_capacity_mwh]', '45000').field('battery[battery_status]', 'Baik')
    .field('physical_condition', 'Baik').field('final_condition', 'Baik').field('confirm_followup', '0');
  assert.equal(ok.status, 200, ok.text);
  const rec = await db.one('SELECT * FROM maintenance_records WHERE asset_id=? ORDER BY id DESC LIMIT 1', [ids.lt]);
  assert.equal(rec.cpu_temp_c, null, 'CPU tidak terbaca disimpan NULL, bukan 0');
  assert.equal(rec.evaluated_status, 'BAIK');
  assert.equal(rec.approval_status, 'Tidak Diperlukan');
  const b = await db.one('SELECT * FROM maintenance_battery_readings WHERE maintenance_record_id=?', [rec.id]);
  assert.equal(b.health_percent, 90);
  assert.equal((await db.one('SELECT COUNT(*) c FROM follow_up_actions WHERE maintenance_record_id=?', [rec.id])).c, 0);
});

test('persetujuan Manager IT; Staff IT tidak dapat menyetujui; Manager IT tidak mengisi form', async () => {
  assert.equal((await staff.postForm(`/maintenance/${ids.rec}/approve`, { decision: 'Disetujui' })).status, 403);
  assert.equal((await mgr.get('/maintenance/new')).status, 403);
  const noReason = await mgr.postForm(`/maintenance/${ids.rec}/approve`, { decision: 'Ditolak' });
  assert.equal(noReason.status, 422);
  const ok = await mgr.postForm(`/maintenance/${ids.rec}/approve`, { decision: 'Disetujui', approval_notes: 'Segera ganti SSD' });
  assert.equal(ok.status, 200);
  const r = await db.one('SELECT approval_status, approved_by FROM maintenance_records WHERE id=?', [ids.rec]);
  assert.equal(r.approval_status, 'Disetujui');
  // Maintenance Selesai terkunci untuk IT Staff
  assert.equal((await staff.get(`/maintenance/${ids.rec}/edit`)).status, 403);
  assert.equal((await admin.get(`/maintenance/${ids.rec}/edit`)).status, 200);
});

test('riwayat tetap utuh saat pengguna pindah unit', async () => {
  await admin.postForm('/org/units', { department_id: ids.dept, name: 'Lini 2' });
  const u2 = (await db.one("SELECT id FROM work_units WHERE name='Lini 2'")).id;
  await admin.postForm(`/employees/${ids.emp}`, { nik: 'P001', full_name: 'Siti Operator', department_id: ids.dept, work_unit_id: u2, status: 'Aktif' });
  const r = await db.one('SELECT work_unit_snapshot FROM maintenance_records WHERE id=?', [ids.rec]);
  assert.equal(r.work_unit_snapshot, 'Lini 1');
});

test('cetak laporan PDF & akses lampiran sesuai izin', async () => {
  const pdf = await staff.get(`/maintenance/${ids.rec}/print`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.body.slice(0, 5).toString(), '%PDF-');
  assert.ok(pdf.body.length > 5000);
  const img = await staff.get(`/files/${ids.att}`);
  assert.equal(img.status, 200);
  assert.match(img.headers['content-security-policy'], /sandbox/);
  // Tanpa login, file tidak dapat diakses
  const anon = await require('supertest')(app).get(`/files/${ids.att}`);
  assert.equal(anon.status, 302);
});

test('detail aset: 10 tab, grafik dari data nyata', async () => {
  const r = await staff.get(`/assets/${ids.pc}`);
  assert.equal(r.status, 200);
  for (const t of ['Informasi Perangkat', 'Pengguna &amp; Unit', 'Hasil Maintenance', 'Riwayat Suhu', 'Health Storage', 'Baterai', 'Perbaikan &amp; Komponen', 'Perpindahan', 'Dokumentasi', 'Jadwal Berikutnya']) {
    assert.ok(r.text.includes(t), `tab ${t}`);
  }
  assert.match(r.text, /id="cTemp"/);
  const lt = await staff.get(`/assets/${ids.lt}`);
  assert.doesNotMatch(lt.text, /id="cTemp"/, 'tanpa data suhu -> empty state, bukan grafik palsu');
  assert.match(lt.text, /Belum ada data suhu/);
});

test('jadwal: generate otomatis, tidak menggandakan, terlambat terdeteksi', async () => {
  await admin.postMultipart('/assets').field('asset_code', 'ADEV-NEW-0001').field('hostname', 'NEW-01').field('device_type', 'Workstation').field('asset_status', 'Aktif');
  const g = await staff.postForm('/schedules/generate', { start_date: '2026-10-12', spread_per_day: '5' });
  assert.equal(g.status, 200);
  assert.match(g.body.message, /1 jadwal dibuat/);
  const again = await staff.postForm('/schedules/generate', { start_date: '2026-10-12' });
  assert.match(again.body.message, /sudah memiliki jadwal/);
  const s = await db.one("SELECT s.id FROM maintenance_schedules s JOIN assets a ON a.id=s.asset_id WHERE a.asset_code='ADEV-NEW-0001'");
  await staff.postForm(`/schedules/${s.id}`, { scheduled_date: '2026-09-01', status: 'Terjadwal', technician_user_id: String(ids.staff) });
  const late = await staff.get('/schedules?tab=terlambat');
  assert.match(late.text, /ADEV-NEW-0001/);
  const rep = await staff.get('/reports?type=terlambat');
  assert.match(rep.text, /ADEV-NEW-0001/);
  // hapus jadwal: tombol tersedia, jadwal hilang dari daftar, tanggal berikutnya aset ikut diperbarui
  assert.match(late.text, new RegExp(`data-post-url="/schedules/${s.id}/delete"`));
  const del = await staff.postForm(`/schedules/${s.id}/delete`, {});
  assert.equal(del.status, 200, del.text);
  assert.doesNotMatch((await staff.get('/schedules?tab=semua')).text, /ADEV-NEW-0001/);
  assert.equal((await db.one("SELECT next_maintenance_date d FROM assets WHERE asset_code='ADEV-NEW-0001'")).d, null);
  assert.equal((await staff.postForm(`/schedules/${s.id}/delete`, {})).status, 404);
  const done = await db.one("SELECT id FROM maintenance_schedules WHERE status='Selesai' AND deleted_at IS NULL LIMIT 1");
  if (done) assert.equal((await staff.postForm(`/schedules/${done.id}/delete`, {})).status, 422, 'jadwal Selesai tidak dapat dihapus');
});

test('audit log mencatat tindakan penting', async () => {
  const actions = (await db.query('SELECT DISTINCT action FROM audit_logs')).map((a) => a.action);
  for (const a of ['LOGIN', 'CREATE', 'UPDATE', 'APPROVE', 'PRINT', 'GENERATE']) assert.ok(actions.includes(a), a);
});

test('perangkat baru dari form maintenance: otomatis masuk Master Aset PC, Pengguna PC, Unit Kerja & Lokasi', async () => {
  // Form menampilkan mode "Perangkat baru"
  const page = await staff.get('/maintenance/new?mode=new');
  assert.equal(page.status, 200);
  assert.match(page.text, /name="na\[hostname\]"/);
  assert.match(page.text, /data-asset-mode-input/);
  for (const n of ['model', 'serial_number', 'processor', 'employee_nik', 'department_name', 'work_unit_name']) assert.doesNotMatch(page.text, new RegExp(`name="na\\[${n}\\]"`), n);
  for (const n of ['hostname', 'device_type', 'brand', 'employee_name', 'location_name', 'room']) assert.match(page.text, new RegExp(`name="na\\[${n}\\]"`), n);

  // Validasi: hostname & jenis wajib; hostname yang sudah terdaftar ditolak
  const bad = await staff.postMultipart('/maintenance').field('asset_mode', 'new').field('action', 'draft').field('maintenance_date', '2026-10-01')
    .field('na[hostname]', 'PRD-PC-01');
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors['na[device_type]']);
  assert.match(bad.body.errors['na[hostname]'], /ADEV-PRD-PC-0001/);
  assert.equal((await db.one("SELECT COUNT(*) n FROM assets WHERE hostname='PRD-PC-01'")).n, 1);

  // Simpan maintenance Selesai sekaligus mendaftarkan PC baru
  const req = baseForm(staff.postMultipart('/maintenance'), { assetId: '', action: 'complete' })
    .field('asset_mode', 'new')
    .field('na[hostname]', 'KEU-PC-07').field('na[device_type]', 'Desktop PC').field('na[brand]', 'Lenovo').field('na[model]', 'ThinkCentre M70s')
    .field('na[employee_name]', 'Budi Kasir').field('na[department_name]', 'Keuangan').field('na[work_unit_name]', 'Kasir')
    .field('na[location_name]', 'Kantor Pusat').field('na[room]', 'R. Keuangan Lt. 2')
    .field('cpu_temp_c', '48').field('hdd_presence', 'TIDAK_ADA').field('physical_condition', 'Baik').field('final_condition', 'Baik')
    .field('ssd[0][interface]', 'NVMe').field('ssd[0][capacity_gb]', '512').field('ssd[0][temperature_c]', '40').field('ssd[0][health_percent]', '99').field('ssd[0][smart_status]', 'Baik');
  const r = await req;
  assert.equal(r.status, 200, r.text);
  assert.match(r.body.message, /otomatis terdaftar di Master Aset PC/);

  const a = await db.one("SELECT * FROM assets WHERE hostname='KEU-PC-07'");
  assert.match(a.asset_code, /^AST-PC-\d{4}$/);
  assert.equal(a.brand, 'Lenovo');
  assert.equal(a.has_battery, 0);
  assert.equal(a.storage_summary, 'SSD NVMe 512 GB');
  assert.equal(a.last_maintenance_date ? 'ada' : null, 'ada', 'status terkini aset ikut diperbarui');
  const emp = await db.one("SELECT * FROM employees WHERE full_name='Budi Kasir'");
  assert.match(emp.nik, /^AUTO-\d{4}$/);
  const dept = await db.one("SELECT id FROM departments WHERE name='Keuangan'");
  const unit = await db.one('SELECT id FROM work_units WHERE name=? AND department_id=?', ['Kasir', dept.id]);
  const loc = await db.one("SELECT id FROM locations WHERE name='Kantor Pusat'");
  assert.equal(a.current_employee_id, emp.id);
  assert.equal(a.current_department_id, dept.id);
  assert.equal(a.current_work_unit_id, unit.id);
  assert.equal(a.location_id, loc.id);
  const asg = await db.one("SELECT * FROM asset_assignments WHERE asset_id=? AND is_current=1 AND assignment_role='PENGGUNA_UTAMA'", [a.id]);
  assert.equal(asg.room, 'R. Keuangan Lt. 2');
  const rec = await db.one('SELECT * FROM maintenance_records WHERE asset_id=?', [a.id]);
  assert.equal(rec.status, 'Selesai');
  assert.equal(rec.employee_name_snapshot, 'Budi Kasir');
  assert.equal(rec.department_snapshot, 'Keuangan');
  assert.equal(rec.work_unit_snapshot, 'Kasir');
  assert.equal(rec.room_snapshot, 'R. Keuangan Lt. 2');
  assert.equal((await db.one('SELECT COUNT(*) n FROM storage_devices WHERE asset_id=?', [a.id])).n, 1);

  // Nama yang sudah ada dipakai ulang (tidak dobel): pengguna, departemen, unit, lokasi
  const r2 = await staff.postMultipart('/maintenance').field('asset_mode', 'new').field('action', 'draft').field('maintenance_date', '2026-10-02')
    .field('na[hostname]', 'KEU-LT-02').field('na[device_type]', 'Laptop').field('na[asset_code]', 'keu-lt-0002')
    .field('na[employee_name]', 'budi kasir').field('na[department_name]', 'KEUANGAN').field('na[work_unit_name]', 'Kasir').field('na[location_name]', 'Kantor Pusat');
  assert.equal(r2.status, 200, r2.text);
  const lt = await db.one("SELECT * FROM assets WHERE hostname='KEU-LT-02'");
  assert.equal(lt.asset_code, 'KEU-LT-0002');
  assert.equal(lt.has_battery, 1);
  assert.equal(lt.current_employee_id, emp.id);
  assert.equal((await db.one("SELECT COUNT(*) n FROM employees WHERE full_name='Budi Kasir'")).n, 1);
  assert.equal((await db.one("SELECT COUNT(*) n FROM departments WHERE name='Keuangan'")).n, 1);
  assert.equal((await db.one("SELECT COUNT(*) n FROM work_units WHERE name='Kasir'")).n, 1);
  assert.equal((await db.one("SELECT COUNT(*) n FROM locations WHERE name='Kantor Pusat'")).n, 1);

  // Kode aset duplikat ditolak; tidak ada data setengah jadi
  const dup = await staff.postMultipart('/maintenance').field('asset_mode', 'new').field('action', 'draft').field('maintenance_date', '2026-10-02')
    .field('na[hostname]', 'X-01').field('na[device_type]', 'Desktop PC').field('na[asset_code]', 'KEU-LT-0002').field('na[employee_name]', 'Orang Baru');
  assert.equal(dup.status, 422);
  assert.ok(dup.body.errors['na[asset_code]']);
  assert.equal(await db.one("SELECT id FROM employees WHERE full_name='Orang Baru'"), null);

  // Role tanpa izin tambah aset tidak dapat mendaftarkan perangkat
  const staffRole = await db.one("SELECT id FROM roles WHERE code='IT_STAFF'");
  await db.query("DELETE FROM role_permissions WHERE role_id=? AND permission_id IN (SELECT id FROM permissions WHERE code='asset.create')", [staffRole.id]);
  const denied = await staff.postMultipart('/maintenance').field('asset_mode', 'new').field('action', 'draft').field('maintenance_date', '2026-10-02')
    .field('na[hostname]', 'X-02').field('na[device_type]', 'Desktop PC');
  assert.equal(denied.status, 403);
});

test('form ringkas: hanya kondisi akhir, status tindak lanjut & catatan; data kolom lama tidak hilang saat diubah', async () => {
  const page = await admin.get('/maintenance/new');
  for (const n of ['root_cause', 'actions_taken', 'recommendation', 'spare_parts_needed', 'user_complaint', 'follow_up_pic', 'follow_up_target_date', 'next_maintenance_date']) {
    assert.doesNotMatch(page.text, new RegExp(`name="${n}"`), n);
  }
  for (const n of ['final_condition', 'follow_up_status', 'findings']) assert.match(page.text, new RegExp(`name="${n}"`), n);
  assert.match(page.text, /Catatan preventive maintenance/);
  // record lama yang memiliki isian kolom lama
  const asset = await db.one("SELECT id FROM assets WHERE hostname='KEU-PC-07'");
  const d = await admin.postMultipart('/maintenance').field('asset_id', String(asset.id)).field('action', 'draft').field('maintenance_date', '2026-10-03')
    .field('findings', 'Catatan awal').field('root_cause', 'Debu menumpuk').field('recommendation', 'Ganti thermal paste');
  assert.equal(d.status, 200, d.text);
  const rec = await db.one("SELECT id FROM maintenance_records WHERE findings='Catatan awal'");
  const e = await admin.postMultipart(`/maintenance/${rec.id}`).field('action', 'draft').field('maintenance_date', '2026-10-03').field('findings', 'Catatan diperbarui');
  assert.equal(e.status, 200, e.text);
  const after = await db.one('SELECT findings, root_cause, recommendation FROM maintenance_records WHERE id=?', [rec.id]);
  assert.equal(after.findings, 'Catatan diperbarui');
  assert.equal(after.root_cause, 'Debu menumpuk');
  assert.equal(after.recommendation, 'Ganti thermal paste');
  const show = await admin.get(`/maintenance/${rec.id}`);
  assert.match(show.text, /Catatan diperbarui/);
  assert.match(show.text, /Debu menumpuk/);
});

test('perangkat baru: isian "-" dianggap kosong, nama pengguna kembar tidak memblokir', async () => {
  const r = await admin.postMultipart('/maintenance').field('asset_mode', 'new').field('action', 'draft').field('maintenance_date', '2026-10-04')
    .field('na[hostname]', 'PC farmasi -2').field('na[device_type]', 'Desktop PC').field('na[brand]', 'MSI').field('na[serial_number]', '-').field('na[employee_nik]', '-')
    .field('na[employee_name]', 'Perawat 2').field('na[department_name]', '-').field('na[location_name]', 'gedung A').field('na[room]', 'farmasi');
  assert.equal(r.status, 200, r.text);
  const a = await db.one("SELECT serial_number, brand, current_department_id FROM assets WHERE hostname='PC farmasi -2'");
  assert.equal(a.serial_number, null);
  assert.equal(a.brand, 'MSI');
  assert.equal(a.current_department_id, null);
  const e = await db.one("SELECT nik FROM employees WHERE full_name='Perawat 2'");
  assert.match(e.nik, /^AUTO-/);
  assert.equal(await db.one("SELECT id FROM departments WHERE name='-'"), null);
  // PC kedua dengan serial "-" juga lolos (tidak dianggap duplikat)
  const r2 = await admin.postMultipart('/maintenance').field('asset_mode', 'new').field('action', 'draft').field('maintenance_date', '2026-10-04')
    .field('na[hostname]', 'PC farmasi -3').field('na[device_type]', 'Desktop PC').field('na[serial_number]', '-').field('na[employee_name]', 'Perawat 2');
  assert.equal(r2.status, 200, r2.text);
  assert.equal((await db.one("SELECT COUNT(*) n FROM employees WHERE full_name='Perawat 2'")).n, 1);
});

test('form storage ringkas: hanya kapasitas, suhu, health, SMART; data storage terdaftar tetap terbawa', async () => {
  const page = await admin.get('/maintenance/new');
  const visible = page.text.replace(/<input type="hidden"[^>]*>/g, '');
  for (const n of ['cpu_reading_tool', 'ssd[0][serial_number]', 'ssd[0][used_percent]', 'ssd[0][reading_tool]', 'ssd[0][brand]', 'ssd[0][model]', 'ssd[0][interface]']) assert.ok(!visible.includes(`name="${n}"`), n);
  for (const n of ['ssd[0][capacity_gb]', 'ssd[0][temperature_c]', 'ssd[0][health_percent]', 'ssd[0][smart_status]']) assert.ok(visible.includes(`name="${n}"`), n);
  // Storage terdaftar: merek & model lama tampil gabung
  const pc = await db.one("SELECT id FROM assets WHERE hostname='KEU-PC-07'");
  await db.query("UPDATE storage_devices SET brand='Samsung', model='980 EVO' WHERE asset_id=?", [pc.id]);
  const withCtx = await admin.get(`/maintenance/new?asset_id=${pc.id}`);
  assert.match(withCtx.text, /value="Samsung 980 EVO"/);
});

test('Ada SSD / Tidak Ada SSD: tanpa SSD disimpan NULL (bukan 0); SSD & HDD tidak boleh sama-sama tidak ada', async () => {
  const pc = await db.one("SELECT id FROM assets WHERE hostname='GDG-PC-01' OR hostname='KEU-PC-07' ORDER BY id LIMIT 1");
  const base = (req) => baseForm(req, { assetId: pc.id, action: 'complete' }).field('cpu_temp_c', '50').field('physical_condition', 'Baik').field('final_condition', 'Baik')
    .field('maintenance_date', '2026-10-05');
  const both = await base(admin.postMultipart('/maintenance')).field('ssd_presence', 'TIDAK_ADA').field('hdd_presence', 'TIDAK_ADA');
  assert.equal(both.status, 422);
  assert.match(both.body.errors.storage, /SSD atau HDD/);
  const noPick = await base(admin.postMultipart('/maintenance')).field('hdd_presence', 'ADA').field('hdd[0][health_percent]', '95').field('hdd[0][smart_status]', 'Baik');
  assert.equal(noPick.status, 422);
  assert.ok(noPick.body.errors.ssd_presence);
  const ok = await base(admin.postMultipart('/maintenance')).field('ssd_presence', 'TIDAK_ADA').field('ssd[0][health_percent]', '0')
    .field('hdd_presence', 'ADA').field('hdd[0][health_percent]', '95').field('hdd[0][temperature_c]', '38').field('hdd[0][smart_status]', 'Baik');
  assert.equal(ok.status, 200, ok.text);
  const rec = await db.one("SELECT id, ssd_presence FROM maintenance_records WHERE asset_id=? AND maintenance_date='2026-10-05' AND status='Selesai'", [pc.id]);
  assert.equal(rec.ssd_presence, 'TIDAK_ADA');
  const rows = await db.query('SELECT storage_type FROM maintenance_storage_readings WHERE maintenance_record_id=?', [rec.id]);
  assert.deepEqual(rows.map((x) => x.storage_type), ['HDD']);
  const show = await admin.get(`/maintenance/${rec.id}`);
  assert.match(show.text, /Tidak Ada SSD/);
  const page = await admin.get('/maintenance/new');
  assert.match(page.text, /id="ssdYes"/);
  assert.match(page.text, /id="ssdNo"/);
});

test('form ringkas: tombol Draft / Simpan Selesai / Selesai & Cetak, baterai cukup health + status', async () => {
  const page = await admin.get(`/maintenance/new?asset_id=${ids.lt}`);
  assert.doesNotMatch(page.text, /data-status-select/);
  assert.match(page.text, /value="complete_print"/);
  assert.match(page.text, /data-mark-all="Sudah dilakukan"/);
  const visible = page.text.replace(/<input type="hidden"[^>]*>/g, '');
  for (const n of ['battery[design_capacity_mwh]', 'battery[full_charge_capacity_mwh]', 'battery[cycle_count]', 'battery[notes]']) assert.ok(!visible.includes(`name="${n}"`), n);
  for (const n of ['battery[health_percent]', 'battery[battery_status]']) assert.ok(visible.includes(`name="${n}"`), n);
  // "Selesai & Cetak" divalidasi sebagai Selesai
  const r = await admin.postMultipart('/maintenance').field('asset_id', String(ids.lt)).field('action', 'complete_print').field('maintenance_date', '2026-10-06');
  assert.equal(r.status, 422);
  assert.ok(r.body.errors.final_condition);
});
