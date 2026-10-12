'use strict';
const crypto = require('crypto');
const { HttpError } = require('./auth');

/**
 * Proteksi CSRF (synchronizer token per sesi).
 * Token diterima dari header X-CSRF-Token (fetch), field _csrf (form biasa),
 * atau query _csrf (form multipart tanpa JavaScript).
 */
function csrf(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token') || (req.body && req.body._csrf) || (req.query && req.query._csrf);
  const expected = req.session.csrfToken;
  const ok = typeof sent === 'string' && sent.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return next(new HttpError(403, 'Token keamanan (CSRF) tidak valid atau kedaluwarsa. Muat ulang halaman lalu coba lagi.'));
  return next();
}

/** Batasi waktu idle sesi. */
function idleTimeout(minutes) {
  return (req, res, next) => {
    const now = Date.now();
    if (req.session.userId && req.session.lastSeen && now - req.session.lastSeen > minutes * 60000) {
      return req.session.destroy(() => res.redirect('/login?expired=1'));
    }
    if (req.session.userId) req.session.lastSeen = now;
    return next();
  };
}

module.exports = { csrf, idleTimeout };
