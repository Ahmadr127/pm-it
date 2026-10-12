'use strict';
/**
 * Registrasi cepat perangkat dari form maintenance ("Perangkat baru").
 * Teknisi cukup mengisi hostname, jenis, merek, pengguna, lokasi & ruangan; saat maintenance disimpan,
 * sistem membuat/menautkan Master Aset PC, Pengguna PC, Departemen, Unit Kerja, dan Lokasi
 * dalam transaksi yang SAMA dengan record maintenance (gagal satu, batal semua).
 */
const db = require('../config/db');
const audit = require('./audit');
const assignments = require('./assignments');
const A = require('./assets');
const h = require('../utils/helpers');
const { validate } = require('../utils/validate');

const SCHEMA = {
  asset_code: { label: 'Kode aset', type: 'code', maxLength: 50, upper: true },
  hostname: { label: 'Nama perangkat / hostname', required: true, maxLength: 100 },
  device_type: { label: 'Jenis perangkat', required: true, type: 'enum', values: A.DEVICE_TYPES },
  brand: { label: 'Merek PC', maxLength: 80 },
  model: { label: 'Model', maxLength: 120 },
  serial_number: { label: 'Serial number', maxLength: 100 },
  processor: { label: 'Processor', maxLength: 150 },
  employee_name: { label: 'Nama pengguna PC', maxLength: 150 },
  employee_nik: { label: 'NIK / ID karyawan', maxLength: 40 },
  department_name: { label: 'Departemen', maxLength: 120 },
  work_unit_name: { label: 'Unit kerja', maxLength: 120 },
  location_name: { label: 'Lokasi / gedung', maxLength: 120 },
  room: { label: 'Ruangan', maxLength: 120 },
};

const PREFIX = { 'Desktop PC': 'PC', Laptop: 'LT', Workstation: 'WS', Lainnya: 'DV' };

/** Validasi input + pengecekan duplikat (di luar transaksi, untuk pesan yang ramah). Error berkunci na[field]. */
/** Isian pengganti "kosong" seperti "-", "--", ".", "n/a", "tidak ada" dianggap kosong. */
const PLACEHOLDER = /^\s*(?:[-–—._/]+|n\/?a|na|null|tidak ada|tdk ada|kosong)\s*$/i;

async function check(raw) {
  const src = {};
  for (const [k, val] of Object.entries(raw || {})) src[k] = typeof val === 'string' && PLACEHOLDER.test(val) ? '' : val;
  const v = validate(src, SCHEMA);
  const errors = {};
  for (const [k, m] of Object.entries(v.errors)) errors[`na[${k}]`] = m;
  const d = v.data;
  if (d.work_unit_name && !d.department_name) errors['na[department_name]'] = 'Isi departemen untuk unit kerja ini.';
  if (d.employee_nik && !d.employee_name) errors['na[employee_name]'] = 'Isi nama pengguna untuk NIK ini.';

  if (d.asset_code && !errors['na[asset_code]']) {
    const dup = await db.one('SELECT id FROM assets WHERE asset_code=?', [d.asset_code]);
    if (dup) errors['na[asset_code]'] = 'Kode aset sudah digunakan. Kosongkan agar dibuat otomatis, atau pilih aset tersebut dari daftar.';
  }
  if (d.hostname && !errors['na[hostname]']) {
    const dup = await db.one('SELECT asset_code FROM assets WHERE hostname=? AND deleted_at IS NULL LIMIT 1', [d.hostname]);
    if (dup) errors['na[hostname]'] = `Hostname ini sudah terdaftar pada aset ${dup.asset_code}. Pilih perangkat tersebut dari daftar "Perangkat (PC)".`;
  }
  if (d.serial_number && !errors['na[serial_number]']) {
    const dup = await db.one('SELECT asset_code FROM assets WHERE serial_number=? AND deleted_at IS NULL LIMIT 1', [d.serial_number]);
    if (dup) errors['na[serial_number]'] = `Serial number ini sudah terdaftar pada aset ${dup.asset_code}.`;
  }
  if (d.employee_nik && d.employee_name) {
    const e = await db.one('SELECT full_name FROM employees WHERE nik=?', [d.employee_nik]);
    if (e && e.full_name.toLowerCase() !== d.employee_name.toLowerCase()) errors['na[employee_nik]'] = `NIK ini sudah terdaftar atas nama ${e.full_name}.`;
  }
  return { data: d, errors };
}

/** Aset sementara (belum tersimpan) untuk validasi checklist, baterai, dan evaluasi. */
function pseudoAsset(d) {
  return { id: 0, asset_code: d.asset_code || '(baru)', hostname: d.hostname, device_type: d.device_type, brand: d.brand, model: d.model, processor: d.processor, has_battery: d.device_type === 'Laptop' ? 1 : 0 };
}

async function seq(t, key) {
  return db.nextSequence(t, key);
}

async function autoAssetCode(t, type) {
  const p = PREFIX[type] || 'DV';
  for (let i = 0; i < 1000; i++) {
    const code = `AST-${p}-${String(await seq(t, `ASSET-${p}`)).padStart(4, '0')}`;
    if (!(await t.one('SELECT id FROM assets WHERE asset_code=?', [code]))) return code;
  }
  throw new Error('Gagal membuat kode aset otomatis.');
}

async function autoNik(t) {
  for (let i = 0; i < 1000; i++) {
    const nik = `AUTO-${String(await seq(t, 'EMP-AUTO')).padStart(4, '0')}`;
    if (!(await t.one('SELECT id FROM employees WHERE nik=?', [nik]))) return nik;
  }
  throw new Error('Gagal membuat ID karyawan otomatis.');
}

function storageSummary(storages) {
  const parts = storages.map((s) => [s.storage_type, s.interface && s.interface !== s.storage_type ? s.interface : null, s.capacity_gb ? `${Number(s.capacity_gb)} GB` : null].filter(Boolean).join(' '));
  return parts.length ? parts.join(' + ').slice(0, 200) : null;
}

/**
 * Buat/tautkan seluruh master data lalu kembalikan baris aset baru (terkunci).
 * @param t koneksi transaksi
 * @returns {{ asset, info }} info = ringkasan untuk pesan sukses
 */
/**
 * Cari / buat departemen, unit kerja, lokasi, dan pengguna PC berdasarkan nama (tanpa duplikat).
 * @returns {{ dept, unit, loc, emp, created: string[] }}
 */
async function resolvePeople(t, req, d, { source = 'form maintenance' } = {}) {
  const created = [];
  const note = `Didaftarkan otomatis dari ${source}`;
  // Departemen (nama unik, tidak peka huruf besar/kecil). Data yang pernah dihapus dipulihkan.
  let dept = null;
  if (d.department_name) {
    dept = await t.one('SELECT id, name, deleted_at, is_active FROM departments WHERE name=? LIMIT 1', [d.department_name]);
    if (dept && (dept.deleted_at || !dept.is_active)) await t.query('UPDATE departments SET deleted_at=NULL, is_active=1 WHERE id=?', [dept.id]);
    if (!dept) {
      const r = await t.query('INSERT INTO departments (name, description, is_active) VALUES (?,?,1)', [d.department_name, note]);
      dept = { id: r.insertId, name: d.department_name };
      created.push(`departemen ${d.department_name}`);
      await audit.log(req, 'CREATE', { entity: 'departments', id: dept.id, description: `Departemen ${d.department_name} dibuat dari ${source}` }, t);
    }
  }
  // Unit kerja (unik per departemen)
  let unit = null;
  if (d.work_unit_name && dept) {
    unit = await t.one('SELECT id, name, deleted_at, is_active FROM work_units WHERE department_id=? AND name=? LIMIT 1', [dept.id, d.work_unit_name]);
    if (unit && (unit.deleted_at || !unit.is_active)) await t.query('UPDATE work_units SET deleted_at=NULL, is_active=1 WHERE id=?', [unit.id]);
    if (!unit) {
      const r = await t.query('INSERT INTO work_units (department_id, name, is_active) VALUES (?,?,1)', [dept.id, d.work_unit_name]);
      unit = { id: r.insertId, name: d.work_unit_name };
      created.push(`unit kerja ${d.work_unit_name}`);
      await audit.log(req, 'CREATE', { entity: 'work_units', id: unit.id, description: `Unit kerja ${d.work_unit_name} (${dept.name}) dibuat dari ${source}` }, t);
    }
  }
  // Lokasi (nama lokasi/gedung); ruangan disimpan pada penugasan perangkat
  let loc = null;
  if (d.location_name) {
    loc = await t.one('SELECT id FROM locations WHERE name=? AND deleted_at IS NULL ORDER BY (building IS NULL) DESC, (room IS NULL) DESC, id LIMIT 1', [d.location_name]);
    if (!loc) {
      const r = await t.query('INSERT INTO locations (name, is_active) VALUES (?,1)', [d.location_name]);
      loc = { id: r.insertId };
      created.push(`lokasi ${d.location_name}`);
      await audit.log(req, 'CREATE', { entity: 'locations', id: loc.id, description: `Lokasi ${d.location_name} dibuat dari ${source}` }, t);
    }
  }
  // Pengguna PC
  let emp = null;
  if (d.employee_name) {
    if (d.employee_nik) {
      emp = await t.one('SELECT id, full_name, deleted_at FROM employees WHERE nik=?', [d.employee_nik]);
      if (emp && emp.deleted_at) await t.query("UPDATE employees SET deleted_at=NULL, status='Aktif' WHERE id=?", [emp.id]);
    } else {
      // Nama sama: pakai yang cocok departemen / lokasi / ruangan; bila tetap lebih dari satu, pakai data terbaru
      const same = await t.query(`SELECT e.id, e.full_name, e.location_id, e.room, d.name AS dept FROM employees e LEFT JOIN departments d ON d.id=e.department_id
                                   WHERE e.full_name=? AND e.deleted_at IS NULL ORDER BY e.id DESC`, [d.employee_name]);
      const low = (x) => String(x || '').toLowerCase();
      const pick = (list, fn) => { const f = list.filter(fn); return f.length ? f : list; };
      let cand = same;
      if (cand.length > 1 && d.department_name) cand = pick(cand, (x) => low(x.dept) === low(d.department_name));
      if (cand.length > 1 && loc) cand = pick(cand, (x) => x.location_id === loc.id);
      if (cand.length > 1 && d.room) cand = pick(cand, (x) => low(x.room) === low(d.room));
      if (cand.length) [emp] = cand;
    }
    if (!emp) {
      const nik = d.employee_nik || await autoNik(t);
      const r = await t.query(`INSERT INTO employees (nik, full_name, department_id, work_unit_id, location_id, room, status, notes) VALUES (?,?,?,?,?,?, 'Aktif', ?)`,
        [nik, d.employee_name, dept && dept.id, unit && unit.id, loc && loc.id, d.room, `${note}${d.employee_nik ? '' : ' (NIK sementara — perbarui di menu Pengguna PC)'}`]);
      emp = { id: r.insertId, full_name: d.employee_name };
      created.push(`pengguna ${d.employee_name}`);
      await audit.log(req, 'CREATE', { entity: 'employees', id: emp.id, description: `Pengguna ${d.employee_name} (${nik}) dibuat dari ${source}` }, t);
    }
  }

  return { dept, unit, loc, emp, created };
}

async function register(t, req, d, parsed, { source = 'form maintenance' } = {}) {
  const uid = req.user.id;
  const note = `Didaftarkan otomatis dari ${source}`;
  const storages = (parsed && parsed.storages) || [];
  const md = parsed && parsed.data ? parsed.data.maintenance_date : null;
  const { dept, unit, loc, emp, created } = await resolvePeople(t, req, d, { source });

  // Aset
  const code = d.asset_code || await autoAssetCode(t, d.device_type);
  const row = {
    asset_code: code, hostname: d.hostname, device_type: d.device_type, brand: d.brand, model: d.model, serial_number: d.serial_number,
    processor: d.processor, storage_summary: storageSummary(storages), location_id: loc ? loc.id : null, asset_status: 'Aktif',
    warranty_status: 'Tidak Diketahui', has_battery: d.device_type === 'Laptop' ? 1 : 0, notes: note, created_by: uid, updated_by: uid,
  };
  const r = await t.query(`INSERT INTO assets (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`, Object.values(row));
  const assetId = r.insertId;
  await audit.log(req, 'CREATE', { entity: 'assets', id: assetId, description: `Aset ${code} didaftarkan dari ${source}`, after: row }, t);

  // Penugasan pengguna / departemen / unit / lokasi (riwayat tercatat)
  if (emp || dept || unit || loc || d.room) {
    await assignments.assign(t, {
      assetId, employeeId: emp ? emp.id : null, role: 'PENGGUNA_UTAMA', departmentId: dept && dept.id, workUnitId: unit && unit.id,
      locationId: loc && loc.id, room: d.room, startDate: md && md <= h.today() ? md : h.today(), reason: `Registrasi perangkat dari ${source}`,
    }, uid);
  }
  const asset = await t.one('SELECT * FROM assets WHERE id=?', [assetId]);
  return { asset, info: { asset_code: code, created } };
}

module.exports = { SCHEMA, PLACEHOLDER, check, pseudoAsset, register, resolvePeople, storageSummary, autoAssetCode };
