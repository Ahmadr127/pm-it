(function () {
  'use strict';
  // Saring pilihan unit kerja sesuai departemen terpilih
  function syncUnits(form) {
    const dept = form.querySelector('[data-dept-select]');
    const unit = form.querySelector('[data-unit-select]');
    if (!dept || !unit) return;
    unit.querySelectorAll('option[data-dept]').forEach((o) => {
      const show = !dept.value || o.dataset.dept === dept.value;
      o.hidden = !show; o.disabled = !show;
    });
    const sel = unit.selectedOptions[0];
    if (sel && sel.disabled) unit.value = '';
  }
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-dept-select]')) syncUnits(e.target.form);
  });
  document.addEventListener('shown.bs.modal', (e) => { const f = e.target.querySelector('form'); if (f) syncUnits(f); });
})();
