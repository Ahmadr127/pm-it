'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const H = require('./helpers');

let app;
test.before(async () => { app = await H.setup(); });
test.after(async () => { await H.teardown(app); });

test('halaman terlindungi mengarah ke login', async () => {
  const r = await request(app).get('/assets');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/login');
});

test('POST tanpa token CSRF ditolak 403', async () => {
  const r = await request(app).post('/login').type('form').send({ username: 'admin', password: 'x' });
  assert.equal(r.status, 403);
});

test('password salah ditolak, password tidak muncul di respons', async () => {
  const agent = request.agent(app);
  const csrf = H.csrfFrom((await agent.get('/login')).text);
  const r = await agent.post('/login').type('form').send({ _csrf: csrf, username: 'admin', password: 'SalahSekali#1' });
  assert.equal(r.status, 401);
  assert.match(r.text, /Username atau password salah/);
  assert.doesNotMatch(r.text, /SalahSekali/);
});

test('login pertama wajib ganti password; kebijakan password diterapkan', async () => {
  const agent = request.agent(app);
  let csrf = H.csrfFrom((await agent.get('/login')).text);
  const r = await agent.post('/login').type('form').send({ _csrf: csrf, username: 'admin', password: 'Admin#Awal123' });
  assert.equal(r.headers.location, '/password');
  assert.equal((await agent.get('/assets')).headers.location, '/password');
  csrf = H.csrfFrom((await agent.get('/password')).text);
  const weak = await agent.post('/password').set('Accept', 'application/json').set('X-CSRF-Token', csrf).type('form')
    .send({ current_password: 'Admin#Awal123', new_password: 'pendek', confirm_password: 'pendek' });
  assert.equal(weak.status, 422);
  assert.ok(weak.body.errors.new_password);
  const ok = await agent.post('/password').set('Accept', 'application/json').set('X-CSRF-Token', csrf).type('form')
    .send({ current_password: 'Admin#Awal123', new_password: H.ADMIN_PASSWORD, confirm_password: H.ADMIN_PASSWORD });
  assert.equal(ok.status, 200);
  assert.equal((await agent.get('/')).status, 200);
});

test('akun terkunci setelah 5x gagal, dapat dibuka admin', async () => {
  const admin = await H.login(app, 'admin', H.ADMIN_PASSWORD);
  const db = require('../src/config/db');
  const role = await db.one("SELECT id FROM roles WHERE code='IT_STAFF'");
  await admin.postForm('/admin/users', { username: 'kunci', full_name: 'Uji Kunci', role_id: role.id, password: 'Awal#Pass12345', is_active: '1' });
  const agent = request.agent(app);
  for (let i = 0; i < 5; i++) {
    const csrf = H.csrfFrom((await agent.get('/login')).text);
    await agent.post('/login').type('form').send({ _csrf: csrf, username: 'kunci', password: 'salah' });
  }
  const csrf = H.csrfFrom((await agent.get('/login')).text);
  const locked = await agent.post('/login').type('form').send({ _csrf: csrf, username: 'kunci', password: 'Awal#Pass12345' });
  assert.equal(locked.status, 401);
  assert.match(locked.text, /terkunci/);
  const u = await db.one("SELECT id FROM users WHERE username='kunci'");
  assert.equal((await admin.postForm(`/admin/users/${u.id}/unlock`, {})).status, 200);
  const csrf2 = H.csrfFrom((await agent.get('/login')).text);
  const ok = await agent.post('/login').type('form').send({ _csrf: csrf2, username: 'kunci', password: 'Awal#Pass12345' });
  assert.equal(ok.status, 302);
});

test('password tersimpan sebagai hash bcrypt & audit log tidak berisi password', async () => {
  const db = require('../src/config/db');
  const u = await db.one("SELECT password_hash FROM users WHERE username='admin'");
  assert.match(u.password_hash, /^\$2[aby]\$12\$/);
  const logs = await db.query('SELECT old_values, new_values, description FROM audit_logs');
  const blob = JSON.stringify(logs);
  assert.doesNotMatch(blob, /Awal#Pass12345|Admin#Awal123/);
});

test('header keamanan & CSP aktif', async () => {
  const r = await request(app).get('/login');
  assert.match(r.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-powered-by'], undefined);
});

test('logout mengakhiri sesi', async () => {
  const admin = await H.login(app, 'admin', H.ADMIN_PASSWORD);
  const r = await admin.post('/logout').type('form').send({ _csrf: admin.csrf });
  assert.equal(r.status, 302);
  assert.equal((await admin.get('/')).headers.location, '/login');
});

test('kebijakan password default: minimal 8 karakter tanpa syarat kombinasi; dapat diperketat admin', async () => {
  const admin = await H.login(app, 'admin', H.ADMIN_PASSWORD);
  const page = await admin.get('/password');
  assert.match(page.text, /Minimal 8 karakter\./);
  const short = await admin.postForm('/password', { current_password: H.ADMIN_PASSWORD, new_password: 'abc1234', confirm_password: 'abc1234' });
  assert.equal(short.status, 422);
  assert.match(short.body.errors.new_password, /minimal 8 karakter/);
  const easy = await admin.postForm('/password', { current_password: H.ADMIN_PASSWORD, new_password: 'mudah123', confirm_password: 'mudah123' });
  assert.equal(easy.status, 200, easy.text);
  // Admin memperketat aturan lewat Pengaturan Sistem
  const s = await admin.get('/admin/settings');
  const vals = {}; for (const m of s.text.matchAll(/name="(\w+)" value="([^"]*)"/g)) vals[m[1]] = m[2];
  for (const m of s.text.matchAll(/<select class="form-select" name="(\w+)">[\s\S]*?<option value="([^"]*)" selected/g)) vals[m[1]] = m[2];
  delete vals._csrf;
  const r = await admin.postForm('/admin/settings', { ...vals, password_min_length: '12', password_require_mix: '1' });
  assert.equal(r.status, 200, r.text);
  require('../src/services/settings').invalidate();
  const weak = await admin.postForm('/password', { current_password: 'mudah123', new_password: 'mudahsekali', confirm_password: 'mudahsekali' });
  assert.equal(weak.status, 422);
  assert.match(weak.body.errors.new_password, /minimal 12 karakter.*huruf besar/);
  await admin.postForm('/admin/settings', { ...vals, password_min_length: '8', password_require_mix: '0' });
  require('../src/services/settings').invalidate();
  assert.equal((await admin.postForm('/password', { current_password: 'mudah123', new_password: H.ADMIN_PASSWORD, confirm_password: H.ADMIN_PASSWORD })).status, 200);
});
