@echo off
title PM-IT - Setup
cd /d "%~dp0"
echo ============================================
echo  PM-IT Asset Monitoring - Setup pertama kali
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo [GAGAL] Node.js belum terpasang.
  echo Unduh dan pasang Node.js LTS dari https://nodejs.org lalu jalankan file ini lagi.
  pause & exit /b 1
)
echo Versi Node.js:
node -v
echo.
if not exist ".env" (
  copy /Y "env-xampp.txt" ".env" >nul
  echo File konfigurasi .env dibuat dari env-xampp.txt
)
echo.
echo [1/3] Membuat database pm_asset di MySQL XAMPP...
"C:\xampp\mysql\bin\mysql.exe" -u root -e "CREATE DATABASE IF NOT EXISTS pm_asset CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
if errorlevel 1 (
  echo [GAGAL] Tidak bisa terhubung ke MySQL. Pastikan MySQL di XAMPP Control Panel sudah Start.
  pause & exit /b 1
)
echo [2/3] Memasang library aplikasi (butuh internet, beberapa menit)...
call npm install --omit=dev
if errorlevel 1 ( echo [GAGAL] npm install gagal. & pause & exit /b 1 )
echo [3/3] Membuat tabel dan data dasar...
call npm run setup
if errorlevel 1 ( echo [GAGAL] Setup database gagal. & pause & exit /b 1 )
echo.
echo ============================================
echo  SELESAI. Jalankan 2-JALANKAN.bat
echo  Login: admin / Admin#Pmit2026 (wajib diganti)
echo  Opsional data demo: npm run demo:load
echo ============================================
pause
