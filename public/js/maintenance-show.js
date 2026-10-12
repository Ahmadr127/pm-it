(function () {
  'use strict';
  // Tombol setujui / tolak mengisi field decision sebelum submit via fetch
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-decision]');
    if (!b) return;
    const f = b.closest('form');
    f.querySelector('[data-decision-input]').value = b.dataset.decision;
    f.querySelectorAll('button[name="decision"]').forEach((x) => x.removeAttribute('name'));
  });
  document.addEventListener('DOMContentLoaded', () => {
    const m = document.querySelector('[data-autoshow]');
    if (m) bootstrap.Modal.getOrCreateInstance(m).show();
  });
})();
