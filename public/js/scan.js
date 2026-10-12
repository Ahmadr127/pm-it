/* Pemindai QR label perangkat: kamera langsung (HTTPS / localhost) atau foto (berfungsi juga lewat http). */
(function () {
  'use strict';
  const video = document.querySelector('[data-scan-video]');
  if (!video) return;
  const box = document.querySelector('[data-scan-box]');
  const canvas = document.querySelector('[data-scan-canvas]');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const status = document.querySelector('[data-scan-status]');
  const btnStart = document.querySelector('[data-scan-start]');
  const btnStop = document.querySelector('[data-scan-stop]');
  const photo = document.querySelector('[data-scan-photo]');
  let stream = null; let running = false; let detector = null;

  const say = (msg, tone = 'light') => { status.className = `alert alert-${tone} border small text-center mb-3`; status.textContent = msg; };

  /**
   * Ambil ID / kode perangkat dari isi QR. Alamat server di dalam QR DIABAIKAN — selalu dibuka di server
   * yang sedang dipakai, sehingga label lama (alamat IP berbeda) tetap berfungsi.
   */
  function target(text) {
    const s = String(text || '').trim();
    let m = /\/s\/(\d+)(?:[/?#]|$)/.exec(s) || /[?&]asset_id=(\d+)/.exec(s) || /\/assets\/(\d+)(?:[/?#]|$)/.exec(s) || /^PMIT[:\-](\d+)$/i.exec(s);
    if (m) return `/s/${m[1]}`;
    if (/^[\w.\-/]{2,60}$/.test(s)) return `/s?q=${encodeURIComponent(s)}`; // kode aset / hostname
    return null;
  }
  function found(text) {
    const url = target(text);
    if (!url) { say(`QR terbaca tetapi bukan label perangkat PM-IT: "${String(text).slice(0, 80)}"`, 'warning'); return false; }
    stop();
    say('Label terbaca. Membuka data perangkat...', 'success');
    if (navigator.vibrate) navigator.vibrate(80);
    window.location.href = url;
    return true;
  }

  function decodeCanvas(w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const r = window.jsQR ? window.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' }) : null;
    return r ? r.data : null;
  }

  async function tick() {
    if (!running) return;
    if (video.readyState >= 2) {
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes.length && found(codes[0].rawValue)) return;
        } else {
          const w = Math.min(video.videoWidth, 720); const h = Math.round(video.videoHeight * (w / video.videoWidth));
          canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
          const text = decodeCanvas(w, h);
          if (text && found(text)) return;
        }
      } catch (_) { /* frame berikutnya */ }
    }
    setTimeout(() => requestAnimationFrame(tick), 120);
  }

  async function start() {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say('Kamera langsung hanya tersedia lewat alamat HTTPS (lihat menu profil → Akses dari HP). Gunakan tombol "Foto label QR".', 'warning');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      say('Izin kamera ditolak atau kamera tidak tersedia. Gunakan tombol "Foto label QR".', 'warning');
      return;
    }
    if ('BarcodeDetector' in window) {
      try { const f = await window.BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { detector = null; }
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    box.classList.remove('d-none'); btnStart.classList.add('d-none'); btnStop.classList.remove('d-none');
    running = true;
    say('Arahkan kamera ke label QR...', 'info');
    tick();
  }
  function stop() {
    running = false;
    if (stream) { stream.getTracks().forEach((tr) => tr.stop()); stream = null; }
    box.classList.add('d-none'); btnStart.classList.remove('d-none'); btnStop.classList.add('d-none');
  }

  btnStart.addEventListener('click', start);
  btnStop.addEventListener('click', () => { stop(); say('Kamera dihentikan.'); });

  photo.addEventListener('change', () => {
    const file = photo.files && photo.files[0];
    if (!file) return;
    say('Membaca QR dari foto...', 'info');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Coba beberapa ukuran: QR kecil di foto besar lebih mudah terbaca setelah diperkecil sedikit
      for (const max of [1200, 900, 1600, 600]) {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale); const h = Math.round(img.height * scale);
        canvas.width = w; canvas.height = h; ctx.drawImage(img, 0, 0, w, h);
        const text = decodeCanvas(w, h);
        if (text) { found(text); photo.value = ''; return; }
      }
      say('QR tidak terbaca. Foto lebih dekat, pastikan label terang & tidak buram, lalu coba lagi.', 'warning');
      photo.value = '';
    };
    img.onerror = () => { URL.revokeObjectURL(url); say('File foto tidak dapat dibaca.', 'danger'); };
    img.src = url;
  });

  window.addEventListener('pagehide', stop);
  window.PMScan = { target }; // untuk pengujian
}());
