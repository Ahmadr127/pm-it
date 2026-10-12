@echo off
rem Dijalankan tersembunyi oleh jalankan-tersembunyi.vbs (auto-start Windows). Jangan dijalankan manual.
cd /d "%~dp0.."
if not exist "storage\logs" mkdir "storage\logs"
if not exist "storage\run" mkdir "storage\run"

rem Sudah berjalan? (port 3000 dipakai) -> selesai
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>nul
if not errorlevel 1 exit /b 0

rem Nyalakan MySQL XAMPP bila belum berjalan
set "XAMPP=%~dp0..\..\.."
if not exist "%XAMPP%\mysql\bin\mysqld.exe" set "XAMPP=C:\xampp"
tasklist /FI "IMAGENAME eq mysqld.exe" 2>nul | find /I "mysqld.exe" >nul
if errorlevel 1 (
  echo [%date% %time%] Menyalakan MySQL XAMPP >> "storage\logs\server.log"
  start "" /B "%XAMPP%\mysql\bin\mysqld.exe" --defaults-file="%XAMPP%\mysql\bin\my.ini" --standalone
)

rem Pembaruan otomatis: server keluar dengan kode 3 saat file aplikasi berubah, lalu dinyalakan ulang di sini.
rem Berhenti total hanya bila 5-MATIKAN-OTOMATIS.bat / 4-AKTIFKAN-OTOMATIS.bat membuat file storage\run\stop.
set "PMIT_SUPERVISED=1"
if exist "storage\run\stop" del "storage\run\stop"
echo [%date% %time%] Aplikasi dimulai (latar belakang) >> "storage\logs\server.log"
:loop
rem Instans lain sudah memakai port 3000 -> jangan dobel
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>nul
if not errorlevel 1 exit /b 0
node src/server.js >> "storage\logs\server.log" 2>&1
set "CODE=%errorlevel%"
if exist "storage\run\stop" (
  del "storage\run\stop"
  echo [%date% %time%] Aplikasi dihentikan >> "storage\logs\server.log"
  exit /b 0
)
if "%CODE%"=="3" (
  echo [%date% %time%] Memuat ulang setelah pembaruan >> "storage\logs\server.log"
  goto loop
)
echo [%date% %time%] Aplikasi berhenti (kode %CODE%), dinyalakan ulang dalam 5 detik >> "storage\logs\server.log"
ping -n 6 127.0.0.1 >nul
goto loop
