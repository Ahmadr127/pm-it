'use strict';
/**
 * Validator ringan berbasis skema (dipakai di semua endpoint backend).
 * String kosong selalu dinormalisasi menjadi NULL (tidak pernah 0).
 */

const RE = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  ipv4: /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/,
  ipv6: /^[0-9a-fA-F:]{2,39}$/,
  mac: /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/,
  code: /^[A-Za-z0-9._\-/]+$/,
};

function isValidDate(s) {
  if (!RE.date.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function clean(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) v = v[v.length - 1];
  if (typeof v === 'string') { v = v.trim(); return v === '' ? null : v; }
  return v;
}

function validate(input, schema) {
  const data = {};
  const errors = {};
  for (const [key, rule] of Object.entries(schema)) {
    const label = rule.label || key;
    let v = clean(input ? input[key] : undefined);
    if (rule.type === 'bool') { data[key] = v === '1' || v === 'on' || v === 'true' || v === true || v === 1 ? 1 : 0; continue; }
    if (v === null) {
      if (rule.required) errors[key] = `${label} wajib diisi.`;
      data[key] = rule.default !== undefined ? rule.default : null;
      continue;
    }
    switch (rule.type) {
      case 'int':
      case 'decimal': {
        const s = String(v).replace(',', '.');
        const ok = rule.type === 'int' ? /^-?\d+$/.test(s) : /^-?\d+(\.\d+)?$/.test(s);
        if (!ok) { errors[key] = `${label} harus berupa angka${rule.type === 'int' ? ' bulat' : ''}.`; break; }
        const n = Number(s);
        if (rule.min !== undefined && n < rule.min) { errors[key] = `${label} minimal ${rule.min}${rule.unit || ''}.`; break; }
        if (rule.max !== undefined && n > rule.max) { errors[key] = `${label} maksimal ${rule.max}${rule.unit || ''}.`; break; }
        v = n; break;
      }
      case 'date':
        if (!isValidDate(v)) errors[key] = `${label} harus berupa tanggal yang valid.`; break;
      case 'time':
        if (!RE.time.test(v)) errors[key] = `${label} harus berformat JJ:MM.`; else if (v.length === 5) v += ':00'; break;
      case 'enum':
        if (!rule.values.includes(v)) errors[key] = `${label} tidak valid.`; break;
      case 'email':
        if (!RE.email.test(v) || v.length > 150) errors[key] = `${label} tidak valid.`; break;
      case 'ip':
        if (!RE.ipv4.test(v) && !(v.includes(':') && RE.ipv6.test(v))) errors[key] = `${label} tidak valid (contoh: 192.168.1.10).`; break;
      case 'mac':
        if (!RE.mac.test(v)) errors[key] = `${label} tidak valid (contoh: 00:1A:2B:3C:4D:5E).`; else v = v.toUpperCase().replace(/-/g, ':'); break;
      case 'code':
        if (!RE.code.test(v)) errors[key] = `${label} hanya boleh huruf, angka, titik, garis bawah, strip, atau garis miring.`;
        if (rule.upper) v = String(v).toUpperCase();
        break;
      case 'id':
        if (!/^\d+$/.test(String(v))) errors[key] = `${label} tidak valid.`; else v = Number(v); break;
      default:
        v = String(v);
    }
    if (typeof v === 'string' && rule.maxLength && v.length > rule.maxLength) errors[key] = `${label} maksimal ${rule.maxLength} karakter.`;
    data[key] = v;
  }
  return { data, errors, ok: Object.keys(errors).length === 0 };
}

class ValidationError extends Error {
  constructor(errors, message = 'Data tidak valid. Periksa kembali isian yang ditandai.') {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
    this.errors = errors;
  }
}

module.exports = { validate, clean, isValidDate, ValidationError, RE };
