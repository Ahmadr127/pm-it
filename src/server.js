'use strict';
const config = require('./config');
const { createApp } = require('./app');
const { pool } = require('./config/db');
const logger = require('./utils/logger');

async function start() {
  // Tunggu database siap (mis. MySQL baru dinyalakan saat Windows mulai) hingga ±2 menit
  for (let i = 1; ; i++) {
    try { await pool.query('SELECT 1'); break; } catch (e) {
      if (i >= 60) {
        logger.error('Tidak dapat terhubung ke database. Pastikan MySQL di XAMPP berjalan dan konfigurasi DB_* di file .env benar.', { error: e.code || e.message });
        process.exit(1);
      }
      if (i === 1) logger.info('Menunggu database MySQL siap...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  // Terapkan pembaruan struktur database (migrasi baru) secara otomatis saat aplikasi dijalankan
  try {
    await require('../database/migrate').migrate({ silent: true });
  } catch (e) {
    logger.error('Pembaruan database (migrasi) gagal. Aplikasi dihentikan agar data tetap konsisten.', { error: e.message });
    process.exit(1);
  }
  // Nama instansi dari Pengaturan Sistem (bila ada)
  try {
    const [rows] = await pool.query("SELECT setting_value FROM app_settings WHERE setting_key='company_name'");
    if (rows[0] && rows[0].setting_value) config.companyName = rows[0].setting_value;
  } catch (_) { /* pakai nilai .env */ }
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`${config.appName} berjalan di port ${config.port} (${config.env})`);
  });
  // HTTPS untuk HP / PC lain di jaringan (sertifikat lokal dibuat otomatis). Gagal = tidak fatal.
  let secure = null;
  if (config.httpsPort) {
    try {
      const tls = require('./services/tls').ensureCertificates(require('path').join(config.root, 'storage', 'certs'));
      app.locals.tls = { caPem: tls.caPem, ips: tls.ips, port: config.httpsPort };
      secure = require('https').createServer({ key: tls.key, cert: tls.cert }, app);
      secure.on('error', (e) => { app.locals.tls = null; logger.warn('HTTPS tidak dapat dijalankan', { error: e.code || e.message }); });
      secure.listen(config.httpsPort, () => logger.info(`HTTPS aktif di port ${config.httpsPort} (${tls.ips.filter((i) => i !== '127.0.0.1').join(', ') || 'localhost'})`));
    } catch (e) {
      logger.warn('Sertifikat HTTPS gagal dibuat; akses HTTPS dinonaktifkan', { error: e.message });
    }
  }
  const shutdown = (code = 0) => {
    if (secure) secure.close();
    server.close(() => pool.end().then(() => process.exit(code), () => process.exit(code)));
    setTimeout(() => process.exit(code), 4000).unref(); // koneksi keep-alive jangan menahan restart
  };
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
  // Pembaruan otomatis tanpa bergantung versi Node.js: bila file aplikasi berubah, proses keluar dengan kode 3
  // dan skrip penjalan (2-JALANKAN.bat / server-latar.bat) langsung menyalakannya kembali.
  if (process.env.PMIT_SUPERVISED === '1' && !process.execArgv.some((a) => a.startsWith('--watch'))) {
    const fs = require('fs'); const path = require('path');
    let timer = null;
    const onChange = (dir, file) => {
      if (file && /(^|[\\/])(\.|~)|\.(tmp|swp|part)$/i.test(String(file))) return;
      clearTimeout(timer);
      timer = setTimeout(() => { logger.info(`Pembaruan file terdeteksi (${dir}/${file || ''}), memuat ulang aplikasi...`); shutdown(3); }, 2000);
    };
    const DIRS = ['src', 'database', 'public'];
    for (const dir of DIRS) {
      try { fs.watch(path.join(config.root, dir), { recursive: true }, (ev, file) => onChange(dir, file)); } catch (e) { logger.warn('Pemantauan pembaruan file tidak aktif', { dir, error: e.message }); }
    }
    // Cadangan: periksa waktu ubah & ukuran semua file tiap 3 detik (bila notifikasi sistem file tidak sampai)
    const signature = () => {
      let n = 0; let acc = 0;
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else { try { const st = fs.statSync(p); n += 1; acc += (st.mtimeMs % 1e9) + st.size; } catch (_) { /* file sedang ditulis */ } }
        }
      };
      for (const dir of DIRS) { try { walk(path.join(config.root, dir)); } catch (_) { /* abaikan */ } }
      return `${n}:${acc}`;
    };
    let lastSig = signature();
    setInterval(() => { const sig = signature(); if (sig !== lastSig) { lastSig = sig; onChange('file', ''); } }, 3000).unref();
    logger.info('Pembaruan otomatis aktif: aplikasi memuat ulang sendiri bila file diperbarui.');
  }
}

start();
