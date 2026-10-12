'use strict';
/**
 * Logger aplikasi. Field sensitif (password, token, secret, cookie) otomatis disamarkan
 * sehingga kredensial tidak pernah tercetak ke log.
 * Peringatan & error juga ditulis ke storage/logs/app-YYYY-MM.log agar mudah diperiksa.
 */
const fs = require('fs');
const path = require('path');

const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|_csrf/i;
const LOG_DIR = path.join(__dirname, '..', '..', 'storage', 'logs');

function redact(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = Array.isArray(meta) ? [] : {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = SENSITIVE.test(k) ? '[DIRAHASIAKAN]' : (v && typeof v === 'object' ? redact(v) : v);
  }
  return out;
}

function toFile(line) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const d = new Date();
    const file = path.join(LOG_DIR, `app-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.log`);
    fs.appendFileSync(file, `${line}\n`);
  } catch (_) { /* jangan gagalkan aplikasi karena log */ }
}

function write(level, msg, meta) {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(meta ? redact(meta) : {}) });
  (level === 'error' ? console.error : console.log)(line);
  if (level !== 'info' && process.env.NODE_ENV !== 'test') toFile(line);
}

module.exports = {
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  error: (m, meta) => write('error', m, meta),
  redact,
};
