'use strict';
/**
 * Mesin evaluasi kondisi hardware.
 *
 * Prinsip:
 *  - Status TIDAK ditentukan dari satu parameter; status akhir = level terburuk dari seluruh
 *    parameter yang benar-benar diperiksa (CPU, storage, SMART, baterai, kondisi fisik, temuan teknisi).
 *  - Threshold berasal dari tabel hardware_thresholds (dapat dikonfigurasi admin), dipilih aturan
 *    PALING SPESIFIK yang cocok (pola model > merek > antarmuka > jenis perangkat > umum).
 *  - Nilai NULL = tidak diperiksa / tidak tersedia, tidak pernah dianggap "baik".
 *  - SMART "Tidak Tersedia" ditampilkan apa adanya; perlakuannya diatur setting smart_unavailable_level.
 *  - Health tinggi tidak otomatis "aman" bila SMART kritis atau parameter lain bermasalah.
 *
 * Aturan batas (inklusif agar sesuai kebijakan "70–90% = pantau"):
 *  HIGHER_IS_WORSE : nilai >= kritis -> KRITIS ; nilai >= peringatan -> PERHATIAN
 *  LOWER_IS_WORSE  : nilai <  kritis -> KRITIS ; nilai <= peringatan -> PERHATIAN
 */

const RANK = { BAIK: 0, PERHATIAN: 1, KRITIS: 2 };
const LEVEL_LABEL = {
  BAIK: 'Baik', PERHATIAN: 'Perlu Perhatian', KRITIS: 'Kritis',
  TIDAK_TERSEDIA: 'Tidak Tersedia', TIDAK_DIPERIKSA: 'Tidak Diperiksa', TIDAK_BERLAKU: 'Tidak Berlaku',
  INFO: 'Informasi', BELUM_DIEVALUASI: 'Belum Dievaluasi',
};
const PARAM_LABEL = {
  CPU_TEMP: 'Suhu CPU', SSD_TEMP: 'Suhu SSD', HDD_TEMP: 'Suhu HDD',
  SSD_HEALTH: 'Health SSD', HDD_HEALTH: 'Health HDD', BATTERY_HEALTH: 'Battery health',
};

const isNum = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));
const num = (v) => (isNum(v) ? Number(v) : null);
const worst = (levels) => levels.filter((l) => l in RANK).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'BAIK');

function matchThreshold(thresholds, parameter, ctx = {}) {
  let best = null; let bestScore = -1;
  for (const t of thresholds) {
    if (!t.is_active || t.parameter !== parameter) continue;
    let score = 0;
    if (t.device_type) { if (t.device_type !== ctx.device_type) continue; score += 1; }
    if (t.interface) { if (t.interface !== ctx.interface) continue; score += 2; }
    if (t.brand) {
      if (!ctx.brand || !String(ctx.brand).toLowerCase().includes(String(t.brand).toLowerCase())) continue;
      score += 3;
    }
    if (t.model_pattern) {
      if (!ctx.model || !String(ctx.model).toLowerCase().includes(String(t.model_pattern).toLowerCase())) continue;
      score += 5;
    }
    if (score > bestScore || (score === bestScore && best && t.id > best.id)) { best = t; bestScore = score; }
  }
  return best;
}

function levelFor(value, t) {
  const w = Number(t.warning_value); const c = Number(t.critical_value);
  if (t.direction === 'HIGHER_IS_WORSE') {
    if (value >= c) return 'KRITIS';
    if (value >= w) return 'PERHATIAN';
    return 'BAIK';
  }
  if (value < c) return 'KRITIS';
  if (value <= w) return 'PERHATIAN';
  return 'BAIK';
}

function thresholdText(t, unit) {
  if (!t) return 'Belum ada threshold aktif';
  const sign = t.direction === 'HIGHER_IS_WORSE' ? '≥' : '≤';
  const csign = t.direction === 'HIGHER_IS_WORSE' ? '≥' : '<';
  return `Perhatian ${sign} ${Number(t.warning_value)}${unit}, Kritis ${csign} ${Number(t.critical_value)}${unit}`;
}

function numericItem({ thresholds, parameter, value, unit, ctx, scope }) {
  const label = PARAM_LABEL[parameter];
  const base = { parameter, label, scope: scope || null, value: num(value), unit };
  if (!isNum(value)) {
    return { ...base, level: 'TIDAK_DIPERIKSA', message: `${label} tidak diperiksa / tidak tersedia (tidak dinilai).` };
  }
  const t = matchThreshold(thresholds, parameter, ctx);
  if (!t) {
    return { ...base, level: 'INFO', message: `${label} ${num(value)}${unit} — belum ada threshold aktif yang cocok, tidak dapat dinilai.` };
  }
  const level = levelFor(num(value), t);
  return { ...base, level, threshold_id: t.id, threshold: thresholdText(t, unit), message: `${label} ${num(value)}${unit} (${LEVEL_LABEL[level]}; ${thresholdText(t, unit)}).` };
}

function evaluate({ asset, record, storages = [], battery = null, previous = null, thresholds = [], settings = {} }) {
  const items = [];
  const recs = [];
  const flags = [];
  const smartUnavailable = (settings.smart_unavailable_level || 'PERHATIAN').toUpperCase();
  const dropHealth = Number(settings.health_drop_significant ?? 5);
  const dropBattery = Number(settings.battery_drop_significant ?? 10);
  const riseTemp = Number(settings.temp_rise_significant ?? 10);

  // ---- CPU ----
  const cpu = numericItem({
    thresholds, parameter: 'CPU_TEMP', value: record.cpu_temp_c, unit: '°C',
    ctx: { device_type: asset.device_type, brand: asset.brand, model: asset.processor },
  });
  if (cpu.level !== 'TIDAK_DIPERIKSA' && record.cpu_load_condition) cpu.message += ` Kondisi beban saat diukur: ${record.cpu_load_condition}.`;
  items.push(cpu);
  if (cpu.level === 'KRITIS') recs.push('Suhu CPU kritis: periksa fan, heatsink & thermal paste; cek beban proses dan ventilasi ruangan.');
  else if (cpu.level === 'PERHATIAN') recs.push(record.cpu_load_condition === 'Beban Tinggi'
    ? 'Suhu CPU tinggi saat beban tinggi: ulangi pengukuran saat idle sebelum menyimpulkan.'
    : 'Suhu CPU tinggi: jadwalkan pembersihan fan/heatsink dan pantau ulang.');
  if (previous && isNum(previous.cpu_temp_c) && isNum(record.cpu_temp_c) && num(record.cpu_temp_c) - num(previous.cpu_temp_c) >= riseTemp) {
    flags.push({ parameter: 'CPU_TEMP', message: `Suhu CPU naik ${(num(record.cpu_temp_c) - num(previous.cpu_temp_c)).toFixed(1)}°C dibanding pemeriksaan sebelumnya.` });
  }

  // ---- Storage ----
  const storageLevels = [];
  storages.forEach((s, idx) => {
    const type = s.storage_type === 'HDD' ? 'HDD' : 'SSD';
    const scope = `${type} #${idx + 1}${s.brand || s.model ? ` (${[s.brand, s.model].filter(Boolean).join(' ')})` : ''}`;
    const ctx = { device_type: asset.device_type, interface: s.interface || null, brand: s.brand, model: s.model };
    const t = numericItem({ thresholds, parameter: `${type}_TEMP`, value: s.temperature_c, unit: '°C', ctx, scope });
    const h = numericItem({ thresholds, parameter: `${type}_HEALTH`, value: s.health_percent, unit: '%', ctx, scope });
    items.push(t, h);

    let smartLevel;
    let smartMsg;
    switch (s.smart_status) {
      case 'Baik': smartLevel = 'BAIK'; smartMsg = 'Status SMART baik.'; break;
      case 'Peringatan': smartLevel = 'PERHATIAN'; smartMsg = 'SMART menunjukkan peringatan.'; break;
      case 'Kritis': smartLevel = 'KRITIS'; smartMsg = 'SMART menunjukkan peringatan KRITIS — prioritaskan pemeriksaan walaupun health masih tinggi.'; break;
      case 'Tidak Tersedia':
        smartLevel = smartUnavailable === 'PERHATIAN' ? 'PERHATIAN' : 'TIDAK_TERSEDIA';
        smartMsg = 'Status SMART Tidak Tersedia — kondisi storage tidak dapat dipastikan hanya dari angka health.';
        break;
      default: smartLevel = 'TIDAK_DIPERIKSA'; smartMsg = 'Status SMART belum diperiksa.';
    }
    items.push({ parameter: `${type}_SMART`, label: `SMART ${type}`, scope, value: s.smart_status || null, unit: '', level: smartLevel, message: smartMsg });

    const lv = [t.level, h.level, smartLevel];
    const evaluable = lv.filter((l) => l in RANK);
    const sLevel = evaluable.length ? worst(evaluable) : 'TIDAK_TERSEDIA';
    s.evaluated_level = sLevel;
    storageLevels.push(sLevel);

    if (smartLevel === 'KRITIS' || h.level === 'KRITIS') recs.push(`${scope}: backup data pengguna segera dan evaluasi rencana penggantian storage.`);
    else if (h.level === 'PERHATIAN' || smartLevel === 'PERHATIAN') recs.push(`${scope}: lakukan pemeriksaan lanjutan (SMART detail, uji baca/tulis) dan pantau tren health.`);
    if (t.level === 'KRITIS' || t.level === 'PERHATIAN') recs.push(`${scope}: suhu storage tinggi — periksa airflow casing/heatsink M.2 dan posisi perangkat.`);
    if (h.level === 'BAIK' && s.smart_status === 'Tidak Tersedia') {
      flags.push({ parameter: `${type}_SMART`, message: `${scope}: health terlihat baik tetapi SMART tidak tersedia — perangkat tidak disimpulkan aman.` });
    }

    // Penurunan signifikan dibanding pembacaan sebelumnya pada storage yang sama
    if (previous && Array.isArray(previous.storages) && isNum(s.health_percent)) {
      const prev = previous.storages.find((p) => (s.storage_device_id && p.storage_device_id === s.storage_device_id)
        || (s.serial_number && p.serial_number && p.serial_number === s.serial_number));
      if (prev && isNum(prev.health_percent) && num(prev.health_percent) - num(s.health_percent) >= dropHealth) {
        flags.push({ parameter: `${type}_HEALTH`, message: `${scope}: health turun ${(num(prev.health_percent) - num(s.health_percent)).toFixed(1)} poin (dari ${num(prev.health_percent)}% ke ${num(s.health_percent)}%).` });
        recs.push(`${scope}: penurunan health signifikan — pantau lebih rapat dan siapkan cadangan data.`);
      }
      if (prev && isNum(prev.temperature_c) && isNum(s.temperature_c) && num(s.temperature_c) - num(prev.temperature_c) >= riseTemp) {
        flags.push({ parameter: `${type}_TEMP`, message: `${scope}: suhu naik ${(num(s.temperature_c) - num(prev.temperature_c)).toFixed(1)}°C dibanding pemeriksaan sebelumnya.` });
      }
    }
  });
  let storageStatus = 'BELUM_DIEVALUASI';
  if (storageLevels.length) {
    const ranked = storageLevels.filter((l) => l in RANK);
    storageStatus = ranked.length ? worst(ranked) : 'TIDAK_TERSEDIA';
  }

  // ---- Baterai ----
  if (!battery || !battery.is_applicable) {
    items.push({ parameter: 'BATTERY', label: 'Baterai', value: null, unit: '', level: 'TIDAK_BERLAKU', message: 'Pemeriksaan baterai tidak berlaku untuk perangkat ini.' });
  } else {
    let health = num(battery.health_percent);
    let derived = false;
    if (health === null && isNum(battery.design_capacity_mwh) && isNum(battery.full_charge_capacity_mwh) && num(battery.design_capacity_mwh) > 0) {
      health = Math.round((num(battery.full_charge_capacity_mwh) / num(battery.design_capacity_mwh)) * 1000) / 10;
      derived = true;
      battery.health_percent = health;
    }
    const b = numericItem({ thresholds, parameter: 'BATTERY_HEALTH', value: health, unit: '%', ctx: { device_type: asset.device_type, brand: asset.brand, model: asset.model } });
    if (derived) b.message += ' (dihitung dari full charge capacity ÷ design capacity)';
    const statusLevel = {
      Baik: 'BAIK', Menurun: 'PERHATIAN', 'Perlu Penggantian': 'KRITIS', 'Tidak Terdeteksi': 'PERHATIAN', 'Tidak Dapat Dibaca': 'TIDAK_TERSEDIA',
    }[battery.battery_status] || null;
    let lvl = b.level;
    if (statusLevel && statusLevel in RANK) lvl = lvl in RANK ? worst([lvl, statusLevel]) : statusLevel;
    else if (!(lvl in RANK) && statusLevel) lvl = statusLevel;
    b.level = lvl;
    if (battery.battery_status) b.message += ` Status baterai menurut teknisi: ${battery.battery_status}.`;
    battery.evaluated_level = lvl in RANK ? lvl : (lvl === 'TIDAK_DIPERIKSA' ? null : 'TIDAK_TERSEDIA');
    items.push(b);
    if (lvl === 'KRITIS') recs.push('Baterai: ajukan penggantian baterai; hindari penggunaan tanpa adaptor bila baterai menggembung/drop.');
    else if (lvl === 'PERHATIAN') recs.push('Baterai menurun: pantau kapasitas & cycle count pada pemeriksaan berikutnya.');
    if (previous && previous.battery && isNum(previous.battery.health_percent) && health !== null
      && num(previous.battery.health_percent) - health >= dropBattery) {
      flags.push({ parameter: 'BATTERY_HEALTH', message: `Battery health turun ${(num(previous.battery.health_percent) - health).toFixed(1)} poin dibanding pemeriksaan sebelumnya.` });
    }
  }

  // ---- Kondisi fisik ----
  const physMap = { Baik: 'BAIK', Cukup: 'BAIK', 'Rusak Ringan': 'PERHATIAN', 'Rusak Berat': 'KRITIS' };
  if (record.physical_condition) {
    const l = physMap[record.physical_condition];
    items.push({ parameter: 'PHYSICAL', label: 'Kondisi fisik', value: record.physical_condition, unit: '', level: l, message: `Kondisi fisik: ${record.physical_condition}.` });
    if (l !== 'BAIK') recs.push('Kondisi fisik bermasalah: dokumentasikan kerusakan dan ajukan perbaikan/penggantian komponen.');
  } else {
    items.push({ parameter: 'PHYSICAL', label: 'Kondisi fisik', value: null, unit: '', level: 'TIDAK_DIPERIKSA', message: 'Kondisi fisik belum diisi.' });
  }

  // ---- Temuan teknisi (kondisi akhir) ----
  const techMap = { Baik: 'BAIK', 'Baik dengan catatan': 'BAIK', 'Perlu Monitoring': 'PERHATIAN', 'Perlu Perbaikan': 'PERHATIAN', Kritis: 'KRITIS' };
  const paramLevel = worst(items.map((i) => i.level));
  if (record.final_condition) {
    const l = techMap[record.final_condition];
    items.push({ parameter: 'TECHNICIAN', label: 'Penilaian teknisi', value: record.final_condition, unit: '', level: l, message: `Kondisi akhir menurut teknisi: ${record.final_condition}.` });
    if (RANK[paramLevel] > RANK[l]) {
      flags.push({ parameter: 'TECHNICIAN', message: `Kondisi akhir teknisi (${record.final_condition}) lebih baik daripada hasil evaluasi parameter (${LEVEL_LABEL[paramLevel]}) — mohon ditinjau.` });
    }
  }

  // ---- Temuan tugas perawatan ----
  const pending = (record.tasks || []).filter((t) => t.status === 'Belum dilakukan').map((t) => t.task_name);
  if (pending.length) items.push({ parameter: 'TASKS', label: 'Perawatan fisik', value: pending.length, unit: '', level: 'INFO', message: `${pending.length} item perawatan belum dilakukan: ${pending.join(', ')}.` });

  const evaluated = items.filter((i) => i.level in RANK);
  const overall = evaluated.length ? worst(evaluated.map((i) => i.level)) : 'BELUM_DIEVALUASI';
  let priority = null;
  if (overall === 'KRITIS') priority = 'Kritis';
  else if (overall === 'PERHATIAN') priority = (record.final_condition === 'Perlu Perbaikan' || storageStatus === 'PERHATIAN') ? 'Tinggi' : 'Sedang';
  else if (overall === 'BAIK') priority = 'Rendah';
  if (overall === 'BAIK' && flags.length) priority = 'Sedang';

  const notChecked = items.filter((i) => i.level === 'TIDAK_DIPERIKSA').map((i) => (i.scope ? `${i.label} ${i.scope}` : i.label));

  return {
    overall,
    overall_label: LEVEL_LABEL[overall],
    storage_status: storageStatus,
    priority,
    needs_follow_up: overall === 'KRITIS' || overall === 'PERHATIAN'
      || ['Perlu Perbaikan', 'Kritis', 'Perlu Monitoring'].includes(record.final_condition),
    items,
    flags,
    recommendations: [...new Set(recs)],
    not_checked: notChecked,
    evaluated_at: new Date().toISOString(),
  };
}

module.exports = { evaluate, matchThreshold, levelFor, LEVEL_LABEL, PARAM_LABEL, RANK };
