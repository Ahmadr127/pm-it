@echo off
title PM-IT - Reset password admin
cd /d "%~dp0"
echo Pastikan MySQL di XAMPP Control Panel sudah Start.
echo.
node scripts/reset-admin.js admin
pause
