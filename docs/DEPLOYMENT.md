# Panduan Deployment Produksi (Linux)

Contoh untuk Ubuntu 22.04/24.04. Sesuaikan dengan standar server perusahaan.

## 1. Paket
```bash
sudo apt install -y mariadb-server nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo useradd -r -m -d /opt/pmit -s /usr/sbin/nologin pmit
```

## 2. Database
```sql
CREATE DATABASE pm_asset CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pm_app'@'localhost' IDENTIFIED BY '<password-kuat>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP, LOCK TABLES ON pm_asset.* TO 'pm_app'@'localhost';
```

## 3. Aplikasi
```bash
sudo -u pmit cp -r pm-it-asset/* /opt/pmit/
cd /opt/pmit
sudo -u pmit cp .env.example .env && sudo -u pmit nano .env   # NODE_ENV=production, DB_*, SESSION_SECRET, COOKIE_SECURE=true, TRUST_PROXY=1
sudo chmod 600 .env
sudo -u pmit npm ci --omit=dev
sudo -u pmit npm run setup
```

## 4. systemd
`/etc/systemd/system/pmit.service`:
```ini
[Unit]
Description=PM-IT Asset Monitoring
After=network.target mariadb.service

[Service]
User=pmit
WorkingDirectory=/opt/pmit
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
Environment=NODE_ENV=production
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/opt/pmit/storage

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now pmit
journalctl -u pmit -f      # log aplikasi (JSON, tanpa password/token)
```

## 5. Nginx + HTTPS
```nginx
server {
  listen 443 ssl http2;
  server_name pmit.perusahaan.local;
  ssl_certificate     /etc/ssl/certs/pmit.crt;
  ssl_certificate_key /etc/ssl/private/pmit.key;
  client_max_body_size 60m;          # 5 jenis dokumentasi x 5 file
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
server { listen 80; server_name pmit.perusahaan.local; return 301 https://$host$request_uri; }
```
Dengan HTTPS: set `COOKIE_SECURE=true` dan `TRUST_PROXY=1` di `.env`.

## 6. Backup otomatis
```bash
sudo -u pmit crontab -e
0 2 * * * cd /opt/pmit && /usr/bin/node scripts/backup.js >> storage/backups/backup.log 2>&1
```
Salin folder `storage/backups` ke lokasi lain (NAS/offsite) secara berkala.

## 7. Pembaruan versi
```bash
sudo systemctl stop pmit
npm run backup
# salin kode baru (jangan timpa .env dan storage/)
npm ci --omit=dev && npm run migrate
sudo systemctl start pmit
```

## 8. Checklist keamanan sebelum go-live
- [ ] `NODE_ENV=production`, `SESSION_SECRET` acak ≥ 32 karakter, `.env` permission 600
- [ ] HTTPS aktif, `COOKIE_SECURE=true`
- [ ] Password admin awal sudah diganti; akun demo tidak ada (`npm run demo:remove`)
- [ ] Threshold hardware sudah ditinjau terhadap datasheet perangkat yang dipakai
- [ ] Backup terjadwal berjalan & pemulihan sudah diuji sekali (lihat BACKUP.md)
- [ ] Folder `storage/` tidak dapat diakses langsung dari web (hanya via aplikasi)
- [ ] Port database tidak terbuka ke jaringan pengguna
