'use strict';
/**
 * Backup dari command line (sama dengan tombol "Backup Sekarang" di menu Administrasi > Backup Data).
 *   npm run backup
 * Hasil: storage/backups/pmit-backup-YYYYMMDD-HHMMSS-manual.zip (database.sql + uploads/ + manifest.json)
 */
const backup = require('../src/services/backup');
const db = require('../src/config/db');

backup.createBackup({ kind: 'manual' })
  .then((r) => { console.log(`Backup selesai: ${r.name} (${(r.size / 1048576).toFixed(2)} MB, ${r.rows} baris, ${r.files} file).`); return db.pool.end(); })
  .then(() => process.exit(0))
  .catch((e) => { console.error(`BACKUP GAGAL: ${e.message}`); process.exit(1); });
