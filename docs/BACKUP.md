# Backup & Pemulihan

Semua dilakukan dari aplikasi: **Administrasi → Backup Data** (hanya Administrator).

## Isi file backup
Satu file `.zip` di `storage/backups/` bernama `pmit-backup-YYYYMMDD-HHMMSS-<jenis>.zip`:
- `database.sql` — seluruh tabel (kecuali sesi login). Bisa juga diimpor lewat phpMyAdmin.
- `uploads/` — foto & dokumen maintenance.
- `manifest.json` — waktu, jumlah baris per tabel, checksum SHA-256 `database.sql`.

Tidak memerlukan mysqldump; cukup Node.js.

## Membuat backup
Backup hanya dibuat **manual** dengan tombol **Backup Sekarang** (tidak ada backup otomatis, agar tidak membebani PC server). Disarankan minimal seminggu sekali, lalu unduh/simpan salinannya di luar PC server.

**Folder salinan** (opsional): setiap backup juga disalin ke folder lain, mis. `D:\Backup-PMIT` atau hardisk eksternal.

## Memulihkan
1. Administrasi → Backup Data → **Pulihkan** pada baris backup → ketik `PULIHKAN`.
2. Aplikasi otomatis membuat backup *Sebelum pemulihan* terlebih dahulu. Bila pemulihan gagal di tengah jalan, data dikembalikan seperti semula.
3. Setelah database dipulihkan, pembaruan struktur database (migrasi) dijalankan otomatis dan foto/dokumen disalin kembali.

Pindah ke PC server baru: pasang aplikasi di PC baru → login → Backup Data → **Unggah file backup** (.zip dari PC lama) → Pulihkan.

## Command line (opsional)
```bash
npm run backup
npm run restore -- pmit-backup-20261009-120000-otomatis.zip --yes
```

Uji pemulihan minimal sekali per triwulan.
