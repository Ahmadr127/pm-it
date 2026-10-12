'use strict';
const db = require('../config/db');
const h = require('../utils/helpers');
const { validate } = require('../utils/validate');

const DEVICE_TYPES = ['Desktop PC', 'Laptop', 'Workstation', 'Lainnya'];
const ASSET_STATUS = ['Aktif', 'Dipinjamkan', 'Dalam Perbaikan', 'Cadangan', 'Nonaktif'];
const WARRANTY = ['Aktif', 'Habis', 'Tidak Ada', 'Tidak Diketahui'];
const PHYSICAL = ['Baik', 'Cukup', 'Rusak Ringan', 'Rusak Berat'];
const STORAGE_TYPES = ['SSD', 'HDD'];
const INTERFACES = ['SATA', 'NVMe', 'SAS', 'USB', 'Lainnya'];

const assetSchema = {
  // Opsional: PC yang belum memiliki kode aset diberi nomor otomatis (dapat diganti kode resmi nanti)
  asset_code: { label: 'Kode aset', type: 'code', maxLength: 50, upper: true },
  inventory_number: { label: 'Nomor inventaris', maxLength: 60 },
  hostname: { label: 'Nama perangkat / hostname', maxLength: 100 }, // kosong = memakai kode aset
  device_type: { label: 'Jenis perangkat', required: true, type: 'enum', values: DEVICE_TYPES },
  device_type_other: { label: 'Jenis lainnya', maxLength: 80 },
  brand: { label: 'Brand', maxLength: 80 },
  model: { label: 'Model', maxLength: 120 },
  serial_number: { label: 'Serial number', maxLength: 100 },
  processor: { label: 'Processor', maxLength: 150 },
  ram_gb: { label: 'Kapasitas RAM', type: 'decimal', min: 0.5, max: 4096, unit: ' GB' },
  storage_summary: { label: 'Jenis & kapasitas storage', maxLength: 200 },
  gpu: { label: 'VGA/GPU', maxLength: 150 },
  operating_system: { label: 'Sistem operasi', maxLength: 120 },
  ip_address: { label: 'IP address', type: 'ip' },
  mac_address: { label: 'MAC address', type: 'mac' },
  location_id: { label: 'Lokasi', type: 'id' },
  purchase_date: { label: 'Tanggal pembelian', type: 'date' },
  warranty_status: { label: 'Status garansi', type: 'enum', values: WARRANTY, default: 'Tidak Diketahui' },
  warranty_until: { label: 'Garansi berlaku sampai', type: 'date' },
  physical_condition: { label: 'Kondisi perangkat', type: 'enum', values: PHYSICAL },
  asset_status: { label: 'Status aset', required: true, type: 'enum', values: ASSET_STATUS },
  has_battery: { type: 'bool' },
  maintenance_interval_days: { label: 'Interval maintenance khusus', type: 'int', min: 1, max: 730, unit: ' hari' },
  notes: { label: 'Catatan', maxLength: 5000 },
};

// Kolom yang tidak lagi ada di form Tambah/Ubah Aset (data lama tetap tersimpan, tidak ditimpa saat diubah)
const FORM_HIDDEN = ['inventory_number', 'hostname', 'brand', 'model', 'serial_number', 'mac_address', 'purchase_date', 'warranty_status', 'warranty_until', 'maintenance_interval_days'];
const FORM_COLS = Object.keys(assetSchema).filter((k) => !FORM_HIDDEN.includes(k));

function validateAsset(body) {
  const v = validate(body, assetSchema);
  if (v.data.device_type === 'Lainnya' && !v.data.device_type_other) v.errors.device_type_other = 'Sebutkan jenis perangkat lainnya.';
  if (v.data.device_type !== 'Lainnya') v.data.device_type_other = null;
  if (v.data.purchase_date && v.data.purchase_date > h.today()) v.errors.purchase_date = 'Tanggal pembelian tidak boleh di masa depan.';
  if (v.data.warranty_until && v.data.purchase_date && v.data.warranty_until < v.data.purchase_date) v.errors.warranty_until = 'Tanggal garansi tidak boleh sebelum tanggal pembelian.';
  v.ok = Object.keys(v.errors).length === 0;
  return v;
}

const storageSchema = {
  storage_type: { label: 'Jenis storage', required: true, type: 'enum', values: STORAGE_TYPES },
  interface: { label: 'Antarmuka', type: 'enum', values: INTERFACES },
  brand: { label: 'Merek', maxLength: 80 },
  model: { label: 'Model', maxLength: 120 },
  serial_number: { label: 'Serial number', maxLength: 100 },
  capacity_gb: { label: 'Kapasitas', type: 'decimal', min: 1, max: 1000000, unit: ' GB' },
  installed_at: { label: 'Tanggal pasang', type: 'date' },
  notes: { label: 'Catatan', maxLength: 255 },
};

/** Query daftar aset + filter. Mengembalikan { where, params }. */
function filterSql(q) {
  const where = ['a.deleted_at IS NULL'];
  const params = [];
  if (q.q) {
    const like = `%${h.likeEscape(String(q.q).trim())}%`;
    where.push(`(a.asset_code LIKE ? OR a.hostname LIKE ? OR a.inventory_number LIKE ? OR a.serial_number LIKE ? OR a.ip_address LIKE ?
                 OR e.full_name LIKE ? OR e.nik LIKE ? OR d.name LIKE ? OR wu.name LIKE ? OR l.name LIKE ? OR l.room LIKE ?)`);
    params.push(like, like, like, like, like, like, like, like, like, like, like);
  }
  const eq = { device_type: 'a.device_type', asset_status: 'a.asset_status', health: 'a.current_health_status', department_id: 'a.current_department_id', work_unit_id: 'a.current_work_unit_id', location_id: 'a.location_id' };
  for (const [k, col] of Object.entries(eq)) if (q[k]) { where.push(`${col} = ?`); params.push(q[k]); }
  if (q.due === 'overdue') { where.push('a.next_maintenance_date < CURRENT_DATE'); }
  if (q.due === 'never') { where.push('a.last_maintenance_date IS NULL'); }
  return { where: where.join(' AND '), params };
}

const LIST_FROM = `FROM assets a
  LEFT JOIN employees e ON e.id = a.current_employee_id
  LEFT JOIN departments d ON d.id = a.current_department_id
  LEFT JOIN work_units wu ON wu.id = a.current_work_unit_id
  LEFT JOIN locations l ON l.id = a.location_id`;

const LIST_COLS = `a.*, e.full_name AS employee_name, e.nik AS employee_nik, d.name AS department_name, wu.name AS work_unit_name,
  l.name AS location_name, l.building AS location_building, l.room AS location_room`;

async function getAsset(id, conn = db) {
  return conn.one(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE a.id = ? AND a.deleted_at IS NULL`, [id]);
}

/** Konteks aset untuk form maintenance: data perangkat + pengguna aktif + storage terdaftar. */
async function maintenanceContext(assetId, conn = db) {
  const a = await getAsset(assetId, conn);
  if (!a) return null;
  const [storages, pic] = await Promise.all([
    conn.query('SELECT * FROM storage_devices WHERE asset_id=? AND is_active=1 ORDER BY storage_type DESC, id', [assetId]),
    conn.one(`SELECT aa.*, COALESCE(e.full_name, aa.employee_name_snapshot) AS name FROM asset_assignments aa LEFT JOIN employees e ON e.id=aa.employee_id
             WHERE aa.asset_id=? AND aa.assignment_role='PIC_UNIT' AND aa.is_current=1`, [assetId]),
  ]);
  const primary = await conn.one("SELECT room FROM asset_assignments WHERE asset_id=? AND assignment_role='PENGGUNA_UTAMA' AND is_current=1", [assetId]);
  return {
    id: a.id, asset_code: a.asset_code, hostname: a.hostname, device_type: a.device_type, brand: a.brand, model: a.model,
    processor: a.processor, has_battery: !!a.has_battery, employee_id: a.current_employee_id, employee_name: a.employee_name,
    employee_nik: a.employee_nik, department_id: a.current_department_id, department_name: a.department_name,
    work_unit_id: a.current_work_unit_id, work_unit_name: a.work_unit_name, location_id: a.location_id,
    location_text: [a.location_name, a.location_building].filter(Boolean).join(' · '),
    room: (primary && primary.room) || a.location_room || null,
    pic_name: pic ? pic.name : null, asset_status: a.asset_status,
    last_maintenance_date: a.last_maintenance_date, next_maintenance_date: a.next_maintenance_date,
    storages: storages.map((s) => ({ id: s.id, storage_type: s.storage_type, interface: s.interface, brand: s.brand, model: s.model, serial_number: s.serial_number, capacity_gb: s.capacity_gb })),
  };
}

module.exports = {
  DEVICE_TYPES, ASSET_STATUS, WARRANTY, PHYSICAL, STORAGE_TYPES, INTERFACES,
  assetSchema, FORM_COLS, validateAsset, storageSchema, filterSql, LIST_FROM, LIST_COLS, getAsset, maintenanceContext,
};
