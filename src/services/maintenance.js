'use strict';
/**
 * Penyimpanan maintenance beserta pembacaan hardware, checklist, dan lampiran
 * dalam SATU transaksi database. Bila satu bagian gagal, seluruhnya dibatalkan
 * (termasuk file yang sudah dipindahkan ke penyimpanan permanen).
 */
const db = require('../config/db');
const settings = require('./settings');
const audit = require('./audit');
const uploads = require('./uploads');
const notifications = require('./notifications');
const { evaluate } = require('./evaluation');
const { validate, ValidationError, clean } = require('../utils/validate');
const h = require('../utils/helpers');
const A = require('./assets');

const RECORD_STATUS = ['Draft', 'Terjadwal', 'Dalam Proses', 'Selesai', 'Ditunda'];
const FINAL = ['Baik', 'Baik dengan catatan', 'Perlu Monitoring', 'Perlu Perbaikan', 'Kritis'];
const SMART = ['Baik', 'Peringatan', 'Kritis', 'Tidak Tersedia'];
const TASK_STATUS = ['Sudah dilakukan', 'Tidak diperlukan', 'Belum dilakukan'];
const BATTERY_STATUS = ['Baik', 'Menurun', 'Perlu Penggantian', 'Tidak Terdeteksi', 'Tidak Dapat Dibaca'];
const FOLLOW_STATUS = ['Tidak Perlu', 'Perlu Tindak Lanjut', 'Dalam Proses', 'Selesai'];
const LOAD = ['Idle', 'Normal', 'Beban Tinggi', 'Tidak Diketahui'];
const SOURCE = ['MANUAL', 'AGENT'];

async function tempRange() {
  return { min: await settings.getInt('temp_min_valid', -10), max: await settings.getInt('temp_max_valid', 130) };
}

function arr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'object') return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]).filter(Boolean);
  return [];
}

/**
 * Validasi & normalisasi input form.
 * @param action 'draft' | 'save' | 'complete'
 */
async function parse(body, action, asset, taskDefs) {
  const t = await tempRange();
  const errors = {};
  const core = validate(body, {
    maintenance_date: { label: 'Tanggal maintenance', type: 'date', required: true },
    check_time: { label: 'Jam pemeriksaan', type: 'time', required: action !== 'draft' },
    technician_user_id: { label: 'Petugas IT', type: 'id', required: action !== 'draft' },
    status: { label: 'Status maintenance', type: 'enum', values: RECORD_STATUS.filter((s) => s !== 'Draft'), required: action === 'save' },
    schedule_id: { label: 'Jadwal', type: 'id' },
    cpu_temp_c: { label: 'Suhu CPU', type: 'decimal', min: t.min, max: t.max, unit: '°C' },
    cpu_unavailable: { type: 'bool' },
    cpu_load_condition: { label: 'Kondisi beban', type: 'enum', values: LOAD },
    cpu_reading_tool: { label: 'Alat ukur', maxLength: 80 },
    cpu_data_source: { label: 'Sumber data CPU', type: 'enum', values: SOURCE, default: 'MANUAL' },
    hdd_presence: { label: 'Keberadaan HDD', type: 'enum', values: ['ADA', 'TIDAK_ADA'] },
    ssd_presence: { label: 'Keberadaan SSD', type: 'enum', values: ['ADA', 'TIDAK_ADA'] },
    physical_condition: { label: 'Kondisi fisik', type: 'enum', values: A.PHYSICAL },
    final_condition: { label: 'Kondisi akhir', type: 'enum', values: FINAL },
    user_complaint: { label: 'Keluhan pengguna', maxLength: 5000 },
    findings: { label: 'Catatan preventive maintenance', maxLength: 5000 },
    root_cause: { label: 'Analisis penyebab', maxLength: 5000 },
    actions_taken: { label: 'Tindakan yang dilakukan', maxLength: 5000 },
    recommendation: { label: 'Rekomendasi IT', maxLength: 5000 },
    spare_parts_needed: { label: 'Kebutuhan spare part', maxLength: 3000 },
    follow_up_status: { label: 'Status tindak lanjut', type: 'enum', values: FOLLOW_STATUS },
    follow_up_pic: { label: 'PIC tindak lanjut', maxLength: 150 },
    follow_up_target_date: { label: 'Target penyelesaian', type: 'date' },
    next_maintenance_date: { label: 'Tanggal maintenance berikutnya', type: 'date' },
  });
  Object.assign(errors, core.errors);
  const d = core.data;
  if (action === 'draft') d.status = 'Draft';
  if (action === 'complete') d.status = 'Selesai';
  const complete = d.status === 'Selesai';

  if (d.maintenance_date && d.maintenance_date > h.today() && complete) errors.maintenance_date = 'Maintenance berstatus Selesai tidak boleh bertanggal di masa depan.';
  if (d.cpu_unavailable) d.cpu_temp_c = null;
  if (d.next_maintenance_date && d.maintenance_date && d.next_maintenance_date <= d.maintenance_date) errors.next_maintenance_date = 'Harus setelah tanggal maintenance.';
  if (d.follow_up_target_date && d.maintenance_date && d.follow_up_target_date < d.maintenance_date) errors.follow_up_target_date = 'Tidak boleh sebelum tanggal maintenance.';
  if (d.cpu_temp_c === null) d.cpu_data_source = 'MANUAL';

  // ---- Storage (SSD & HDD, multi) ----
  const storages = [];
  const parseStorage = (raw, type, idx) => {
    const v = validate(raw, {
      storage_device_id: { type: 'id' },
      interface: { label: 'Jenis/antarmuka', type: 'enum', values: A.INTERFACES },
      brand: { label: 'Merek', maxLength: 80 },
      model: { label: 'Merek / model', maxLength: 120 },
      serial_number: { label: 'Serial number', maxLength: 100 },
      capacity_gb: { label: 'Kapasitas', type: 'decimal', min: 1, max: 1000000, unit: ' GB' },
      temperature_c: { label: `Suhu ${type}`, type: 'decimal', min: t.min, max: t.max, unit: '°C' },
      health_percent: { label: `Health ${type}`, type: 'decimal', min: 0, max: 100, unit: '%' },
      used_percent: { label: 'Ruang terpakai', type: 'decimal', min: 0, max: 100, unit: '%' },
      smart_status: { label: `Status SMART ${type}`, type: 'enum', values: SMART, required: complete },
      reading_tool: { label: 'Alat ukur', maxLength: 80 },
      data_source: { type: 'enum', values: SOURCE, default: 'MANUAL' },
    });
    const prefix = `${type === 'SSD' ? 'ssd' : 'hdd'}[${idx}]`;
    for (const [k, m] of Object.entries(v.errors)) errors[`${prefix}[${k}]`] = `${type} #${idx + 1}: ${m}`;
    const s = { ...v.data, storage_type: type };
    if (s.temperature_c === null && s.health_percent === null) s.data_source = s.smart_status ? s.data_source : 'MANUAL';
    if (type === 'SSD' && s.interface && !['SATA', 'NVMe', 'Lainnya', 'USB'].includes(s.interface)) errors[`${prefix}[interface]`] = 'Jenis SSD harus SATA atau NVMe.';
    return s;
  };
  const hasContent = (r) => Object.entries(r || {}).some(([k, v]) => !['data_source', 'storage_device_id'].includes(k) && clean(v) !== null);
  if (d.ssd_presence === 'TIDAK_ADA') {
    // SSD tidak ada => tidak menyimpan baris SSD apa pun (nilai = NULL / tidak berlaku, BUKAN 0%)
  } else {
    arr(body.ssd).forEach((r, i) => { if (hasContent(r)) storages.push(parseStorage(r, 'SSD', i)); });
    if (!d.ssd_presence && storages.some((s) => s.storage_type === 'SSD')) d.ssd_presence = 'ADA';
  }
  if (d.hdd_presence === 'TIDAK_ADA') {
    // HDD tidak ada => tidak menyimpan baris HDD apa pun (nilai = NULL / tidak berlaku, BUKAN 0%)
  } else {
    arr(body.hdd).forEach((r, i) => { if (hasContent(r)) storages.push(parseStorage(r, 'HDD', i)); });
  }
  if (complete) {
    if (!d.ssd_presence) errors.ssd_presence = 'Pilih apakah perangkat memiliki SSD atau "Tidak Ada SSD".';
    if (d.ssd_presence === 'ADA' && !storages.some((s) => s.storage_type === 'SSD')) errors.ssd_presence = 'Isi data SSD atau pilih "Tidak Ada SSD".';
    if (!storages.length && d.ssd_presence === 'TIDAK_ADA' && d.hdd_presence === 'TIDAK_ADA') errors.storage = 'Perangkat harus memiliki SSD atau HDD — pilih "Ada" pada salah satunya.';
    else if (!storages.length) errors.storage = 'Isi minimal satu pemeriksaan storage (SSD atau HDD).';
    if (!d.hdd_presence) errors.hdd_presence = 'Pilih apakah perangkat memiliki HDD atau "Tidak Ada HDD".';
    if (d.hdd_presence === 'ADA' && !storages.some((s) => s.storage_type === 'HDD')) errors.hdd_presence = 'Isi data HDD atau pilih "Tidak Ada HDD".';
    if (d.cpu_temp_c === null && !d.cpu_unavailable) errors.cpu_temp_c = 'Isi suhu CPU hasil pengukuran, atau centang "Sensor tidak dapat dibaca". Jangan isi angka perkiraan.';
    if (!d.physical_condition) errors.physical_condition = 'Kondisi fisik wajib dipilih.';
    if (!d.final_condition) errors.final_condition = 'Kondisi akhir wajib dipilih.';
    if (!d.findings && d.final_condition && d.final_condition !== 'Baik') errors.findings = 'Catatan preventive maintenance wajib diisi bila kondisi akhir bukan "Baik".';
  }

  // ---- Baterai ----
  const batteryApplicable = !!asset.has_battery;
  let battery = { is_applicable: batteryApplicable ? 1 : 0 };
  if (batteryApplicable) {
    const b = validate(body.battery || {}, {
      health_percent: { label: 'Battery health', type: 'decimal', min: 0, max: 150, unit: '%' },
      design_capacity_mwh: { label: 'Design capacity', type: 'int', min: 1, max: 500000, unit: ' mWh' },
      full_charge_capacity_mwh: { label: 'Full charge capacity', type: 'int', min: 0, max: 500000, unit: ' mWh' },
      cycle_count: { label: 'Cycle count', type: 'int', min: 0, max: 100000 },
      battery_status: { label: 'Status baterai', type: 'enum', values: BATTERY_STATUS, required: complete },
      notes: { label: 'Catatan baterai', maxLength: 3000 },
      data_source: { type: 'enum', values: SOURCE, default: 'MANUAL' },
    });
    for (const [k, m] of Object.entries(b.errors)) errors[`battery[${k}]`] = m;
    battery = { ...battery, ...b.data };
  }

  // ---- Checklist perawatan fisik ----
  const tasks = [];
  const rawTasks = body.tasks || {};
  for (const td of taskDefs) {
    const r = rawTasks[td.code] || {};
    let status = clean(r.status);
    if (status && !TASK_STATUS.includes(status)) { errors[`tasks[${td.code}][status]`] = 'Status tidak valid.'; status = null; }
    if (complete && !status) errors[`tasks[${td.code}][status]`] = `"${td.name}" belum dikonfirmasi teknisi.`;
    const notes = clean(r.notes);
    tasks.push({ task_definition_id: td.id, task_code: td.code, task_name: td.name, status: status || null, notes: notes ? String(notes).slice(0, 255) : null, sort_order: td.sort_order });
  }
  return { data: d, storages, battery, tasks, errors, complete };
}

async function nextNumber(t, date) {
  const key = `PM-${date.slice(0, 4)}${date.slice(5, 7)}`;
  await t.query('INSERT INTO number_sequences (seq_key, last_number) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)', [key]);
  const row = await t.one('SELECT LAST_INSERT_ID() n');
  return `${key}-${String(row.n).padStart(4, '0')}`;
}

async function taskDefinitions(deviceType) {
  const all = await db.query('SELECT * FROM task_definitions WHERE is_active=1 ORDER BY sort_order, id');
  return all.filter((t) => t.applies_to === 'SEMUA' || (t.applies_to === 'LAPTOP' && deviceType === 'Laptop') || (t.applies_to === 'DESKTOP' && deviceType !== 'Laptop'));
}

async function previousCompleted(t, assetId, excludeId, beforeDate) {
  const r = await t.one(`SELECT id, cpu_temp_c FROM maintenance_records WHERE asset_id=? AND status='Selesai' AND deleted_at IS NULL AND id<>? AND maintenance_date <= ?
                          ORDER BY maintenance_date DESC, id DESC LIMIT 1`, [assetId, excludeId || 0, beforeDate]);
  if (!r) return null;
  r.storages = await t.query('SELECT * FROM maintenance_storage_readings WHERE maintenance_record_id=?', [r.id]);
  r.battery = await t.one('SELECT * FROM maintenance_battery_readings WHERE maintenance_record_id=?', [r.id]);
  return r;
}

/** Evaluasi tanpa menyimpan (untuk konfirmasi tindak lanjut di form). */
async function preview(asset, parsed, excludeId) {
  const thresholds = await db.query('SELECT * FROM hardware_thresholds WHERE is_active=1');
  const cfg = await settings.all();
  const prev = await previousCompleted(db, asset.id, excludeId, parsed.data.maintenance_date || h.today());
  return evaluate({
    asset, record: { ...parsed.data, tasks: parsed.tasks },
    storages: parsed.storages.map((s) => ({ ...s })), battery: { ...parsed.battery }, previous: prev, thresholds, settings: cfg,
  });
}

/**
 * Simpan (buat / ubah) record maintenance dalam satu transaksi.
 * @returns {id, maintenance_no, evaluation}
 */
async function save({ req, asset: assetIn, parsed, files, existing, prepare = null }) {
  const thresholds = await db.query('SELECT * FROM hardware_thresholds WHERE is_active=1');
  const cfg = await settings.all();
  const validatedFiles = uploads.validateFiles(files, uploads.MAINT_FIELDS); // lempar error + hapus tmp bila tidak valid
  let moved = [];
  try {
    const result = await db.transaction(async (t) => {
      const d = parsed.data;
      // Mode "Perangkat baru": aset & master data dibuat di transaksi yang sama sebelum record maintenance
      const asset = prepare ? await prepare(t) : assetIn;
      const lockedAsset = await t.one('SELECT * FROM assets WHERE id=? AND deleted_at IS NULL FOR UPDATE', [asset.id]);
      if (!lockedAsset) throw Object.assign(new Error('Aset tidak ditemukan atau sudah dihapus.'), { status: 404 });
      const ctx = await A.maintenanceContext(asset.id, t);

      // Validasi storage_device_id milik aset ini
      for (const s of parsed.storages) {
        if (s.storage_device_id) {
          const sd = await t.one('SELECT id FROM storage_devices WHERE id=? AND asset_id=?', [s.storage_device_id, asset.id]);
          if (!sd) s.storage_device_id = null;
        }
      }
      // Daftarkan storage baru ke aset agar tren histori dapat dilacak antar pemeriksaan
      if (d.status !== 'Draft') {
        for (const s of parsed.storages) {
          if (!s.storage_device_id && (s.serial_number || s.model || s.brand || s.capacity_gb)) {
            const found = s.serial_number ? await t.one('SELECT id FROM storage_devices WHERE asset_id=? AND serial_number=? AND is_active=1', [asset.id, s.serial_number]) : null;
            if (found) s.storage_device_id = found.id;
            else {
              const r = await t.query('INSERT INTO storage_devices (asset_id, storage_type, interface, brand, model, serial_number, capacity_gb, installed_at, notes) VALUES (?,?,?,?,?,?,?,?,?)',
                [asset.id, s.storage_type, s.interface, s.brand, s.model, s.serial_number, s.capacity_gb, null, 'Terdaftar otomatis dari form maintenance']);
              s.storage_device_id = r.insertId;
            }
          }
        }
      }

      const prev = await previousCompleted(t, asset.id, existing && existing.id, d.maintenance_date);
      const evaluation = evaluate({ asset: lockedAsset, record: { ...d, tasks: parsed.tasks }, storages: parsed.storages, battery: parsed.battery, previous: prev, thresholds, settings: cfg });
      const evalStatus = d.status === 'Draft' ? 'BELUM_DIEVALUASI' : evaluation.overall;

      const usedAgent = d.cpu_data_source === 'AGENT' || parsed.storages.some((s) => s.data_source === 'AGENT') || parsed.battery.data_source === 'AGENT';
      const usedManual = (d.cpu_temp_c !== null && d.cpu_data_source === 'MANUAL') || parsed.storages.some((s) => s.data_source === 'MANUAL') || (parsed.battery.is_applicable && parsed.battery.data_source !== 'AGENT');
      const dataSource = usedAgent ? (usedManual ? 'CAMPURAN' : 'AGENT') : 'MANUAL';

      let approval = existing ? existing.approval_status : 'Tidak Diperlukan';
      if (d.status === 'Selesai' && (!existing || existing.status !== 'Selesai' || existing.approval_status === 'Ditolak')) {
        const mode = (cfg.approval_mode || 'KRITIS').toUpperCase();
        approval = mode === 'SEMUA' || (mode === 'KRITIS' && ['PERHATIAN', 'KRITIS'].includes(evaluation.overall)) ? 'Menunggu' : 'Tidak Diperlukan';
      }
      if (d.status !== 'Selesai') approval = existing && existing.approval_status === 'Ditolak' ? 'Ditolak' : 'Tidak Diperlukan';

      const fields = {
        asset_id: asset.id, schedule_id: d.schedule_id, maintenance_date: d.maintenance_date, check_time: d.check_time,
        technician_user_id: d.technician_user_id, status: d.status,
        asset_code_snapshot: lockedAsset.asset_code, hostname_snapshot: lockedAsset.hostname, device_type_snapshot: lockedAsset.device_type,
        brand_model_snapshot: [lockedAsset.brand, lockedAsset.model].filter(Boolean).join(' ') || null,
        employee_id: ctx.employee_id, employee_name_snapshot: ctx.employee_name, employee_nik_snapshot: ctx.employee_nik,
        department_id: ctx.department_id, department_snapshot: ctx.department_name, work_unit_id: ctx.work_unit_id, work_unit_snapshot: ctx.work_unit_name,
        location_id: ctx.location_id, location_snapshot: ctx.location_text || null, room_snapshot: ctx.room,
        cpu_temp_c: d.cpu_temp_c, cpu_load_condition: d.cpu_temp_c !== null ? d.cpu_load_condition : null, cpu_reading_tool: d.cpu_reading_tool,
        cpu_data_source: d.cpu_data_source, cpu_read_at: d.cpu_temp_c !== null ? `${d.maintenance_date} ${d.check_time || '00:00:00'}` : null,
        hdd_presence: d.hdd_presence, ssd_presence: d.ssd_presence, physical_condition: d.physical_condition, final_condition: d.final_condition,
        user_complaint: d.user_complaint, findings: d.findings, root_cause: d.root_cause, actions_taken: d.actions_taken,
        recommendation: d.recommendation, spare_parts_needed: d.spare_parts_needed, follow_up_status: d.follow_up_status,
        follow_up_pic: d.follow_up_pic, follow_up_target_date: d.follow_up_target_date, next_maintenance_date: d.next_maintenance_date,
        evaluated_status: evalStatus, storage_status: d.status === 'Draft' ? 'BELUM_DIEVALUASI' : evaluation.storage_status,
        priority: d.status === 'Draft' ? null : evaluation.priority, evaluation_json: JSON.stringify(evaluation), evaluated_at: h.nowDateTime(),
        approval_status: approval, completed_at: d.status === 'Selesai' ? (existing && existing.completed_at) || h.nowDateTime() : null,
        data_source: dataSource, updated_by: req.user.id,
      };
      if (approval === 'Menunggu') { fields.approved_by = null; fields.approved_at = null; }

      let id; let no;
      if (existing) {
        id = existing.id; no = existing.maintenance_no;
        await t.query(`UPDATE maintenance_records SET ${Object.keys(fields).map((k) => `${k}=?`).join(', ')} WHERE id=?`, [...Object.values(fields), id]);
        await t.query('DELETE FROM maintenance_storage_readings WHERE maintenance_record_id=?', [id]);
        await t.query('DELETE FROM maintenance_battery_readings WHERE maintenance_record_id=?', [id]);
        await t.query('DELETE FROM maintenance_tasks WHERE maintenance_record_id=?', [id]);
      } else {
        no = await nextNumber(t, d.maintenance_date);
        fields.maintenance_no = no; fields.created_by = req.user.id;
        const r = await t.query(`INSERT INTO maintenance_records (${Object.keys(fields).join(', ')}) VALUES (${Object.keys(fields).map(() => '?').join(', ')})`, Object.values(fields));
        id = r.insertId;
      }

      let order = 0;
      for (const s of parsed.storages) {
        await t.query(`INSERT INTO maintenance_storage_readings (maintenance_record_id, storage_device_id, storage_type, interface, brand, model, serial_number, capacity_gb,
                         temperature_c, health_percent, used_percent, smart_status, reading_tool, data_source, read_at, evaluated_level, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, s.storage_device_id, s.storage_type, s.interface, s.brand, s.model, s.serial_number, s.capacity_gb, s.temperature_c, s.health_percent, s.used_percent,
          s.smart_status, s.reading_tool, s.data_source, (s.temperature_c !== null || s.health_percent !== null || s.smart_status) ? `${d.maintenance_date} ${d.check_time || '00:00:00'}` : null,
          d.status === 'Draft' ? null : s.evaluated_level || null, order++]);
      }
      const b = parsed.battery;
      await t.query(`INSERT INTO maintenance_battery_readings (maintenance_record_id, is_applicable, health_percent, design_capacity_mwh, full_charge_capacity_mwh, cycle_count,
                       battery_status, notes, data_source, read_at, evaluated_level) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, b.is_applicable, b.is_applicable ? b.health_percent ?? null : null, b.design_capacity_mwh ?? null, b.full_charge_capacity_mwh ?? null, b.cycle_count ?? null,
        b.battery_status ?? null, b.notes ?? null, b.data_source || 'MANUAL', b.is_applicable && (b.health_percent !== null || b.battery_status) ? `${d.maintenance_date} ${d.check_time || '00:00:00'}` : null,
        d.status === 'Draft' ? null : b.evaluated_level || null]);
      for (const tk of parsed.tasks) {
        await t.query('INSERT INTO maintenance_tasks (maintenance_record_id, task_definition_id, task_code, task_name, status, notes, sort_order) VALUES (?,?,?,?,?,?,?)',
          [id, tk.task_definition_id, tk.task_code, tk.task_name, tk.status, tk.notes, tk.sort_order]);
      }

      // Lampiran: file dipindah ke penyimpanan permanen lalu dicatat; bila transaksi gagal, file dihapus lagi.
      if (validatedFiles.length) {
        moved = uploads.persist(validatedFiles, `maintenance/${d.maintenance_date.slice(0, 7)}/${id}`);
        for (const m of moved) {
          await t.query('INSERT INTO maintenance_attachments (maintenance_record_id, category, original_name, stored_path, mime_type, size_bytes, sha256, uploaded_by) VALUES (?,?,?,?,?,?,?,?)',
            [id, m.category, m.originalName, m.storedPath, m.mime, m.size, m.sha256, req.user.id]);
        }
      }

      // Sinkron status jadwal
      if (d.schedule_id) {
        const map = { Terjadwal: 'Terjadwal', 'Dalam Proses': 'Dalam Proses', Ditunda: 'Ditunda', Selesai: 'Selesai' };
        if (map[d.status]) await t.query('UPDATE maintenance_schedules SET status=?, maintenance_record_id=? WHERE id=? AND asset_id=?', [map[d.status], id, d.schedule_id, asset.id]);
      }

      let followUpId = null; let nextSchedule = null;
      if (d.status === 'Selesai') {
        ({ followUpId, nextSchedule } = await onCompleted(t, { req, id, no, asset: lockedAsset, d, evaluation, cfg }));
      }
      await audit.log(req, existing ? 'UPDATE' : 'CREATE', {
        entity: 'maintenance_records', id,
        description: `Maintenance ${no} (${lockedAsset.asset_code}) disimpan sebagai ${d.status}${validatedFiles.length ? `, ${validatedFiles.length} lampiran` : ''}`,
        after: { status: d.status, evaluated_status: evalStatus, final_condition: d.final_condition },
      }, t);
      return { id, maintenance_no: no, evaluation, followUpId, nextSchedule, asset_id: asset.id };
    });
    notifications.clear();
    return result;
  } catch (e) {
    uploads.removeFiles(moved);
    uploads.removeTemp(files);
    throw e;
  }
}

/** Langkah setelah maintenance Selesai: update aset, jadwal berikutnya, tindak lanjut otomatis. */
async function onCompleted(t, { req, id, no, asset, d, evaluation, cfg }) {
  // Status terkini aset hanya diperbarui bila record ini adalah maintenance selesai TERBARU
  const latest = await t.one(`SELECT id FROM maintenance_records WHERE asset_id=? AND status='Selesai' AND deleted_at IS NULL
                               ORDER BY maintenance_date DESC, id DESC LIMIT 1`, [asset.id]);
  let nextSchedule = null;
  if (latest && latest.id === id) {
    const interval = await settings.intervalFor(asset, t);
    let days = interval.days;
    if (evaluation.overall === 'KRITIS') days = Math.min(days, Number(cfg.interval_critical_days || 7));
    else if (evaluation.overall === 'PERHATIAN') days = Math.min(days, Number(cfg.interval_attention_days || 30));
    const nextDate = d.next_maintenance_date || h.addDays(d.maintenance_date, days);
    await t.query(`UPDATE assets SET current_health_status=?, last_maintenance_date=?, next_maintenance_date=?, physical_condition=COALESCE(?, physical_condition) WHERE id=?`,
      [evaluation.overall === 'BELUM_DIEVALUASI' ? 'BELUM_DIEVALUASI' : evaluation.overall, d.maintenance_date, nextDate, d.physical_condition, asset.id]);

    // Tutup jadwal terbuka yang sudah terpenuhi oleh maintenance ini
    await t.query(`UPDATE maintenance_schedules SET status='Selesai', maintenance_record_id=COALESCE(maintenance_record_id, ?)
                    WHERE asset_id=? AND deleted_at IS NULL AND status IN ('Terjadwal','Ditunda','Dalam Proses') AND scheduled_date <= ?`,
    [id, asset.id, h.addDays(d.maintenance_date, Number(cfg.due_soon_days || 14))]);
    // Buat jadwal berikutnya bila belum ada jadwal terbuka di masa depan
    const open = await t.one("SELECT id, scheduled_date FROM maintenance_schedules WHERE asset_id=? AND deleted_at IS NULL AND status IN ('Terjadwal','Ditunda') ORDER BY scheduled_date LIMIT 1", [asset.id]);
    if (!open) {
      const r = await t.query("INSERT INTO maintenance_schedules (asset_id, scheduled_date, technician_user_id, interval_type, status, source, notes, created_by) VALUES (?,?,?,?, 'Terjadwal', 'OTOMATIS', ?, ?)",
        [asset.id, nextDate, d.technician_user_id, d.next_maintenance_date ? 'Kustom' : interval.type,
          `Dibuat otomatis dari ${no}${days < interval.days && !d.next_maintenance_date ? ` (interval dipersingkat: kondisi ${evaluation.overall_label})` : ''}`, req.user.id]);
      nextSchedule = { id: r.insertId, date: nextDate };
    } else {
      nextSchedule = { id: open.id, date: open.scheduled_date };
    }
  }

  let followUpId = null;
  if (evaluation.needs_follow_up && String(cfg.auto_followup ?? '1') === '1' && d.follow_up_status !== 'Tidak Perlu') {
    const exists = await t.one("SELECT id FROM follow_up_actions WHERE maintenance_record_id=? AND deleted_at IS NULL", [id]);
    if (!exists) {
      const problems = evaluation.items.filter((i) => ['KRITIS', 'PERHATIAN'].includes(i.level)).map((i) => `• ${i.scope ? `${i.scope} – ` : ''}${i.message}`);
      const pic = d.follow_up_pic ? await t.one('SELECT id FROM users WHERE full_name=? AND is_active=1 LIMIT 1', [d.follow_up_pic]) : null;
      const r = await t.query(`INSERT INTO follow_up_actions (asset_id, maintenance_record_id, title, description, priority, status, pic_user_id, pic_name, target_date, is_auto_generated, created_by)
                                VALUES (?,?,?,?,?, 'Terbuka', ?,?,?,1,?)`,
      [asset.id, id, `Tindak lanjut ${asset.asset_code}: ${evaluation.overall_label}${d.final_condition ? ` / ${d.final_condition}` : ''}`,
        [...problems, '', 'Rekomendasi:', ...evaluation.recommendations.map((x) => `• ${x}`), d.recommendation ? `• ${d.recommendation}` : null].filter((x) => x !== null).join('\n').slice(0, 60000),
        evaluation.priority || 'Sedang', pic ? pic.id : d.technician_user_id, d.follow_up_pic, d.follow_up_target_date, req.user.id]);
      followUpId = r.insertId;
      if (!d.follow_up_status) await t.query("UPDATE maintenance_records SET follow_up_status='Perlu Tindak Lanjut' WHERE id=?", [id]);
    }
  }
  return { followUpId, nextSchedule };
}

async function loadRecord(id) {
  const r = await db.one(`SELECT r.*, u.full_name AS technician_name, ap.full_name AS approver_name, cu.full_name AS creator_name
                            FROM maintenance_records r LEFT JOIN users u ON u.id=r.technician_user_id LEFT JOIN users ap ON ap.id=r.approved_by
                            LEFT JOIN users cu ON cu.id=r.created_by WHERE r.id=? AND r.deleted_at IS NULL`, [id]);
  if (!r) return null;
  const [storages, battery, tasks, attachments] = await Promise.all([
    db.query('SELECT * FROM maintenance_storage_readings WHERE maintenance_record_id=? ORDER BY sort_order', [id]),
    db.one('SELECT * FROM maintenance_battery_readings WHERE maintenance_record_id=?', [id]),
    db.query('SELECT * FROM maintenance_tasks WHERE maintenance_record_id=? ORDER BY sort_order', [id]),
    db.query('SELECT at.*, u.full_name AS uploader FROM maintenance_attachments at LEFT JOIN users u ON u.id=at.uploaded_by WHERE maintenance_record_id=? AND at.deleted_at IS NULL ORDER BY category, id', [id]),
  ]);
  r.storages = storages; r.battery = battery; r.tasks = tasks; r.attachments = attachments;
  try { r.evaluation = r.evaluation_json ? JSON.parse(r.evaluation_json) : null; } catch (_) { r.evaluation = null; }
  return r;
}

module.exports = {
  RECORD_STATUS, FINAL, SMART, TASK_STATUS, BATTERY_STATUS, FOLLOW_STATUS, LOAD,
  parse, save, preview, loadRecord, taskDefinitions, nextNumber, ValidationError,
};
