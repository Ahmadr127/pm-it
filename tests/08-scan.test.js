'use strict';
// Scan QR di dalam aplikasi: hasil scan (pemilik terdaftar + riwayat) dan pencatatan PC yang ditukar tanpa izin
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let app; let admin; let db; let id;
test.before(async () => {
  app = await H.setup(); db = require('../src/config/db'); admin = await H.adminAgent(app);
  await admin.postMultipart('/assets').field('hostname', 'SCAN-PC-01').field('device_type', 'Desktop PC').field('asset_status', 'Aktif');
  id = (await db.one("SELECT id FROM assets WHERE hostname='SCAN-PC-01'")).id;
});
test.after(async () => { await H.teardown(app); });

test('halaman pemindai & menu tersedia', async () => {
  const r = await admin.get('/scan');
  assert.equal(r.status, 200);
  assert.match(r.text, /data-scan-video/);
  assert.match(r.text, /vendor\/jsQR\.js/);
  assert.match(r.text, /href="\/scan"/);
});

test('cari manual: hostname → hasil scan; tidak ditemukan → kembali ke /scan', async () => {
  const r = await admin.get('/s?q=SCAN-PC-01');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, `/s/${id}`);
  const miss = await admin.get('/s?q=TIDAK-ADA-999');
  assert.equal(miss.headers.location, '/scan');
  assert.equal((await admin.get('/s/999999')).status, 404);
});

test('catat pemegang, lalu PC ditukar tanpa izin: riwayat menyimpan pemilik lama + tindak lanjut dibuat', async () => {
  const first = await admin.postForm(`/s/${id}/pindah`, { employee_name: 'Ns. Rina', location_name: 'Rawat Inap Lt 2', room: 'Nurse Station', reason_type: 'Koreksi data' });
  assert.equal(first.status, 200, first.text);
  let page = await admin.get(`/s/${id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Terdaftar untuk[\s\S]*Ns\. Rina/);

  const empty = await admin.postForm(`/s/${id}/pindah`, { reason_type: 'Koreksi data' });
  assert.equal(empty.status, 422);
  const badReason = await admin.postForm(`/s/${id}/pindah`, { employee_name: 'X', reason_type: 'asal' });
  assert.equal(badReason.status, 422);

  const moved = await admin.postForm(`/s/${id}/pindah`, { employee_name: 'Ns. Dewi', reason_type: 'Dipindah / ditukar tanpa izin', notes: 'ditemukan di IGD' });
  assert.equal(moved.status, 200, moved.text);
  assert.match(moved.body.message, /Tindak lanjut/);

  const rows = await db.query("SELECT employee_name_snapshot, location_text_snapshot, room, is_current FROM asset_assignments WHERE asset_id=? AND assignment_role='PENGGUNA_UTAMA' ORDER BY id", [id]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].employee_name_snapshot, 'Ns. Rina');
  assert.equal(rows[0].is_current, 0);
  assert.equal(rows[1].employee_name_snapshot, 'Ns. Dewi');
  assert.equal(rows[1].is_current, 1);
  assert.match(rows[1].location_text_snapshot || '', /Rawat Inap Lt 2/, 'lokasi lama dipakai bila tidak diisi');
  assert.equal(rows[1].room, 'Nurse Station');

  const fu = await db.one('SELECT title, description FROM follow_up_actions WHERE asset_id=?', [id]);
  assert.match(fu.title, /SCAN-PC-01 dipindah \/ ditukar tanpa izin/);
  assert.match(fu.description, /Ns\. Rina/);
  assert.match(fu.description, /Ns\. Dewi/);

  page = await admin.get(`/s/${id}`);
  assert.match(page.text, /Terdaftar untuk[\s\S]*Ns\. Dewi/);
  assert.match(page.text, /data-scan-history[\s\S]*Ns\. Dewi[\s\S]*Ns\. Rina/);
  assert.match(page.text, /ditukar tanpa izin: ditemukan di IGD/);
  // Data aset ikut menampilkan pengguna terbaru
  assert.match((await admin.get(`/assets/${id}`)).text, /Ns\. Dewi/);
});

test('Manager IT boleh melihat hasil scan tetapi tidak dapat mencatat perpindahan', async () => {
  const mgr = await H.createUser(app, admin, { username: 'mgrscan', role: 'MANAGER_IT' });
  const page = await mgr.get(`/s/${id}`);
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /\/pindah"/);
  const r = await mgr.postForm(`/s/${id}/pindah`, { employee_name: 'Siapa', reason_type: 'Koreksi data' });
  assert.equal(r.status, 403);
});
