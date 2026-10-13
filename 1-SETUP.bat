@echo off
title PM-IT - Setup
cd /d "%~dp0"
echo ============================================
echo  PM-IT Asset Monitoring - Setup pertama kali
echo  Database: PostgreSQL (user bawaan: postgres)
echo  Bisa dijalankan ulang / di device lain hasil copy folder.
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [GAGAL] Node.js belum terpasang.
  echo Unduh dan pasang Node.js LTS dari https://nodejs.org lalu jalankan file ini lagi.
  pause & exit /b 1
)
echo Versi Node.js:
node -v
echo.

rem ---- Cari psql.exe (client PostgreSQL) ----
set "PSQL=psql"
where psql >nul 2>nul
if not errorlevel 1 goto :psql_ok
for %%V in (18 17 16 15 14) do (
  if exist "C:\Program Files\PostgreSQL\%%V\bin\psql.exe" (
    set "PSQL=C:\Program Files\PostgreSQL\%%V\bin\psql.exe"
    goto :psql_ok
  )
)
echo [GAGAL] PostgreSQL tidak ditemukan.
echo Pasang PostgreSQL 14+ dari https://www.postgresql.org/download/windows/
echo (catat password user "postgres" saat instalasi), lalu jalankan file ini lagi.
pause & exit /b 1
:psql_ok
echo PostgreSQL client: %PSQL%
"%PSQL%" --version
echo.

rem ---- Pastikan service PostgreSQL berjalan (port 5432) ----
netstat -ano | findstr /R /C:":5432 .*LISTENING" >nul 2>nul
if not errorlevel 1 goto :pg_up
echo PostgreSQL belum berjalan, mencoba menyalakan service...
for %%S in (postgresql-x64-18 postgresql-x64-17 postgresql-x64-16 postgresql-x64-15 postgresql-x64-14 postgresql) do (
  sc query "%%S" >nul 2>&1
  if not errorlevel 1 (
    echo Menyalakan service %%S ...
    net start "%%S" >nul 2>&1
  )
)
timeout /t 3 /nobreak >nul
netstat -ano | findstr /R /C:":5432 .*LISTENING" >nul 2>nul
if errorlevel 1 (
  echo [PERINGATAN] Port 5432 belum LISTENING. Pastikan service PostgreSQL sudah Start
  echo (Services ^> postgresql-x64-* ^> Start), lalu lanjutkan.
  echo.
)
:pg_up

rem ---- Buat .env dari template bila belum ada; sesuaikan dengan device ini bila sudah ada ----
if not exist ".env" (
  copy /Y "env-postgres.txt" ".env" >nul
  echo File konfigurasi .env dibuat dari env-postgres.txt
)
rem Selalu: isi SESSION_SECRET bila masih placeholder, dan samakan path psql/pg_dump dgn device ini
node -e "const fs=require('fs'),c=require('crypto');let t=fs.readFileSync('.env','utf8');const m=/^SESSION_SECRET=(.*)$/m.exec(t);const cur=(m?m[1]:'').trim();if(cur.length<32||/ganti_dengan/i.test(cur)){t=t.replace(/^SESSION_SECRET=.*$/m,'SESSION_SECRET='+c.randomBytes(48).toString('hex'));console.log('SESSION_SECRET dibuat di .env');}let psqlBin='';try{psqlBin=require('child_process').execSync('where psql',{encoding:'utf8'}).trim().split(/\r?\n/)[0];}catch(e){}if(!psqlBin){const fspath=require('fs');for(const v of [18,17,16,15,14]){const p='C:\\Program Files\\PostgreSQL\\'+v+'\\bin\\psql.exe';if(fspath.existsSync(p)){psqlBin=p;break;}}}if(psqlBin){const b=psqlBin.replace(/psql\.exe$/i,'');t=t.replace(/^PSQL_PATH=.*$/m,'PSQL_PATH='+b+'psql.exe');t=t.replace(/^PGDUMP_PATH=.*$/m,'PGDUMP_PATH='+b+'pg_dump.exe');console.log('Path PostgreSQL disesuaikan: '+b);}fs.writeFileSync('.env',t);"
if errorlevel 1 ( echo [GAGAL] Gagal menyiapkan .env. & pause & exit /b 1 )
echo.

echo [1/4] Memasang library aplikasi (butuh internet, beberapa menit)...
call npm install --omit=dev
if errorlevel 1 ( echo [GAGAL] npm install gagal. & pause & exit /b 1 )
echo.

rem ---- Baca nama database & user dari .env (default: pm_asset / postgres) ----
set "DBNAME=pm_asset"
set "DBUSER=postgres"
for /f "tokens=2 delims==" %%a in ('findstr /B "DB_NAME=" ".env"') do set "DBNAME=%%a"
for /f "tokens=2 delims==" %%a in ('findstr /B "DB_USER=" ".env"') do set "DBUSER=%%a"
set "DBNAME=%DBNAME:"=%"
set "DBUSER=%DBUSER:"=%"
set "DBNAME=%DBNAME:'=%"
set "DBUSER=%DBUSER:'=%"

echo [2/4] Memeriksa koneksi ke PostgreSQL (database "%DBNAME%", user "%DBUSER%")...
call node -e "require('./src/config/db').one('SELECT 1 n').then(()=>console.log('[OK] Terkoneksi dengan password di .env.')).catch(()=>process.exit(1))"
if not errorlevel 1 goto :db_ok
echo.
echo Koneksi gagal - kemungkinan password di .env kosong/salah
echo (password postgres tiap device berbeda), atau database belum dibuat.
echo Masukkan password user "%DBUSER%" di DEVICE INI (dibuat saat instalasi PostgreSQL).
echo Kosongkan (langsung Enter) bila PostgreSQL device ini tanpa password.
echo Lupa password? Jalankan psql sebagai admin lalu: ALTER USER "%DBUSER%" WITH PASSWORD 'password-baru';
set "PGPASS="
set /p "PGPASS=Password %DBUSER%: "
if "%PGPASS%"=="" echo (Lanjut tanpa password...)
rem Simpan password ke .env (DB_PASSWORD) dengan aman via node (melewati env agar karakter khusus tidak rusak;
rem bungkus kutip tunggal agar ", \, #, spasi, %, !, $ lolos parse dotenv apa adanya)
set "PGPASS_ENV=%PGPASS%"
node -e "const fs=require('fs');const SQ=String.fromCharCode(39);let p=process.env.PGPASS_ENV||'';let t=fs.readFileSync('.env','utf8');let line;if(p.indexOf(SQ)<0){line='DB_PASSWORD='+SQ+p+SQ;}else if(p.indexOf(String.fromCharCode(34))<0&&p.indexOf(String.fromCharCode(92))<0){line='DB_PASSWORD=\"'+p+'\"';}else{console.error('[GAGAL] Password memakai kombinasi kutip yang tak didukung; ganti password postgres dahulu.');process.exit(1);}t=t.replace(/^DB_PASSWORD=.*$/m,()=>line);fs.writeFileSync('.env',t);console.log('Password tersimpan di .env');"
if errorlevel 1 ( echo [GAGAL] Gagal menyimpan password ke .env. & pause & exit /b 1 )
set "PGPASSWORD=%PGPASS%"
set "PGPASS="
set "PGPASS_ENV="
"%PSQL%" -h 127.0.0.1 -U "%DBUSER%" -d postgres -v ON_ERROR_STOP=1 -c "SELECT 'CREATE DATABASE \"%DBNAME%\"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '%DBNAME%')\gexec"
if errorlevel 1 goto :pg_fail
set "PGPASSWORD="
call node -e "require('./src/config/db').one('SELECT 1 n').then(()=>console.log('[OK] Database siap.')).catch(e=>{console.error('[GAGAL] '+e.message);process.exit(1)})"
if errorlevel 1 ( echo Periksa kembali password lalu jalankan ulang file ini. & pause & exit /b 1 )
echo.
goto :db_ok
:pg_fail
set "PGPASSWORD="
echo.
echo [GAGAL] Tidak bisa menyiapkan database PostgreSQL.
echo Kemungkinan: password salah, atau pg_hba.conf menolak koneksi.
echo Coba manual: "%PSQL%" -h 127.0.0.1 -U "%DBUSER%" -d postgres -c "CREATE DATABASE ""%DBNAME%"";"
pause & exit /b 1
:db_ok

echo [3/4] Membuat tabel dan data dasar (aman diulang)...
call npm run setup
if errorlevel 1 ( echo [GAGAL] Setup database gagal. Periksa isi .env (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD). & pause & exit /b 1 )
echo [4/4] Memeriksa koneksi aplikasi ke PostgreSQL...
call node -e "require('./src/config/db').one('SELECT 1 n').then(()=>console.log('[OK] Aplikasi terhubung ke PostgreSQL.')).catch(e=>{console.error('[GAGAL] '+e.message);process.exit(1)})"
if errorlevel 1 ( echo Periksa kembali .env lalu jalankan ulang file ini. & pause & exit /b 1 )
echo.
echo ============================================
echo  SELESAI. Jalankan 2-JALANKAN.bat
echo  Login: admin / Admin#Pmit2026 (wajib diganti)
echo  Opsional data demo: npm run demo:load
echo ============================================
pause
