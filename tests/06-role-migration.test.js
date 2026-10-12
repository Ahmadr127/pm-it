'use strict';
// Migrasi 003: instalasi lama dengan role Kepala IT (SUPERVISOR) & Karyawan (USER) disederhanakan menjadi 2 role.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let app; let db;
test.before(async () => { app = await H.setup(); db = require('../src/config/db'); });
test.after(async () => { await H.teardown(app); });

async function dropManagerRole() {
  const r = await db.one("SELECT id FROM roles WHERE code='MANAGER_IT'");
  if (!r) return;
  await db.query('DELETE FROM role_permissions WHERE role_id=?', [r.id]);
  await db.query('DELETE FROM roles WHERE id=?', [r.id]);
}

test('database lama: SPV / Kepala IT -> Manager IT (akun tetap), akun karyawan dinonaktifkan', async () => {
  // Simulasikan database versi lama (sebelum migrasi 003 & 004)
  await dropManagerRole();
  const spv = (await db.query("INSERT INTO roles (code, name, is_system) VALUES ('SUPERVISOR','Kepala IT / Supervisor',1)")).insertId;
  const usr = (await db.query("INSERT INTO roles (code, name, is_system) VALUES ('USER','User / Karyawan',1)")).insertId;
  await db.query("INSERT INTO permissions (code, name, group_name) VALUES ('self.devices','x','Portal'),('complaint.manage','x','TL')");
  await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code IN ('maintenance.approve','report.view','self.devices')", [spv]);
  const emp = (await db.query("INSERT INTO employees (nik, full_name) VALUES ('K1','Karyawan Satu')")).insertId;
  await db.query("INSERT INTO users (role_id, username, full_name, password_hash) VALUES (?, 'kepala', 'Kepala IT', 'x')", [spv]);
  await db.query("INSERT INTO users (role_id, employee_id, username, full_name, password_hash) VALUES (?, ?, 'karyawan', 'Karyawan Satu', 'x')", [usr, emp]);
  await db.query("DELETE FROM schema_migrations WHERE name IN ('003_simple_roles.sql','004_manager_it_role.sql')");

  await require('../database/migrate').migrate({ silent: true });

  assert.deepEqual((await db.query('SELECT code FROM roles ORDER BY code')).map((r) => r.code), ['ADMIN', 'IT_STAFF', 'MANAGER_IT']);
  assert.equal((await db.one("SELECT name FROM roles WHERE code='ADMIN'")).name, 'Administrator');
  const kepala = await db.one("SELECT r.code, r.name, u.is_active FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username='kepala'");
  assert.equal(kepala.code, 'MANAGER_IT');
  assert.equal(kepala.name, 'Manager IT');
  assert.equal(kepala.is_active, 1);
  const perms = (await db.query("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id JOIN roles r ON r.id=rp.role_id WHERE r.code='MANAGER_IT' ORDER BY p.code")).map((x) => x.code);
  assert.deepEqual(perms, ['maintenance.approve', 'report.view']);
  const kar = await db.one("SELECT u.is_active, u.employee_id FROM users u WHERE u.username='karyawan'");
  assert.equal(kar.is_active, 0);
  assert.equal(kar.employee_id, null);
  assert.equal(await db.one("SELECT id FROM permissions WHERE code IN ('self.devices','complaint.manage')"), null);
  assert.ok(await db.one("SELECT id FROM employees WHERE nik='K1'"), 'data pengguna PC tetap ada');
});

test('instalasi yang sudah menjalankan versi awal 003 (tanpa Manager IT) mendapat role Manager IT', async () => {
  await db.query("UPDATE users u JOIN roles a ON a.code='ADMIN' JOIN roles m ON m.code='MANAGER_IT' SET u.role_id=a.id WHERE u.role_id=m.id");
  await dropManagerRole();
  await db.query("UPDATE roles SET name='Admin / Manager IT' WHERE code='ADMIN'");
  await db.query("DELETE FROM schema_migrations WHERE name='004_manager_it_role.sql'");

  await require('../database/migrate').migrate({ silent: true });

  assert.equal((await db.one("SELECT name FROM roles WHERE code='ADMIN'")).name, 'Administrator');
  const m = await db.one("SELECT id, name FROM roles WHERE code='MANAGER_IT'");
  assert.equal(m.name, 'Manager IT');
  const perms = (await db.query('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?', [m.id])).map((x) => x.code);
  assert.ok(perms.includes('maintenance.approve'));
  assert.ok(perms.includes('audit.view'));
  assert.ok(!perms.includes('maintenance.create'));
});
