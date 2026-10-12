'use strict';
/** Administrasi > Backup Data: buat, unduh, unggah, pulihkan backup & atur backup otomatis. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const audit = require('../services/audit');
const backup = require('../services/backup');
const notifications = require('../services/notifications');
const { can } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');
const db = require('../config/db');
const settings = require('../services/settings');

const router = express.Router();
router.use(can('backup.manage'));

const mb = (n) => (n ? `${(n / 1048576).toLocaleString('id-ID', { maximumFractionDigits: n < 10485760 ? 2 : 1, minimumFractionDigits: n < 104858 ? 2 : 1 })} MB` : '0 MB');

router.get('/', async (req, res) => {
  res.render('admin/backup', { title: 'Backup Data', s: await backup.status(), mb });
});

router.post('/create', async (req, res) => {
  const r = await backup.createBackup({ kind: 'manual', user: req.user });
  await audit.log(req, 'BACKUP', { entity: 'backup', description: `Backup manual ${r.name} (${mb(r.size)}, ${r.rows} baris, ${r.files} file)` });
  res.done(`Backup berhasil dibuat: ${r.rows.toLocaleString('id-ID')} baris data & ${r.files} file dokumentasi (${mb(r.size)}).${r.copyErr ? ` Peringatan: ${r.copyErr}` : ''}`, '/admin/backup');
});

router.get('/download/:name', async (req, res) => {
  const p = backup.pathOf(req.params.name);
  await audit.log(req, 'DOWNLOAD', { entity: 'backup', description: `Unduh ${req.params.name}` });
  res.download(p, req.params.name);
});

router.post('/:name/delete', async (req, res) => {
  backup.deleteBackup(req.params.name);
  await audit.log(req, 'DELETE', { entity: 'backup', description: `Hapus ${req.params.name}` });
  res.done('File backup dihapus.', '/admin/backup');
});

router.post('/:name/restore', async (req, res) => {
  if (String((req.body && req.body.confirm) || '').trim().toUpperCase() !== 'PULIHKAN') throw new ValidationError({ confirm: 'Ketik PULIHKAN untuk melanjutkan.' });
  const r = await backup.restoreBackup(req.params.name, { user: req.user });
  notifications.clear();
  await audit.log(req, 'RESTORE', { entity: 'backup', description: `Pulihkan dari ${req.params.name} (backup keamanan: ${r.safety})` });
  res.done(`Data berhasil dipulihkan dari backup ${new Date(r.manifest.created_at).toLocaleString('id-ID')} (${r.files} file dokumentasi). Data sebelum pemulihan disimpan sebagai ${r.safety}.`, '/admin/backup');
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { const d = path.join(config.backup.dir, 'tmp'); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/\.zip$/i.test(file.originalname) ? cb(null, true) : cb(new ValidationError({ file: 'Pilih file backup berformat .zip.' }))),
});
router.post('/upload', (req, res, next) => upload.single('file')(req, res, (err) => next(err)), async (req, res) => {
  if (!req.file) throw new ValidationError({ file: 'Pilih file backup (.zip) terlebih dahulu.' });
  const name = backup.importUploaded(req.file.path);
  await audit.log(req, 'UPLOAD', { entity: 'backup', description: `Unggah backup ${req.file.originalname} → ${name}` });
  res.done(`File backup diunggah dan valid. Tekan "Pulihkan" pada baris ${name} untuk memakainya.`, '/admin/backup');
});

router.post('/settings', async (req, res) => {
  const v = validate(req.body, { backup_copy_dir: { label: 'Folder salinan', maxLength: 250 } });
  const copy = String(v.data.backup_copy_dir || '').trim();
  if (copy) {
    if (!path.isAbsolute(copy) && !/^[a-z]:[\\/]/i.test(copy) && !copy.startsWith('\\\\')) v.errors.backup_copy_dir = 'Isi alamat folder lengkap, mis. D:\\Backup-PMIT';
    else if (path.resolve(copy) === path.resolve(config.backup.dir)) v.errors.backup_copy_dir = 'Pilih folder yang berbeda dari folder backup utama.';
    else {
      try { fs.mkdirSync(copy, { recursive: true }); const t = path.join(copy, '.cek-tulis'); fs.writeFileSync(t, 'ok'); fs.rmSync(t); } catch (e) { v.errors.backup_copy_dir = `Folder tidak dapat ditulisi (${e.code || e.message}). Pastikan drive tersedia.`; }
    }
  }
  if (Object.keys(v.errors).length) throw new ValidationError(v.errors);
  const before = await backup.conf();
  await db.upsert('app_settings', 'setting_key', { setting_key: 'backup_copy_dir', setting_value: copy });
  settings.invalidate();
  await audit.log(req, 'UPDATE', { entity: 'app_settings', ...audit.diff({ backup_copy_dir: before.backup_copy_dir }, { backup_copy_dir: copy }) });
  res.done(copy ? `Setiap backup akan disalin juga ke ${copy}.` : 'Folder salinan dikosongkan.', '/admin/backup');
});

module.exports = router;
