'use strict';
const db = require('../config/db');
const h = require('../utils/helpers');
const { LEVEL_LABEL } = require('./evaluation');

const TYPES = {
  hasil: 'Tabel Hasil Maintenance',
  ringkasan: 'Ringkasan Kondisi Perangkat',
  'per-aset': 'Riwayat Maintenance per Aset',
  perbaikan: 'Daftar Perangkat Perlu Perbaikan',
  storage: 'Perangkat Membutuhkan Penggantian Storage',
  terlambat: 'Daftar Maintenance Terlambat',
  penggunaan: 'Penggunaan PC per Unit Kerja',
};

function recFilters(q) {
  const w = ['r.deleted_at IS NULL', "r.status <> 'Draft'"]; const p = [];
  if (q.from) { w.push('r.maintenance_date >= ?'); p.push(q.from); }
  if (q.to) { w.push('r.maintenance_date <= ?'); p.push(q.to); }
  if (q.asset_q) { const like = `%${h.likeEscape(q.asset_q)}%`; w.push('(r.asset_code_snapshot LIKE ? OR r.hostname_snapshot LIKE ?)'); p.push(like, like); }
  if (q.asset_id) { w.push('r.asset_id = ?'); p.push(q.asset_id); }
  const eq = { technician_user_id: 'r.technician_user_id', department_id: 'r.department_id', work_unit_id: 'r.work_unit_id', location_id: 'r.location_id',
    final_condition: 'r.final_condition', status: 'r.status', storage_status: 'r.storage_status' };
  for (const [k, c] of Object.entries(eq)) if (q[k]) { w.push(`${c} = ?`); p.push(q[k]); }
  return { where: w.join(' AND '), params: p };
}
function assetFilters(q) {
  const w = ['a.deleted_at IS NULL']; const p = [];
  if (q.asset_q) { const like = `%${h.likeEscape(q.asset_q)}%`; w.push('(a.asset_code LIKE ? OR a.hostname LIKE ?)'); p.push(like, like); }
  const eq = { department_id: 'a.current_department_id', work_unit_id: 'a.current_work_unit_id', location_id: 'a.location_id', asset_id: 'a.id' };
  for (const [k, c] of Object.entries(eq)) if (q[k]) { w.push(`${c} = ?`); p.push(q[k]); }
  return { where: w.join(' AND '), params: p };
}

const storageText = (list, hddNone, ssdNone) => {
  const parts = (list || []).map((s) => `${s.storage_type}${s.interface ? ` ${s.interface}` : ''}: ${h.show(s.health_percent, '%', 'health -')}, ${h.show(s.temperature_c, '°C', 'suhu -')}, SMART ${s.smart_status || '-'}`);
  if (ssdNone) parts.unshift('SSD: tidak ada');
  if (hddNone) parts.push('HDD: tidak ada');
  return parts.join('\n') || '-';
};
const tasksText = (tasks) => {
  const done = (tasks || []).filter((t) => t.status === 'Sudah dilakukan').map((t) => t.task_name);
  const notDone = (tasks || []).filter((t) => t.status === 'Belum dilakukan').map((t) => t.task_name);
  return [done.length ? `Dilakukan: ${done.join(', ')}` : null, notDone.length ? `Belum: ${notDone.join(', ')}` : null].filter(Boolean).join('\n') || '-';
};

async function attachDetails(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [st, bt, tk] = await Promise.all([
    db.query('SELECT * FROM maintenance_storage_readings WHERE maintenance_record_id IN (?) ORDER BY sort_order', [ids]),
    db.query('SELECT * FROM maintenance_battery_readings WHERE maintenance_record_id IN (?)', [ids]),
    db.query('SELECT maintenance_record_id, task_name, status FROM maintenance_tasks WHERE maintenance_record_id IN (?) ORDER BY sort_order', [ids]),
  ]);
  for (const r of rows) {
    r.storages = st.filter((s) => s.maintenance_record_id === r.id);
    r.battery = bt.find((b) => b.maintenance_record_id === r.id) || null;
    r.tasks = tk.filter((t) => t.maintenance_record_id === r.id);
  }
  return rows;
}

const HASIL_COLS = [
  { header: 'No. Maintenance', key: 'maintenance_no', w: 1.1 },
  { header: 'Tanggal', value: (r) => `${h.fmtDate(r.maintenance_date)}${r.check_time ? ` ${r.check_time.slice(0, 5)}` : ''}`, w: 0.9, type: 'date' },
  { header: 'Aset', value: (r) => `${r.asset_code_snapshot}\n${r.hostname_snapshot || ''}\n${r.device_type_snapshot || ''}`, w: 1.2 },
  { header: 'Pengguna / Unit', value: (r) => [r.employee_name_snapshot, r.department_snapshot, r.work_unit_snapshot].filter(Boolean).join('\n') || '-', w: 1.2 },
  { header: 'Petugas IT', key: 'technician', w: 0.9 },
  { header: 'CPU', value: (r) => h.show(r.cpu_temp_c, '°C', 'tdk terbaca'), w: 0.6 },
  { header: 'Storage', value: (r) => storageText(r.storages, r.hdd_presence === 'TIDAK_ADA', r.ssd_presence === 'TIDAK_ADA'), w: 2 },
  { header: 'Baterai', value: (r) => (!r.battery || !r.battery.is_applicable ? 'Tidak berlaku' : `${h.show(r.battery.health_percent, '%', '-')} ${r.battery.battery_status || ''}`), w: 0.8 },
  { header: 'Tindakan maintenance', value: (r) => [tasksText(r.tasks), r.actions_taken].filter((x) => x && x !== '-').join('\n') || '-', w: 2 },
  { header: 'Catatan', value: (r) => r.findings || '-', w: 1.5 },
  { header: 'Kondisi Akhir', value: (r) => r.final_condition || '-', w: 0.9 },
  { header: 'Evaluasi', value: (r) => LEVEL_LABEL[r.evaluated_status], w: 0.8, color: (r) => ({ KRITIS: '#B42323', PERHATIAN: '#946500', BAIK: '#13774A' }[r.evaluated_status]) },
  { header: 'Status', key: 'status', w: 0.7 },
];

async function run(type, q) {
  const today = h.today();
  if (type === 'hasil' || type === 'per-aset') {
    if (type === 'per-aset' && !q.asset_id && !q.asset_q) return { title: TYPES[type], needs: 'Pilih / ketik kode aset untuk menampilkan riwayat per aset.', columns: HASIL_COLS, rows: [], summary: [] };
    const f = recFilters(q);
    const rows = await attachDetails(await db.query(`SELECT r.*, u.full_name AS technician FROM maintenance_records r LEFT JOIN users u ON u.id=r.technician_user_id
       WHERE ${f.where} ORDER BY ${type === 'per-aset' ? 'r.asset_code_snapshot, r.maintenance_date' : 'r.maintenance_date DESC, r.id DESC'} LIMIT 5000`, f.params));
    const cnt = (k) => rows.filter((r) => r.evaluated_status === k).length;
    return { title: TYPES[type], columns: HASIL_COLS, rows, signature: true,
      summary: [`Total: ${rows.length}`, `Baik: ${cnt('BAIK')}`, `Perlu Perhatian: ${cnt('PERHATIAN')}`, `Kritis: ${cnt('KRITIS')}`, `Selesai: ${rows.filter((r) => r.status === 'Selesai').length}`] };
  }
  if (type === 'ringkasan') {
    const f = assetFilters(q);
    const rf = recFilters(q);
    const rows = await db.query(`SELECT COALESCE(d.name,'(Tanpa departemen)') department, COALESCE(w.name,'-') work_unit, COUNT(*) total,
         SUM(a.current_health_status='BAIK') baik, SUM(a.current_health_status='PERHATIAN') perhatian, SUM(a.current_health_status='KRITIS') kritis,
         SUM(a.current_health_status='BELUM_DIEVALUASI') belum, SUM(a.next_maintenance_date < ?) terlambat,
         SUM(EXISTS (SELECT 1 FROM maintenance_records r WHERE r.asset_id=a.id AND ${rf.where} AND r.status='Selesai')) maintained
       FROM assets a LEFT JOIN departments d ON d.id=a.current_department_id LEFT JOIN work_units w ON w.id=a.current_work_unit_id
       WHERE ${f.where} AND a.asset_status <> 'Nonaktif' GROUP BY d.name, w.name ORDER BY d.name, w.name`, [today, ...rf.params, ...f.params]);
    rows.forEach((r) => Object.keys(r).forEach((k) => { if (!['department', 'work_unit'].includes(k)) r[k] = Number(r[k] || 0); }));
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    return { title: TYPES[type], rows, summary: [`Perangkat: ${sum('total')}`, `Sudah maintenance pada periode: ${sum('maintained')}`, `Baik: ${sum('baik')}`, `Perlu Perhatian: ${sum('perhatian')}`, `Kritis: ${sum('kritis')}`, `Terlambat: ${sum('terlambat')}`],
      columns: [
        { header: 'Departemen', key: 'department', w: 1.4 }, { header: 'Unit Kerja', key: 'work_unit', w: 1.4 }, { header: 'Perangkat', key: 'total', type: 'number', align: 'right' },
        { header: 'Sudah maintenance (periode)', key: 'maintained', type: 'number', align: 'right' }, { header: 'Baik', key: 'baik', type: 'number', align: 'right' },
        { header: 'Perlu Perhatian', key: 'perhatian', type: 'number', align: 'right' }, { header: 'Kritis', key: 'kritis', type: 'number', align: 'right' },
        { header: 'Belum Dievaluasi', key: 'belum', type: 'number', align: 'right' }, { header: 'Jadwal terlambat', key: 'terlambat', type: 'number', align: 'right' },
      ] };
  }
  if (type === 'perbaikan') {
    const f = assetFilters(q);
    const rows = await db.query(`SELECT a.id, a.asset_code, a.hostname, a.device_type, a.current_health_status, e.full_name employee_name, d.name department_name, w.name work_unit_name,
         lr.maintenance_no, lr.maintenance_date, lr.final_condition, lr.findings, lr.recommendation, lr.spare_parts_needed, tu.full_name technician,
         (SELECT GROUP_CONCAT(CONCAT('[',f.priority,'] ',f.title,' (',f.status,')') SEPARATOR '\n') FROM follow_up_actions f WHERE f.asset_id=a.id AND f.deleted_at IS NULL AND f.status NOT IN ('Selesai','Dibatalkan')) follow_ups
       FROM assets a
       LEFT JOIN maintenance_records lr ON lr.id = (SELECT r.id FROM maintenance_records r WHERE r.asset_id=a.id AND r.status='Selesai' AND r.deleted_at IS NULL ORDER BY r.maintenance_date DESC, r.id DESC LIMIT 1)
       LEFT JOIN users tu ON tu.id=lr.technician_user_id LEFT JOIN employees e ON e.id=a.current_employee_id LEFT JOIN departments d ON d.id=a.current_department_id LEFT JOIN work_units w ON w.id=a.current_work_unit_id
       WHERE ${f.where} AND a.asset_status <> 'Nonaktif' AND (lr.final_condition IN ('Perlu Perbaikan','Kritis') OR a.current_health_status='KRITIS'
             OR EXISTS (SELECT 1 FROM follow_up_actions f WHERE f.asset_id=a.id AND f.deleted_at IS NULL AND f.status NOT IN ('Selesai','Dibatalkan') AND f.priority IN ('Tinggi','Kritis')))
       ORDER BY FIELD(a.current_health_status,'KRITIS','PERHATIAN','BELUM_DIEVALUASI','BAIK'), a.asset_code`, f.params);
    return { title: TYPES[type], rows, summary: [`Total perangkat: ${rows.length}`], signature: true, columns: [
      { header: 'Aset', value: (r) => `${r.asset_code}\n${r.hostname}`, w: 1.1 }, { header: 'Pengguna / Departemen', value: (r) => [r.employee_name, r.department_name].filter(Boolean).join('\n') || '-', w: 1.2 },
      { header: 'Kondisi', value: (r) => LEVEL_LABEL[r.current_health_status], w: 0.8 }, { header: 'Kondisi akhir terakhir', value: (r) => r.final_condition || '-', w: 0.9 },
      { header: 'Maintenance terakhir', value: (r) => (r.maintenance_no ? `${r.maintenance_no}\n${h.fmtDate(r.maintenance_date)}\n${r.technician || ''}` : '-'), w: 1.1 },
      { header: 'Catatan', value: (r) => r.findings || '-', w: 1.6 }, { header: 'Rekomendasi / spare part', value: (r) => [r.recommendation, r.spare_parts_needed].filter(Boolean).join('\n') || '-', w: 1.6 },
      { header: 'Tindak lanjut terbuka', value: (r) => r.follow_ups || '-', w: 1.6 },
    ] };
  }
  if (type === 'storage') {
    const f = assetFilters(q);
    const rows = await db.query(`SELECT a.id, a.asset_code, a.hostname, e.full_name employee_name, d.name department_name, lr.maintenance_no, lr.maintenance_date,
         s.storage_type, s.interface, s.brand, s.model, s.serial_number, s.capacity_gb, s.health_percent, s.temperature_c, s.smart_status, s.evaluated_level
       FROM assets a
       JOIN maintenance_records lr ON lr.id = (SELECT r.id FROM maintenance_records r WHERE r.asset_id=a.id AND r.status='Selesai' AND r.deleted_at IS NULL ORDER BY r.maintenance_date DESC, r.id DESC LIMIT 1)
       JOIN maintenance_storage_readings s ON s.maintenance_record_id=lr.id
       LEFT JOIN employees e ON e.id=a.current_employee_id LEFT JOIN departments d ON d.id=a.current_department_id
       WHERE ${f.where} AND a.asset_status <> 'Nonaktif' AND (s.evaluated_level='KRITIS' OR s.smart_status='Kritis' ${q.include_attention === '1' ? "OR s.evaluated_level='PERHATIAN'" : ''})
       ORDER BY FIELD(s.evaluated_level,'KRITIS','PERHATIAN'), s.health_percent IS NULL, s.health_percent, a.asset_code`, f.params);
    return { title: TYPES[type], rows, summary: [`Total storage: ${rows.length}`, 'Kriteria: evaluasi KRITIS (health di bawah batas kritis threshold) atau SMART Kritis pada maintenance terakhir'], signature: true, columns: [
      { header: 'Aset', value: (r) => `${r.asset_code}\n${r.hostname}`, w: 1.1 }, { header: 'Pengguna / Departemen', value: (r) => [r.employee_name, r.department_name].filter(Boolean).join('\n') || '-', w: 1.2 },
      { header: 'Storage', value: (r) => `${r.storage_type} ${r.interface || ''}\n${[r.brand, r.model].filter(Boolean).join(' ')}`, w: 1.4 }, { header: 'Serial', key: 'serial_number', w: 1 },
      { header: 'Kapasitas', value: (r) => h.fmtCapacity(r.capacity_gb), w: 0.7 }, { header: 'Health', value: (r) => h.show(r.health_percent, '%', 'Tdk diperiksa'), w: 0.7 },
      { header: 'Suhu', value: (r) => h.show(r.temperature_c, '°C', '-'), w: 0.6 }, { header: 'SMART', value: (r) => r.smart_status || '-', w: 0.7 },
      { header: 'Evaluasi', value: (r) => LEVEL_LABEL[r.evaluated_level] || '-', w: 0.8, color: (r) => ({ KRITIS: '#B42323', PERHATIAN: '#946500' }[r.evaluated_level]) },
      { header: 'Pemeriksaan', value: (r) => `${r.maintenance_no}\n${h.fmtDate(r.maintenance_date)}`, w: 1 },
    ] };
  }
  if (type === 'terlambat') {
    const f = assetFilters(q);
    const extra = []; const ep = [];
    if (q.technician_user_id) { extra.push('s.technician_user_id = ?'); ep.push(q.technician_user_id); }
    const rows = await db.query(`SELECT s.*, a.asset_code, a.hostname, a.device_type, a.last_maintenance_date, a.current_health_status, e.full_name employee_name, d.name department_name, w.name work_unit_name, u.full_name technician,
         DATEDIFF(?, s.scheduled_date) late_days
       FROM maintenance_schedules s JOIN assets a ON a.id=s.asset_id LEFT JOIN employees e ON e.id=a.current_employee_id LEFT JOIN departments d ON d.id=a.current_department_id
       LEFT JOIN work_units w ON w.id=a.current_work_unit_id LEFT JOIN users u ON u.id=s.technician_user_id
       WHERE ${f.where} AND s.deleted_at IS NULL AND s.status IN ('Terjadwal','Ditunda','Dalam Proses') AND s.scheduled_date < ? ${extra.length ? `AND ${extra.join(' AND ')}` : ''}
       ORDER BY s.scheduled_date`, [today, ...f.params, today, ...ep]);
    return { title: TYPES[type], rows, summary: [`Total terlambat: ${rows.length}`, `Per tanggal ${h.fmtDate(today, true)}`], columns: [
      { header: 'Jadwal', value: (r) => h.fmtDate(r.scheduled_date), w: 0.8 }, { header: 'Terlambat', value: (r) => `${r.late_days} hari`, w: 0.6, align: 'right' },
      { header: 'Aset', value: (r) => `${r.asset_code}\n${r.hostname}`, w: 1.1 }, { header: 'Jenis', key: 'device_type', w: 0.8 },
      { header: 'Pengguna', key: 'employee_name', w: 1.1 }, { header: 'Departemen / Unit', value: (r) => [r.department_name, r.work_unit_name].filter(Boolean).join(' › ') || '-', w: 1.3 },
      { header: 'Teknisi', value: (r) => r.technician || 'Belum ditugaskan', w: 1 }, { header: 'Status', key: 'status', w: 0.7 },
      { header: 'Maintenance terakhir', value: (r) => h.fmtDate(r.last_maintenance_date), w: 0.9 },
    ] };
  }
  if (type === 'penggunaan') {
    const w = ['aa.is_current=1', 'a.deleted_at IS NULL']; const p = [];
    for (const [k, c] of Object.entries({ department_id: 'aa.department_id', work_unit_id: 'aa.work_unit_id', location_id: 'aa.location_id' })) if (q[k]) { w.push(`${c} = ?`); p.push(q[k]); }
    if (q.asset_q) { const like = `%${h.likeEscape(q.asset_q)}%`; w.push('(a.asset_code LIKE ? OR a.hostname LIKE ? OR aa.employee_name_snapshot LIKE ?)'); p.push(like, like, like); }
    const rows = await db.query(`SELECT COALESCE(d.name, aa.department_name_snapshot, '(Tanpa departemen)') department, COALESCE(wu.name, aa.work_unit_name_snapshot, '-') work_unit,
         a.asset_code, a.hostname, a.device_type, a.brand, a.model, a.current_health_status, COALESCE(e.full_name, aa.employee_name_snapshot) employee_name, e.nik,
         aa.assignment_role, aa.start_date, aa.status, aa.location_text_snapshot, aa.room
       FROM asset_assignments aa JOIN assets a ON a.id=aa.asset_id LEFT JOIN employees e ON e.id=aa.employee_id LEFT JOIN departments d ON d.id=aa.department_id LEFT JOIN work_units wu ON wu.id=aa.work_unit_id
       WHERE ${w.join(' AND ')} ORDER BY department, work_unit, aa.assignment_role, employee_name`, p);
    const units = new Set(rows.map((r) => `${r.department}|${r.work_unit}`));
    return { title: TYPES[type], rows, summary: [`Unit kerja: ${units.size}`, `Penugasan aktif: ${rows.length}`, `Laptop: ${rows.filter((r) => r.device_type === 'Laptop').length}`, `Desktop/Workstation: ${rows.filter((r) => r.device_type !== 'Laptop').length}`], columns: [
      { header: 'Departemen', key: 'department', w: 1.1 }, { header: 'Unit Kerja', key: 'work_unit', w: 1.1 },
      { header: 'Pengguna', value: (r) => `${r.employee_name || '-'}${r.nik ? `\n${r.nik}` : ''}`, w: 1.3 }, { header: 'Peran', value: (r) => (r.assignment_role === 'PIC_UNIT' ? 'PIC unit' : 'Pengguna utama'), w: 0.8 },
      { header: 'Aset', value: (r) => `${r.asset_code}\n${r.hostname}`, w: 1.1 }, { header: 'Jenis / Model', value: (r) => `${r.device_type}\n${[r.brand, r.model].filter(Boolean).join(' ')}`, w: 1.2 },
      { header: 'Lokasi', value: (r) => [r.location_text_snapshot, r.room ? `R. ${r.room}` : null].filter(Boolean).join(' · ') || '-', w: 1.3 },
      { header: 'Mulai', value: (r) => h.fmtDate(r.start_date), w: 0.7 }, { header: 'Status', key: 'status', w: 0.6 }, { header: 'Kondisi', value: (r) => LEVEL_LABEL[r.current_health_status], w: 0.8 },
    ] };
  }
  return null;
}

function filterText(q, names) {
  const parts = [];
  if (q.from || q.to) parts.push(`Periode ${q.from ? h.fmtDate(q.from) : '...'} – ${q.to ? h.fmtDate(q.to) : '...'}`);
  if (q.asset_q) parts.push(`Aset: ${q.asset_q}`);
  for (const [k, label] of [['technician_user_id', 'Petugas'], ['department_id', 'Departemen'], ['work_unit_id', 'Unit'], ['location_id', 'Lokasi']]) if (q[k] && names[k]) parts.push(`${label}: ${names[k]}`);
  for (const [k, label] of [['final_condition', 'Kondisi akhir'], ['status', 'Status'], ['storage_status', 'Kesehatan storage']]) if (q[k]) parts.push(`${label}: ${k === 'storage_status' ? LEVEL_LABEL[q[k]] : q[k]}`);
  return parts.join(' · ') || 'Semua data';
}

module.exports = { TYPES, run, filterText };
