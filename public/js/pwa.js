/* PWA: daftar service worker & tombol "Pasang Aplikasi" */
(function () {
  'use strict';
  const secure = window.isSecureContext;
  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* abaikan */ }); });
  }
  let deferred = null;
  const buttons = () => document.querySelectorAll('[data-install-app]');
  const show = (on) => buttons().forEach((b) => b.classList.toggle('d-none', !on));
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; show(true); });
  window.addEventListener('appinstalled', () => { deferred = null; show(false); });
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-install-app]');
    if (!btn) return;
    e.preventDefault();
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (_) { /* abaikan */ }
    deferred = null; show(false);
  });
}());
