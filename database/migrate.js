'use strict';
/**
 * Runner migrasi sederhana: menjalankan file database/migrations/{mysql,pgsql}/*.sql
 * secara berurutan dan mencatatnya di tabel schema_migrations.
 * Dialek dipilih lewat DB_CLIENT=mysql|pgsql (default mysql).
 *   node database/migrate.js            -> jalankan migrasi yang belum ada
 *   node database/migrate.js --fresh    -> HAPUS semua tabel lalu migrasi ulang (hanya untuk dev/test!)
 */
const fs = require('fs');
const path = require('path');
const config = require('../src/config');

const isPg = config.db.client === 'pgsql';

function splitSql(sql) {
  // Pisahkan per statement; sadar dollar-quoting ($$...$$) agar badan
  // fungsi PL/pgSQL yang mengandung ';' tidak terpotong.
  const out = [];
  let cur = '';
  let inDollar = false;
  const lines = sql.split('\n');
  for (const raw of lines) {
    const line = raw.replace(/^\s*--.*$/, '');
    cur += line + '\n';
    const dollars = (line.match(/\$\$/g) || []).length;
    if (dollars % 2 === 1) inDollar = !inDollar;
    if (!inDollar && /;\s*$/.test(line)) {
      const stmt = cur.trim();
      if (stmt.replace(/;$/, '').trim()) out.push(stmt);
      cur = '';
    }
  }
  const rest = cur.trim();
  if (rest) out.push(rest);
  return out;
}

async function connectDb() {
  if (isPg) {
    const { Client } = require('pg');
    const client = new Client({
      host: config.db.host, port: config.db.port, user: config.db.user,
      password: config.db.password, database: config.db.database,
    });
    await client.connect();
    return {
      query: (sql, params = []) => client.query(sql, params).then((r) => [r.rows, r.fields]),
      end: () => client.end(),
    };
  }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: config.db.database, charset: 'utf8mb4',
  });
  return { query: (sql, params) => conn.query(sql, params), end: () => conn.end() };
}

async function migrate({ fresh = false, silent = false } = {}) {
  const log = (...a) => { if (!silent) console.log(...a); };
  log(`Dialek database: ${isPg ? 'PostgreSQL' : 'MySQL/MariaDB'}`);
  const conn = await connectDb();
  try {
    if (fresh) {
      if (config.isProd && !process.env.ALLOW_FRESH) throw new Error('--fresh ditolak di produksi (set ALLOW_FRESH=1 bila benar-benar yakin).');
      if (isPg) {
        const [tables] = await conn.query(
          "SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'pg_%'"
        );
        for (const { t } of tables) await conn.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
        try { await conn.query('DROP FUNCTION IF EXISTS touch_updated_at() CASCADE'); } catch (_) { /* abaikan */ }
        log(`Semua tabel (${tables.length}) dihapus.`);
      } else {
        const [tables] = await conn.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [config.db.database]);
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const { t } of tables) await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        log(`Semua tabel (${tables.length}) dihapus.`);
      }
    }
    if (isPg) {
      await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    } else {
      await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(190) PRIMARY KEY, executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    const [doneRows] = await conn.query('SELECT name FROM schema_migrations');
    const done = new Set(doneRows.map((r) => r.name));
    const dir = path.join(__dirname, 'migrations', isPg ? 'pgsql' : 'mysql');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    let ran = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const statements = splitSql(fs.readFileSync(path.join(dir, file), 'utf8'));
      log(`→ ${file} (${statements.length} statement)`);
      for (const st of statements) await conn.query(st);
      await conn.query(isPg ? 'INSERT INTO schema_migrations (name) VALUES ($1)' : 'INSERT INTO schema_migrations (name) VALUES (?)', [file]);
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
