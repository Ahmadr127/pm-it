'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const db = require('../config/db');
const config = require('../config');
const audit = require('../services/audit');
const settings = require('../services/settings');
const { requireLogin } = require('../middleware/auth');
const { ValidationError } = require('../utils/validate');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('auth/login', {
    title: 'Login', error: 'Terlalu banyak percobaan login dari alamat ini. Coba lagi 15 menit lagi.', username: '', layout: false,
  }),
});

// Hash dummy agar waktu respons sama untuk username yang tidak ada (mencegah enumerasi user)
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { title: 'Login', error: req.query.expired ? 'Sesi Anda telah berakhir. Silakan login kembali.' : null, username: '' });
});

router.post('/login', loginLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().slice(0, 60);
  const password = String(req.body.password || '');
  const fail = (msg) => res.status(401).render('auth/login', { title: 'Login', error: msg, username });
  if (!username || !password) return fail('Username dan password wajib diisi.');

  const user = await db.one('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL', [username]);
  if (!user) { await bcrypt.compare(password, DUMMY_HASH); return fail('Username atau password salah.'); }
  if (!user.is_active) return fail('Akun Anda dinonaktifkan. Hubungi administrator.');
  if (user.locked_until && new Date(user.locked_until.replace(' ', 'T')) > new Date()) {
    return fail(`Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi setelah ${user.locked_until.slice(11, 16)}.`);
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const attempts = user.failed_attempts + 1;
    const lock = attempts >= config.login.maxAttempts;
    await db.query('UPDATE users SET failed_attempts = ?, locked_until = IF(?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NULL) WHERE id = ?',
      [lock ? 0 : attempts, lock, config.login.lockMinutes, user.id]);
    await audit.log(req, lock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', { entity: 'users', id: user.id, description: `Login gagal untuk ${username}` });
    return fail(lock ? `Akun dikunci ${config.login.lockMinutes} menit karena ${config.login.maxAttempts}x percobaan gagal.` : 'Username atau password salah.');
  }

  const returnTo = req.session.returnTo;
  req.session.regenerate(async (err) => {
    if (err) return res.status(500).render('auth/login', { title: 'Login', error: 'Gagal membuat sesi.', username });
    req.session.userId = user.id;
    req.session.lastSeen = Date.now();
    await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?', [user.id]);
    req.user = { id: user.id, username: user.username };
    await audit.log(req, 'LOGIN', { entity: 'users', id: user.id, description: 'Login berhasil' });
    req.session.save(() => res.redirect(user.must_change_password ? '/password' : (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/')));
  });
});

router.post('/logout', async (req, res) => {
  if (req.user) await audit.log(req, 'LOGOUT', { entity: 'users', id: req.user.id });
  req.session.destroy(() => { res.clearCookie('pmit.sid'); res.redirect('/login'); });
});

router.get('/password', requireLogin, async (req, res) => {
  res.render('auth/password', { title: 'Ganti Password', forced: !!req.user.must_change_password, pwHint: (await passwordRules()).hint });
});

/** Aturan password dari Pengaturan Sistem (default: minimal 8 karakter, tanpa syarat kombinasi). */
async function passwordRules() {
  const min = Math.min(Math.max(await settings.getInt('password_min_length', 8), 6), 64);
  const mix = String(await settings.get('password_require_mix', '0')) === '1';
  const hint = `Minimal ${min} karakter${mix ? ', kombinasi huruf besar, huruf kecil, dan angka' : ''}.`;
  return { min, mix, hint };
}

/** Mengembalikan pesan kesalahan (string) atau null bila password memenuhi kebijakan. */
async function passwordPolicy(pwd, username) {
  const { min, mix } = await passwordRules();
  const need = [];
  if (pwd.length < min) need.push(`minimal ${min} karakter`);
  if (pwd.length > 128) need.push('maksimal 128 karakter');
  if (mix && (!/[A-Z]/.test(pwd) || !/[a-z]/.test(pwd))) need.push('mengandung huruf besar dan kecil');
  if (mix && !/\d/.test(pwd)) need.push('mengandung angka');
  const msgs = [];
  if (need.length) msgs.push(`Password harus ${need.join(', ')}.`);
  if (mix && username && pwd.toLowerCase().includes(username.toLowerCase())) msgs.push('Password tidak boleh mengandung username.');
  return msgs.length ? msgs.join(' ') : null;
}

router.post('/password', requireLogin, async (req, res) => {
  const { current_password: cur = '', new_password: pwd = '', confirm_password: conf = '' } = req.body;
  const u = await db.one('SELECT id, username, password_hash FROM users WHERE id = ?', [req.user.id]);
  const errors = {};
  if (!(await bcrypt.compare(String(cur), u.password_hash))) errors.current_password = 'Password saat ini salah.';
  const pol = await passwordPolicy(String(pwd), u.username);
  if (pol) errors.new_password = pol;
  if (pwd !== conf) errors.confirm_password = 'Konfirmasi password tidak sama.';
  if (cur && pwd && cur === pwd) errors.new_password = 'Password baru tidak boleh sama dengan password lama.';
  if (Object.keys(errors).length) throw new ValidationError(errors);
  await db.query('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = NOW() WHERE id = ?', [await bcrypt.hash(String(pwd), 12), u.id]);
  await audit.log(req, 'PASSWORD_CHANGED', { entity: 'users', id: u.id });
  res.done('Password berhasil diganti.', '/');
});

module.exports = router;
module.exports.passwordPolicy = passwordPolicy;
module.exports.passwordRules = passwordRules;
