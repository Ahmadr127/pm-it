'use strict';
/**
 * Backup & pemulihan data aplikasi — tanpa mysqldump, cukup Node.js.
 *
 * Satu file .zip berisi:
 *   database.sql   seluruh tabel (kecuali sesi login) — bisa juga diimpor lewat phpMyAdmin
 *   uploads/...    foto & dokumen yang diunggah
 *   manifest.json  waktu, jumlah baris per tabel, checksum SHA-256 database.sql
 *
 * Backup hanya dibuat manual (tombol "Backup Sekarang") agar tidak membebani PC server.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const config = require('../config');
const db = require('../config/db');
const settings = require('./settings');
const logger = require('../utils/logger');
const { ZipWriter, openZip } = require('./zip');

const KINDS = { manual: 'Manual', otomatis: 'Otomatis', 'sebelum-pulihkan': 'Sebelum pemulihan', unggahan: 'Diunggah' };
const NAME_RE = /^pmit-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(manual|otomatis|sebelum-pulihkan|unggahan)(?:-\d+)?\.zip$/;
const SKIP_TABLES = new Set(['sessions']);
const SKIP_TABLES_PG = new Set(['session']);
const DEFAULTS = { backup_keep: '14', backup_copy_dir: '' };

let busy = null; // 'backup' | 'restore' — mencegah dua proses berjalan bersamaan

const dir = () => { fs.mkdirSync(config.backup.dir, { recursive: true }); return config.backup.dir; };
const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
const qi = (n) => `\`${String(n).replace(/`/g, '``')}\``;

async function conf() {
  const s = await settings.all();
  return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, s[k] ?? DEFAULTS[k]]));
}

function connect(extra = {}) {
  if (config.db.client === 'pgsql') {
    const { Client } = require('pg');
    const client = new Client({
      host: config.db.host, port: config.db.port, user: config.db.user,
      password: config.db.password, database: config.db.database, ...extra,
    });
    return client.connect().then(() => client);
  }
  return mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database,
    charset: 'utf8mb4', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
    typeCast: (field, next) => (field.type === 'JSON' ? field.string() : next()), ...extra,
  });
}

const qiPg = (n) => `"${String(n).replace(/"/g, '""')}"`;
function litPg(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
  // E'' agar \n, \r, \\ pulih persis saat restore.
  return `E'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
}

/** Isi database dalam bentuk SQL (dialek aktif). Untuk PostgreSQL hanya data
 *  (INSERT); skema dibuat ulang oleh migrate() saat pemulihan. */
async function dumpSql() {
  if (config.db.client === 'pgsql') return dumpSqlPg();
  const conn = await connect();
  const out = []; const counts = {};
  try {
    const [tables] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    const names = tables.map((r) => Object.values(r)[0]).filter((t) => !SKIP_TABLES.has(t)).sort();
    out.push(`-- Backup PM-IT Asset Monitoring\n-- Database: ${config.db.database}\n-- Dibuat: ${new Date().toISOString()}\n`);
    out.push("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n");
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    for (const t of names) {
      const [[cr]] = await conn.query(`SHOW CREATE TABLE ${qi(t)}`);
      out.push(`\nDROP TABLE IF EXISTS ${qi(t)};\n${cr['Create Table']};\n`);
      const [rows, fields] = await conn.query(`SELECT * FROM ${qi(t)}`);
      counts[t] = rows.length;
      if (!rows.length) continue;
      const cols = fields.map((f) => qi(f.name)).join(',');
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200).map((r) => `(${fields.map((f) => conn.escape(r[f.name])).join(',')})`);
        out.push(`INSERT INTO ${qi(t)} (${cols}) VALUES ${chunk.join(',')};\n`);
      }
    }
    await conn.query('COMMIT');
    out.push('\nSET FOREIGN_KEY_CHECKS=1;\n');
  } finally { await conn.end(); }
  return { sql: Buffer.from(out.join(''), 'utf8'), counts };
}

/** Varian PostgreSQL: hanya INSERT (urutan-bebas; FK deferrable). */
async function dumpSqlPg() {
  const { Client } = require('pg');
  const conn = new Client({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: config.db.database,
  });
  await conn.connect();
  const out = []; const counts = {};
  try {
    const tables = (await conn.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    )).rows.map((r) => r.tablename).filter((t) => !SKIP_TABLES_PG.has(t)).sort();
    out.push(`-- Backup PM-IT Asset Monitoring (PostgreSQL)\n-- Database: ${config.db.database}\n-- Dibuat: ${new Date().toISOString()}\n`);
    out.push('-- Skema dibuat oleh migrate(); file ini hanya berisi data.\n');
    for (const t of tables) {
      const cols = (await conn.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
        ['public', t]
      )).rows.map((r) => r.column_name);
      const { rows } = await conn.query(`SELECT * FROM ${qiPg(t)}`);
      counts[t] = rows.length;
      if (!rows.length) continue;
      const colList = cols.map(qiPg).join(',');
      out.push(`\n-- ${t} (${rows.length} baris)\n`);
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200)
          .map((r) => `(${cols.map((c) => litPg(r[c])).join(',')})`).join(',');
        out.push(`INSERT INTO ${qiPg(t)} (${colList}) VALUES ${chunk};\n`);
      }
    }
  } finally { await conn.end(); }
  return { sql: Buffer.from(out.join(''), 'utf8'), counts };
}

function walk(root, rel = '') {
  const res = [];
  if (!fs.existsSync(path.join(root, rel))) return res;
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (r !== 'tmp') res.push(...walk(root, r)); } else if (e.isFile()) res.push(r);
  }
  return res;
}

function uniqueName(kind) {
  const base = `pmit-backup-${stamp()}-${kind}`;
  let name = `${base}.zip`;
  for (let i = 2; fs.existsSync(path.join(dir(), name)); i++) name = `${base}-${i}.zip`;
  return name;
}

/** Buat backup baru. kind: manual | otomatis | sebelum-pulihkan */
async function createBackup({ kind = 'manual', user = null } = {}) {
  if (busy) throw Object.assign(new Error(`Proses ${busy === 'restore' ? 'pemulihan' : 'backup'} lain sedang berjalan. Coba lagi sebentar.`), { status: 409 });
  busy = 'backup';
  const t0 = Date.now();
  const name = uniqueName(kind);
  const file = path.join(dir(), name);
  const partial = `${file}.part`;
  let zip = null;
  try {
    const { sql, counts } = await dumpSql();
    zip = new ZipWriter(partial);
    zip.add('database.sql', sql);
    const files = walk(config.upload.dir); let bytes = 0;
    for (const r of files) {
      const p = path.join(config.upload.dir, r);
      let st; let data;
      try { st = fs.statSync(p); data = fs.readFileSync(p); } catch (_) { continue; } // file terhapus saat backup
      bytes += data.length; zip.add(`uploads/${r}`, data, st.mtime);
    }
    const [mig] = await db.query('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').catch(() => [[]]);
    const manifest = {
      app: config.appName, format: 1, kind, created_at: new Date().toISOString(), created_by: user ? user.full_name || user.username : 'Sistem',
      database: config.db.database, dialect: config.db.client, schema: mig ? mig.name : null, tables: counts,
      sql_bytes: sql.length, sql_sha256: crypto.createHash('sha256').update(sql).digest('hex'), upload_files: files.length, upload_bytes: bytes,
    };
    zip.add('manifest.json', JSON.stringify(manifest, null, 2));
    zip.add('BACA-SAYA.txt', [
      'Backup PM-IT Asset Monitoring',
      `Dibuat: ${new Date().toLocaleString('id-ID')} (${KINDS[kind]})`,
      '',
      'Cara memulihkan (disarankan): buka aplikasi > Administrasi > Backup Data > Unggah backup > Pulihkan.',
      'Alternatif: impor database.sql lewat phpMyAdmin ke database aplikasi, lalu salin isi folder uploads',
      'ke folder storage/uploads aplikasi.',
    ].join('\r\n'));
    zip.close(); zip = null;
    fs.renameSync(partial, file);
    const size = fs.statSync(file).size;
    const copyErr = await copyExtra(file, name);
    if (kind === 'otomatis') await applyRetention();
    logger.info(`Backup dibuat: ${name}`, { size, ms: Date.now() - t0 });
    return { name, size, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), files: files.length, ms: Date.now() - t0, copyErr };
  } catch (e) {
    if (zip) zip.abort();
    fs.rmSync(partial, { force: true });
    throw e;
  } finally { busy = null; }
}

/** Salin ke folder tambahan (mis. hardisk ke-2 / flashdisk / folder jaringan). Gagal = tidak membatalkan backup. */
async function copyExtra(file, name) {
  const target = String((await conf()).backup_copy_dir || '').trim();
  if (!target) return null;
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(file, path.join(target, name));
    if (name.includes('-otomatis')) pruneDir(target, Number((await conf()).backup_keep) || 14);
    return null;
  } catch (e) {
    logger.warn('Salinan backup ke folder tambahan gagal', { target, error: e.message });
    return `Salinan ke ${target} gagal: ${e.code || e.message}`;
  }
}

function pruneDir(d, keep) {
  const auto = fs.readdirSync(d).filter((n) => NAME_RE.test(n) && n.includes('-otomatis')).sort().reverse();
  for (const n of auto.slice(Math.max(1, keep))) fs.rmSync(path.join(d, n), { force: true });
}
async function applyRetention() { pruneDir(dir(), Number((await conf()).backup_keep) || 14); }

function parseName(name) {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  return { kind: m[7], created: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) };
}
function listBackups() {
  return fs.readdirSync(dir()).map((name) => {
    const p = parseName(name); if (!p) return null;
    const st = fs.statSync(path.join(dir(), name));
    return { name, kind: p.kind, label: KINDS[p.kind], created: p.created, size: st.size };
  }).filter(Boolean).sort((a, b) => b.name.localeCompare(a.name));
}
function pathOf(name) {
  if (!NAME_RE.test(String(name || ''))) throw Object.assign(new Error('Nama file backup tidak valid.'), { status: 400 });
  const p = path.join(dir(), name);
  if (!fs.existsSync(p)) throw Object.assign(new Error('File backup tidak ditemukan.'), { status: 404 });
  return p;
}
function deleteBackup(name) { fs.rmSync(pathOf(name), { force: true }); }

/** Periksa isi backup tanpa memulihkan. */
function inspect(file) {
  const z = openZip(file);
  try {
    if (!z.has('database.sql') || !z.has('manifest.json')) throw new Error('File ini bukan backup aplikasi PM-IT (database.sql / manifest.json tidak ada).');
    const manifest = JSON.parse(z.read('manifest.json').toString('utf8'));
    const sql = z.read('database.sql');
    if (crypto.createHash('sha256').update(sql).digest('hex') !== manifest.sql_sha256) throw new Error('Checksum database.sql tidak cocok — file backup rusak.');
    const dialect = manifest.dialect || 'mysql'; // backup lama tanpa penanda = MySQL
    if (dialect !== config.db.client) throw new Error(`Backup ini untuk database ${dialect === 'pgsql' ? 'PostgreSQL' : 'MySQL'}, sedangkan aplikasi memakai ${config.db.client === 'pgsql' ? 'PostgreSQL' : 'MySQL'}.`);
    return { manifest, sql, uploads: z.entries.filter((e) => e.name.startsWith('uploads/') && !e.name.endsWith('/')) };
  } finally { z.close(); }
}

/** Simpan file backup yang diunggah (mis. dari PC lama) ke daftar backup setelah diperiksa. */
function importUploaded(tmpPath) {
  try {
    inspect(tmpPath);
  } catch (e) {
    fs.rmSync(tmpPath, { force: true });
    throw Object.assign(new Error(`File tidak dapat dipakai: ${e.message}`), { status: 422 });
  }
  const name = uniqueName('unggahan');
  fs.renameSync(tmpPath, path.join(dir(), name));
  return name;
}

const ALLOWED = /^(SET (NAMES|FOREIGN_KEY_CHECKS|UNIQUE_CHECKS|SQL_MODE|TIME_ZONE)\b|DROP TABLE IF EXISTS `\w+`$|CREATE TABLE `\w+` \(|INSERT INTO `\w+` \()/i;
const ALLOWED_PG = /^(DROP TABLE IF EXISTS "\w+"( CASCADE)?$|INSERT INTO "\w+" \()/i;
function statements(sql) {
  // Pisahkan per statement tanpa memotong literal string '...' (bisa memuat ; dan newline).
  const text = sql.toString('utf8');
  const out = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    cur += ch;
    if (inStr) {
      if (ch === "'") {
        if (text[i + 1] === "'") { cur += text[i + 1]; i++; }
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; continue; }
    if (ch === ';' && (text[i + 1] === '\n' || text[i + 1] === '\r' || i + 1 >= text.length)) {
      const stmt = cur.replace(/^\s*--.*$/gm, '').trim();
      if (stmt) out.push(stmt);
      cur = '';
    }
  }
  const rest = cur.replace(/^\s*--.*$/gm, '').trim();
  if (rest) out.push(rest);
  return out;
}

/** Varian PostgreSQL: skema dibuat migrate(), lalu data dimuat dalam transaksi
 *  (FK deferrable sehingga urutan INSERT bebas). */
async function loadSqlPg(sql) {
  const list = statements(sql);
  const bad = list.find((s) => !ALLOWED_PG.test(s));
  if (bad) throw new Error(`Isi database.sql tidak dikenali: "${bad.slice(0, 60)}..."`);
  const { Client } = require('pg');
  const conn = new Client({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: config.db.database,
  });
  await conn.connect();
  try {
    const tables = (await conn.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'"
    )).rows.map((r) => r.tablename).filter((t) => !SKIP_TABLES_PG.has(t));
    await conn.query('BEGIN');
    try {
      // Kosongkan (skema dipertahankan; migrate catch-up menyusul bila perlu).
      if (tables.length) await conn.query(`TRUNCATE ${tables.map(qiPg).join(', ')} CASCADE`);
      for (const s of list) {
        const m = /^INSERT INTO "(\w+)"/i.exec(s);
        if (m && SKIP_TABLES_PG.has(m[1])) continue;
        await conn.query(s);
      }
      // Sequence SERIAL tidak maju pada INSERT ber-id eksplisit — selaraskan.
      const seqs = (await conn.query(
        `SELECT c.relname AS seq, t.tablename AS tbl, a.attname AS col
           FROM pg_depend d JOIN pg_class c ON c.oid = d.objid
           JOIN pg_class t ON t.oid = d.refobjid
           JOIN pg_tables pt ON pt.tablename = t.relname AND pt.schemaname = 'public'
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
          WHERE c.relkind = 'S' AND d.deptype = 'a'`
      )).rows;
      for (const { seq, tbl, col } of seqs) {
        await conn.query(
          `SELECT setval($1, COALESCE((SELECT MAX(${qiPg(col)}) FROM ${qiPg(tbl)}), 0) + 1, false)`,
          [seq]
        );
      }
      await conn.query('COMMIT');
    } catch (e) {
      try { await conn.query('ROLLBACK'); } catch (_) { /* abaikan */ }
      throw e;
    }
    // Catch-up skema bila backup dari versi lebih lama.
    await require('../../database/migrate').migrate({ silent: true });
  } finally { await conn.end(); }
}

async function loadSql(sql) {
  if (config.db.client === 'pgsql') return loadSqlPg(sql);
  const list = statements(sql);
  const bad = list.find((s) => !ALLOWED.test(s));
  if (bad) throw new Error(`Isi database.sql tidak dikenali: "${bad.slice(0, 60)}..."`);
  const conn = await connect();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    const [tables] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    for (const r of tables) { const t = Object.values(r)[0]; if (!SKIP_TABLES.has(t)) await conn.query(`DROP TABLE IF EXISTS ${qi(t)}`); }
    for (const s of list) {
      const m = /^(?:DROP TABLE IF EXISTS|CREATE TABLE|INSERT INTO) `(\w+)`/i.exec(s);
      if (m && SKIP_TABLES.has(m[1])) continue;
      await conn.query(s);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
  } finally { await conn.end(); }
}

function restoreUploads(file) {
  const z = openZip(file); let n = 0;
  const root = path.resolve(config.upload.dir);
  try {
    for (const e of z.entries) {
      if (!e.name.startsWith('uploads/') || e.name.endsWith('/')) continue;
      const target = path.resolve(root, e.name.slice(8));
      if (!target.startsWith(root + path.sep)) continue; // cegah path traversal
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, z.read(e));
      n++;
    }
  } finally { z.close(); }
  return n;
}

/**
 * Pulihkan dari backup. Sebelumnya dibuat backup keamanan otomatis; bila pemulihan gagal di tengah jalan,
 * data dikembalikan dari backup keamanan tersebut.
 */
async function restoreBackup(name, { user = null } = {}) {
  const file = pathOf(name);
  const info = inspect(file); // gagal di sini = data saat ini belum disentuh
  const safety = await createBackup({ kind: 'sebelum-pulihkan', user });
  if (busy) throw Object.assign(new Error('Proses lain sedang berjalan.'), { status: 409 });
  busy = 'restore';
  try {
    try {
      await loadSql(info.sql);
      await require('../../database/migrate').migrate({ silent: true });
    } catch (e) {
      logger.error('Pemulihan gagal, mengembalikan data sebelumnya', { error: e.message });
      try { await loadSql(inspect(path.join(dir(), safety.name)).sql); } catch (e2) { logger.error('Pengembalian data gagal', { error: e2.message }); }
      throw new Error(`Pemulihan gagal: ${e.message}. Data dikembalikan seperti sebelum pemulihan (${safety.name}).`);
    }
    const files = restoreUploads(file);
    settings.invalidate();
    try { const c = await db.one("SELECT setting_value v FROM app_settings WHERE setting_key='company_name'"); if (c && c.v) config.companyName = c.v; } catch (_) { /* abaikan */ }
    return { manifest: info.manifest, files, safety: safety.name };
  } finally { busy = null; }
}

async function status() {
  const c = await conf();
  const list = listBackups();
  return {
    ...c, list, busy,
    latest: list[0] || null, totalSize: list.reduce((a, b) => a + b.size, 0), dir: path.resolve(dir()),
  };
}

module.exports = { KINDS, DEFAULTS, createBackup, listBackups, deleteBackup, pathOf, inspect, importUploaded, restoreBackup, status, conf, dumpSql, statements };
