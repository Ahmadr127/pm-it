@echo off
title PM-IT - Bersihkan file lama
rem Minta hak administrator (diperlukan untuk menghapus service Windows lama)
net session >nul 2>&1
if errorlevel 1 (
  echo Meminta izin administrator...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
echo ============================================================
echo  Membersihkan file dan service lama yang sudah tidak dipakai
echo ============================================================
echo.

echo [1/3] File fitur lama (Agent Hardware, portal karyawan)...
if exist "agent" rmdir /s /q "agent"
for %%f in ("docs\AGENT.md" "src\routes\agentApi.js" "src\services\agent.js" "src\views\admin\agent.ejs" "src\routes\self.js" "src\routes\complaints.js") do if exist %%f del /q %%f
if exist "src\views\self" rmdir /s /q "src\views\self"
if exist "src\views\complaints" rmdir /s /q "src\views\complaints"
echo       selesai.

echo [2/3] Folder salinan lama C:\xampp\pm-it-asset...
set "OLD=%~dp0..\..\pm-it-asset"
if exist "%OLD%\package.json" (
  if exist "%OLD%\src" (
    echo       [LEWATI] folder berisi aplikasi lengkap, tidak dihapus demi keamanan.
  ) else (
    rmdir /s /q "%OLD%"
    echo       dihapus.
  )
) else (
  echo       tidak ada.
)

echo [3/3] Service Windows lama XAMPP yang mengarah ke folder salah...
for %%s in (Apache2.4 mysql) do call :cekservice %%s
echo.
echo Selesai. Aplikasi tidak terpengaruh.
echo.
pause
exit /b 0

:cekservice
sc qc %1 >nul 2>&1
if errorlevel 1 ( echo       service %1: tidak terdaftar. & goto :eof )
sc qc %1 | findstr /I /C:"xamppanshar" >nul
if errorlevel 1 ( echo       service %1: path benar, dibiarkan. & goto :eof )
sc stop %1 >nul 2>&1
sc delete %1 >nul
if errorlevel 1 ( echo       service %1: GAGAL dihapus. ) else ( echo       service %1: dihapus - path lama C:\xamppanshar. )
goto :eof
