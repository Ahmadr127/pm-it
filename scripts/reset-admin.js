'use strict';
/**
 * Reset password akun admin (atau username lain) bila lupa.
 *   npm run reset-admin            -> reset akun "admin"
 *   npm run reset-admin -- budi    -> reset akun "budi"
 * Membuat password sementara acak, membuka kunci akun, mengaktifkan akun,
 * dan mewajibkan ganti password saat login berikutnya. Harus dijalankan langsung di server.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

async function main() {
  const username = (process.argv[2] || 'admin').trim().toLowerCase();
  const user = await db.one('SELECT id, username FROM users WHERE username=? AND deleted_at IS NULL', [username]);
  if (!user) throw new Error(`Akun "${username}" tidak ditemukan.`);
  const temp = `Reset${crypto.randomInt(1000, 9999)}${crypto.randomBytes(3).toString('hex')}`;
  await db.query(`UPDATE users SET password_hash=?, must_change_password=1, failed_attempts=0, locked_until=NULL,
                   is_active=1, password_changed_at=NOW() WHERE id=?`, [await bcrypt.hash(temp, 12), user.id]);
  await db.query('DELETE FROM sessions WHERE data LIKE ?', [`%"userId":${user.id},%`]);
  await db.query("INSERT INTO audit_logs (username, action, entity_type, entity_id, description) VALUES ('sistem', 'RESET_PASSWORD', 'users', ?, 'Reset password lewat skrip server')", [String(user.id)]);
  console.log('');
  console.log('==============================================');
  console.log(` Password akun "${user.username}" berhasil direset.`);
  console.log(` Password sementara : ${temp}`);
  console.log(' Login dengan password ini, lalu Anda akan diminta');
  console.log(' membuat password baru.');
  console.log('==============================================');
  console.log('');
}

main().then(() => db.pool.end()).catch(async (e) => {
  console.error(`RESET GAGAL: ${e.message}`);
  try { await db.pool.end(); } catch (_) { /* abaikan */ }
  process.exit(1);
});
