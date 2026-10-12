'use strict';
const mysql = require('mysql2/promise');
const config = require('./index');

// Semua query memakai placeholder (?) = prepared statement / escaping aman dari SQL injection.
const pool = mysql.createPool({
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

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * Jalankan fn(conn) di dalam transaksi. Rollback otomatis bila terjadi error.
 */
async function transaction(fn) {
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

module.exports = { pool, query, one, transaction };
