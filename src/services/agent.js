'use strict';
/**
 * Arsitektur pengambilan data hardware otomatis.
 * Agent lokal (Windows) mengirim JSON ke POST /api/agent/readings dengan token Bearer.
 * Server memvalidasi setiap parameter: nilai yang tidak tersedia / di luar rentang wajar disimpan sebagai NULL
 * dan dicatat — tidak pernah diisi tebakan. Data masuk ke staging (agent_readings) dan baru dipakai
 * di form maintenance bila teknisi memilih "Gunakan data agent".
 */
const crypto = require('crypto');
const db = require('../config/db');

const SMART = ['Baik', 'Peringatan', 'Kritis', 'Tidak Tersedia'];
const IFACES = ['SATA', 'NVMe', 'SAS', 'USB', 'Lainnya'];

function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function newToken() { return `pmit_${crypto.randomBytes(24).toString('base64url')}`; }

function numIn(v, min, max, label, notes) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) { notes.push(`${label}: nilai "${v}" di luar rentang wajar (${min}–${max}), diabaikan.`); return null; }
  return Math.round(n * 10) / 10;
}
function str(v, max) { return v === null || v === undefined || v === '' ? null : String(v).trim().slice(0, max); }

function validatePayload(p) {
  const notes = []; const unavailable = [];
  if (!p || typeof p !== 'object' || !p.device || typeof p.device !== 'object') return { ok: false, notes: ['Struktur payload tidak valid (objek "device" wajib ada).'] };
  const collected = p.collected_at ? new Date(p.collected_at) : null;
  if (!collected || isNaN(collected)) return { ok: false, notes: ['collected_at wajib berupa tanggal ISO-8601 yang valid.'] };
  if (collected > new Date(Date.now() + 10 * 60000)) return { ok: false, notes: ['collected_at berada di masa depan.'] };
  const device = {
    hostname: str(p.device.hostname, 100), serial_number: str(p.device.serial_number, 100), asset_code: str(p.device.asset_code, 50),
    os: str(p.device.os, 120), cpu: str(p.device.cpu, 150), ram_gb: numIn(p.device.ram_gb, 0.5, 4096, 'RAM', notes),
    ip_address: str(p.device.ip_address, 45), mac_address: str(p.device.mac_address, 17),
  };
  if (!device.hostname && !device.serial_number && !device.asset_code) return { ok: false, notes: ['Identitas perangkat (asset_code / serial_number / hostname) wajib ada.'] };

  const cpuIn = p.cpu || {};
  const cpu = { temperature_c: cpuIn.available === false ? null : numIn(cpuIn.temperature_c, -10, 130, 'Suhu CPU', notes), source: str(cpuIn.source, 80) };
  if (cpu.temperature_c === null) unavailable.push('suhu CPU');

  const storages = (Array.isArray(p.storages) ? p.storages : []).slice(0, 16).map((s, i) => {
    const type = s.storage_type === 'HDD' ? 'HDD' : s.storage_type === 'SSD' ? 'SSD' : null;
    if (!type) { notes.push(`Storage #${i + 1}: storage_type harus SSD atau HDD, diabaikan.`); return null; }
    const out = {
      storage_type: type, interface: IFACES.includes(s.interface) ? s.interface : null, brand: str(s.brand, 80), model: str(s.model, 120),
      serial_number: str(s.serial_number, 100), capacity_gb: numIn(s.capacity_gb, 1, 1000000, `Kapasitas storage #${i + 1}`, notes),
      temperature_c: numIn(s.temperature_c, -10, 130, `Suhu storage #${i + 1}`, notes),
      health_percent: numIn(s.health_percent, 0, 100, `Health storage #${i + 1}`, notes),
      used_percent: numIn(s.used_percent, 0, 100, `Terpakai storage #${i + 1}`, notes),
      smart_status: SMART.includes(s.smart_status) ? s.smart_status : 'Tidak Tersedia',
    };
    if (out.temperature_c === null) unavailable.push(`suhu ${type} #${i + 1}`);
    if (out.health_percent === null) unavailable.push(`health ${type} #${i + 1}`);
    if (out.smart_status === 'Tidak Tersedia') unavailable.push(`SMART ${type} #${i + 1}`);
    return out;
  }).filter(Boolean);

  let battery = null;
  if (p.battery && p.battery.present) {
    battery = {
      design_capacity_mwh: numIn(p.battery.design_capacity_mwh, 1, 500000, 'Design capacity', notes),
      full_charge_capacity_mwh: numIn(p.battery.full_charge_capacity_mwh, 0, 500000, 'Full charge capacity', notes),
      cycle_count: numIn(p.battery.cycle_count, 0, 100000, 'Cycle count', notes),
      health_percent: numIn(p.battery.health_percent, 0, 150, 'Battery health', notes),
    };
    if (battery.health_percent === null && battery.design_capacity_mwh && battery.full_charge_capacity_mwh !== null) {
      battery.health_percent = Math.round((battery.full_charge_capacity_mwh / battery.design_capacity_mwh) * 1000) / 10;
    }
    if (battery.health_percent === null) unavailable.push('battery health');
  }
  return { ok: true, data: { agent_version: str(p.agent_version, 30), collected_at: collected, device, cpu, storages, battery }, notes, unavailable };
}

async function findAsset(device) {
  if (device.asset_code) { const a = await db.one('SELECT id FROM assets WHERE asset_code=? AND deleted_at IS NULL', [device.asset_code]); if (a) return a.id; }
  if (device.serial_number) { const a = await db.one('SELECT id FROM assets WHERE serial_number=? AND deleted_at IS NULL', [device.serial_number]); if (a) return a.id; }
  if (device.hostname) { const rows = await db.query('SELECT id FROM assets WHERE hostname=? AND deleted_at IS NULL LIMIT 2', [device.hostname]); if (rows.length === 1) return rows[0].id; }
  return null;
}

function toLocalDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = { hashToken, newToken, validatePayload, findAsset, toLocalDateTime };
