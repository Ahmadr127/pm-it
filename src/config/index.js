'use strict';
const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '..', '..', '.env'), quiet: true });

const ROOT = path.join(__dirname, '..', '..');
const int = (v, d) => (v === undefined || v === '' || isNaN(parseInt(v, 10)) ? d : parseInt(v, 10));
const resolveDir = (p, d) => path.isAbsolute(p || d) ? (p || d) : path.join(ROOT, p || d);

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  root: ROOT,
  port: int(process.env.PORT, 3000),
  // HTTPS lokal untuk akses dari HP / PC lain (0 = nonaktif)
  httpsPort: int(process.env.HTTPS_PORT, 3443),
  appName: process.env.APP_NAME || 'PM-IT Asset Monitoring',
  companyName: process.env.COMPANY_NAME || 'Perusahaan',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  db: {
    client: (process.env.DB_CLIENT || 'mysql').toLowerCase() === 'pgsql' ? 'pgsql' : 'mysql',
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, (process.env.DB_CLIENT || '').toLowerCase() === 'pgsql' ? 5432 : 3306),
    database: process.env.DB_NAME || 'pm_asset',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: int(process.env.DB_CONNECTION_LIMIT, 10),
  },
  session: {
    secret: process.env.SESSION_SECRET || '',
    cookieSecure: String(process.env.COOKIE_SECURE).toLowerCase() === 'true',
    idleMinutes: int(process.env.SESSION_IDLE_MINUTES, 60),
  },
  trustProxy: int(process.env.TRUST_PROXY, 0),
  login: {
    maxAttempts: int(process.env.LOGIN_MAX_ATTEMPTS, 5),
    lockMinutes: int(process.env.LOGIN_LOCK_MINUTES, 15),
  },
  upload: {
    dir: resolveDir(process.env.UPLOAD_DIR, 'storage/uploads'),
    maxImageBytes: int(process.env.MAX_IMAGE_MB, 5) * 1024 * 1024,
    maxPdfBytes: int(process.env.MAX_PDF_MB, 10) * 1024 * 1024,
  },
  backup: {
    dir: resolveDir(process.env.BACKUP_DIR, 'storage/backups'),
    mysqldump: process.env.MYSQLDUMP_PATH || 'mysqldump',
    mysql: process.env.MYSQL_PATH || 'mysql',
    pgdump: process.env.PGDUMP_PATH || 'pg_dump',
    psql: process.env.PSQL_PATH || 'psql',
    retentionDays: int(process.env.BACKUP_RETENTION_DAYS, 30),
  },
};

if (!config.session.secret || config.session.secret.length < 32) {
  if (config.isProd) {
    throw new Error('SESSION_SECRET wajib diisi minimal 32 karakter di file .env (lihat .env.example).');
  }
  // Mode pengembangan/test: secret sementara (sesi hilang saat restart).
  config.session.secret = require('crypto').randomBytes(48).toString('hex');
}

module.exports = config;
