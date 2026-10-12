@echo off
title PM-IT - Izinkan akses dari HP / PC lain
rem Minta hak administrator (diperlukan untuk mengubah firewall Windows)
net session >nul 2>&1
if errorlevel 1 (
  echo Meminta izin administrator...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo ============================================================
echo  Membuka akses aplikasi PM-IT di firewall Windows
echo  (port 3000 = HTTP, port 3443 = HTTPS) untuk HP / PC lain
echo  di jaringan kantor.
echo ============================================================
netsh advfirewall firewall delete rule name="PM-IT Asset Monitoring" >nul 2>&1
netsh advfirewall firewall add rule name="PM-IT Asset Monitoring" dir=in action=allow protocol=TCP localport=3000,3443 profile=any
if errorlevel 1 ( echo [GAGAL] Aturan firewall tidak dapat dibuat. & pause & exit /b 1 )
echo.
echo [OK] Akses dibuka. Alamat komputer ini:
ipconfig | findstr /R /C:"IPv4"
echo Buka di HP: https://ALAMAT-IPv4-di-atas:3443
echo.
echo Panduan lengkap dan QR code: menu profil di aplikasi - Akses dari HP / PC lain.
echo.
pause
