'use strict';
// Backup & pemulihan data dari menu Administrasi > Backup Data
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');

let app; let admin; let db; let backup; let config;
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const inserts = (sql, table) => sql.toString('utf8').split('\n').filter((l) => l.startsWith(`INSERT INTO \`${table}\``)).join('\n');

test.before(async () => {
  app = await H.setup(); db = require('../src/config/db'); backup = require('../src/services/backup'); config = require('../src/config');
  fs.rmSync(config.backup.dir, { recursive: true, force: true });
  admin = await H.adminAgent(app);
  await admin.postMultipart('/assets').field('hostname', "PC-O'BRIEN-01").field('device_type', 'Desktop PC').field('asset_status', 'Aktif')
    .field('notes', 'Baris 1\nBaris 2; titik koma;\n-- bukan komentar\r\nEmoji 🖥️ & "kutip" \\ backslash');
  fs.mkdirSync(path.join(config.upload.dir, 'uji'), { recursive: true });
  fs.writeFileSync(path.join(config.upload.dir, 'uji', 'foto-uji.jpg'), Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]));
});
test.after(async () => { await H.teardown(app); fs.rmSync(config.backup.dir, { recursive: true, force: true }); });

test('hanya Administrator yang dapat membuka menu Backup Data', async () => {
  const page = await admin.get('/admin/backup');
  assert.equal(page.status, 200);
  assert.match(page.text, /Backup Sekarang/);
  assert.match(page.text, /href="\/admin\/backup"/);
  const staff = await H.createUser(app, admin, { username: 'staffbk', role: 'IT_STAFF' });
  assert.equal((await staff.get('/admin/backup')).status, 403);
  assert.equal((await staff.postForm('/admin/backup/create', {})).status, 403);
  const mgr = await H.createUser(app, admin, { username: 'mgrbk', role: 'MANAGER_IT' });
  assert.equal((await mgr.get('/admin/backup')).status, 403);
});

let first;
test('backup manual: zip berisi database.sql, foto, manifest; dapat diunduh', async () => {
  const r = await admin.postForm('/admin/backup/create', {});
  assert.equal(r.status, 200, r.text);
  const list = backup.listBackups();
  assert.equal(list.length, 1);
  first = list[0].name;
  assert.match(first, /^pmit-backup-\d{8}-\d{6}-manual\.zip$/);
  const info = backup.inspect(path.join(config.backup.dir, first));
  assert.ok(info.manifest.tables.assets >= 1);
  assert.equal(info.manifest.tables.sessions, undefined, 'sesi login tidak ikut');
  assert.ok(info.uploads.some((e) => e.name === 'uploads/uji/foto-uji.jpg'));
  const dl = await admin.get(`/admin/backup/download/${first}`).buffer(true).parse(binary);
  assert.equal(dl.status, 200);
  assert.equal(dl.body.slice(0, 2).toString(), 'PK');
  assert.equal((await admin.get('/admin/backup/download/..%2F..%2Fpackage.json')).status, 400);
  assert.match((await admin.get('/admin/backup')).text, /data-backup-list[\s\S]*Manual/);
});

test('pulihkan: data & foto kembali seperti saat backup, backup pengaman dibuat', async () => {
  const before = (await backup.dumpSql()).sql;
  // Ubah data setelah backup
  await admin.postMultipart('/assets').field('hostname', 'PC-SETELAH-BACKUP').field('device_type', 'Laptop').field('asset_status', 'Aktif');
  await db.query("UPDATE assets SET notes='diubah' WHERE hostname=?", ["PC-O'BRIEN-01"]);
  fs.rmSync(path.join(config.upload.dir, 'uji', 'foto-uji.jpg'));

  const wrong = await admin.postForm(`/admin/backup/${first}/restore`, { confirm: 'ya' });
  assert.equal(wrong.status, 422);
  assert.ok(await db.one("SELECT id FROM assets WHERE hostname='PC-SETELAH-BACKUP'"), 'belum dipulihkan');

  const ok = await admin.postForm(`/admin/backup/${first}/restore`, { confirm: 'pulihkan' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(await db.one("SELECT id FROM assets WHERE hostname='PC-SETELAH-BACKUP'"), null);
  const a = await db.one('SELECT notes FROM assets WHERE hostname=?', ["PC-O'BRIEN-01"]);
  assert.equal(a.notes, 'Baris 1\nBaris 2; titik koma;\n-- bukan komentar\r\nEmoji 🖥️ & "kutip" \\ backslash');
  assert.ok(fs.existsSync(path.join(config.upload.dir, 'uji', 'foto-uji.jpg')));
  const after = (await backup.dumpSql()).sql;
  for (const t of ['assets', 'users', 'roles', 'role_permissions', 'asset_assignments', 'schema_migrations']) assert.equal(inserts(after, t), inserts(before, t), `isi tabel ${t} sama`);
  assert.ok(backup.listBackups().some((b) => b.kind === 'sebelum-pulihkan'));
  // Sesi admin tetap berlaku & aplikasi berjalan normal
  assert.equal((await admin.get('/assets')).status, 200);
});

test('unggah backup dari PC lain: zip valid diterima, file lain ditolak', async () => {
  const zip = fs.readFileSync(path.join(config.backup.dir, first));
  const up = await admin.postMultipart('/admin/backup/upload').attach('file', zip, 'backup-pc-lama.zip');
  assert.equal(up.status, 200, up.text);
  assert.ok(backup.listBackups().some((b) => b.kind === 'unggahan'));
  const junk = await admin.postMultipart('/admin/backup/upload').attach('file', Buffer.from('bukan zip sama sekali'), 'rusak.zip');
  assert.equal(junk.status, 422);
  const txt = await admin.postMultipart('/admin/backup/upload').attach('file', Buffer.from('x'), 'data.txt');
  assert.equal(txt.status, 422);
  assert.equal(fs.readdirSync(path.join(config.backup.dir, 'tmp')).length, 0, 'file sementara dibersihkan');
});

test('backup hanya manual; folder salinan dapat diatur', async () => {
  const page = await admin.get('/admin/backup');
  assert.doesNotMatch(page.text, /Backup otomatis setiap hari|name="backup_time"/);
  assert.equal(typeof backup.startScheduler, 'undefined', 'tidak ada penjadwal backup otomatis');
  const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmit-copy-'));
  const rel = await admin.postForm('/admin/backup/settings', { backup_copy_dir: 'folder-relatif' });
  assert.equal(rel.status, 422);
  const ok = await admin.postForm('/admin/backup/settings', { backup_copy_dir: copyDir });
  assert.equal(ok.status, 200, ok.text);
  await admin.postForm('/admin/backup/create', {});
  assert.equal(fs.readdirSync(copyDir).filter((n) => n.endsWith('.zip')).length, 1);
  fs.rmSync(copyDir, { recursive: true, force: true });
  assert.equal((await admin.postForm('/admin/backup/settings', { backup_copy_dir: '' })).status, 200);
});

test('hapus backup', async () => {
  const n = backup.listBackups().length;
  const r = await admin.postForm(`/admin/backup/${first}/delete`, {});
  assert.equal(r.status, 200);
  assert.equal(backup.listBackups().length, n - 1);
  assert.equal((await admin.postForm(`/admin/backup/${first}/delete`, {})).status, 404);
});
