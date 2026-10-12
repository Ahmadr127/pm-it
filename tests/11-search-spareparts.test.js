'use strict';
// Pencarian cepat, stok spare part, menu ringkas & halaman Perangkat Lain
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let app; let admin; let staff; let db; let assetId; let partId;
test.before(async () => {
  app = await H.setup(); db = require('../src/config/db'); admin = await H.adminAgent(app);
  staff = await H.createUser(app, admin, { username: 'staffsp', role: 'IT_STAFF' });
  await admin.postForm('/pengaturan/units', { name: 'Instalasi Farmasi' });
  const unit = await db.one("SELECT id FROM work_units WHERE name='Instalasi Farmasi'");
  await admin.postMultipart('/assets').field('device_type', 'Desktop PC').field('asset_status', 'Aktif');
  assetId = (await db.one('SELECT id FROM assets ORDER BY id DESC LIMIT 1')).id;
  await admin.postForm('/employees', { nik: 'F001', full_name: 'Apt. Ratna Sari', work_unit_id: String(unit.id), status: 'Aktif', asset_id: String(assetId), start_date: '2026-10-01', usage_status: 'Aktif', assignment_role: 'PENGGUNA_UTAMA' });
});
test.after(async () => { await H.teardown(app); });

test('menu: Master Unit Kerja tidak dobel, Pengguna PC di Inventaris, Perangkat Lain tersedia', async () => {
  const page = await admin.get('/');
  assert.doesNotMatch(page.text, /href="\/org"/);
  assert.match(page.text, /href="\/pengaturan"/);
  assert.match(page.text, /href="\/spare-parts"/);
  assert.match(page.text, /data-gsearch-input/);
  const r = await admin.get('/org');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/pengaturan?tab=unit');
  const other = await staff.get('/perangkat-lain');
  assert.equal(other.status, 200);
  assert.match(other.text, /sedang disiapkan/);
});

test('nama perangkat sama dengan kode aset tidak ditampilkan dobel', async () => {
  const a = await db.one('SELECT asset_code, hostname FROM assets WHERE id=?', [assetId]);
  assert.equal(a.hostname, a.asset_code);
  const list = await admin.get('/assets');
  const row = list.text.slice(list.text.indexOf(a.asset_code));
  assert.doesNotMatch(row.slice(0, 600), new RegExp(`fw-semibold">${a.asset_code}<`));
});

test('pencarian cepat: kode aset, nama pengguna, unit kerja; pengguna PC; minimal 2 huruf', async () => {
  const code = (await db.one('SELECT asset_code FROM assets WHERE id=?', [assetId])).asset_code;
  const byCode = (await admin.get(`/api/search?q=${code}`)).body;
  assert.equal(byCode.assets[0].id, assetId);
  const byUser = (await admin.get('/api/search?q=Ratna')).body;
  assert.equal(byUser.assets[0].id, assetId);
  assert.match(byUser.assets[0].sub, /Apt\. Ratna Sari/);
  assert.equal(byUser.employees[0].name, 'Apt. Ratna Sari');
  assert.match(byUser.employees[0].sub, /1 perangkat/);
  assert.equal((await admin.get('/api/search?q=farmasi')).body.assets[0].id, assetId);
  const short = (await admin.get('/api/search?q=a')).body;
  assert.deepEqual([short.assets.length, short.employees.length], [0, 0]);
  assert.equal((await admin.get('/api/search?q=%25%25%25')).status, 200);
});

test('spare part: tambah dengan stok awal, masuk, pakai untuk PC, tidak boleh minus, koreksi', async () => {
  const add = await staff.postForm('/spare-parts', { name: 'Thermal paste MX-4', category: 'Bahan perawatan', unit: 'tube', stock: '3', min_stock: '2' });
  assert.equal(add.status, 200, add.text);
  partId = (await db.one("SELECT id FROM spare_parts WHERE name='Thermal paste MX-4'")).id;
  assert.equal((await staff.postForm('/spare-parts', { name: 'Thermal paste MX-4' })).status, 422, 'nama kembar ditolak');
  assert.equal((await staff.postForm(`/spare-parts/${partId}/stock`, { movement_type: 'MASUK', qty: '5', note: 'Pembelian Oktober' })).status, 200);
  const use = await staff.postForm(`/spare-parts/${partId}/stock`, { movement_type: 'KELUAR', qty: '6', asset_id: String(assetId) });
  assert.equal(use.status, 200, use.text);
  assert.equal((await db.one('SELECT stock FROM spare_parts WHERE id=?', [partId])).stock, 2);
  const over = await staff.postForm(`/spare-parts/${partId}/stock`, { movement_type: 'KELUAR', qty: '3' });
  assert.equal(over.status, 422);
  assert.match(over.body.errors.qty, /tidak cukup \(tersisa 2 tube\)/);
  assert.equal((await staff.postForm(`/spare-parts/${partId}/stock`, { movement_type: 'KOREKSI', qty: '1' })).status, 422, 'koreksi wajib alasan');
  assert.equal((await staff.postForm(`/spare-parts/${partId}/stock`, { movement_type: 'KOREKSI', qty: '1', note: 'Hitung fisik' })).status, 200);
  const moves = await db.query('SELECT movement_type, qty, stock_after, asset_id FROM spare_part_movements WHERE spare_part_id=? ORDER BY id', [partId]);
  assert.deepEqual(moves.map((m) => [m.movement_type, m.qty, m.stock_after]), [['MASUK', 3, 3], ['MASUK', 5, 8], ['KELUAR', 6, 2], ['KOREKSI', -1, 1]]);
  assert.equal(moves[2].asset_id, assetId);
  // stok menipis -> notifikasi & filter
  const list = await staff.get('/spare-parts?filter=menipis');
  assert.match(list.text, /Thermal paste MX-4/);
  assert.match(list.text, /Menipis/);
  assert.match((await staff.get('/')).text, /spare part stoknya menipis/);
  const detail = await staff.get(`/spare-parts/${partId}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Pembelian Oktober/);
});

test('spare part dari laporan maintenance: tercatat ke laporan & PC, stok berkurang', async () => {
  const draft = await staff.postMultipart('/maintenance').field('asset_id', String(assetId)).field('maintenance_date', '2026-10-10').field('action', 'draft');
  assert.equal(draft.status, 200, draft.text);
  const rec = await db.one('SELECT id FROM maintenance_records WHERE asset_id=? ORDER BY id DESC LIMIT 1', [assetId]);
  const page = await staff.get(`/maintenance/${rec.id}`);
  assert.match(page.text, /Spare part dipakai/);
  assert.match(page.text, /Thermal paste MX-4 \(stok 1 tube\)/);
  const r = await staff.postForm('/spare-parts/use', { spare_part_id: String(partId), qty: '1', maintenance_record_id: String(rec.id), note: 'Ganti pasta CPU' });
  assert.equal(r.status, 200, r.text);
  const m = await db.one('SELECT asset_id, maintenance_record_id FROM spare_part_movements WHERE note=?', ['Ganti pasta CPU']);
  assert.deepEqual({ ...m }, { asset_id: assetId, maintenance_record_id: rec.id });
  assert.equal((await db.one('SELECT stock FROM spare_parts WHERE id=?', [partId])).stock, 0);
  assert.match((await staff.get(`/maintenance/${rec.id}`)).text, /data-spare-used[\s\S]*Thermal paste MX-4[\s\S]*Ganti pasta CPU/);
  assert.equal((await staff.postForm('/spare-parts/use', { spare_part_id: String(partId), qty: '1', maintenance_record_id: String(rec.id) })).status, 422, 'stok habis');
});

test('spare part: hapus (riwayat tetap), Manager IT boleh melihat', async () => {
  const mgr = await H.createUser(app, admin, { username: 'mgrsp', role: 'MANAGER_IT' });
  assert.equal((await mgr.get('/spare-parts')).status, 200);
  assert.equal((await admin.postForm(`/spare-parts/${partId}/delete`, {})).status, 200);
  assert.doesNotMatch((await admin.get('/spare-parts')).text, /Thermal paste MX-4<\/a>/);
  assert.ok((await db.one('SELECT COUNT(*) c FROM spare_part_movements WHERE spare_part_id=?', [partId])).c >= 5);
});
