'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
const { pool } = require('./config/db');
const { loadUser } = require('./middleware/auth');
const { csrf, idleTimeout } = require('./middleware/security');
const { locals, withNotifications, notFound, errorHandler } = require('./middleware/respond');

/** Sidik jari singkat dari nama, ukuran & waktu ubah seluruh file di folder public. */
function assetVersion(dir) {
  const hash = require('crypto').createHash('md5');
  const walk = (d) => {
    for (const e of require('fs').readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const st = require('fs').statSync(p); hash.update(`${p}:${st.size}:${st.mtimeMs}`); }
    }
  };
  try { walk(dir); } catch (_) { hash.update(String(Date.now())); }
  return hash.digest('hex').slice(0, 10);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': config.session.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.session.cookieSecure,
  }));

  // Aset statis (semua library dibundel lokal — aplikasi tetap jalan di intranet tanpa internet)
  const nm = path.join(config.root, 'node_modules');
  const vendor = {
    bootstrap: path.join(nm, 'bootstrap', 'dist'),
    'bootstrap-icons': path.join(nm, 'bootstrap-icons', 'font'),
    chartjs: path.join(nm, 'chart.js', 'dist'),
    'tom-select': path.join(nm, 'tom-select', 'dist'),
    font: path.join(nm, '@fontsource', 'plus-jakarta-sans'),
  };
  for (const [k, dir] of Object.entries(vendor)) app.use(`/vendor/${k}`, express.static(dir, { maxAge: '7d', index: false }));
  app.use('/static', express.static(path.join(config.root, 'public'), { maxAge: config.isProd ? '1d' : 0, index: false }));
  // Versi aset: berubah otomatis bila file di folder public berubah -> browser langsung memakai file baru (tanpa Ctrl+F5)
  app.locals.assetVersion = assetVersion(path.join(config.root, 'public'));
  // Versi aplikasi: berubah setiap server memuat ulang (mis. setelah pembaruan file) -> halaman yang terbuka ikut diperbarui
  app.locals.appVersion = `${app.locals.assetVersion}-${Date.now().toString(36)}`;
  app.get('/app-version', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ v: app.locals.appVersion }); });

  // ---- PWA: manifest & service worker (tanpa login) ----
  app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json').set('Cache-Control', 'no-cache').send(JSON.stringify({
      name: config.appName, short_name: 'PM-IT', description: 'Preventive Maintenance PC & IT Asset Monitoring',
      lang: 'id', dir: 'ltr', start_url: '/', scope: '/', display: 'standalone', orientation: 'any',
      background_color: '#f4f6fb', theme_color: '#4c8c2b',
      icons: [
        { src: '/static/img/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/static/img/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/static/img/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: 'Scan QR Perangkat', short_name: 'Scan QR', url: '/scan', icons: [{ src: '/static/img/icons/icon-192.png', sizes: '192x192' }] },
        { name: 'Isi Preventive Maintenance', short_name: 'Maintenance', url: '/maintenance/new', icons: [{ src: '/static/img/icons/icon-192.png', sizes: '192x192' }] },
        { name: 'Jadwal Maintenance', short_name: 'Jadwal', url: '/schedules', icons: [{ src: '/static/img/icons/icon-192.png', sizes: '192x192' }] },
      ],
    }));
  });
  // Sertifikat CA lokal untuk dipasang di HP / PC lain (agar HTTPS dipercaya)
  app.get('/ca.crt', (req, res) => {
    const tls = app.locals.tls;
    if (!tls) return res.status(404).type('text').send('HTTPS belum aktif di server ini.');
    res.set({ 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="PM-IT-CA.crt"', 'Cache-Control': 'no-cache' })
      .send(require('./services/tls').caDer(tls.caPem));
  });
  const swSource = require('fs').readFileSync(path.join(__dirname, 'pwa', 'sw.js'), 'utf8');
  app.get('/sw.js', (req, res) => {
    res.type('application/javascript').set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' })
      .send(swSource.replace(/__VERSION__/g, app.locals.assetVersion));
  });

  app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 2000 }));
  app.use(express.json({ limit: '2mb' }));

  let store;
  if (config.db.client === 'pgsql') {
    const PgStore = require('connect-pg-simple')(session);
    store = new PgStore({ pool, createTableIfMissing: true });
  } else {
    const MySQLStore = require('express-mysql-session')(session);
    store = new MySQLStore({ createDatabaseTable: false, clearExpired: true, checkExpirationInterval: 15 * 60000, expiration: 12 * 3600 * 1000, endConnectionOnClose: false }, pool);
  }
  app.locals.sessionStore = store;
  app.use(session({
    name: 'pmit.sid',
    secret: config.session.secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.session.cookieSecure, maxAge: 12 * 3600 * 1000 },
  }));

  app.use(idleTimeout(config.session.idleMinutes));
  app.use(csrf);
  app.use(loadUser);
  app.use(locals);
  app.use(withNotifications);

  app.use('/', require('./routes/auth'));
  app.use('/', require('./routes/index'));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
