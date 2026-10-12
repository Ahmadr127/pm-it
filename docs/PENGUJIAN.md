# Hasil Pengujian (Tahap 7)

Dijalankan: 9 Oktober 2026 · Node.js 22.22 · MariaDB 10.11 · `npm test`

**Hasil: 41 test, 41 lulus, 0 gagal** (± 26 detik). Test berjalan terhadap database MySQL/MariaDB sungguhan (`pm_asset_test`, dikosongkan ulang setiap file) — bukan mock.

| File | Cakupan | Hasil |
|---|---|---|
| `01-evaluation.test.js` | Mesin evaluasi: batas inklusif 90/70, SMART kritis menang atas health tinggi, SMART "Tidak Tersedia" ≠ Baik, NULL = tidak diperiksa, evaluasi multi-parameter, threshold paling spesifik, health baterai dari kapasitas, penurunan signifikan, penilaian teknisi vs parameter | 10/10 |
| `02-auth-security.test.js` | Redirect login, CSRF, password salah tanpa kebocoran, wajib ganti password & kebijakan password, lockout 5x + buka kunci, hash bcrypt, audit log tanpa password, header CSP/nosniff, logout | 8/8 |
| `03-crud-rbac.test.js` | Departemen/unit/lokasi (duplikat, nonaktif), aset (validasi, kode unik, MAC dinormalisasi, foto, ubah + jejak lokasi/status, cari), pengguna PC + penugasan + pindah unit (riwayat utuh), pencarian berdasarkan nama/NIK/kode aset/departemen/unit, RBAC 3 role Administrator, Manager IT & Staff IT (403 di backend), tanpa portal karyawan, perubahan hak akses berlaku seketika, role Admin terkunci, soft delete, impor all-or-nothing, ekspor xlsx | 6/6 |
| `04-maintenance-flow.test.js` | Alur utama IT Staff: konteks aset read-only, draft, validasi wajib saat Selesai, tolak file palsu (`.png` berisi PHP) + bersihkan tmp, konfirmasi tindak lanjut, simpan transaksional (readings, lampiran terverifikasi SHA-256, tindak lanjut otomatis, jadwal dipersingkat 7 hari), "Tidak Ada HDD" tanpa baris HDD, desktop baterai NULL, laptop baterai wajib, persetujuan Manager IT, kunci edit record Selesai, snapshot tidak berubah saat pindah unit, PDF resmi, lampiran hanya untuk akun yang login, 10 tab detail aset & empty state tanpa grafik palsu, generate jadwal tanpa duplikasi & deteksi terlambat, audit log, registrasi perangkat baru dari form maintenance (otomatis ke Master Aset, Pengguna PC, unit & lokasi tanpa duplikat) | 12/12 |
| `05-reports-agent-pages.test.js` | Smoke test 41 halaman + 7 jenis laporan (200), 404, statistik dashboard, ekspor PDF/XLSX/CSV seluruh laporan, CSV formula injection, hapus data demo tuntas | 6/6 |
| `06-role-migration.test.js` | Migrasi 003/004: role lama SPV/Kepala IT menjadi Manager IT (akun tetap), akun karyawan dinonaktifkan, data pengguna PC tetap utuh | 1/1 |

## Pengujian manual tambahan
- **Tampilan**: tangkapan layar Chromium headless desktop (1440 px) & ponsel (390 px): login, dashboard, aset, detail aset (grafik & penanda penurunan), form maintenance, daftar & detail maintenance, jadwal, laporan, tindak lanjut, threshold. Tidak ada error console JavaScript.
- **Backup & restore**: `npm run backup` lalu `npm run restore` ke database terpisah — checksum OK, jumlah record identik (82 = 82), tabel sesi dibuat ulang.
- **Data demo**: dimuat melalui service maintenance yang sama dengan aplikasi (82 maintenance, 32 aset) lalu dihapus tuntas — hanya akun admin tersisa.
- **PDF laporan resmi**: identitas aset & pengguna, parameter hardware, checklist, temuan, kondisi akhir, evaluasi, blok tanda tangan + status persetujuan elektronik.

## Temuan saat pengujian & perbaikannya
| Temuan | Perbaikan |
|---|---|
| Nilai `.env` yang mengandung `#` terpotong oleh dotenv (password jadi salah) | Peringatan di `.env.example` & panduan; contoh nilai memakai tanda kutip |
| Tabel `sessions` hilang setelah restore (dikecualikan dari dump) | `restore.js` membuat ulang tabel sesi |
| Kalimat pesan kebijakan password janggal | Pesan dipisah: syarat karakter vs larangan memuat username |
| Kartu statistik tersusun vertikal & terlalu tinggi di ponsel | Layout kartu horizontal, 2 kolom di ponsel |
| Data demo menghasilkan terlalu banyak jadwal terlambat | Tanggal kunjungan demo disesuaikan agar realistis |

## Batasan yang diketahui
- Gambar referensi form tidak dilampirkan pada percakapan; tata letak form mengikuti deskripsi tertulis bagian 3 & 7 (kartu hijau SSD, biru HDD, oranye baterai, ungu perawatan fisik). Penyesuaian visual mudah dilakukan di `src/views/maintenance/form.ejs` dan `public/css/app.css`.
- Notifikasi bersifat in-app (ikon lonceng & dashboard); notifikasi email belum disertakan.
- Cara menjalankan test di mesin Anda: buat database `pm_asset_test` (hak akses untuk DB_USER), lalu `npm install` (termasuk devDependencies) dan `npm test`.
