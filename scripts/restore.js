'use strict';
/**
 * Pemulihan dari command line (alternatif menu Administrasi > Backup Data > Pulihkan).
 *   npm run restore -- pmit-backup-20261009-120000-otomatis.zip --yes
 * File dicari di folder backup (storage/backups). File di lokasi lain: salin dulu ke folder tersebut.
 * Database saat ini DITIMPA; backup "sebelum-pulihkan" dibuat otomatis terlebih dahulu.
 */
const path = require('path');
const backup = require('../src/services/backup');
const db = require('../src/config/db');

async function main() {
  const name = path.basename(process.argv[2] || '');
  if (!name) throw new Error('Pemakaian: npm run restore -- <nama-file-backup.zip> --yes');
  if (!process.argv.includes('--yes')) throw new Error('Database akan DITIMPA. Ulangi perintah dengan --yes untuk melanjutkan.');
  const r = await backup.restoreBackup(name);
  console.log(`Data dipulihkan dari backup ${r.manifest.created_at} (${r.files} file). Backup pengaman: ${r.safety}`);
  await db.pool.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(`RESTORE GAGAL: ${e.message}`); process.exit(1); });
