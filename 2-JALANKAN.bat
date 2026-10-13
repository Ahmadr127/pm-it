@echo off
title PM-IT Asset Monitoring (jangan tutup jendela ini)
cd /d "%~dp0"
if not exist "storage\run" mkdir "storage\run"

rem Bila aplikasi sudah berjalan di latar belakang (auto-start), cukup buka browser
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo Aplikasi sudah berjalan di latar belakang. Membuka http://localhost:3000 ...
  start "" http://localhost:3000
  timeout /t 3 /nobreak >nul
  exit /b 0
)

rem Pastikan PostgreSQL berjalan (port 5432); coba nyalakan service bila belum
netstat -ano | findstr /R /C:":5432 .*LISTENING" >nul 2>nul
if errorlevel 1 (
  echo PostgreSQL belum terdeteksi, mencoba menyalakan service...
  for %%S in (postgresql-x64-18 postgresql-x64-17 postgresql-x64-16 postgresql-x64-15 postgresql-x64-14 postgresql) do (
    sc query "%%S" >nul 2>&1
    if not errorlevel 1 net start "%%S" >nul 2>&1
  )
  timeout /t 3 /nobreak >nul
  netstat -ano | findstr /R /C:":5432 .*LISTENING" >nul 2>nul
  if errorlevel 1 (
    echo [PERINGATAN] PostgreSQL belum berjalan. Nyalakan via Services ^(postgresql-x64-*^)
    echo atau jalankan ulang 1-SETUP.bat bila database belum disiapkan.
  )
)

if not exist ".env" (
  echo [GAGAL] File .env tidak ada. Jalankan 1-SETUP.bat terlebih dahulu.
  pause & exit /b 1
)
if not exist "node_modules" (
  echo [GAGAL] Library belum terpasang. Jalankan 1-SETUP.bat terlebih dahulu.
  pause & exit /b 1
)

rem Uji koneksi database dulu agar penyebab gagal langsung jelas
rem (mis. DB_PASSWORD kosong/salah), bukan error samar saat aplikasi jalan.
call node -e "require('./src/config/db').one('SELECT 1 n').then(()=>console.log('[OK] Terkoneksi ke database.')).catch(e=>{console.error('[GAGAL] '+e.message);process.exit(1)})" 2>nul
if errorlevel 1 (
  echo.
  echo [GAGAL] Aplikasi tidak bisa terhubung ke PostgreSQL.
  echo Penyebab umum: DB_PASSWORD di .env kosong/salah, atau database belum dibuat.
  echo Solusi: jalankan 1-SETUP.bat dan masukkan password postgres device ini.
  pause & exit /b 1
)
echo.

echo ============================================================
echo  PM-IT Asset Monitoring berjalan di http://localhost:3000
echo  Mode pembaruan otomatis AKTIF:
echo  bila ada file aplikasi yang diperbarui, aplikasi memuat ulang
echo  sendiri dan halaman di browser ikut diperbarui otomatis.
echo  Jendela ini cukup dibiarkan terbuka (boleh di-minimize).
echo  Tips: jalankan 4-AKTIFKAN-OTOMATIS.bat agar aplikasi jalan
echo  sendiri setiap Windows menyala, tanpa jendela ini.
echo ============================================================
start "" http://localhost:3000
set "PMIT_SUPERVISED=1"
if exist "storage\run\stop" del "storage\run\stop"
:loop
node src/server.js
set "CODE=%errorlevel%"
if exist "storage\run\stop" (
  del "storage\run\stop"
  echo Aplikasi dihentikan.
  exit /b 0
)
if "%CODE%"=="3" (
  echo.
  echo [%time%] Pembaruan terdeteksi - aplikasi dimuat ulang...
  goto loop
)
echo.
echo [PERINGATAN] Aplikasi berhenti (kode %CODE%). Dinyalakan ulang dalam 5 detik...
echo Tutup jendela ini untuk berhenti.
timeout /t 5 /nobreak >nul
goto loop
