'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const H = require('./helpers');

let app; let admin; let db;
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

test.before(async () => {
  app = await H.setup();
  db = require('../src/config/db');
  admin = await H.adminAgent(app);
  // Gunakan data demonstrasi (dibuat lewat service yang sama) sebagai bahan laporan
  const r = await admin.postForm('/admin/settings/demo/load', {});
  assert.equal(r.status, 200, r.text);
});
test.after(async () => { await H.teardown(app); });

test('seluruh halaman utama dapat dibuka (admin)', async () => {
  const asset = await db.one('SELECT id FROM assets LIMIT 1');
  const rec = await db.one("SELECT id FROM maintenance_records WHERE status='Selesai' LIMIT 1");
  const emp = await db.one('SELECT id FROM employees LIMIT 1');
  const pages = ['/', '/assets', '/assets/new', `/assets/${asset.id}`, `/assets/${asset.id}/edit`, '/assets/import', '/employees', `/employees/${emp.id}`, '/pengaturan', '/pengaturan?tab=lokasi', '/pengaturan?tab=kode', '/org?tab=departemen',
    '/maintenance', '/maintenance/new', `/maintenance/new?asset_id=${asset.id}`, `/maintenance/${rec.id}`, `/maintenance/${rec.id}?print=1`, `/maintenance/${rec.id}/edit`,
    '/schedules', '/schedules?tab=terlambat', '/schedules?tab=selesai', '/follow-ups', '/follow-ups?status=all', '/reports',
    '/admin/thresholds', '/admin/settings', '/admin/users', '/admin/roles', '/admin/audit', '/password',
    '/?from=2026-01-01&to=2026-10-09&device_type=Laptop', '/assets?sort=health&dir=desc&health=KRITIS', '/maintenance?sort=eval&evaluated_status=KRITIS'];
  for (const p of pages) {
    const r = await admin.get(p);
    assert.equal(r.status, 200, `${p} -> ${r.status} ${r.text.slice(0, 300)}`);
  }
  for (const t of ['hasil', 'ringkasan', 'per-aset', 'perbaikan', 'storage', 'terlambat', 'penggunaan']) {
    const r = await admin.get(`/reports?type=${t}&all=1`);
    assert.equal(r.status, 200, t);
  }
  assert.equal((await admin.get('/tidak-ada')).status, 404);
  assert.equal((await admin.get('/assets/999999')).status, 404);
});

test('dashboard menampilkan statistik nyata', async () => {
  const r = await admin.get('/');
  const total = (await db.one('SELECT COUNT(*) c FROM assets WHERE deleted_at IS NULL')).c;
  assert.match(r.text, new RegExp(`<div class="stat-value">${total}</div>`));
  assert.match(r.text, /id="cMonthly"/);
  assert.match(r.text, /Perangkat yang membutuhkan tindakan IT/);
});

test('ekspor laporan PDF, Excel, CSV untuk semua jenis', async () => {
  for (const t of ['hasil', 'ringkasan', 'perbaikan', 'storage', 'terlambat', 'penggunaan']) {
    const pdf = await admin.get(`/reports/export?type=${t}&all=1&fmt=pdf`).buffer(true).parse(binary);
    assert.equal(pdf.status, 200, `${t} pdf`);
    assert.equal(pdf.body.slice(0, 5).toString(), '%PDF-');
    const x = await admin.get(`/reports/export?type=${t}&all=1&fmt=xlsx`).buffer(true).parse(binary);
    assert.equal(x.status, 200); assert.equal(x.body.slice(0, 2).toString(), 'PK');
    const c = await admin.get(`/reports/export?type=${t}&all=1&fmt=csv`);
    assert.equal(c.status, 200); assert.match(c.headers['content-type'], /text\/csv/);
  }
  const per = await admin.get('/reports?type=per-aset&asset_q=ADEV-LT-0016');
  assert.equal(per.status, 200);
});

test('CSV aman dari formula injection', async () => {
  const exporter = require('../src/services/exporter');
  const csv = exporter.toCsv([{ header: 'A', key: 'a' }, { header: 'B', key: 'b' }], [{ a: '=HYPERLINK("http://x")', b: -5 }]).toString();
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /,-5\r\n/);
});

test('fitur agent hardware sudah dihapus', async () => {
  assert.equal((await admin.get('/admin/agent')).status, 404);
  assert.equal((await request(app).post('/api/agent/readings').send({})).status, 403);
  const home = await admin.get('/');
  assert.doesNotMatch(home.text, /Agent Hardware/);
});

test('hapus data demo membersihkan seluruh data contoh', async () => {
  const r = await admin.postForm('/admin/settings/demo/remove', {});
  assert.equal(r.status, 200);
  for (const t of ['assets', 'employees', 'maintenance_records', 'maintenance_schedules', 'follow_up_actions', 'asset_assignments', 'demo_registry']) {
    assert.equal((await db.one(`SELECT COUNT(*) c FROM ${t}`)).c, 0, t);
  }
  assert.equal((await db.one("SELECT COUNT(*) c FROM users WHERE username LIKE 'demo.%'")).c, 0);
  assert.equal((await db.one("SELECT COUNT(*) c FROM users WHERE username='admin'")).c, 1);
  assert.equal((await admin.get('/')).status, 200, 'dashboard tetap jalan dengan data kosong');
  assert.match((await admin.get('/assets/1')).status === 404 ? 'ok' : 'x', /ok/);
});

test('PWA: manifest, service worker, ikon & halaman offline tersedia', async () => {
  const m = await request(app).get('/manifest.webmanifest');
  assert.equal(m.status, 200);
  assert.match(m.headers['content-type'], /manifest\+json/);
  const man = JSON.parse(m.text);
  assert.equal(man.display, 'standalone');
  assert.equal(man.start_url, '/');
  assert.ok(man.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of man.icons) assert.equal((await request(app).get(i.src)).status, 200, i.src);
  const sw = await request(app).get('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers['content-type'], /javascript/);
  assert.doesNotMatch(sw.text, /__VERSION__/);
  assert.equal((await request(app).get('/static/offline.html')).status, 200);
  const login = await request(app).get('/login');
  assert.match(login.text, /rel="manifest"/);
  assert.match(login.text, /pwa\.js/);
  const home = await admin.get('/');
  assert.match(home.text, /data-install-app/);
});
