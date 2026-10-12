'use strict';
// HTTPS lokal (sertifikat buatan sendiri), halaman akses HP, dan label QR
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const request = require('supertest');
const H = require('./helpers');

let app; let admin; let db;
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmit-certs-'));
test.before(async () => { app = await H.setup(); db = require('../src/config/db'); admin = await H.adminAgent(app); });
test.after(async () => { await H.teardown(app); fs.rmSync(certDir, { recursive: true, force: true }); });

test('sertifikat CA & server valid, dipakai ulang, HTTPS dapat diakses dengan CA', async () => {
  const tls = require('../src/services/tls');
  const r = tls.ensureCertificates(certDir);
  const ca = new crypto.X509Certificate(r.caPem);
  const srv = new crypto.X509Certificate(r.cert.toString().split(/(?=-----BEGIN CERTIFICATE-----)/)[0]);
  assert.ok(ca.ca);
  assert.ok(srv.verify(ca.publicKey), 'server ditandatangani CA');
  assert.equal(srv.checkIP('127.0.0.1'), '127.0.0.1');
  assert.equal(srv.checkHost('localhost'), 'localhost');
  const days = (new Date(srv.validTo) - Date.now()) / 864e5;
  assert.ok(days > 390 && days < 399, 'masa berlaku ≤ 398 hari');
  assert.ok(r.cert.equals(tls.ensureCertificates(certDir).cert), 'tidak dibuat ulang tanpa perubahan');
  // Server HTTPS nyata + klien yang hanya mempercayai CA lokal
  app.locals.tls = { caPem: r.caPem, ips: r.ips, port: 0 };
  const server = https.createServer({ key: r.key, cert: r.cert }, app);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const status = await new Promise((ok, fail) => {
    https.get({ host: '127.0.0.1', port: server.address().port, path: '/login', ca: r.caPem }, (res) => { res.resume(); ok(res.statusCode); }).on('error', fail);
  });
  server.close();
  assert.equal(status, 200);
  const der = await request(app).get('/ca.crt').buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(der.status, 200);
  assert.match(der.headers['content-type'], /x509-ca-cert/);
  assert.ok(new crypto.X509Certificate(der.body).ca);
});

test('halaman akses HP menampilkan alamat & QR', async () => {
  const r = await admin.get('/akses-perangkat');
  assert.equal(r.status, 200);
  assert.match(r.text, /<svg/);
  assert.match(r.text, /6-IZINKAN-AKSES-HP\.bat/);
  // alamat manual dari Pengaturan Sistem dipakai di QR/label
  await db.query("INSERT INTO app_settings (setting_key, setting_value) VALUES ('public_base_url','https://pmit.kantor.local:3443') ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)");
  require('../src/services/settings').invalidate();
  assert.match((await admin.get('/akses-perangkat')).text, /https:\/\/pmit\.kantor\.local:3443/);
});

test('label QR: satu label per PC, QR berisi alamat form maintenance PC tsb', async () => {
  for (const h of ['LBL-PC-01', 'LBL-PC-02']) await admin.postMultipart('/assets').field('hostname', h).field('device_type', 'Desktop PC').field('asset_status', 'Aktif');
  const ids = (await db.query("SELECT id FROM assets WHERE hostname LIKE 'LBL-PC-%' ORDER BY id")).map((x) => x.id);
  const all = await admin.get('/assets/labels?q=LBL-PC');
  assert.equal(all.status, 200);
  assert.equal((all.text.match(/class="label"/g) || []).length, 2);
  assert.match(all.text, /LBL-PC-01/);
  const one = await admin.get(`/assets/labels?ids=${ids[1]}`);
  assert.equal((one.text.match(/<svg/g) || []).length, 1);
  assert.match(one.text, /LBL-PC-02/);
  assert.doesNotMatch(one.text, /LBL-PC-01/);
  const { qrSvg } = require('../src/utils/qr');
  assert.ok(one.text.includes(qrSvg(`https://pmit.kantor.local:3443/s/${ids[1]}`)), 'QR memakai alamat dari pengaturan + id aset');
  assert.match((await admin.get('/assets')).text, /\/assets\/labels/);
});
