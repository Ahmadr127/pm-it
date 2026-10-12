(function () {
  'use strict';
  const type = document.getElementById('deviceType');
  const other = document.getElementById('otherTypeWrap');
  const bat = document.getElementById('hasBattery');
  function sync(initial) {
    if (!type) return;
    other.classList.toggle('d-none', type.value !== 'Lainnya');
    if (!initial && bat && type.value === 'Laptop') bat.checked = true;
    if (!initial && bat && type.value === 'Desktop PC') bat.checked = false;
  }
  if (type) { type.addEventListener('change', () => sync(false)); sync(true); }
  // Validasi ukuran & tipe file di sisi browser (backend tetap memvalidasi ulang)
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.type !== 'file' || !el.files) return;
    const max = Number(el.dataset.maxMb || 5) * 1048576;
    const accept = (el.accept || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const f of el.files) {
      if (accept.length && !accept.includes(f.type)) { PM.toast(`"${f.name}" bukan tipe file yang diizinkan.`, 'danger'); el.value = ''; return; }
      if (f.size > max) { PM.toast(`"${f.name}" melebihi ${el.dataset.maxMb || 5} MB.`, 'danger'); el.value = ''; return; }
    }
  });
})();
