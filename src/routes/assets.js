'use strict';
const fs = require('fs');
const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../config/db');
const audit = require('../services/audit');
const { autoAssetCode } = require('../services/quickAsset');
const A = require('../services/assets');
const uploads = require('../services/uploads');
const assignments = require('../services/assignments');
const settings = require('../services/settings');
const exporter = require('../services/exporter');
const { lookups, locText } = require('./org');
const { can, has } = require('../middleware/auth');
const { validate, ValidationError, isValidDate } = require('../utils/validate');
const h = require('../utils/helpers');

const router = express.Router();
const notFound = () => Object.assign(new Error('Aset tidak ditemukan.'), { status: 404 });

const SORTS = {
  code: 'a.asset_code', hostname: 'a.hostname', type: 'a.device_type', status: 'a.asset_status', user: 'e.full_name',
  dept: 'd.name', health: "FIELD(a.current_health_status,'KRITIS','PERHATIAN','BELUM_DIEVALUASI','BAIK')",
  last: 'a.last_maintenance_date', next: 'a.next_maintenance_date', updated: 'a.updated_at',
};

async function workUnits() {
  return db.query('SELECT w.id, w.name, w.department_id, d.name AS department_name FROM work_units w JOIN departments d ON d.id=w.department_id WHERE w.deleted_at IS NULL AND w.is_active=1 ORDER BY d.name, w.name');
}

// ---------------- Daftar ----------------
router.get('/', can('asset.view'), async (req, res) => {
  const { page, per, offset } = h.paging(req.query);
  const s = h.sorting(req.query, SORTS, 'code');
  const f = A.filterSql(req.query);
  const [[{ total }], rows, lk, units] = await Promise.all([
    db.query(`SELECT COUNT(*) total ${A.LIST_FROM} WHERE ${f.where}`, f.params),
    db.query(`SELECT ${A.LIST_COLS} ${A.LIST_FROM} WHERE ${f.where} ORDER BY ${s.sql}, a.id LIMIT ? OFFSET ?`, [...f.params, per, offset]),
    lookups(), workUnits(),
  ]);
  res.render('assets/index', { title: 'Master Aset PC', rows, pg: { page, per, total }, ...lk, units, A, locText });
});

// ---------------- Ekspor ----------------
const EXPORT_COLS = [
  { header: 'Kode Aset', key: 'asset_code', width: 20 }, { header: 'No Inventaris', key: 'inventory_number', width: 16 },
  { header: 'Hostname', key: 'hostname', width: 18 }, { header: 'Jenis Perangkat', key: 'device_type', width: 14 },
  { header: 'Brand', key: 'brand' }, { header: 'Model', key: 'model', width: 20 }, { header: 'Serial Number', key: 'serial_number', width: 18 },
  { header: 'Processor', key: 'processor', width: 24 }, { header: 'RAM (GB)', key: 'ram_gb', type: 'number' },
  { header: 'Storage', key: 'storage_summary', width: 22 }, { header: 'GPU', key: 'gpu', width: 18 },
  { header: 'Sistem Operasi', key: 'operating_system', width: 18 }, { header: 'IP Address', key: 'ip_address', width: 15 },
  { header: 'MAC Address', key: 'mac_address', width: 18 }, { header: 'Lokasi', key: 'location_name', width: 16 },
  { header: 'Gedung', key: 'location_building' }, { header: 'Ruangan', key: 'location_room' },
  { header: 'Tanggal Pembelian', key: 'purchase_date', type: 'date', width: 14 }, { header: 'Status Garansi', key: 'warranty_status' },
  { header: 'Garansi Sampai', key: 'warranty_until', type: 'date', width: 14 }, { header: 'Kondisi Fisik', key: 'physical_condition' },
  { header: 'Status Aset', key: 'asset_status' }, { header: 'Punya Baterai', value: (r) => (r.has_battery ? 'Ya' : 'Tidak') },
  { header: 'Catatan', key: 'notes', width: 30 },
];
const REPORT_EXTRA = [
  { header: 'Pengguna', key: 'employee_name', width: 20 }, { header: 'Departemen', key: 'department_name', width: 16 },
  { header: 'Unit Kerja', key: 'work_unit_name', width: 16 }, { header: 'Status Kesehatan', value: (r) => h.STATUS_BADGE[r.current_health_status][1] },
  { header: 'Maintenance Terakhir', key: 'last_maintenance_date', type: 'date' }, { header: 'Jadwal Berikutnya', key: 'next_maintenance_date', type: 'date' },
];

router.get('/export.:fmt', can('asset.export'), async (req, res) => {
  const fmt = req.params.fmt;
  if (!['csv', 'xlsx'].includes(fmt)) throw notFound();
  const f = A.filterSql(req.query);
  const rows = await db.query(`SELECT ${A.LIST_COLS} ${A.LIST_FROM} WHERE ${f.where} ORDER BY a.asset_code`, f.params);
  const cols = [...EXPORT_COLS, ...REPORT_EXTRA];
  await audit.log(req, 'EXPORT', { entity: 'assets', description: `Ekspor ${rows.length} aset (${fmt})` });
  const name = `aset-pc-${h.today()}.${fmt}`;
  if (fmt === 'csv') return exporter.send(res, exporter.toCsv(cols, rows), name, 'csv');
  return exporter.send(res, await exporter.toXlsx([{ name: 'Aset', title: 'Data Inventaris Aset Komputer', columns: cols, rows }], { by: req.user.full_name }), name, 'xlsx');
});

router.get('/import/template.xlsx', can('asset.import'), async (req, res) => {
  const lk = await lookups();
  const buf = await exporter.toXlsx([
    { name: 'Aset', columns: EXPORT_COLS, rows: [] },
    { name: 'Petunjuk', columns: [{ header: 'Kolom', key: 'k', width: 22 }, { header: 'Keterangan', key: 'v', width: 90 }], rows: [
      { k: 'Kode Aset', v: 'Opsional, unik. Kosongkan bila PC belum punya kode aset (diberi nomor otomatis).' },
      { k: 'Hostname', v: 'Wajib.' },
      { k: 'Jenis Perangkat', v: `Wajib: ${A.DEVICE_TYPES.join(', ')}` },
      { k: 'Status Aset', v: `Wajib: ${A.ASSET_STATUS.join(', ')}` },
      { k: 'Status Garansi', v: A.WARRANTY.join(', ') },
      { k: 'Kondisi Fisik', v: A.PHYSICAL.join(', ') },
      { k: 'Tanggal', v: 'Format YYYY-MM-DD (atau sel tanggal Excel).' },
      { k: 'Lokasi/Gedung/Ruangan', v: 'Harus sama persis dengan Master Lokasi. Kosongkan bila belum diketahui.' },
      { k: 'Punya Baterai', v: 'Ya / Tidak (laptop umumnya Ya).' },
      { k: 'Lokasi terdaftar', v: lk.locations.map(locText).join(' | ') || '(belum ada)' },
    ] },
  ]);
  exporter.send(res, buf, 'template-impor-aset.xlsx', 'xlsx');
});

// ---- Impor sederhana: cukup Hostname, Jenis, Merek, Nama Pengguna, Lokasi, Ruangan ----
const SIMPLE_COLS = [
  { header: 'Hostname', key: 'hostname', width: 22 }, { header: 'Jenis Perangkat', key: 'device_type', width: 16 },
  { header: 'Merek', key: 'brand', width: 14 }, { header: 'Nama Pengguna', key: 'employee_name', width: 24 },
  { header: 'Lokasi / Gedung', key: 'location_name', width: 18 }, { header: 'Ruangan', key: 'room', width: 18 },
  { header: 'Kode Aset', key: 'asset_code', width: 18 },
];
router.get('/import/template-sederhana.xlsx', can('asset.import'), async (req, res) => {
  const buf = await exporter.toXlsx([
    { name: 'Daftar PC', columns: SIMPLE_COLS, rows: [
      { hostname: 'PC-FARMASI-01', device_type: 'PC', brand: 'Lenovo', employee_name: 'Contoh Nama', location_name: 'Gedung A', room: 'Farmasi', asset_code: '' },
    ] },
    { name: 'Petunjuk', columns: [{ header: 'Kolom', key: 'k', width: 20 }, { header: 'Keterangan', key: 'v', width: 90 }], rows: [
      { k: 'Hostname', v: 'Wajib. Nama komputer (unik). PC yang hostname-nya sudah terdaftar akan dilewati.' },
      { k: 'Jenis Perangkat', v: 'PC / Laptop / Workstation. Kosong = PC (Desktop PC).' },
      { k: 'Merek', v: 'Opsional, mis. Lenovo, HP, Dell.' },
      { k: 'Nama Pengguna', v: 'Opsional. Dibuat otomatis di menu Pengguna PC bila belum ada (nama sama dipakai ulang).' },
      { k: 'Lokasi / Gedung', v: 'Opsional. Dibuat otomatis bila belum ada.' },
      { k: 'Ruangan', v: 'Opsional.' },
      { k: 'Kode Aset', v: 'Opsional. Kosongkan bila PC belum punya kode aset (diberi nomor otomatis).' },
      { k: 'Catatan', v: 'Hapus baris contoh sebelum mengunggah. Isian "-" dianggap kosong.' },
    ] },
  ]);
  exporter.send(res, buf, 'template-daftar-pc.xlsx', 'xlsx');
});

function normalizeType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s || /^(pc|desktop|desktop pc|komputer|cpu|pc desktop|all ?in ?one|aio)$/.test(s)) return 'Desktop PC';
  if (/^(laptop|notebook|netbook)$/.test(s)) return 'Laptop';
  if (/^workstation$/.test(s)) return 'Workstation';
  if (/^(lainnya|lain|other)$/.test(s)) return 'Lainnya';
  return null;
}

async function importSimple(req, res, ws, colIdx) {
  const Q = require('../services/quickAsset');
  const idx = Object.fromEntries(SIMPLE_COLS.map((c) => [c.key, colIdx(c.header)]));
  if (idx.employee_name < 1) idx.employee_name = colIdx('Pengguna');
  if (idx.location_name < 1) idx.location_name = colIdx('Lokasi');
  const rows = []; const errors = []; const seen = new Set();
  const last = Math.min(ws.rowCount, 5001);
  for (let i = 2; i <= last; i++) {
    const row = ws.getRow(i);
    const get = (k) => { const v = idx[k] > 0 ? cellToString(row.getCell(idx[k]).value) : ''; return Q.PLACEHOLDER.test(v) ? '' : v; };
    const raw = Object.fromEntries(SIMPLE_COLS.map((c) => [c.key, get(c.key)]));
    if (!Object.values(raw).some(Boolean)) continue;
    const type = normalizeType(raw.device_type);
    const v = validate({ ...raw, device_type: type }, Q.SCHEMA);
    if (!type) v.errors.device_type = `Jenis perangkat "${raw.device_type}" tidak dikenal (gunakan PC / Laptop / Workstation).`;
    const key = (v.data.hostname || '').toLowerCase();
    if (key && seen.has(key)) v.errors.hostname = `Hostname ${v.data.hostname} muncul lebih dari sekali di file.`;
    if (key) seen.add(key);
    if (Object.keys(v.errors).length) errors.push({ row: i, code: raw.hostname || raw.asset_code, messages: Object.values(v.errors) });
    else rows.push({ row: i, d: v.data });
  }
  const view = (result, status = 200) => res.status(status).render('assets/import', { title: 'Impor Data Aset', result });
  if (errors.length) return view({ ok: false, created: 0, updated: 0, errors }, 422);
  if (!rows.length) return view({ ok: false, created: 0, updated: 0, errors: [], empty: true });
  const existing = await db.query('SELECT hostname, asset_code FROM assets WHERE deleted_at IS NULL AND hostname IN (?)', [rows.map((r) => r.d.hostname)]);
  const exists = new Set(existing.map((e) => e.hostname.toLowerCase()));
  const codes = rows.map((r) => r.d.asset_code).filter(Boolean);
  const usedCodes = codes.length ? new Set((await db.query('SELECT asset_code FROM assets WHERE asset_code IN (?)', [codes])).map((x) => x.asset_code)) : new Set();
  for (const r of rows) if (r.d.asset_code && usedCodes.has(r.d.asset_code) && !exists.has(r.d.hostname.toLowerCase())) errors.push({ row: r.row, code: r.d.asset_code, messages: ['Kode aset sudah dipakai perangkat lain.'] });
  if (errors.length) return view({ ok: false, created: 0, updated: 0, errors }, 422);
  const skipped = rows.filter((r) => exists.has(r.d.hostname.toLowerCase())).map((r) => r.d.hostname);
  const todo = rows.filter((r) => !exists.has(r.d.hostname.toLowerCase()));
  await db.transaction(async (t) => {
    for (const r of todo) await Q.register(t, req, r.d, null, { source: 'impor Excel' });
    await audit.log(req, 'IMPORT', { entity: 'assets', description: `Impor daftar PC: ${todo.length} baru, ${skipped.length} dilewati (sudah ada)` }, t);
  });
  return view({ ok: true, created: todo.length, updated: 0, skipped, errors: [] });
}

router.get('/import', can('asset.import'), (req, res) => res.render('assets/import', { title: 'Impor Data Aset', result: null }));

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.text) return String(v.text);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.result !== undefined) return cellToString(v.result);
    return '';
  }
  return String(v).trim();
}

router.post('/import', can('asset.import'), uploads.importUpload, async (req, res) => {
  const file = req.file;
  if (!file) throw new ValidationError({ file: 'Pilih file .xlsx atau .csv.' });
  const name = file.originalname.toLowerCase();
  const wb = new ExcelJS.Workbook();
  try {
    if (name.endsWith('.xlsx')) {
      const head = fs.readFileSync(file.path).slice(0, 4);
      if (head.toString('hex') !== '504b0304') throw new Error('bukan xlsx');
      await wb.xlsx.readFile(file.path);
    } else if (name.endsWith('.csv')) await wb.csv.readFile(file.path);
    else throw new Error('format');
  } catch (e) {
    uploads.removeTemp([file]);
    throw new ValidationError({ file: 'File tidak dapat dibaca. Gunakan template .xlsx atau file .csv yang valid.' });
  }
  uploads.removeTemp([file]);
  const ws = wb.worksheets[0];
  const header = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { header[i] = cellToString(c.value).toLowerCase(); });
  const colIdx = (label) => header.findIndex((x) => x === label.toLowerCase());
  if (colIdx('Nama Pengguna') > 0 || colIdx('Pengguna') > 0 || (colIdx('Hostname') > 0 && colIdx('Status Aset') < 1)) return importSimple(req, res, ws, colIdx);
  const map = Object.fromEntries(EXPORT_COLS.filter((c) => c.key || c.header === 'Punya Baterai').map((c) => [c.header, colIdx(c.header)]));
  if (map.Hostname < 1 || map['Jenis Perangkat'] < 1) {
    throw new ValidationError({ file: 'Header kolom tidak sesuai template (minimal: Hostname, Jenis Perangkat).' });
  }
  const locations = await db.query('SELECT * FROM locations WHERE deleted_at IS NULL');
  const findLoc = (n, b, r) => locations.find((l) => l.name.toLowerCase() === n.toLowerCase()
    && (l.building || '').toLowerCase() === (b || '').toLowerCase() && (l.room || '').toLowerCase() === (r || '').toLowerCase());
  const updateExisting = req.body.update_existing === '1';
  const parsed = []; const errors = []; const seen = new Set();
  const last = Math.min(ws.rowCount, 5001);
  for (let i = 2; i <= last; i++) {
    const row = ws.getRow(i);
    const get = (hdr) => (map[hdr] > 0 ? cellToString(row.getCell(map[hdr]).value) : '');
    if (!get('Kode Aset') && !get('Hostname')) continue;
    const body = {
      asset_code: get('Kode Aset'), inventory_number: get('No Inventaris'), hostname: get('Hostname'), device_type: get('Jenis Perangkat'),
      brand: get('Brand'), model: get('Model'), serial_number: get('Serial Number'), processor: get('Processor'), ram_gb: get('RAM (GB)'),
      storage_summary: get('Storage'), gpu: get('GPU'), operating_system: get('Sistem Operasi'), ip_address: get('IP Address'),
      mac_address: get('MAC Address'), purchase_date: get('Tanggal Pembelian'), warranty_status: get('Status Garansi') || 'Tidak Diketahui',
      warranty_until: get('Garansi Sampai'), physical_condition: get('Kondisi Fisik'), asset_status: get('Status Aset') || 'Aktif',
      has_battery: /^(ya|yes|1|true)$/i.test(get('Punya Baterai')) ? '1' : '0', notes: get('Catatan'),
    };
    const v = A.validateAsset(body);
    const loc = get('Lokasi');
    if (loc) {
      const l = findLoc(loc, get('Gedung'), get('Ruangan'));
      if (!l) v.errors.location_id = `Lokasi "${[loc, get('Gedung'), get('Ruangan')].filter(Boolean).join(' · ')}" belum terdaftar di Master Lokasi.`;
      else v.data.location_id = l.id;
    }
    const code = v.data.asset_code;
    if (code && seen.has(code)) v.errors.asset_code = `Kode aset ${code} duplikat di dalam file.`;
    if (code) seen.add(code);
    if (Object.keys(v.errors).length) errors.push({ row: i, code: code || v.data.hostname, messages: Object.values(v.errors) });
    else parsed.push({ row: i, data: v.data });
  }
  if (!errors.length && parsed.length) {
    const codes = parsed.map((p) => p.data.asset_code).filter(Boolean);
    const existing = codes.length ? await db.query('SELECT id, asset_code, inventory_number FROM assets WHERE asset_code IN (?)', [codes]) : [];
    const byCode = new Map(existing.map((e) => [e.asset_code, e]));
    if (!updateExisting) for (const p of parsed) if (p.data.asset_code && byCode.has(p.data.asset_code)) errors.push({ row: p.row, code: p.data.asset_code, messages: ['Kode aset sudah ada di database (centang "perbarui data yang sudah ada" untuk memperbarui).'] });
    if (!errors.length) {
      let created = 0; let updated = 0;
      await db.transaction(async (t) => {
        for (const p of parsed) {
          const d = p.data;
          const cols = Object.keys(A.assetSchema).filter((k) => k !== 'maintenance_interval_days');
          const ex = d.asset_code ? byCode.get(d.asset_code) : null;
          if (!d.asset_code) d.asset_code = await autoAssetCode(t, d.device_type);
          if (ex) {
            if (!d.hostname) cols.splice(cols.indexOf('hostname'), 1);
            await t.query(`UPDATE assets SET ${cols.map((c) => `${c}=?`).join(', ')}, updated_by=? WHERE id=?`, [...cols.map((c) => d[c] ?? null), req.user.id, ex.id]);
            updated++;
          } else {
            if (!d.hostname) d.hostname = d.asset_code;
            await t.query(`INSERT INTO assets (${cols.join(', ')}, created_by, updated_by) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`, [...cols.map((c) => d[c] ?? null), req.user.id, req.user.id]);
            created++;
          }
        }
        await audit.log(req, 'IMPORT', { entity: 'assets', description: `Impor aset: ${created} baru, ${updated} diperbarui` }, t);
      });
      return res.render('assets/import', { title: 'Impor Data Aset', result: { ok: true, created, updated, errors: [] } });
    }
  }
  return res.status(errors.length ? 422 : 200).render('assets/import', { title: 'Impor Data Aset', result: { ok: false, created: 0, updated: 0, errors, empty: !parsed.length && !errors.length } });
});

// ---------------- Form tambah / ubah ----------------
async function formData(asset) {
  const lk = await lookups();
  const intervals = await db.query('SELECT * FROM maintenance_intervals');
  return { ...lk, intervals, A, locText, asset };
}

// ---------------- Label QR (cetak & tempel di PC; scan = buka form maintenance PC tsb) ----------------
const ROOM_COL = "(SELECT aa.room FROM asset_assignments aa WHERE aa.asset_id=a.id AND aa.assignment_role='PENGGUNA_UTAMA' AND aa.is_current=1 LIMIT 1) AS assign_room";
router.get('/labels', can('asset.view'), async (req, res) => {
  const { addresses } = require('../services/network');
  const { qrSvg } = require('../utils/qr');
  let rows;
  const ids = String(req.query.ids || '').split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 500);
  if (ids.length) {
    rows = await db.query(`SELECT ${A.LIST_COLS}, ${ROOM_COL} ${A.LIST_FROM} WHERE a.deleted_at IS NULL AND a.id IN (?) ORDER BY a.hostname`, [ids]);
  } else {
    const f = A.filterSql(req.query);
    rows = await db.query(`SELECT ${A.LIST_COLS}, ${ROOM_COL} ${A.LIST_FROM} WHERE ${f.where} ORDER BY a.hostname, a.id LIMIT 500`, f.params);
  }
  const net = await addresses(req.app, req);
  const labels = rows.map((a) => ({ a, url: `${net.primary}/s/${a.id}`, svg: qrSvg(`${net.primary}/s/${a.id}`) }));
  res.render('assets/labels', { layout: false, labels, net, locText });
});

router.get('/new', can('asset.create'), async (req, res) => {
  res.render('assets/form', { title: 'Tambah Aset', mode: 'create', ...(await formData({ asset_status: 'Aktif', warranty_status: 'Tidak Diketahui', device_type: 'Desktop PC' })) });
});

router.post('/', can('asset.create'), uploads.photoUpload, async (req, res) => {
  const v = A.validateAsset(req.body);
  let photo = [];
  try {
    if (!v.ok) throw new ValidationError(v.errors);
    photo = uploads.validateFiles(req.files, uploads.PHOTO_FIELDS);
  } catch (e) { uploads.removeTemp(req.files); throw e; }
  let moved = [];
  try {
    const id = await db.transaction(async (t) => {
      if (!v.data.asset_code) v.data.asset_code = await autoAssetCode(t, v.data.device_type);
      if (!v.data.hostname) v.data.hostname = v.data.asset_code; // nama perangkat = kode aset
      const cols = Object.keys(A.assetSchema);
      const r = await t.query(`INSERT INTO assets (${cols.join(', ')}, created_by, updated_by) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`, [...cols.map((c) => v.data[c]), req.user.id, req.user.id]);
      if (photo.length) {
        moved = uploads.persist(photo, `assets/${r.insertId}`);
        await t.query('UPDATE assets SET photo_path=? WHERE id=?', [moved[0].storedPath, r.insertId]);
      }
      await audit.log(req, 'CREATE', { entity: 'assets', id: r.insertId, description: `Aset ${v.data.asset_code} ditambahkan`, after: v.data }, t);
      return r.insertId;
    });
    res.done(`Aset ${v.data.asset_code} berhasil ditambahkan.`, `/assets/${id}`);
  } catch (e) { uploads.removeFiles(moved); uploads.removeTemp(req.files); throw e; }
});

router.get('/:id/edit', can('asset.update'), async (req, res) => {
  const asset = await A.getAsset(req.params.id);
  if (!asset) throw notFound();
  res.render('assets/form', { title: `Ubah Aset ${asset.asset_code}`, mode: 'edit', ...(await formData(asset)) });
});

router.post('/:id', can('asset.update'), uploads.photoUpload, async (req, res) => {
  const before = await db.one('SELECT * FROM assets WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!before) { uploads.removeTemp(req.files); throw notFound(); }
  const v = A.validateAsset(req.body);
  let photo = [];
  try {
    if (!v.ok) throw new ValidationError(v.errors);
    photo = uploads.validateFiles(req.files, uploads.PHOTO_FIELDS);
  } catch (e) { uploads.removeTemp(req.files); throw e; }
  let moved = [];
  try {
    if (!v.data.asset_code) v.data.asset_code = before.asset_code; // kosong = tetap memakai kode/nomor yang ada
    await db.transaction(async (t) => {
      const cols = A.FORM_COLS; // kolom yang tidak ada di form tetap memakai nilai lama
      await t.query(`UPDATE assets SET ${cols.map((c) => `${c}=?`).join(', ')}, updated_by=? WHERE id=?`, [...cols.map((c) => v.data[c]), req.user.id, before.id]);
      if (photo.length) {
        moved = uploads.persist(photo, `assets/${before.id}`);
        await t.query('UPDATE assets SET photo_path=? WHERE id=?', [moved[0].storedPath, before.id]);
      } else if (req.body.remove_photo === '1') {
        await t.query('UPDATE assets SET photo_path=NULL WHERE id=?', [before.id]);
      }
      if (before.asset_status !== v.data.asset_status) await assignments.movement(t, before.id, 'STATUS', before.asset_status, v.data.asset_status, req.body.change_reason, req.user.id);
      if ((before.location_id || null) !== (v.data.location_id || null)) {
        const [o, n] = await Promise.all([before.location_id && t.one('SELECT * FROM locations WHERE id=?', [before.location_id]), v.data.location_id && t.one('SELECT * FROM locations WHERE id=?', [v.data.location_id])]);
        await assignments.movement(t, before.id, 'LOKASI', o ? locText(o) : null, n ? locText(n) : null, req.body.change_reason || 'Perubahan data aset', req.user.id);
      }
      const d = audit.diff(before, Object.fromEntries(A.FORM_COLS.map((c) => [c, v.data[c]])));
      await audit.log(req, 'UPDATE', { entity: 'assets', id: before.id, description: `Aset ${v.data.asset_code} diubah`, ...d }, t);
    });
    res.done('Data aset berhasil diperbarui.', `/assets/${before.id}`);
  } catch (e) { uploads.removeFiles(moved); uploads.removeTemp(req.files); throw e; }
});

router.post('/:id/delete', can('asset.delete'), async (req, res) => {
  const a = await db.one('SELECT id, asset_code FROM assets WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!a) throw notFound();
  await db.transaction(async (t) => {
    await t.query('UPDATE assets SET deleted_at=NOW(), updated_by=? WHERE id=?', [req.user.id, a.id]);
    await t.query("UPDATE maintenance_schedules SET status='Dibatalkan', notes=CONCAT(COALESCE(notes,''),' [aset dihapus]') WHERE asset_id=? AND status IN ('Terjadwal','Ditunda')", [a.id]);
    await audit.log(req, 'DELETE', { entity: 'assets', id: a.id, description: `Aset ${a.asset_code} dihapus (soft delete, riwayat tetap tersimpan)` }, t);
  });
  res.done(`Aset ${a.asset_code} dihapus. Riwayat maintenance tetap tersimpan.`, '/assets');
});

// ---------------- Detail ----------------
router.get('/:id', can('asset.view'), async (req, res) => {
  const asset = await A.getAsset(req.params.id);
  if (!asset) throw notFound();
  const id = asset.id;
  const [storages, assignHist, records, storageReadings, batteryReadings, repairs, movements, attachments, schedules, followUps, techs, lk] = await Promise.all([
    db.query('SELECT * FROM storage_devices WHERE asset_id=? ORDER BY is_active DESC, storage_type DESC, id', [id]),
    db.query(`SELECT aa.*, COALESCE(e.full_name, aa.employee_name_snapshot) AS emp_name, e.nik, e.position, e.email, e.phone_ext, u.full_name AS by_name
                FROM asset_assignments aa LEFT JOIN employees e ON e.id=aa.employee_id LEFT JOIN users u ON u.id=aa.created_by
               WHERE aa.asset_id=? ORDER BY aa.is_current DESC, aa.start_date DESC, aa.id DESC`, [id]),
    db.query(`SELECT r.id, r.maintenance_no, r.maintenance_date, r.status, r.final_condition, r.evaluated_status, r.storage_status, r.cpu_temp_c,
                     r.approval_status, r.employee_name_snapshot, r.department_snapshot, u.full_name AS technician
                FROM maintenance_records r LEFT JOIN users u ON u.id=r.technician_user_id
               WHERE r.asset_id=? AND r.deleted_at IS NULL ORDER BY r.maintenance_date DESC, r.id DESC`, [id]),
    db.query(`SELECT s.*, r.maintenance_date, r.maintenance_no FROM maintenance_storage_readings s JOIN maintenance_records r ON r.id=s.maintenance_record_id
               WHERE r.asset_id=? AND r.deleted_at IS NULL AND r.status = 'Selesai' ORDER BY r.maintenance_date, r.id, s.sort_order`, [id]),
    db.query(`SELECT b.*, r.maintenance_date, r.maintenance_no FROM maintenance_battery_readings b JOIN maintenance_records r ON r.id=b.maintenance_record_id
               WHERE r.asset_id=? AND r.deleted_at IS NULL AND r.status = 'Selesai' AND b.is_applicable=1 ORDER BY r.maintenance_date, r.id`, [id]),
    db.query(`SELECT rr.*, u.full_name AS technician, r.maintenance_no FROM repair_records rr LEFT JOIN users u ON u.id=rr.technician_user_id
               LEFT JOIN maintenance_records r ON r.id=rr.maintenance_record_id WHERE rr.asset_id=? AND rr.deleted_at IS NULL ORDER BY rr.repair_date DESC`, [id]),
    db.query('SELECT m.*, u.full_name AS by_name FROM asset_movements m LEFT JOIN users u ON u.id=m.moved_by WHERE m.asset_id=? ORDER BY m.moved_at DESC, m.id DESC', [id]),
    db.query(`SELECT at.*, r.maintenance_no, r.maintenance_date FROM maintenance_attachments at JOIN maintenance_records r ON r.id=at.maintenance_record_id
               WHERE r.asset_id=? AND at.deleted_at IS NULL AND r.deleted_at IS NULL ORDER BY r.maintenance_date DESC, at.id`, [id]),
    db.query(`SELECT s.*, u.full_name AS technician FROM maintenance_schedules s LEFT JOIN users u ON u.id=s.technician_user_id
               WHERE s.asset_id=? AND s.deleted_at IS NULL ORDER BY s.scheduled_date DESC LIMIT 50`, [id]),
    db.query(`SELECT f.*, u.full_name AS pic FROM follow_up_actions f LEFT JOIN users u ON u.id=f.pic_user_id WHERE f.asset_id=? AND f.deleted_at IS NULL ORDER BY f.created_at DESC`, [id]),
    db.query("SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.is_active=1 AND u.deleted_at IS NULL AND r.code IN ('IT_STAFF','MANAGER_IT','ADMIN') ORDER BY u.full_name"),
    lookups(),
  ]);
  const units = await workUnits();
  const completed = records.filter((r) => r.status === 'Selesai').slice().reverse();
  const cfg = await settings.all();
  const dropHealth = Number(cfg.health_drop_significant || 5);
  const dropBattery = Number(cfg.battery_drop_significant || 10);
  const riseTemp = Number(cfg.temp_rise_significant || 10);

  // ---- Seri grafik dari histori nyata (tanpa data palsu) ----
  const storageKey = (s) => (s.storage_device_id ? `d${s.storage_device_id}` : `${s.storage_type}-${s.serial_number || s.model || s.sort_order}`);
  const storageNames = {};
  for (const s of storageReadings) storageNames[storageKey(s)] = `${s.storage_type} ${[s.brand, s.model].filter(Boolean).join(' ') || ''}`.trim();
  const dates = [...new Set([...completed.map((r) => r.maintenance_date), ...storageReadings.map((s) => s.maintenance_date)])].sort();
  const palette = ['#4c8c2b', '#1f9d62', '#2f6fd6', '#e07b10', '#d93a3a', '#0f9db8'];
  const tempDatasets = [];
  if (completed.some((r) => r.cpu_temp_c !== null)) {
    tempDatasets.push({ label: 'CPU (°C)', data: dates.map((d) => { const r = completed.filter((x) => x.maintenance_date === d).pop(); return r ? r.cpu_temp_c : null; }), borderColor: palette[0], backgroundColor: palette[0], spanGaps: true, tension: .3 });
  }
  const healthDatasets = [];
  Object.keys(storageNames).forEach((k, i) => {
    const pick = (field) => dates.map((d) => { const s = storageReadings.filter((x) => x.maintenance_date === d && storageKey(x) === k).pop(); return s ? s[field] : null; });
    const t = pick('temperature_c');
    if (t.some((x) => x !== null)) tempDatasets.push({ label: `${storageNames[k]} (°C)`, data: t, borderColor: palette[(i + 1) % 6], backgroundColor: palette[(i + 1) % 6], spanGaps: true, tension: .3 });
    const hv = pick('health_percent');
    if (hv.some((x) => x !== null)) healthDatasets.push({ label: `${storageNames[k]} (%)`, data: hv, borderColor: palette[(i + 1) % 6], backgroundColor: palette[(i + 1) % 6], spanGaps: true, tension: .3 });
  });
  const labels = dates.map((d) => h.fmtDate(d));
  const battLabels = batteryReadings.map((b) => h.fmtDate(b.maintenance_date));

  // ---- Penanda penurunan signifikan ----
  const alerts = [];
  const byKey = {};
  for (const s of storageReadings) (byKey[storageKey(s)] = byKey[storageKey(s)] || []).push(s);
  for (const [k, list] of Object.entries(byKey)) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]; const b = list[i];
      if (a.health_percent !== null && b.health_percent !== null && a.health_percent - b.health_percent >= dropHealth) {
        alerts.push({ tone: 'danger', text: `${storageNames[k]}: health turun ${h.fmtNum(a.health_percent - b.health_percent)} poin (${h.fmtNum(a.health_percent)}% → ${h.fmtNum(b.health_percent)}%) pada ${h.fmtDate(b.maintenance_date)}.` });
        b.drop = true;
      }
      if (a.temperature_c !== null && b.temperature_c !== null && b.temperature_c - a.temperature_c >= riseTemp) {
        alerts.push({ tone: 'warning', text: `${storageNames[k]}: suhu naik ${h.fmtNum(b.temperature_c - a.temperature_c)}°C pada ${h.fmtDate(b.maintenance_date)}.` });
      }
    }
  }
  for (let i = 1; i < completed.length; i++) {
    const a = completed[i - 1]; const b = completed[i];
    if (a.cpu_temp_c !== null && b.cpu_temp_c !== null && b.cpu_temp_c - a.cpu_temp_c >= riseTemp) alerts.push({ tone: 'warning', text: `Suhu CPU naik ${h.fmtNum(b.cpu_temp_c - a.cpu_temp_c)}°C pada ${h.fmtDate(b.maintenance_date)} (${b.maintenance_no}).` });
  }
  for (let i = 1; i < batteryReadings.length; i++) {
    const a = batteryReadings[i - 1]; const b = batteryReadings[i];
    if (a.health_percent !== null && b.health_percent !== null && a.health_percent - b.health_percent >= dropBattery) {
      alerts.push({ tone: 'danger', text: `Battery health turun ${h.fmtNum(a.health_percent - b.health_percent)} poin pada ${h.fmtDate(b.maintenance_date)}.` }); b.drop = true;
    }
  }

  const interval = await settings.intervalFor(asset);
  const lastDone = completed.length ? completed[completed.length - 1] : null;
  let recommended = null;
  if (lastDone) {
    let days = interval.days;
    if (asset.current_health_status === 'KRITIS') days = Math.min(days, Number(cfg.interval_critical_days || 7));
    else if (asset.current_health_status === 'PERHATIAN') days = Math.min(days, Number(cfg.interval_attention_days || 30));
    recommended = { date: h.addDays(lastDone.maintenance_date, days), days, base: interval };
  }

  res.render('assets/show', {
    title: `${asset.asset_code} · ${asset.hostname}`, asset, storages, assignHist, records, storageReadings, batteryReadings, repairs, movements,
    attachments, schedules, followUps, techs, units, ...lk, A, locText, alerts, recommended, interval,
    charts: true,
    chartTemp: { type: 'line', data: { labels, datasets: tempDatasets }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { title: { display: true, text: '°C' } } } } },
    chartHealth: { type: 'line', data: { labels, datasets: healthDatasets }, options: { maintainAspectRatio: false, __percentAxis: true, interaction: { mode: 'index', intersect: false } } },
    chartBattery: { type: 'line', data: { labels: battLabels, datasets: [{ label: 'Battery health (%)', data: batteryReadings.map((b) => b.health_percent), borderColor: '#e07b10', backgroundColor: '#e07b10', spanGaps: true, tension: .3 }] }, options: { maintainAspectRatio: false, __percentAxis: true } },
    canManage: has(req.user, 'asset.update'), canAssign: has(req.user, 'employee.manage'),
  });
});

// ---------------- Storage terdaftar ----------------
router.post('/:id/storages', can('asset.update'), async (req, res) => {
  const a = await db.one('SELECT id, asset_code FROM assets WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!a) throw notFound();
  const v = validate(req.body, A.storageSchema); if (!v.ok) throw new ValidationError(v.errors);
  const r = await db.query('INSERT INTO storage_devices (asset_id, storage_type, interface, brand, model, serial_number, capacity_gb, installed_at, notes) VALUES (?,?,?,?,?,?,?,?,?)',
    [a.id, v.data.storage_type, v.data.interface, v.data.brand, v.data.model, v.data.serial_number, v.data.capacity_gb, v.data.installed_at, v.data.notes]);
  await audit.log(req, 'CREATE', { entity: 'storage_devices', id: r.insertId, description: `Storage ditambahkan ke ${a.asset_code}`, after: v.data });
  res.done('Storage ditambahkan.', `/assets/${a.id}#tab-info`);
});
router.post('/:id/storages/:sid', can('asset.update'), async (req, res) => {
  const s = await db.one('SELECT * FROM storage_devices WHERE id=? AND asset_id=?', [req.params.sid, req.params.id]);
  if (!s) throw Object.assign(new Error('Storage tidak ditemukan.'), { status: 404 });
  if (req.body.action === 'remove') {
    const date = isValidDate(req.body.removed_at || '') ? req.body.removed_at : h.today();
    await db.query('UPDATE storage_devices SET is_active=0, removed_at=? WHERE id=?', [date, s.id]);
    await audit.log(req, 'UPDATE', { entity: 'storage_devices', id: s.id, description: 'Storage dilepas dari perangkat (riwayat pembacaan tetap tersimpan)' });
    return res.done('Storage ditandai dilepas.', `/assets/${s.asset_id}#tab-info`);
  }
  const v = validate(req.body, A.storageSchema); if (!v.ok) throw new ValidationError(v.errors);
  await db.query('UPDATE storage_devices SET storage_type=?, interface=?, brand=?, model=?, serial_number=?, capacity_gb=?, installed_at=?, notes=? WHERE id=?',
    [v.data.storage_type, v.data.interface, v.data.brand, v.data.model, v.data.serial_number, v.data.capacity_gb, v.data.installed_at, v.data.notes, s.id]);
  await audit.log(req, 'UPDATE', { entity: 'storage_devices', id: s.id, ...audit.diff(s, v.data) });
  res.done('Storage diperbarui.', `/assets/${s.asset_id}#tab-info`);
});

// ---------------- Penugasan pengguna / PIC ----------------
const assignSchema = {
  assignment_role: { label: 'Peran', type: 'enum', values: ['PENGGUNA_UTAMA', 'PIC_UNIT'], required: true },
  employee_id: { label: 'Karyawan', type: 'id', required: true },
  department_id: { label: 'Departemen', type: 'id' },
  work_unit_id: { label: 'Unit kerja', type: 'id' },
  location_id: { label: 'Lokasi', type: 'id' },
  room: { label: 'Ruangan', maxLength: 120 },
  start_date: { label: 'Tanggal mulai penggunaan', type: 'date', required: true },
  status: { label: 'Status penggunaan', type: 'enum', values: ['Aktif', 'Dipinjamkan'], required: true },
  reason: { label: 'Alasan', maxLength: 255 },
  notes: { label: 'Keterangan', maxLength: 2000 },
};
router.post('/:id/assign', can('employee.manage'), async (req, res) => {
  const v = validate(req.body, assignSchema); if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  if (d.start_date > h.today()) throw new ValidationError({ start_date: 'Tanggal mulai tidak boleh di masa depan.' });
  await db.transaction(async (t) => {
    const id = await assignments.assign(t, { assetId: Number(req.params.id), employeeId: d.employee_id, role: d.assignment_role, departmentId: d.department_id,
      workUnitId: d.work_unit_id, locationId: d.location_id, room: d.room, startDate: d.start_date, status: d.status, reason: d.reason, notes: d.notes }, req.user.id);
    await audit.log(req, 'ASSIGN', { entity: 'asset_assignments', id, description: `Penugasan ${d.assignment_role} aset #${req.params.id}`, after: d }, t);
  });
  res.done('Penugasan perangkat disimpan. Riwayat sebelumnya tetap tersimpan.', `/assets/${req.params.id}#tab-user`);
});
router.post('/:id/release', can('employee.manage'), async (req, res) => {
  const role = req.body.assignment_role === 'PIC_UNIT' ? 'PIC_UNIT' : 'PENGGUNA_UTAMA';
  const date = isValidDate(req.body.end_date || '') ? req.body.end_date : h.today();
  await db.transaction(async (t) => {
    const ok = await assignments.release(t, Number(req.params.id), role, { endDate: date, reason: req.body.reason || null }, req.user.id);
    if (!ok) throw new ValidationError({ _: 'Tidak ada penugasan aktif.' }, 'Tidak ada penugasan aktif untuk dilepas.');
    await audit.log(req, 'RELEASE', { entity: 'assets', id: req.params.id, description: `Penugasan ${role} dilepas` }, t);
  });
  res.done('Penugasan dilepas. Riwayat tetap tersimpan.', `/assets/${req.params.id}#tab-user`);
});

module.exports = router;
