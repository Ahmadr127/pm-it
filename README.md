# PM-IT Asset Monitoring

Website internal untuk **Preventive Maintenance PC, monitoring kesehatan hardware, inventaris komputer, dan pencatatan pengguna PC**. Antarmuka berbahasa Indonesia, responsif (desktop, tablet, ponsel).

**Stack:** Node.js 22 · Express 5 · MySQL 8 / MariaDB 10.4+ · EJS · Bootstrap 5 · Chart.js · PDFKit · ExcelJS
(Alasan pemilihan & arsitektur: [`docs/ARSITEKTUR.md`](docs/ARSITEKTUR.md))

## Fitur
- **Dashboard** — total perangkat, sudah/belum maintenance, jatuh tempo & terlambat, kondisi Baik/Perhatian/Kritis, grafik bulanan & status kesehatan, daftar perangkat yang butuh tindakan; filter periode, unit kerja, lokasi, jenis perangkat.
- **Master Aset PC** — seluruh field inventaris, foto, storage terpasang, impor/ekspor Excel & CSV, pencarian/filter/sorting/pagination, soft delete.
- **Pengguna PC & Unit Kerja** — data karyawan, master departemen/unit/lokasi/gedung/ruangan/PIC, penugasan pengguna utama & PIC unit dengan **riwayat yang tidak pernah hilang**.
- **Form Preventive Maintenance** — nomor otomatis, auto-fill data aset & pengguna (read-only), CPU & multi-SSD, HDD (opsi "Tidak Ada HDD" = NULL), baterai laptop ("Tidak Berlaku" untuk desktop), checklist perawatan 3 status, kondisi akhir & tindak lanjut, upload foto/PDF aman, tombol Draft / Simpan / Simpan & Cetak / Tandai Selesai, konfirmasi bila perlu tindak lanjut.
- **Evaluasi kondisi hardware** — multi-parameter, threshold dapat dikonfigurasi per jenis perangkat/antarmuka/merek/model, SMART "Tidak Tersedia" tidak dianggap baik, penanda penurunan signifikan.
- **Jadwal** — interval per jenis perangkat + override per aset, jadwal otomatis, dipersingkat untuk kondisi bermasalah, terlambat & jatuh tempo, penugasan teknisi massal.
- **Detail & riwayat aset** — 10 tab termasuk grafik tren suhu, health storage & baterai dari histori nyata (empty state bila belum ada data).
- **Laporan** — 7 jenis laporan dengan filter lengkap; ekspor **PDF** (resmi, dengan tanda tangan), **Excel**, **CSV**; laporan PDF per maintenance.
- **Hak akses** — hanya tim IT: Administrator, Manager IT, dan Staff IT (pengguna PC tidak memiliki akun); matriks izin dapat diubah; pemeriksaan di setiap endpoint.
- **Portal karyawan** — melihat perangkat sendiri, melaporkan keluhan, memantau tindak lanjut.
- **Keamanan & operasional** — CSRF, CSP, bcrypt, lockout login, validasi frontend+backend, audit log, backup/restore, data demo yang dapat dihapus.

## Mulai cepat (Linux / macOS)
```bash
cp .env.example .env          # isi DB_*, SESSION_SECRET (bungkus nilai berisi # dengan tanda kutip)
npm install
npm run setup                 # buat tabel + data dasar + akun admin (password awal tampil sekali)
npm run demo:load             # opsional: data demonstrasi (hapus: npm run demo:remove)
npm start                     # http://localhost:3000
```
Windows + XAMPP: [`docs/INSTALL-XAMPP.md`](docs/INSTALL-XAMPP.md) · Produksi: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Perintah
| Perintah | Fungsi |
|---|---|
| `npm start` / `npm run dev` | Jalankan aplikasi / mode pengembangan (auto-reload) |
| `npm run setup` | `migrate` + `seed` (aman diulang) |
| `npm run migrate` | Jalankan migrasi baru |
| `npm run demo:load` / `demo:remove` | Muat / hapus data demonstrasi |
| `npm run backup` / `npm run restore -- <folder> --yes` | Backup & pemulihan ([`docs/BACKUP.md`](docs/BACKUP.md)) |
| `npm test` | Test otomatis (butuh database `pm_asset_test`) — hasil: [`docs/PENGUJIAN.md`](docs/PENGUJIAN.md) |

## Dokumentasi
- [`docs/ARSITEKTUR.md`](docs/ARSITEKTUR.md) — analisis kebutuhan, arsitektur, ERD, aturan evaluasi, matriks hak akses
- [`docs/INSTALL-XAMPP.md`](docs/INSTALL-XAMPP.md) — instalasi lokal Windows/XAMPP
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — produksi Linux, HTTPS, checklist keamanan
- [`docs/BACKUP.md`](docs/BACKUP.md) — backup & pemulihan
- [`docs/PENGUJIAN.md`](docs/PENGUJIAN.md) — hasil pengujian

## Catatan penting
- Threshold awal hanyalah **contoh kebijakan** — tinjau di menu *Threshold & Interval* sesuai datasheet produsen.
- Data demo hanya untuk pelatihan. Hapus sebelum operasional (`npm run demo:remove` atau menu *Pengaturan Sistem*).
