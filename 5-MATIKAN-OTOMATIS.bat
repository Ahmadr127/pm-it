@echo off
title PM-IT - Matikan jalan otomatis
cd /d "%~dp0"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PM-IT Asset Monitoring.lnk"
if exist "%LNK%" del "%LNK%"
echo [OK] Jalan otomatis saat Windows menyala: NONAKTIF
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\hentikan-server.ps1"
echo.
echo Untuk menjalankan aplikasi secara manual, buka 2-JALANKAN.bat
echo.
pause
