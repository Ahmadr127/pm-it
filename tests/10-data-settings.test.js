'use strict';
// Pengaturan Data: unit kerja, lokasi kerja, kode aset (Administrator & Manager IT)
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let app; let admin; let mgr; let staff; let db;
test.before(async () => {
  app = await H.setup(); db = require('../src/config/db'); admin = await H.adminAgent(app);
  mgr = await H.createUser(app, admin, { username: 'mgrset', role: 'MANAGER_IT' });
  staff = await H.createUser(app, admin, { username: 'staffset', role: 'IT_STAFF' });
});
test.after(async () => { await H.teardown(app); });

test('menu & akses: Administrator dan Manager IT boleh, Staff IT tidak', async () => {
  for (const ag of [admin, mgr]) {
    const r = await ag.get('/pengaturan');
    assert.equal(r.status, 200);
    assert.match(r.text, /href="\/pengaturan"/);
    assert.match(r.text, /Tambah unit kerja/);
  }
  assert.equal((await staff.get('/pengaturan')).status, 403);
  assert.equal((await staff.postForm('/pengaturan/units', { name: 'X' })).status, 403);
});

test('unit kerja: tambah tanpa departemen (Umum), ubah, tolak duplikat, tidak bisa hapus bila dipakai', async () => {
  const r = await mgr.postForm('/pengaturan/units', { name: 'Farmasi' });
  assert.equal(r.status, 200, r.text);
  const u = await db.one("SELECT w.id, d.name dept FROM work_units w JOIN departments d ON d.id=w.department_id WHERE w.name='Farmasi' AND w.deleted_at IS NULL");
  assert.equal(u.dept, 'Umum');
  assert.equal((await mgr.postForm('/pengaturan/units', { name: 'Farmasi' })).status, 422);
  assert.equal((await mgr.postForm('/pengaturan/units', { name: '' })).status, 422);
  const upd = await mgr.postForm(`/pengaturan/units/${u.id}`, { name: 'Farmasi Rawat Jalan', department_name: 'Penunjang Medis' });
  assert.equal(upd.status, 200, upd.text);
  const u2 = await db.one('SELECT w.name, d.name dept FROM work_units w JOIN departments d ON d.id=w.department_id WHERE w.id=?', [u.id]);
  assert.deepEqual({ ...u2 }, { name: 'Farmasi Rawat Jalan', dept: 'Penunjang Medis' });
  await admin.postForm('/employees', { nik: 'PS01', full_name: 'Perawat Satu', work_unit_id: String(u.id), status: 'Aktif' });
  const blocked = await mgr.postForm(`/pengaturan/units/${u.id}/delete`, {});
  assert.equal(blocked.status, 422);
  assert.match(blocked.body.message, /masih dipakai 1 pengguna/);
  await mgr.postForm('/pengaturan/units', { name: 'Gudang' });
  const g = await db.one("SELECT id FROM work_units WHERE name='Gudang'");
  assert.equal((await mgr.postForm(`/pengaturan/units/${g.id}/delete`, {})).status, 200);
  assert.doesNotMatch((await mgr.get('/pengaturan?tab=unit')).text, />Gudang</);
  // nama yang pernah dihapus dapat dipakai lagi
  assert.equal((await mgr.postForm('/pengaturan/units', { name: 'Gudang' })).status, 200);
});

test('lokasi kerja: tambah, ubah, tolak duplikat, tidak bisa hapus bila dipakai perangkat', async () => {
  assert.equal((await admin.postForm('/pengaturan/locations', { name: 'Gedung Utama', building: 'A', floor: '2', room: 'Nurse Station' })).status, 200);
  const l = await db.one("SELECT id FROM locations WHERE name='Gedung Utama'");
  assert.equal((await admin.postForm('/pengaturan/locations', { name: 'Gedung Utama', building: 'A', room: 'Nurse Station' })).status, 422);
  assert.equal((await admin.postForm(`/pengaturan/locations/${l.id}`, { name: 'Gedung Utama', building: 'B', floor: '3', room: 'IGD' })).status, 200);
  assert.equal((await db.one('SELECT building FROM locations WHERE id=?', [l.id])).building, 'B');
  await admin.postMultipart('/assets').field('device_type', 'Desktop PC').field('asset_status', 'Aktif').field('location_id', String(l.id));
  const del = await admin.postForm(`/pengaturan/locations/${l.id}/delete`, {});
  assert.equal(del.status, 422);
  assert.match(del.body.message, /1 perangkat/);
  await admin.postForm('/pengaturan/locations', { name: 'Gudang Lama' });
  const g = await db.one("SELECT id FROM locations WHERE name='Gudang Lama'");
  assert.equal((await admin.postForm(`/pengaturan/locations/${g.id}/delete`, {})).status, 200);
});

test('kode aset: ganti kode otomatis ke kode resmi, nama perangkat ikut, kode kembar ditolak', async () => {
  await admin.postMultipart('/assets').field('device_type', 'Laptop').field('asset_status', 'Aktif');
  const a = await db.one("SELECT id, asset_code, hostname FROM assets WHERE device_type='Laptop' ORDER BY id DESC LIMIT 1");
  assert.match(a.asset_code, /^AST-/);
  const page = await mgr.get('/pengaturan?tab=kode');
  assert.match(page.text, new RegExp(`action="/pengaturan/asset-code/${a.id}"`));
  const r = await mgr.postForm(`/pengaturan/asset-code/${a.id}`, { asset_code: 'rsa-it-lt-001' });
  assert.equal(r.status, 200, r.text);
  const b = await db.one('SELECT asset_code, hostname FROM assets WHERE id=?', [a.id]);
  assert.equal(b.asset_code, 'RSA-IT-LT-001');
  assert.equal(b.hostname, 'RSA-IT-LT-001', 'nama otomatis ikut diganti');
  const other = await db.one('SELECT id FROM assets WHERE id<>? AND deleted_at IS NULL LIMIT 1', [a.id]);
  const dup = await mgr.postForm(`/pengaturan/asset-code/${other.id}`, { asset_code: 'RSA-IT-LT-001' });
  assert.equal(dup.status, 422);
  assert.match(dup.body.errors.asset_code, /sudah dipakai/);
  assert.equal((await mgr.postForm(`/pengaturan/asset-code/${a.id}`, { asset_code: 'kode salah!' })).status, 422);
  assert.match((await mgr.get('/pengaturan?tab=kode&q=RSA-IT')).text, /RSA-IT-LT-001/);
  const log = await db.one("SELECT description FROM audit_logs WHERE entity_type='assets' AND entity_id=? ORDER BY id DESC LIMIT 1", [String(a.id)]);
  assert.match(log.description, /diganti menjadi RSA-IT-LT-001/);
});
