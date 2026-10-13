@echo off
title PM-IT - Bersihkan file lama
cd /d "%~dp0"
echo ============================================================
echo  Membersihkan file fitur lama yang sudah tidak dipakai
echo ============================================================
echo.

echo [1/2] File fitur lama (Agent Hardware, portal karyawan)...
if exist "agent" rmdir /s /q "agent"
for %%f in ("docs\AGENT.md" "src\routes\agentApi.js" "src\services\agent.js" "src\views\admin\agent.ejs" "src\routes\self.js" "src\routes\complaints.js") do if exist %%f del /q %%f
if exist "src\views\self" rmdir /s /q "src\views\self"
if exist "src\views\complaints" rmdir /s /q "src\views\complaints"
echo       selesai.

echo [2/2] File template XAMPP lama (env-xampp.txt)...
if exist "env-xampp.txt" del /q "env-xampp.txt"
echo       selesai.

echo.
echo Selesai. Aplikasi tidak terpengaruh.
echo.
pause
