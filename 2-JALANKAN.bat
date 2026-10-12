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

rem Nyalakan MySQL XAMPP bila belum berjalan
set "XAMPP=%~dp0..\.."
if not exist "%XAMPP%\mysql\bin\mysqld.exe" set "XAMPP=C:\xampp"
tasklist /FI "IMAGENAME eq mysqld.exe" 2>nul | find /I "mysqld.exe" >nul
if errorlevel 1 (
  echo Menyalakan MySQL XAMPP...
  start "MySQL XAMPP" /MIN "%XAMPP%\mysql\bin\mysqld.exe" --defaults-file="%XAMPP%\mysql\bin\my.ini" --standalone
)

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
