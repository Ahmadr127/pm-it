'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const audit = require('../services/audit');
const settings = require('../services/settings');
const demo = require('../../database/demo');
const { PERMISSIONS } = require('../config/permissions');
const { passwordPolicy, passwordRules } = require('./auth');
const { can } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');
const h = require('../utils/helpers');

const router = express.Router();
const PARAMS = { CPU_TEMP: 'Suhu CPU (°C)', SSD_TEMP: 'Suhu SSD (°C)', HDD_TEMP: 'Suhu HDD (°C)', SSD_HEALTH: 'Health SSD (%)', HDD_HEALTH: 'Health HDD (%)', BATTERY_HEALTH: 'Battery health (%)' };
const DEVICE_TYPES = ['Desktop PC', 'Laptop', 'Workstation', 'Lainnya'];

// ================= Threshold, interval, checklist =================
router.get('/thresholds', can('threshold.manage'), async (req, res) => {
  const [thresholds, intervals, tasks] = await Promise.all([
    db.query(`SELECT t.*, u.full_name AS updater FROM hardware_thresholds t LEFT JOIN users u ON u.id=t.updated_by
               ORDER BY ${db.orderField('t.parameter', ['CPU_TEMP', 'SSD_TEMP', 'HDD_TEMP', 'SSD_HEALTH', 'HDD_HEALTH', 'BATTERY_HEALTH'])}, t.device_type IS NOT NULL, t.interface IS NOT NULL, t.brand IS NOT NULL, t.id`),
    db.query('SELECT * FROM maintenance_intervals ORDER BY ' + db.orderField('device_type', ['Desktop PC', 'Laptop', 'Workstation', 'Lainnya'])),
    db.query('SELECT * FROM task_definitions ORDER BY sort_order, id'),
  ]);
  res.render('admin/thresholds', { title: 'Threshold Hardware & Interval Maintenance', thresholds, intervals, tasks, PARAMS, DEVICE_TYPES });
});

const thrSchema = {
  parameter: { label: 'Parameter', type: 'enum', values: Object.keys(PARAMS), required: true },
  device_type: { label: 'Jenis perangkat', type: 'enum', values: DEVICE_TYPES },
  interface: { label: 'Antarmuka', type: 'enum', values: ['SATA', 'NVMe', 'SAS', 'USB', 'Lainnya'] },
  brand: { label: 'Merek', maxLength: 80 },
  model_pattern: { label: 'Pola model', maxLength: 120 },
  warning_value: { label: 'Batas perhatian', type: 'decimal', required: true, min: -50, max: 200 },
  critical_value: { label: 'Batas kritis', type: 'decimal', required: true, min: -50, max: 200 },
  reference: { label: 'Referensi', maxLength: 255 },
  notes: { label: 'Catatan', maxLength: 255 },
  is_active: { type: 'bool' },
};
function validateThreshold(body) {
  const v = validate(body, thrSchema);
  const d = v.data;
  if (d.parameter) d.direction = d.parameter.endsWith('_HEALTH') ? 'LOWER_IS_WORSE' : 'HIGHER_IS_WORSE';
  if (d.warning_value !== null && d.critical_value !== null) {
    if (d.direction === 'HIGHER_IS_WORSE' && d.critical_value <= d.warning_value) v.errors.critical_value = 'Untuk suhu, batas kritis harus lebih tinggi dari batas perhatian.';
    if (d.direction === 'LOWER_IS_WORSE' && d.critical_value >= d.warning_value) v.errors.critical_value = 'Untuk health, batas kritis harus lebih rendah dari batas perhatian.';
    if (d.parameter && d.parameter.endsWith('_HEALTH') && (d.warning_value > 100 || d.critical_value < 0)) v.errors.warning_value = 'Nilai health harus 0–100.';
  }
  if (d.interface && !['SSD_TEMP', 'HDD_TEMP', 'SSD_HEALTH', 'HDD_HEALTH'].includes(d.parameter)) d.interface = null;
  v.ok = Object.keys(v.errors).length === 0;
  return v;
}
router.post('/thresholds', can('threshold.manage'), async (req, res) => {
  const v = validateThreshold(req.body); if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  const r = await db.query(`INSERT INTO hardware_thresholds (parameter, device_type, interface, brand, model_pattern, warning_value, critical_value, direction, reference, notes, is_active, created_by, updated_by)
                             VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`, [d.parameter, d.device_type, d.interface, d.brand, d.model_pattern, d.warning_value, d.critical_value, d.direction, d.reference, d.notes, req.user.id, req.user.id]);
  await audit.log(req, 'CREATE', { entity: 'hardware_thresholds', id: r.insertId, after: d });
  res.done('Threshold ditambahkan. Berlaku untuk evaluasi berikutnya.', '/admin/thresholds');
});
router.post('/thresholds/:id', can('threshold.manage'), async (req, res) => {
  const before = await db.one('SELECT * FROM hardware_thresholds WHERE id=?', [req.params.id]);
  if (!before) throw Object.assign(new Error('Threshold tidak ditemukan.'), { status: 404 });
  const v = validateThreshold(req.body); if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  await db.query(`UPDATE hardware_thresholds SET parameter=?, device_type=?, interface=?, brand=?, model_pattern=?, warning_value=?, critical_value=?, direction=?, reference=?, notes=?, is_active=?, updated_by=? WHERE id=?`,
    [d.parameter, d.device_type, d.interface, d.brand, d.model_pattern, d.warning_value, d.critical_value, d.direction, d.reference, d.notes, d.is_active, req.user.id, before.id]);
  await audit.log(req, 'UPDATE', { entity: 'hardware_thresholds', id: before.id, ...audit.diff(before, d) });
  res.done('Threshold diperbarui. Hasil maintenance lama tidak berubah; aturan baru berlaku untuk evaluasi berikutnya.', '/admin/thresholds');
});
router.post('/intervals/:id', can('threshold.manage'), async (req, res) => {
  const before = await db.one('SELECT * FROM maintenance_intervals WHERE id=?', [req.params.id]);
  if (!before) throw Object.assign(new Error('Interval tidak ditemukan.'), { status: 404 });
  const v = validate(req.body, {
    interval_type: { label: 'Jenis jadwal', type: 'enum', values: ['Mingguan', 'Bulanan', 'Triwulanan', 'Semesteran', 'Tahunan', 'Kustom'], required: true },
    interval_days: { label: 'Interval (hari)', type: 'int', min: 1, max: 730, required: true },
    notes: { label: 'Catatan', maxLength: 255 },
  });
  if (!v.ok) throw new ValidationError(v.errors);
  await db.query('UPDATE maintenance_intervals SET interval_type=?, interval_days=?, notes=? WHERE id=?', [v.data.interval_type, v.data.interval_days, v.data.notes, before.id]);
  await audit.log(req, 'UPDATE', { entity: 'maintenance_intervals', id: before.id, ...audit.diff(before, v.data) });
  res.done(`Interval ${before.device_type} diperbarui.`, '/admin/thresholds#interval');
});
const taskSchema = {
  code: { label: 'Kode', type: 'code', upper: true, required: true, maxLength: 40 },
  name: { label: 'Nama item', required: true, maxLength: 150 },
  applies_to: { label: 'Berlaku untuk', type: 'enum', values: ['SEMUA', 'LAPTOP', 'DESKTOP'], required: true },
  sort_order: { label: 'Urutan', type: 'int', min: 0, max: 999, default: 0 },
  is_active: { type: 'bool' },
};
router.post('/tasks', can('threshold.manage'), async (req, res) => {
  const v = validate(req.body, taskSchema); if (!v.ok) throw new ValidationError(v.errors);
  const r = await db.query('INSERT INTO task_definitions (code, name, applies_to, sort_order, is_active) VALUES (?,?,?,?,1)', [v.data.code, v.data.name, v.data.applies_to, v.data.sort_order]);
  await audit.log(req, 'CREATE', { entity: 'task_definitions', id: r.insertId, after: v.data });
  res.done('Item checklist ditambahkan.', '/admin/thresholds#checklist');
});
router.post('/tasks/:id', can('threshold.manage'), async (req, res) => {
  const before = await db.one('SELECT * FROM task_definitions WHERE id=?', [req.params.id]);
  if (!before) throw Object.assign(new Error('Item tidak ditemukan.'), { status: 404 });
  const v = validate(req.body, taskSchema); if (!v.ok) throw new ValidationError(v.errors);
  await db.query('UPDATE task_definitions SET code=?, name=?, applies_to=?, sort_order=?, is_active=? WHERE id=?', [v.data.code, v.data.name, v.data.applies_to, v.data.sort_order, v.data.is_active, before.id]);
  await audit.log(req, 'UPDATE', { entity: 'task_definitions', id: before.id, ...audit.diff(before, v.data) });
  res.done('Item checklist diperbarui.', '/admin/thresholds#checklist');
});

// ================= Pengaturan sistem =================
router.get('/settings', can('settings.manage'), async (req, res) => {
  const rows = await db.query('SELECT * FROM app_settings ORDER BY setting_key');
  const demoCount = await db.one('SELECT COUNT(*) c FROM demo_registry');
  const realAssets = await db.one('SELECT COUNT(*) c FROM assets a WHERE a.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM demo_registry d WHERE d.table_name=\'assets\' AND d.record_id=a.id)');
  res.render('admin/settings', { title: 'Pengaturan Sistem', rows, demoCount: demoCount.c, realAssets: realAssets.c });
});
const SETTING_RULES = {
  due_soon_days: { type: 'int', min: 1, max: 90 }, health_drop_significant: { type: 'decimal', min: 0.5, max: 50 },
  battery_drop_significant: { type: 'decimal', min: 0.5, max: 50 }, temp_rise_significant: { type: 'decimal', min: 1, max: 50 },
  interval_attention_days: { type: 'int', min: 1, max: 365 }, interval_critical_days: { type: 'int', min: 1, max: 90 },
  smart_unavailable_level: { type: 'enum', values: ['PERHATIAN', 'INFO'] }, approval_mode: { type: 'enum', values: ['SEMUA', 'KRITIS', 'TIDAK'] },
  auto_followup: { type: 'enum', values: ['0', '1'] }, temp_min_valid: { type: 'int', min: -50, max: 20 }, temp_max_valid: { type: 'int', min: 80, max: 200 },
  password_min_length: { type: 'int', min: 6, max: 64 }, password_require_mix: { type: 'enum', values: ['0', '1'] },
  public_base_url: { maxLength: 200, required: false },
  company_name: { maxLength: 120, required: false },
};
router.post('/settings', can('settings.manage'), async (req, res) => {
  const schema = Object.fromEntries(Object.entries(SETTING_RULES).map(([k, r]) => [k, { ...r, label: k, required: r.required !== false }]));
  const v = validate(req.body, schema);
  if (v.data.public_base_url && !/^https?:\/\/[^\s/]+(:\d+)?\/?$/i.test(v.data.public_base_url)) v.errors.public_base_url = 'Format: http://alamat-ip:3000 atau https://alamat-ip:3443 (tanpa path).';
  if (Object.keys(v.errors).length) throw new ValidationError(v.errors);
  if (v.data.public_base_url === null || v.data.public_base_url === undefined) v.data.public_base_url = '';
  if (!v.data.company_name) delete v.data.company_name;
  else require('../config').companyName = v.data.company_name;
  const before = await settings.all();
  for (const [k, val] of Object.entries(v.data)) await db.upsert('app_settings', 'setting_key', { setting_key: k, setting_value: String(val) });
  settings.invalidate();
  await audit.log(req, 'UPDATE', { entity: 'app_settings', ...audit.diff(before, Object.fromEntries(Object.entries(v.data).map(([k, x]) => [k, String(x)]))) });
  res.done('Pengaturan disimpan.', '/admin/settings');
});
router.post('/settings/demo/load', can('settings.manage'), async (req, res) => {
  const count = await db.one('SELECT COUNT(*) c FROM demo_registry');
  if (count.c) throw new ValidationError({ demo: 'Data demonstrasi sudah dimuat.' });
  const result = await demo.load({ silent: true });
  await audit.log(req, 'DEMO_LOAD', { entity: 'demo_registry', description: `Data demonstrasi dimuat (${result.rows} baris)` });
  res.done(`Data demonstrasi dimuat (${result.rows} baris). Hapus kapan saja dari halaman ini.`, '/admin/settings');
});
router.post('/settings/demo/remove', can('settings.manage'), async (req, res) => {
  const result = await demo.remove({ silent: true });
  await audit.log(req, 'DEMO_REMOVE', { entity: 'demo_registry', description: `Data demonstrasi dihapus (${result.rows} baris)` });
  res.done(`Seluruh data demonstrasi dihapus (${result.rows} baris).`, '/admin/settings');
});

// ================= Akun pengguna =================
router.get('/users', can('user.manage'), async (req, res) => {
  const { page, per, offset } = h.paging(req.query);
  const where = ['u.deleted_at IS NULL']; const params = [];
  if (req.query.q) { const like = `%${h.likeEscape(req.query.q)}%`; where.push('(u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)'); params.push(like, like, like); }
  if (req.query.role_id) { where.push('u.role_id = ?'); params.push(req.query.role_id); }
  const [[{ total }], rows, roles] = await Promise.all([
    db.query(`SELECT COUNT(*) total FROM users u WHERE ${where.join(' AND ')}`, params),
    db.query(`SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.last_login_at, u.locked_until, u.must_change_password, u.role_id,
                     r.name AS role_name, r.code AS role_code
                FROM users u JOIN roles r ON r.id=u.role_id
               WHERE ${where.join(' AND ')} ORDER BY u.full_name LIMIT ? OFFSET ?`, [...params, per, offset]),
    db.query('SELECT id, code, name FROM roles ORDER BY id'),
  ]);
  res.render('admin/users', { title: 'Akun Pengguna', rows, pg: { page, per, total }, roles, pwHint: (await passwordRules()).hint });
});
const userSchema = {
  username: { label: 'Username', required: true, type: 'code', maxLength: 60 },
  full_name: { label: 'Nama lengkap', required: true, maxLength: 150 },
  email: { label: 'Email', type: 'email' },
  role_id: { label: 'Role', type: 'id', required: true },
  is_active: { type: 'bool' },
};
async function checkUser(v, id) {
  const role = v.data.role_id ? await db.one('SELECT code FROM roles WHERE id=?', [v.data.role_id]) : null;
  if (v.data.role_id && !role) v.errors.role_id = 'Role tidak ditemukan.';
  if (v.data.username) v.data.username = v.data.username.toLowerCase();
  if (id && Number(id) === v.self && !v.data.is_active) v.errors.is_active = 'Anda tidak dapat menonaktifkan akun sendiri.';
  return role;
}
async function adminCountExcept(id) {
  const r = await db.one("SELECT COUNT(*) c FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='ADMIN' AND u.is_active=1 AND u.deleted_at IS NULL AND u.id<>?", [id]);
  return r.c;
}
router.post('/users', can('user.manage'), async (req, res) => {
  const v = validate(req.body, { ...userSchema, password: { label: 'Password awal', required: true } });
  await checkUser(v);
  const pol = v.data.password ? await passwordPolicy(v.data.password, v.data.username) : null;
  if (pol) v.errors.password = pol;
  if (Object.keys(v.errors).length) throw new ValidationError(v.errors);
  const d = v.data;
  const r = await db.query('INSERT INTO users (role_id, username, full_name, email, password_hash, must_change_password, is_active, password_changed_at) VALUES (?,?,?,?,?,1,1,NOW())',
    [d.role_id, d.username, d.full_name, d.email, await bcrypt.hash(d.password, 12)]);
  await audit.log(req, 'CREATE', { entity: 'users', id: r.insertId, description: `Akun ${d.username} dibuat`, after: { ...d, password: undefined } });
  res.done(`Akun ${d.username} dibuat. Pengguna wajib mengganti password saat login pertama.`, '/admin/users');
});
router.post('/users/:id', can('user.manage'), async (req, res) => {
  const before = await db.one('SELECT u.*, r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.deleted_at IS NULL', [req.params.id]);
  if (!before) throw Object.assign(new Error('Akun tidak ditemukan.'), { status: 404 });
  const v = validate(req.body, userSchema); v.self = req.user.id;
  const role = await checkUser(v, before.id);
  if (before.role_code === 'ADMIN' && (role && role.code !== 'ADMIN' || !v.data.is_active) && (await adminCountExcept(before.id)) === 0) {
    v.errors.role_id = 'Harus ada minimal satu Administrator aktif.';
  }
  if (Object.keys(v.errors).length) throw new ValidationError(v.errors);
  const d = v.data;
  await db.query('UPDATE users SET role_id=?, username=?, full_name=?, email=?, is_active=? WHERE id=?', [d.role_id, d.username, d.full_name, d.email, d.is_active, before.id]);
  if (!d.is_active) await db.query("DELETE FROM sessions WHERE data LIKE ?", [`%"userId":${before.id},%`]);
  await audit.log(req, 'UPDATE', { entity: 'users', id: before.id, ...audit.diff(before, d) });
  res.done('Akun diperbarui.', '/admin/users');
});
router.post('/users/:id/reset-password', can('user.manage'), async (req, res) => {
  const u = await db.one('SELECT id, username FROM users WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!u) throw Object.assign(new Error('Akun tidak ditemukan.'), { status: 404 });
  const temp = `${crypto.randomBytes(4).toString('hex')}A${crypto.randomInt(10, 99)}b`;
  await db.query('UPDATE users SET password_hash=?, must_change_password=1, failed_attempts=0, locked_until=NULL, password_changed_at=NOW() WHERE id=?', [await bcrypt.hash(temp, 12), u.id]);
  await db.query('DELETE FROM sessions WHERE data LIKE ?', [`%"userId":${u.id},%`]);
  await audit.log(req, 'RESET_PASSWORD', { entity: 'users', id: u.id, description: `Reset password ${u.username}` });
  res.done(`Password ${u.username} direset. Sampaikan password sementara secara langsung; wajib diganti saat login.`, null, { temp_password: temp });
});
router.post('/users/:id/unlock', can('user.manage'), async (req, res) => {
  await db.query('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?', [req.params.id]);
  await audit.log(req, 'UNLOCK', { entity: 'users', id: req.params.id });
  res.done('Akun dibuka kuncinya.', '/admin/users');
});

// ================= Role & hak akses =================
router.get('/roles', can('role.manage'), async (req, res) => {
  const [roles, perms, rp, counts] = await Promise.all([
    db.query('SELECT * FROM roles ORDER BY id'),
    db.query('SELECT * FROM permissions ORDER BY id'),
    db.query('SELECT role_id, permission_id FROM role_permissions'),
    db.query('SELECT role_id, COUNT(*) c FROM users WHERE deleted_at IS NULL GROUP BY role_id'),
  ]);
  const has = new Set(rp.map((x) => `${x.role_id}:${x.permission_id}`));
  const groups = [...new Set(PERMISSIONS.map((p) => p[2]))];
  res.render('admin/roles', { title: 'Role & Hak Akses', roles, perms, has, groups, counts: Object.fromEntries(counts.map((c) => [c.role_id, c.c])) });
});
router.post('/roles', can('role.manage'), async (req, res) => {
  const v = validate(req.body, { code: { label: 'Kode', type: 'code', upper: true, required: true, maxLength: 40 }, name: { label: 'Nama role', required: true, maxLength: 100 }, description: { label: 'Deskripsi', maxLength: 255 } });
  if (!v.ok) throw new ValidationError(v.errors);
  const r = await db.query('INSERT INTO roles (code, name, description, is_system) VALUES (?,?,?,0)', [v.data.code.replace(/[^A-Z0-9_]/g, '_'), v.data.name, v.data.description]);
  await audit.log(req, 'CREATE', { entity: 'roles', id: r.insertId, after: v.data });
  res.done('Role dibuat. Atur hak aksesnya pada matriks.', '/admin/roles');
});
router.post('/roles/:id/permissions', can('role.manage'), async (req, res) => {
  const role = await db.one('SELECT * FROM roles WHERE id=?', [req.params.id]);
  if (!role) throw Object.assign(new Error('Role tidak ditemukan.'), { status: 404 });
  if (role.code === 'ADMIN') throw new ValidationError({ perms: 'Hak akses Administrator selalu penuh dan tidak dapat dikurangi (mencegah terkunci dari sistem).' });
  const allowed = new Set((await db.query('SELECT id FROM permissions')).map((p) => p.id));
  const ids = [].concat(req.body.perms || []).map(Number).filter((x) => allowed.has(x));
  const before = (await db.query('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?', [role.id])).map((x) => x.code);
  await db.transaction(async (t) => {
    await t.query('DELETE FROM role_permissions WHERE role_id=?', [role.id]);
    for (const pid of ids) await t.query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?)', [role.id, pid]);
    const after = ids.length ? (await t.query('SELECT code FROM permissions WHERE id IN (?)', [ids])).map((x) => x.code) : [];
    await audit.log(req, 'UPDATE_PERMISSIONS', { entity: 'roles', id: role.id, description: `Hak akses ${role.name} diubah`, before: { permissions: before }, after: { permissions: after } }, t);
  });
  res.done(`Hak akses ${role.name} disimpan. Berlaku seketika.`, '/admin/roles');
});


// ================= Audit log =================
router.get('/audit', can('audit.view'), async (req, res) => {
  const { page, per, offset } = h.paging(req.query, 50);
  const where = ['1=1']; const params = [];
  if (req.query.q) { const like = `%${h.likeEscape(req.query.q)}%`; where.push('(l.description LIKE ? OR l.username LIKE ? OR l.entity_type LIKE ? OR l.entity_id = ?)'); params.push(like, like, like, req.query.q); }
  if (req.query.action) { where.push('l.action = ?'); params.push(req.query.action); }
  if (req.query.from) { where.push('l.created_at >= ?'); params.push(`${req.query.from} 00:00:00`); }
  if (req.query.to) { where.push('l.created_at <= ?'); params.push(`${req.query.to} 23:59:59`); }
  const [[{ total }], rows, actions] = await Promise.all([
    db.query(`SELECT COUNT(*) total FROM audit_logs l WHERE ${where.join(' AND ')}`, params),
    db.query(`SELECT l.* FROM audit_logs l WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT ? OFFSET ?`, [...params, per, offset]),
    db.query('SELECT DISTINCT action FROM audit_logs ORDER BY action'),
  ]);
  res.render('admin/audit', { title: 'Audit Log', rows, pg: { page, per, total }, actions: actions.map((a) => a.action) });
});

module.exports = router;
