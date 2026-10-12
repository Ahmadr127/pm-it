'use strict';
const config = require('../config');
const h = require('../utils/helpers');
const { has, wantsJson } = require('./auth');
const notifications = require('../services/notifications');
const logger = require('../utils/logger');
const MENU = require('../config/menu');
const { ValidationError } = require('../utils/validate');

/** Variabel global untuk view + helper respons standar (JSON untuk fetch, redirect+flash untuk form biasa). */
function locals(req, res, next) {
  res.locals.app = { name: config.appName, company: config.companyName };
  res.locals.user = req.user;
  res.locals.can = (p) => has(req.user, p);
  res.locals.h = h;
  res.locals.menu = MENU;
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  req.flash = (type, message) => { req.session.flash = { type, message }; };

  res.done = (message, redirect, extra = {}) => {
    if (wantsJson(req)) return res.json({ ok: true, message, redirect, ...extra });
    if (message) req.flash('success', message);
    return res.redirect(redirect || req.get('referer') || '/');
  };
  next();
}

async function withNotifications(req, res, next) {
  res.locals.notif = { total: 0, items: [] };
  if (req.user && req.method === 'GET' && !wantsJson(req)) {
    try { res.locals.notif = await notifications.forUser(req.user); } catch (e) { logger.error('Notifikasi gagal', { error: e.message }); }
  }
  next();
}

function notFound(req, res, next) {
  const err = new Error('Halaman tidak ditemukan.');
  err.status = 404;
  next(err);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Terjadi kesalahan.';
  let errors = err.errors || null;

  if (err.code === 'ER_DUP_ENTRY' || err.code === '23505') {
    status = 409;
    const m = /for key '(?:[\w]+\.)?([\w]+)'/.exec(err.sqlMessage || '') || /constraint "([\w]+)"/.exec(err.message || '');
    const keyMap = {
      uq_assets_code: ['asset_code', 'Kode aset sudah digunakan. Kode aset harus unik.'],
      uq_assets_inventory: ['inventory_number', 'Nomor inventaris sudah digunakan.'],
      uq_employees_nik: ['nik', 'NIK / ID karyawan sudah terdaftar.'],
      uq_users_username: ['username', 'Username sudah digunakan.'],
      uq_departments_name: ['name', 'Nama departemen sudah ada.'],
      uq_work_units: ['name', 'Unit kerja dengan nama tersebut sudah ada di departemen ini.'],
      uq_locations: ['name', 'Kombinasi lokasi, gedung, dan ruangan sudah ada.'],
      uq_roles_code: ['code', 'Kode role sudah ada.'],
      uq_td_code: ['code', 'Kode checklist sudah ada.'],
    };
    const [field, msg] = keyMap[m && m[1]] || ['_', 'Data duplikat: nilai unik sudah digunakan.'];
    message = msg; errors = { [field]: msg };
  } else if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
    status = 409; message = 'Data tidak dapat dihapus karena masih dipakai oleh data lain. Nonaktifkan saja bila tidak dipakai lagi.';
  } else if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    status = 422; message = 'Data referensi yang dipilih tidak ditemukan.';
  } else if (err.code === '23503') {
    // PostgreSQL memakai satu kode untuk kedua arah FK.
    if (req.method === 'DELETE') {
      status = 409; message = 'Data tidak dapat dihapus karena masih dipakai oleh data lain. Nonaktifkan saja bila tidak dipakai lagi.';
    } else {
      status = 422; message = 'Data referensi yang dipilih tidak ditemukan.';
    }
  } else if (err.code === 'EBADCSRFTOKEN') {
    status = 403;
  }

  if (status >= 500) {
    const ref = `ERR-${Date.now().toString(36).toUpperCase()}`;
    logger.error('Unhandled error', { ref, path: req.originalUrl, method: req.method, user: req.user ? req.user.username : null, error: err.message, code: err.code, sql: err.sqlMessage, stack: err.stack });
    message = config.isProd ? `Terjadi kesalahan pada server. Silakan coba lagi atau hubungi administrator (kode referensi: ${ref}).` : message;
  }

  if (wantsJson(req)) return res.status(status).json({ ok: false, message, errors });

  if ((err instanceof ValidationError || status === 409 || status === 422) && req.method !== 'GET') {
    req.session.flash = { type: 'danger', message, errors };
    return res.redirect(req.get('referer') || '/');
  }
  res.status(status);
  return res.render('errors/error', { title: `Error ${status}`, status, message, user: req.user || null });
}

module.exports = { locals, withNotifications, notFound, errorHandler };
