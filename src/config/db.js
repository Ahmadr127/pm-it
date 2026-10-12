'use strict';
/**
 * Lapisan akses database ganda: MySQL/MariaDB (mysql2) atau PostgreSQL (pg).
 * Dipilih lewat DB_CLIENT=mysql|pgsql (default mysql agar instalasi lama tetap jalan).
 *
 * Semua query aplikasi memakai placeholder (?) dan diterjemahkan otomatis
 * ke ($1, $2, ...) untuk PostgreSQL. Perbedaan dialek lain (IFNULL,
 * GROUP_CONCAT, dsb.) ditulis eksplisit di tiap query/helper, bukan di sini,
 * kecuali LIKE→ILIKE agar pencarian tetap tak-peka-huruf seperti MySQL.
 */
const config = require('./index');

const CLIENT = (process.env.DB_CLIENT || 'mysql').toLowerCase() === 'pgsql' ? 'pgsql' : 'mysql';
const isPg = CLIENT === 'pgsql';

let pool;
if (isPg) {
  const { Pool, types } = require('pg');
  // Samakan perilaku mysql2: angka sebagai Number, tanggal sebagai string 'YYYY-MM-DD HH:MM:SS'.
  types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // INT8
  types.setTypeParser(21, (v) => (v === null ? null : parseInt(v, 10))); // INT2
  types.setTypeParser(23, (v) => (v === null ? null : parseInt(v, 10))); // INT4
  types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // NUMERIC
  const asDate = (v) => (v === null ? null : v.slice(0, 10)); // DATE -> 'YYYY-MM-DD'
  const asStamp = (v) => {
    if (v === null) return null;
    // '2026-10-12T07:00:00.000Z' -> '2026-10-12 07:00:00' (UTC, konsisten untuk perbandingan string).
    const d = new Date(v);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  };
  types.setTypeParser(1082, asDate); // DATE
  types.setTypeParser(1114, asStamp); // TIMESTAMP
  types.setTypeParser(1184, asStamp); // TIMESTAMPTZ
  pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    max: config.db.connectionLimit,
  });
} else {
  const mysql = require('mysql2/promise');
  // Semua query memakai placeholder (?) = prepared statement / escaping aman dari SQL injection.
  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectionLimit: config.db.connectionLimit,
    waitForConnections: true,
    charset: 'utf8mb4',
    dateStrings: true, // DATE/DATETIME dikembalikan apa adanya (tanpa konversi zona waktu)
    decimalNumbers: true,
    namedPlaceholders: false,
    multipleStatements: false,
  });
}

/**
 * Terjemahkan SQL MySQL-style ke PostgreSQL:
 *  - `?` -> $1, $2, ... (lewati literal string '...', kembangkan param array untuk IN (?))
 *  - LIKE -> ILIKE (perilaku tak-peka-huruf seperti collation MySQL)
 *  - INSERT IGNORE INTO -> INSERT INTO ... ON CONFLICT DO NOTHING
 */
function translate(sql, params) {
  let out = '';
  let idx = 0; // nomor parameter $n berikutnya
  let p = 0; // indeks params berikutnya
  let inStr = false;
  const expanded = [];
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") { out += sql[i + 1]; i++; } // '' escape
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; out += ch; continue; }
    if (ch === '?') {
      const val = params[p++];
      if (Array.isArray(val)) {
        if (!val.length) out += '(NULL)';
        else out += `(${val.map((v) => { idx++; expanded.push(v); return `$${idx}`; }).join(',')})`;
      } else {
        idx++;
        expanded.push(val);
        out += `$${idx}`;
      }
      continue;
    }
    out += ch;
  }
  out = out.replace(/\bLIKE\b/g, 'ILIKE');
  if (/^\s*INSERT\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/^\s*INSERT\s+IGNORE\s+INTO/i, 'INSERT INTO');
    if (!/ON CONFLICT/i.test(out) && !/RETURNING/i.test(out)) out += ' ON CONFLICT DO NOTHING';
  }
  return { sql: out, params: expanded };
}

function isInsert(sql) {
  return /^\s*INSERT\b/i.test(sql);
}

function needsId(sql) {
  if (!isInsert(sql) || /ON CONFLICT DO NOTHING/i.test(sql) || /RETURNING\b/i.test(sql)) return false;
  // Tabel tanpa kolom id (composite key).
  if (/INSERT\s+INTO\s+["`']?role_permissions["`']?\b/i.test(sql)) return false;
  return true;
}

async function query(sql, params = []) {
  if (!isPg) {
    const [rows] = await pool.query(sql, params);
    return rows;
  }
  let t = translate(sql, params);
  let text = t.sql;
  if (needsId(text)) text += ' RETURNING id';
  const res = await pool.query(text, t.params);
  if (isInsert(sql)) {
    const row = (res.rows || [])[0] || {};
    return { insertId: row.id !== undefined ? Number(row.id) : undefined, affectedRows: res.rowCount };
  }
  return res.rows;
}

async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * Jalankan fn(conn) di dalam transaksi. Rollback otomatis bila terjadi error.
 */
async function transaction(fn) {
  if (!isPg) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const helpers = {
        conn,
        query: async (sql, params = []) => (await conn.query(sql, params))[0],
        one: async (sql, params = []) => ((await conn.query(sql, params))[0][0] || null),
      };
      const result = await fn(helpers);
      await conn.commit();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* abaikan */ }
      throw err;
    } finally {
      conn.release();
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = async (sql, params = []) => {
      const t = translate(sql, params);
      let text = t.sql;
      if (needsId(text)) text += ' RETURNING id';
      const res = await client.query(text, t.params);
      if (isInsert(sql)) {
        const row = (res.rows || [])[0] || {};
        return { insertId: row.id !== undefined ? Number(row.id) : undefined, affectedRows: res.rowCount };
      }
      return res.rows;
    };
    const helpers = {
      conn: client,
      query: run,
      one: async (sql, params = []) => (await run(sql, params))[0] || null,
    };
    const result = await fn(helpers);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* abaikan */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * UPSERT lintas-dialek: INSERT bila kunci belum ada, UPDATE bila sudah.
 * keyCol = kolom unik konflik (mis. 'setting_key').
 */
async function upsert(table, keyCol, data, conn = null) {
  const cols = Object.keys(data);
  const vals = Object.values(data).map((v) => (v === undefined ? null : v));
  const run = conn || { query, one };
  if (!isPg) {
    const sets = cols.filter((c) => c !== keyCol).map((c) => `${c}=VALUES(${c})`).join(',');
    await run.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ON DUPLICATE KEY UPDATE ${sets}`,
      vals
    );
    return;
  }
  const sets = cols.filter((c) => c !== keyCol).map((c) => `${c}=EXCLUDED.${c}`).join(',');
  await run.query(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ON CONFLICT (${keyCol}) DO UPDATE SET ${sets} RETURNING ${keyCol}`,
    vals
  );
}

/**
 * Nomor urut atomik per kunci (ganti pola LAST_INSERT_ID MySQL).
 */
async function nextSequence(conn, key) {
  if (!isPg) {
    await conn.query('INSERT INTO number_sequences (seq_key, last_number) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)', [key]);
    return (await conn.one('SELECT LAST_INSERT_ID() n')).n;
  }
  const row = await conn.one(
    `INSERT INTO number_sequences (seq_key, last_number) VALUES (?, 1)
     ON CONFLICT (seq_key) DO UPDATE SET last_number = number_sequences.last_number + 1
     RETURNING last_number n`,
    [key]
  );
  return row.n;
}

/**
 * ORDER BY FIELD(col, ...) lintas-dialek (dieksekusi: CASE ... END).
 */
function orderField(col, values) {
  const cases = values.map((v, i) => `WHEN ${v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`} THEN ${i}`).join(' ');
  return `CASE ${col} ${cases} ELSE ${values.length} END`;
}

/**
 * Agregasi string lintas-dialek (pengganti GROUP_CONCAT).
 * mysql: GROUP_CONCAT(expr SEPARATOR sep) | pgsql: STRING_AGG(expr, sep)
 */
function groupConcat(expr, sep) {
  if (!isPg) return `GROUP_CONCAT(${expr} SEPARATOR '${sep}')`;
  return `STRING_AGG(${expr}, '${sep}')`;
}

/**
 * Format YYYY-MM lintas-dialek (pengganti DATE_FORMAT(x, '%Y-%m')).
 */
function yearMonth(col) {
  if (!isPg) return `DATE_FORMAT(${col},'%Y-%m')`;
  return `TO_CHAR(${col}, 'YYYY-MM')`;
}

module.exports = { pool, query, one, transaction, upsert, nextSequence, orderField, groupConcat, yearMonth, client: CLIENT, isPg };
