'use strict';
/**
 * Runner migrasi sederhana: menjalankan file database/migrations/*.sql secara berurutan
 * dan mencatatnya di tabel schema_migrations.
 *   node database/migrate.js            -> jalankan migrasi yang belum ada
 *   node database/migrate.js --fresh    -> HAPUS semua tabel lalu migrasi ulang (hanya untuk dev/test!)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

function splitSql(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

async function migrate({ fresh = false, silent = false } = {}) {
  const log = (...a) => { if (!silent) console.log(...a); };
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: config.db.database, charset: 'utf8mb4',
  });
  try {
    if (fresh) {
      if (config.isProd && !process.env.ALLOW_FRESH) throw new Error('--fresh ditolak di produksi (set ALLOW_FRESH=1 bila benar-benar yakin).');
      const [tables] = await conn.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [config.db.database]);
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const { t } of tables) await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      log(`Semua tabel (${tables.length}) dihapus.`);
    }
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(190) PRIMARY KEY, executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [doneRows] = await conn.query('SELECT name FROM schema_migrations');
    const done = new Set(doneRows.map((r) => r.name));
    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    let ran = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const statements = splitSql(fs.readFileSync(path.join(dir, file), 'utf8'));
      log(`→ ${file} (${statements.length} statement)`);
      for (const st of statements) await conn.query(st);
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      ran++;
    }
    log(ran ? `Migrasi selesai: ${ran} file dijalankan.` : 'Database sudah mutakhir.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrate({ fresh: process.argv.includes('--fresh') })
    .then(() => process.exit(0))
    .catch((e) => { console.error('Migrasi gagal:', e.message); process.exit(1); });
}

module.exports = { migrate };
