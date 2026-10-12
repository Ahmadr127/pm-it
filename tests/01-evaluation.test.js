'use strict';
// Unit test mesin evaluasi (tanpa database)
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, matchThreshold } = require('../src/services/evaluation');

const TH = [
  { id: 1, is_active: 1, parameter: 'CPU_TEMP', device_type: null, interface: null, brand: null, model_pattern: null, warning_value: 85, critical_value: 95, direction: 'HIGHER_IS_WORSE' },
  { id: 2, is_active: 1, parameter: 'CPU_TEMP', device_type: 'Laptop', interface: null, brand: null, model_pattern: null, warning_value: 90, critical_value: 98, direction: 'HIGHER_IS_WORSE' },
  { id: 3, is_active: 1, parameter: 'SSD_HEALTH', device_type: null, interface: null, brand: null, model_pattern: null, warning_value: 90, critical_value: 70, direction: 'LOWER_IS_WORSE' },
  { id: 4, is_active: 1, parameter: 'SSD_TEMP', device_type: null, interface: 'NVMe', brand: null, model_pattern: null, warning_value: 65, critical_value: 75, direction: 'HIGHER_IS_WORSE' },
  { id: 5, is_active: 1, parameter: 'SSD_TEMP', device_type: null, interface: 'NVMe', brand: 'Samsung', model_pattern: '980 PRO', warning_value: 70, critical_value: 80, direction: 'HIGHER_IS_WORSE' },
  { id: 6, is_active: 1, parameter: 'BATTERY_HEALTH', device_type: null, interface: null, brand: null, model_pattern: null, warning_value: 80, critical_value: 60, direction: 'LOWER_IS_WORSE' },
  { id: 7, is_active: 1, parameter: 'HDD_HEALTH', device_type: null, interface: null, brand: null, model_pattern: null, warning_value: 90, critical_value: 70, direction: 'LOWER_IS_WORSE' },
];
const desktop = { device_type: 'Desktop PC', brand: 'Dell', processor: 'Intel Core i5' };
const ssd = (o) => ({ storage_type: 'SSD', interface: 'SATA', health_percent: 98, temperature_c: 40, smart_status: 'Baik', ...o });
const run = (o) => evaluate({ asset: desktop, record: { cpu_temp_c: 50, physical_condition: 'Baik', final_condition: 'Baik', ...o.record }, storages: o.storages || [ssd()], battery: o.battery || { is_applicable: 0 }, previous: o.previous || null, thresholds: TH, settings: { smart_unavailable_level: 'PERHATIAN', ...(o.settings || {}) } });

test('semua parameter normal -> BAIK', () => {
  assert.equal(run({}).overall, 'BAIK');
});

test('batas health inklusif: 90 dan 70 = PERHATIAN, 69.9 = KRITIS, 90.1 = BAIK', () => {
  assert.equal(run({ storages: [ssd({ health_percent: 90 })] }).storage_status, 'PERHATIAN');
  assert.equal(run({ storages: [ssd({ health_percent: 70 })] }).storage_status, 'PERHATIAN');
  assert.equal(run({ storages: [ssd({ health_percent: 69.9 })] }).storage_status, 'KRITIS');
  assert.equal(run({ storages: [ssd({ health_percent: 90.1 })] }).storage_status, 'BAIK');
});

test('SMART kritis tetap KRITIS walaupun health masih tinggi', () => {
  const r = run({ storages: [ssd({ health_percent: 99, smart_status: 'Kritis' })] });
  assert.equal(r.overall, 'KRITIS');
  assert.ok(r.items.some((i) => /prioritaskan pemeriksaan/.test(i.message)));
});

test('SMART "Tidak Tersedia" tidak pernah dianggap Baik', () => {
  const r = run({ storages: [ssd({ smart_status: 'Tidak Tersedia' })] });
  assert.equal(r.overall, 'PERHATIAN');
  assert.ok(r.flags.some((f) => /tidak disimpulkan aman/.test(f.message)));
  const info = run({ storages: [ssd({ smart_status: 'Tidak Tersedia' })], settings: { smart_unavailable_level: 'INFO' } });
  const smartItem = info.items.find((i) => i.parameter === 'SSD_SMART');
  assert.equal(smartItem.level, 'TIDAK_TERSEDIA');
});

test('nilai NULL = tidak diperiksa (bukan 0, bukan baik)', () => {
  const r = run({ record: { cpu_temp_c: null }, storages: [ssd({ health_percent: null, temperature_c: null })] });
  const cpu = r.items.find((i) => i.parameter === 'CPU_TEMP');
  assert.equal(cpu.level, 'TIDAK_DIPERIKSA');
  assert.equal(cpu.value, null);
  assert.ok(r.not_checked.length >= 3);
});

test('status tidak ditentukan oleh satu parameter: kondisi fisik rusak berat -> KRITIS', () => {
  assert.equal(run({ record: { physical_condition: 'Rusak Berat' } }).overall, 'KRITIS');
});

test('threshold paling spesifik dipilih (merek + model > antarmuka > umum)', () => {
  assert.equal(matchThreshold(TH, 'SSD_TEMP', { interface: 'NVMe', brand: 'Samsung', model: 'SSD 980 PRO 1TB' }).id, 5);
  assert.equal(matchThreshold(TH, 'SSD_TEMP', { interface: 'NVMe', brand: 'WD', model: 'SN770' }).id, 4);
  assert.equal(matchThreshold(TH, 'CPU_TEMP', { device_type: 'Laptop' }).id, 2);
  assert.equal(matchThreshold(TH, 'CPU_TEMP', { device_type: 'Desktop PC' }).id, 1);
  // 72°C: Kritis menurut aturan NVMe umum (>=75? tidak) -> Perhatian; aturan Samsung 980 PRO -> Perhatian (>=70)
  const r = run({ storages: [ssd({ interface: 'NVMe', brand: 'Samsung', model: '980 PRO', temperature_c: 76 })] });
  assert.equal(r.items.find((i) => i.parameter === 'SSD_TEMP').level, 'PERHATIAN'); // umum akan KRITIS, spesifik PERHATIAN
});

test('baterai: health dihitung dari kapasitas & tidak berlaku untuk desktop', () => {
  const b = { is_applicable: 1, design_capacity_mwh: 50000, full_charge_capacity_mwh: 27000, battery_status: 'Menurun' };
  const r = evaluate({ asset: { device_type: 'Laptop' }, record: { cpu_temp_c: 50, final_condition: 'Baik', physical_condition: 'Baik' }, storages: [ssd()], battery: b, thresholds: TH, settings: {} });
  assert.equal(b.health_percent, 54);
  assert.equal(r.overall, 'KRITIS');
  assert.equal(run({}).items.find((i) => i.parameter === 'BATTERY').level, 'TIDAK_BERLAKU');
});

test('penurunan signifikan dibanding pemeriksaan sebelumnya ditandai', () => {
  const r = run({ storages: [ssd({ storage_device_id: 9, health_percent: 92 })], previous: { cpu_temp_c: 40, storages: [{ storage_device_id: 9, health_percent: 99, temperature_c: 40 }] }, settings: { health_drop_significant: 5 } });
  assert.ok(r.flags.some((f) => /turun 7\.0 poin/.test(f.message)));
});

test('penilaian teknisi lebih baik dari parameter -> diberi catatan peninjauan', () => {
  const r = run({ record: { final_condition: 'Baik' }, storages: [ssd({ health_percent: 50 })] });
  assert.equal(r.overall, 'KRITIS');
  assert.ok(r.flags.some((f) => f.parameter === 'TECHNICIAN'));
  assert.equal(r.needs_follow_up, true);
});
