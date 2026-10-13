# Instalasi Lokal di Windows dengan PostgreSQL

PostgreSQL sebagai database. Aplikasi sendiri berjalan dengan **Node.js**.

Cara termudah: jalankan **`1-SETUP.bat`** — database, user, `.env`, library, dan tabel dibuat otomatis. Panduan manual di bawah hanya bila setup otomatis gagal.

## 1. Prasyarat
1. **PostgreSQL 14+** — https://www.postgresql.org/download/windows/ (catat password user `postgres` saat instalasi; pastikan service `postgresql-x64-*` berjalan)
2. **Node.js 22 LTS** atau lebih baru — https://nodejs.org (centang "Add to PATH")
3. Folder aplikasi, mis. `C:\pm-it-asset` (ekstrak file zip di sini)

## 2. Siapkan database (otomatis via 1-SETUP.bat, atau manual)
`1-SETUP.bat` membuat database `pm_asset` otomatis (menanyakan password user `postgres` sekali — yaitu password yang dibuat saat instalasi PostgreSQL). Manual bila diperlukan, jalankan sebagai user `postgres`:
```sql
CREATE DATABASE pm_asset;
```
> Aplikasi memakai user bawaan `postgres` — tidak perlu membuat user/role tambahan.

## 3. Konfigurasi
Di folder aplikasi, salin `env-postgres.txt` menjadi `.env` lalu ubah minimal:
```ini
NODE_ENV=production
COMPANY_NAME=PT Nama Perusahaan
DB_CLIENT=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=pm_asset
DB_USER=postgres
DB_PASSWORD="PasswordYangDibuatSaatInstalasiPostgreSQL"
SESSION_SECRET=<hasil perintah di bawah>
PGDUMP_PATH=pg_dump
PSQL_PATH=psql
```
Buat `SESSION_SECRET`:
```bat
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
> **Bungkus nilai yang mengandung `#` atau spasi dengan tanda kutip.** Tanpa kutip, teks setelah `#` dianggap komentar.

## 4. Instal & siapkan aplikasi
Buka **Command Prompt** di folder aplikasi:
```bat
npm install --omit=dev
npm run setup
```
`npm run setup` membuat seluruh tabel lalu mengisi data dasar (role, hak akses, threshold awal, interval, checklist) dan akun **admin**. Password awal admin ditampilkan **sekali** di layar (atau gunakan `ADMIN_INITIAL_PASSWORD` di `.env`). Password wajib diganti saat login pertama.

Opsional — data demonstrasi untuk pelatihan (dapat dihapus kembali):
```bat
npm run demo:load
npm run demo:remove
```
Akun demo: `demo.it`, `demo.it2` (Staff IT), `demo.mgr` (Manager IT) — password `Demo#2026pass`.

## Pindah ke device lain (copy folder)
1. Di device lama: buka aplikasi → Administrasi → Backup Data → **Backup Sekarang**, unduh file backup (bila data ingin dibawa).
2. Copy folder aplikasi ke device lain (boleh kecualikan `node_modules` dan `storage\logs` untuk menghemat).
3. Di device baru: pasang PostgreSQL + Node.js, lalu jalankan **`1-SETUP.bat`** dan masukkan **password postgres device baru** (password tiap device berbeda — setup mendeteksi ini otomatis dan hanya meminta password bila koneksi gagal).
4. Bila membawa data: pulihkan via Administrasi → Backup Data → Unggah backup → Pulihkan.
> Tidak perlu edit manual: path `psql`/`pg_dump` disesuaikan otomatis dengan PostgreSQL device baru, dan sertifikat HTTPS server dibuat ulang otomatis mengikuti IP/hostname baru.

## 5. Jalankan
```bat
npm start
```
atau klik `2-JALANKAN.bat` (memastikan service PostgreSQL berjalan, lalu membuka browser).
Buka http://localhost:3000. Untuk diakses dari PC lain di jaringan: buka port 3000 di Windows Firewall dan akses `http://<IP-server>:3000`.

## 6. Jalan otomatis setiap Windows menyala
Klik `4-AKTIFKAN-OTOMATIS.bat` (aplikasi berjalan di latar belakang; log: `storage\logs\server.log`). Nonaktifkan via `5-MATIKAN-OTOMATIS.bat`. Alternatif enterprise dengan **NSSM** (https://nssm.cc):
```bat
nssm install PMIT "C:\Program Files\nodejs\node.exe" "C:\pm-it-asset\src\server.js"
nssm set PMIT AppDirectory C:\pm-it-asset
nssm set PMIT Start SERVICE_AUTO_START
nssm start PMIT
```
Pastikan service PostgreSQL (`postgresql-x64-*`) di-set *Automatic* (Services).

## 7. Backup terjadwal
Task Scheduler → *Create Basic Task* → harian 02:00 → *Start a program*:
- Program: `C:\Program Files\nodejs\node.exe`
- Argumen: `scripts\backup.js`
- Start in: `C:\pm-it-asset`

Lihat `BACKUP.md` untuk pemulihan.

## Pemecahan masalah
| Gejala | Solusi |
|---|---|
| `Tidak dapat terhubung ke database` | Service PostgreSQL belum *Start*, atau DB_USER/DB_PASSWORD salah (cek tanda kutip) |
| `SESSION_SECRET wajib diisi` | Isi SESSION_SECRET minimal 32 karakter |
| Port 3000 dipakai aplikasi lain | Ubah `PORT=` di `.env` |
| Backup gagal `pg_dump tidak dapat dijalankan` | Isi `PGDUMP_PATH` dengan path lengkap (mis. `C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`) |

## Pembaruan otomatis

`2-JALANKAN.bat` menjalankan aplikasi dalam mode pantau. Bila file di folder `src`, `database`, atau `public` diperbarui:

1. aplikasi memuat ulang sendiri dalam beberapa detik (migrasi database baru dijalankan otomatis);
2. halaman yang sedang terbuka di browser ikut dimuat ulang. Bila ada isian form yang belum disimpan, muncul pemberitahuan "Aplikasi telah diperbarui" agar isian tidak hilang;
3. file CSS/JS diberi nomor versi otomatis, sehingga tidak perlu Ctrl+F5.

Jendela `2-JALANKAN.bat` cukup dibiarkan terbuka. Restart manual hanya diperlukan bila library (`package.json`) berubah — jalankan ulang `1-SETUP.bat`.

## Aplikasi (PWA)

Aplikasi dapat dipasang seperti aplikasi biasa (ikon di desktop / layar utama, jendela sendiri tanpa bilah alamat):

- **Di komputer server**: buka `http://localhost:3000` di Chrome/Edge → klik tombol **Pasang aplikasi** (ikon unduh di bilah atas, atau di halaman login), atau ikon "Install" di bilah alamat.
- Halaman selalu mengambil data terbaru dari server; data tidak disimpan di perangkat. Bila server mati, tampil halaman "Server aplikasi tidak dapat dihubungi".
- **Dari komputer/HP lain di jaringan** (`http://<IP-server>:3000`): browser hanya mengizinkan pemasangan PWA lewat **HTTPS**. Aplikasi tetap bisa dibuka biasa lewat browser; untuk pemasangan dari perangkat lain perlu sertifikat HTTPS di server.

## File .bat di folder aplikasi

| File | Fungsi |
|---|---|
| `1-SETUP.bat` | Pemasangan pertama (database PostgreSQL & library). |
| `2-JALANKAN.bat` | Menjalankan aplikasi dengan jendela (PostgreSQL dipastikan berjalan). Bila aplikasi sudah jalan di latar belakang, cukup membuka browser. |
| `3-RESET-PASSWORD-ADMIN.bat` | Reset password akun admin. |
| `4-AKTIFKAN-OTOMATIS.bat` | Aplikasi berjalan otomatis setiap Windows menyala, di latar belakang (log: `storage\logs\server.log`). |
| `5-MATIKAN-OTOMATIS.bat` | Menonaktifkan jalan otomatis dan menghentikan aplikasi. |
| `6-IZINKAN-AKSES-HP.bat` | (Administrator) Membuka firewall port 3000/3443 untuk HP / PC lain di jaringan. |
| `7-BERSIHKAN-FILE-LAMA.bat` | Membersihkan file fitur lama yang sudah tidak dipakai. |

## Akses dari HP (HTTPS)

Server otomatis membuat sertifikat HTTPS lokal (`storage\certs`) dan berjalan juga di `https://IP-server:3443`. Pasang sertifikat CA (`/ca.crt`) sekali di setiap HP/PC; panduan langkah demi langkah + QR code ada di aplikasi: menu profil → **Akses dari HP / PC lain**.

## Label QR

Master Aset PC → **Label QR** (sesuai filter) atau ikon QR di detail aset → cetak (A4, 3 kolom). Scan label dengan HP membuka form maintenance PC tersebut.
