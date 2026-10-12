'use strict';
/**
 * Utilitas pengujian. Menggunakan database TERPISAH (DB_NAME_TEST, default pm_asset_test)
 * yang dikosongkan ulang setiap file test. Jangan arahkan ke database produksi.
 */
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.DB_NAME_TEST || 'pm_asset_test';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR_TEST || 'storage/test-uploads';
process.env.BACKUP_DIR = process.env.BACKUP_DIR_TEST || 'storage/test-backups';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin#Awal123';

const request = require('supertest');
const zlib = require('zlib');

const ADMIN_PASSWORD = 'Kuat#Baru2026x';

async function setup() {
  const { migrate } = require('../database/migrate');
  await migrate({ fresh: true, silent: true });
  const { seedBase } = require('../database/seed');
  await seedBase({ silent: true });
  const { createApp } = require('../src/app');
  return createApp();
}

function csrfFrom(html) {
  const m = /name="csrf-token" content="([a-f0-9]+)"/.exec(html) || /name="_csrf" value="([a-f0-9]+)"/.exec(html);
  return m ? m[1] : null;
}

/** Agent login + token CSRF. */
async function login(app, username, password, { changeTo } = {}) {
  const agent = request.agent(app);
  const page = await agent.get('/login');
  let csrf = csrfFrom(page.text);
  const res = await agent.post('/login').type('form').send({ _csrf: csrf, username, password });
  if (res.status !== 302) throw new Error(`Login gagal (${res.status}) untuk ${username}`);
  if (res.headers.location === '/password' && changeTo) {
    const p = await agent.get('/password');
    csrf = csrfFrom(p.text);
    const c = await agent.post('/password').set('Accept', 'application/json').set('X-CSRF-Token', csrf)
      .type('form').send({ current_password: password, new_password: changeTo, confirm_password: changeTo });
    if (c.status !== 200) throw new Error(`Ganti password gagal: ${c.text}`);
  }
  const home = await agent.get('/password');
  agent.csrf = csrfFrom(home.text);
  /** POST JSON-style (seperti fetch dari browser). */
  agent.postForm = (url, data) => agent.post(url).set('Accept', 'application/json').set('X-CSRF-Token', agent.csrf).type('form').send(data);
  agent.postMultipart = (url) => agent.post(url).set('Accept', 'application/json').set('X-CSRF-Token', agent.csrf);
  return agent;
}

async function adminAgent(app) {
  return login(app, 'admin', 'Admin#Awal123', { changeTo: ADMIN_PASSWORD });
}

/** Buat akun lewat endpoint admin, lalu login & ganti password. */
async function createUser(app, admin, { username, role, employeeId = '' }) {
  const db = require('../src/config/db');
  const r = await db.one('SELECT id FROM roles WHERE code=?', [role]);
  const res = await admin.postForm('/admin/users', { username, full_name: `Uji ${username}`, role_id: r.id, employee_id: employeeId, password: 'Awal#Pass12345', is_active: '1' });
  if (res.status !== 200) throw new Error(`Buat user gagal: ${res.text}`);
  return login(app, username, 'Awal#Pass12345', { changeTo: 'Baru#Pass12345' });
}

/** PNG 1x1 valid. */
function png() {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
}
function pdf() { return Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'); }

async function teardown(app) {
  const db = require('../src/config/db');
  if (app && app.locals.sessionStore) { try { await app.locals.sessionStore.close(); } catch (_) { /* abaikan */ } }
  try { await db.pool.end(); } catch (_) { /* sudah ditutup */ }
}

module.exports = { setup, login, adminAgent, createUser, csrfFrom, png, pdf, teardown, ADMIN_PASSWORD };
