/* Tombol cetak untuk halaman cetak mandiri (tanpa skrip inline karena CSP) */
document.addEventListener('click', (e) => { if (e.target.closest('[data-print]')) window.print(); });
