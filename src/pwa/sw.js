/* Service worker PM-IT (PWA). Versi disisipkan server saat file ini diminta. */
'use strict';
const VERSION = '__VERSION__';
const CACHE = `pmit-static-${VERSION}`;
const OFFLINE_URL = `/static/offline.html?v=${VERSION}`;
const PRECACHE = [
  OFFLINE_URL,
  `/static/css/app.css?v=${VERSION}`,
  `/static/js/app.js?v=${VERSION}`,
  `/static/js/pwa.js?v=${VERSION}`,
  '/static/img/favicon.svg',
  '/static/img/icons/icon-192.png',
  '/vendor/bootstrap/css/bootstrap.min.css',
  '/vendor/bootstrap/js/bootstrap.bundle.min.js',
  '/vendor/bootstrap-icons/bootstrap-icons.min.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pmit-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Halaman aplikasi: selalu ambil dari server (data selalu terbaru & tidak disimpan di perangkat).
  // Bila server tidak dapat dihubungi, tampilkan halaman offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Aset tampilan (CSS, JS, ikon, font): pakai cache agar cepat, diperbarui di latar belakang.
  if (url.pathname.startsWith('/static/') || url.pathname.startsWith('/vendor/')) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }));
  }
  // Lainnya (API, lampiran, data): tidak disentuh service worker.
});
