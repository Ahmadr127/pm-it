(function () {
  'use strict';
  document.addEventListener('change', (e) => {
    if (!e.target.matches('[data-check-all]')) return;
    const table = e.target.closest('table');
    table.querySelectorAll('tbody input[type=checkbox][name="ids"]').forEach((c) => { c.checked = e.target.checked; });
  });
  document.addEventListener('DOMContentLoaded', () => {
    const m = document.querySelector('.modal[data-autoshow]');
    if (m) bootstrap.Modal.getOrCreateInstance(m).show();
  });
})();
