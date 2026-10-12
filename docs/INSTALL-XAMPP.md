# Instalasi Lokal di Windows dengan XAMPP

XAMPP menyediakan **MySQL/MariaDB** untuk database. Aplikasi sendiri berjalan dengan **Node.js** (tidak memakai Apache/PHP XAMPP).

## 1. Prasyarat
1. **XAMPP** 8.x (MariaDB 10.4+) — https://www.apachefriends.org
2. **Node.js 22 LTS** atau lebih baru — https://nodejs.org (centang "Add to PATH")
3. Folder aplikasi, mis. `C:\pm-it-asset` (ekstrak file zip di sini)

## 2. Siapkan database
1. Buka **XAMPP Control Panel** → *Start* modul **MySQL**.
2. Buka *Shell* XAMPP (atau `C:\xampp\mysql\bin\mysql.exe -u root`) lalu jalankan:
   ```sql
   CREATE DATABASE pm_asset CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'pm_app'@'localhost' IDENTIFIED BY 'GantiPasswordKuat#2026';
   GRANT ALL PRIVILEGES ON pm_asset.* TO 'pm_app'@'localhost';
   FLUSH PRIVILEGES;
   ```
   > Jangan memakai akun `root` tanpa password untuk aplikasi.

## 3. Konfigurasi
Di folder aplikasi, salin `.env.example` menjadi `.env` lalu ubah minimal:
```ini
NODE_ENV=production
COMPANY_NAME=PT Nama Perusahaan
DB_HOST=127.0.0.1
DB_NAME=pm_asset
DB_USER=pm_app
DB_PASSWORD="GantiPasswordKuat#2026"
SESSION_SECRET=<hasil perintah di bawah>
MYSQLDUMP_PATH=C:\xampp\mysql\bin\mysqldump.exe
MYSQL_PATH=C:\xampp\mysql\bin\mysql.exe
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

## 5. Jalankan
```bat
npm start
```
Buka http://localhost:3000. Untuk diakses dari PC lain di jaringan: buka port 3000 di Windows Firewall dan akses `http://<IP-server>:3000`.

## 6. Jalankan sebagai Windows Service (disarankan)
Dengan **NSSM** (https://nssm.cc):
```bat
nssm install PMIT "C:\Program Files\nodejs\node.exe" "C:\pm-it-asset\src\server.js"
nssm set PMIT AppDirectory C:\pm-it-asset
nssm set PMIT Start SERVICE_AUTO_START
nssm start PMIT
```
Pastikan service MySQL XAMPP juga di-set otomatis (XAMPP Control Panel → centang *Svc* pada MySQL).

## 7. Backup terjadwal
Task Scheduler → *Create Basic Task* → harian 02:00 → *Start a program*:
- Program: `C:\Program Files\nodejs\node.exe`
- Argumen: `scripts\backup.js`
- Start in: `C:\pm-it-asset`

Lihat `BACKUP.md` untuk pemulihan.

## Pemecahan masalah
| Gejala | Solusi |
|---|---|
| `Tidak dapat terhubung ke database` | MySQL XAMPP belum *Start*, atau DB_USER/DB_PASSWORD salah (cek tanda kutip) |
| `SESSION_SECRET wajib diisi` | Isi SESSION_SECRET minimal 32 karakter |
| Port 3000 dipakai aplikasi lain | Ubah `PORT=` di `.env` |
| Backup gagal `mysqldump tidak dapat dijalankan` | Isi `MYSQLDUMP_PATH` dengan path lengkap XAMPP |

## Pembaruan otomatis

`2-JALANKAN.bat` menjalankan aplikasi dalam mode pantau (`node --watch-path`). Bila file di folder `src`, `database`, atau `public` diperbarui:

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
| `1-SETUP.bat` | Pemasangan pertama (database & library). |
| `2-JALANKAN.bat` | Menjalankan aplikasi dengan jendela (MySQL ikut dinyalakan). Bila aplikasi sudah jalan di latar belakang, cukup membuka browser. |
| `3-RESET-PASSWORD-ADMIN.bat` | Reset password akun admin. |
| `4-AKTIFKAN-OTOMATIS.bat` | Aplikasi & MySQL berjalan otomatis setiap Windows menyala, di latar belakang (log: `storage\logs\server.log`). |
| `5-MATIKAN-OTOMATIS.bat` | Menonaktifkan jalan otomatis dan menghentikan aplikasi. |
| `6-IZINKAN-AKSES-HP.bat` | (Administrator) Membuka firewall port 3000/3443 untuk HP / PC lain di jaringan. |
| `7-BERSIHKAN-FILE-LAMA.bat` | (Administrator) Menghapus file fitur lama, folder salinan lama, dan service XAMPP lama yang salah path. |

## Akses dari HP (HTTPS)

Server otomatis membuat sertifikat HTTPS lokal (`storage\certs`) dan berjalan juga di `https://IP-server:3443`. Pasang sertifikat CA (`/ca.crt`) sekali di setiap HP/PC; panduan langkah demi langkah + QR code ada di aplikasi: menu profil → **Akses dari HP / PC lain**.

## Label QR

Master Aset PC → **Label QR** (sesuai filter) atau ikon QR di detail aset → cetak (A4, 3 kolom). Scan label dengan HP membuka form maintenance PC tersebut.
