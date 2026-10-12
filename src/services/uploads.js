'use strict';
/**
 * Penanganan unggahan file yang aman:
 *  - disimpan di folder di luar /public (diakses hanya lewat route /files/:id yang mengecek izin)
 *  - nama file disimpan acak (UUID) — nama asli hanya disimpan sebagai metadata (disanitasi)
 *  - tipe file diverifikasi dari isi file (magic bytes), bukan hanya dari ekstensi / mimetype browser
 *  - ukuran dibatasi per jenis file
 *  - record database hanya dibuat setelah file benar-benar ada di disk (ukuran & hash diverifikasi)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { ValidationError } = require('../utils/validate');

const TMP_DIR = path.join(config.upload.dir, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const KINDS = {
  image: { mimes: ['image/jpeg', 'image/png', 'image/webp'], exts: ['.jpg', '.jpeg', '.png', '.webp'], max: () => config.upload.maxImageBytes, label: 'gambar JPG/PNG/WEBP' },
  pdf: { mimes: ['application/pdf'], exts: ['.pdf'], max: () => config.upload.maxPdfBytes, label: 'PDF' },
};

// Satu kolom unggahan dokumentasi (foto, screenshot, PDF). Kategori lama tetap dikenali untuk data yang sudah ada.
const MAINT_MAX_FILES = 10;
const MAINT_FIELDS = {
  dokumentasi: { category: 'DOKUMENTASI', kinds: ['image', 'pdf'], label: 'Dokumentasi' },
};
const ATTACHMENT_LABELS = {
  DOKUMENTASI: 'Dokumentasi', FOTO_SEBELUM: 'Foto sebelum', FOTO_SESUDAH: 'Foto sesudah', SCREENSHOT_STORAGE: 'Screenshot storage', DOKUMEN_PDF: 'Dokumen PDF', BUKTI_SPAREPART: 'Bukti spare part',
};

function detectMime(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(16);
  const n = fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  if (n >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (n >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (n >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (n >= 5 && buf.slice(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

function safeOriginalName(name) {
  const base = path.basename(String(name || 'file')).normalize('NFKC');
  return base.replace(/[^\w.\- ()]+/g, '_').replace(/_{2,}/g, '_').slice(-180) || 'file';
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
});

function makeUploader(fields) {
  return multer({
    storage,
    limits: { fileSize: Math.max(config.upload.maxImageBytes, config.upload.maxPdfBytes), files: 30, fields: 600, fieldSize: 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!fields.find((f) => f.name === file.fieldname)) return cb(new ValidationError({ [file.fieldname]: 'Field file tidak dikenal.' }));
      cb(null, true);
    },
  }).fields(fields);
}

const maintenanceUpload = makeUploader(Object.keys(MAINT_FIELDS).map((name) => ({ name, maxCount: MAINT_MAX_FILES })));
const photoUpload = makeUploader([{ name: 'photo', maxCount: 1 }]);
const importUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single('file');

function removeTemp(files) {
  if (!files) return;
  const list = Array.isArray(files) ? files : Object.values(files).flat();
  for (const f of list) { try { if (f && f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (_) { /* abaikan */ } }
}

/** Middleware pembungkus agar error multer menjadi pesan berbahasa Indonesia. */
function handle(uploader) {
  return (req, res, next) => uploader(req, res, (err) => {
    if (!err) return next();
    removeTemp(req.files || (req.file ? [req.file] : null));
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran file melebihi batas yang diizinkan.'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Jumlah file melebihi batas (maks. 5 per jenis dokumentasi).'
          : `Unggahan gagal: ${err.code}`;
      return next(new ValidationError({ files: msg }, msg));
    }
    return next(err);
  });
}

/**
 * Validasi file sementara (tipe asli & ukuran). Melempar ValidationError dan menghapus file tmp bila ada yang salah.
 * @returns array {field, category, tmpPath, originalName, mime, size, ext}
 */
function validateFiles(files, fieldDefs) {
  const out = [];
  const errors = {};
  const list = files ? Object.entries(files).flatMap(([field, arr]) => arr.map((f) => ({ field, f }))) : [];
  for (const { field, f } of list) {
    const def = fieldDefs[field];
    const mime = detectMime(f.path);
    const kind = def.kinds.map((k) => [k, KINDS[k]]).find(([, k]) => k.mimes.includes(mime));
    const ext = path.extname(f.originalname || '').toLowerCase();
    if (!kind) {
      errors[field] = `${def.label}: "${safeOriginalName(f.originalname)}" bukan ${def.kinds.map((k) => KINDS[k].label).join(' / ')} yang valid.`;
      continue;
    }
    if (!kind[1].exts.includes(ext)) {
      errors[field] = `${def.label}: ekstensi "${ext || '(kosong)'}" tidak sesuai isi file.`;
      continue;
    }
    if (f.size > kind[1].max()) {
      errors[field] = `${def.label}: "${safeOriginalName(f.originalname)}" melebihi ${Math.round(kind[1].max() / 1048576)} MB.`;
      continue;
    }
    if (f.size === 0) { errors[field] = `${def.label}: file kosong.`; continue; }
    out.push({ field, category: def.category, tmpPath: f.path, originalName: safeOriginalName(f.originalname), mime, size: f.size, ext: ext === '.jpeg' ? '.jpg' : ext });
  }
  if (Object.keys(errors).length) {
    removeTemp(files);
    throw new ValidationError(errors, Object.values(errors)[0]);
  }
  return out;
}

/**
 * Pindahkan file tervalidasi ke lokasi permanen. Mengembalikan metadata yang sudah diverifikasi.
 * moved[] dikembalikan agar pemanggil bisa menghapus file bila transaksi DB gagal (rollback).
 */
function persist(validated, subdir) {
  const destDir = path.join(config.upload.dir, subdir);
  fs.mkdirSync(destDir, { recursive: true });
  const moved = [];
  for (const v of validated) {
    const name = `${crypto.randomUUID()}${v.ext}`;
    const dest = path.join(destDir, name);
    fs.renameSync(v.tmpPath, dest);
    const st = fs.statSync(dest);
    if (!st.isFile() || st.size !== v.size) throw new Error(`Verifikasi file gagal untuk ${v.originalName}`);
    moved.push({ ...v, absPath: dest, storedPath: path.posix.join(subdir.split(path.sep).join('/'), name), sha256: sha256File(dest) });
  }
  return moved;
}

function removeFiles(moved) {
  for (const m of moved || []) { try { if (m.absPath && fs.existsSync(m.absPath)) fs.unlinkSync(m.absPath); } catch (_) { /* abaikan */ } }
}

function absolutePath(storedPath) {
  const abs = path.resolve(config.upload.dir, storedPath);
  if (!abs.startsWith(path.resolve(config.upload.dir) + path.sep)) throw new Error('Path file tidak valid');
  return abs;
}

module.exports = {
  MAINT_FIELDS, MAINT_MAX_FILES, ATTACHMENT_LABELS, maintenanceUpload: handle(maintenanceUpload), photoUpload: handle(photoUpload), importUpload: handle(importUpload),
  validateFiles, persist, removeFiles, removeTemp, absolutePath, detectMime, safeOriginalName,
  PHOTO_FIELDS: { photo: { category: 'FOTO', kinds: ['image'], label: 'Foto perangkat' } },
};
