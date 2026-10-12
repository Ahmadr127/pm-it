'use strict';
const db = require('../config/db');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Muat user + daftar permission dari DB pada setiap request (perubahan hak akses berlaku seketika). */
async function loadUser(req, res, next) {
  req.user = null;
  const uid = req.session && req.session.userId;
  if (!uid) return next();
  const user = await db.one(
    `SELECT u.id, u.username, u.full_name, u.email, u.employee_id, u.must_change_password, u.is_active,
            r.code AS role_code, r.name AS role_name, r.id AS role_id
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ? AND u.deleted_at IS NULL`, [uid]);
  if (!user || !user.is_active) {
    return req.session.destroy(() => { res.redirect('/login?expired=1'); });
  }
  const perms = await db.query(
    'SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?', [user.role_id]);
  user.permissions = new Set(perms.map((p) => p.code));
  req.user = user;
  return next();
}

function wantsJson(req) {
  return req.xhr || (req.get('accept') || '').includes('application/json') || req.path.startsWith('/api/');
}

function requireLogin(req, res, next) {
  if (!req.user) {
    if (wantsJson(req)) return res.status(401).json({ ok: false, message: 'Sesi berakhir. Silakan login kembali.' });
    if (req.method === 'GET') req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.user.must_change_password && !['/password', '/logout'].includes(req.path)) {
    if (wantsJson(req)) return res.status(403).json({ ok: false, message: 'Anda wajib mengganti password terlebih dahulu.' });
    return res.redirect('/password');
  }
  return next();
}

const has = (user, perm) => !!(user && user.permissions && user.permissions.has(perm));

/** Middleware otorisasi: lolos bila user memiliki SALAH SATU permission yang disebut. */
function can(...perms) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (perms.some((p) => has(req.user, p))) return next();
    return next(new HttpError(403, 'Anda tidak memiliki hak akses untuk tindakan ini.'));
  };
}

module.exports = { loadUser, requireLogin, can, has, HttpError, wantsJson };
