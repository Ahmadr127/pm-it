@echo off
title PM-IT - Aktifkan jalan otomatis
cd /d "%~dp0"
echo ============================================================
echo  Aktifkan: aplikasi PM-IT berjalan otomatis setiap Windows
echo  menyala (di latar belakang, tanpa jendela hitam).
echo  Service PostgreSQL juga dipastikan berjalan bila belum aktif.
echo ============================================================
echo.
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PM-IT Asset Monitoring.lnk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0scripts\jalankan-tersembunyi.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Description='PM-IT Asset Monitoring (latar belakang)'; $s.Save()"
if errorlevel 1 ( echo [GAGAL] Tidak dapat membuat pintasan Startup. & pause & exit /b 1 )
echo [OK] Jalan otomatis saat Windows menyala: AKTIF

rem Hentikan jendela 2-JALANKAN.bat bila masih terbuka, lalu jalankan di latar belakang sekarang
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\hentikan-server.ps1"
timeout /t 2 /nobreak >nul
wscript.exe "%~dp0scripts\jalankan-tersembunyi.vbs"
echo [OK] Aplikasi dijalankan di latar belakang. Membuka browser...
timeout /t 6 /nobreak >nul
start "" http://localhost:3000
echo.
echo Selesai. Jendela 2-JALANKAN.bat tidak perlu dibuka lagi.
echo Log aplikasi: storage\logs\server.log
echo Untuk menonaktifkan: jalankan 5-MATIKAN-OTOMATIS.bat
echo.
pause
