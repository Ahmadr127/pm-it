@echo off
title PM-IT - Reset password admin
cd /d "%~dp0"
echo Pastikan PostgreSQL sudah berjalan (service postgresql-x64-*).
echo.
node scripts/reset-admin.js admin
pause
