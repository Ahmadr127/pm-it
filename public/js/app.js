/* PM-IT Asset Monitoring — interaksi global (tanpa inline script, aman untuk CSP ketat) */
(function () {
  'use strict';
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  window.PM = window.PM || {};
  PM.csrf = csrf;

  // ---------- Sidebar mobile ----------
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-sidebar-toggle]')) document.body.classList.toggle('sidebar-open');
    if (e.target.closest('[data-sidebar-close]')) document.body.classList.remove('sidebar-open');
  });

  // ---------- Toast ----------
  PM.toast = function (message, type = 'success') {
    const box = document.getElementById('toastBox');
    if (!box) return alert(message);
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${type === 'danger' ? 'danger' : type === 'warning' ? 'warning' : 'success'} border-0`;
    el.setAttribute('role', 'alert');
    el.innerHTML = '<div class="d-flex"><div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    el.querySelector('.toast-body').textContent = message;
    box.appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 4000 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  };

  // ---------- Konfirmasi ----------
  const confirmEl = document.getElementById('confirmModal');
  PM.confirm = function ({ title = 'Konfirmasi', text = 'Apakah Anda yakin?', ok = 'Ya, lanjutkan', tone = 'danger' } = {}) {
    return new Promise((resolve) => {
      if (!confirmEl) return resolve(window.confirm(text));
      confirmEl.querySelector('[data-confirm-title]').textContent = title;
      confirmEl.querySelector('[data-confirm-text]').textContent = text;
      const btn = confirmEl.querySelector('[data-confirm-ok]');
      btn.textContent = ok;
      btn.className = `btn btn-${tone}`;
      const modal = bootstrap.Modal.getOrCreateInstance(confirmEl);
      let done = false;
      const onOk = () => { done = true; modal.hide(); resolve(true); };
      btn.addEventListener('click', onOk, { once: true });
      confirmEl.addEventListener('hidden.bs.modal', () => { btn.removeEventListener('click', onOk); if (!done) resolve(false); }, { once: true });
      modal.show();
    });
  };

  // ---------- Error field ----------
  function clearErrors(form) {
    form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    form.querySelectorAll('.invalid-feedback.js-err').forEach((el) => el.remove());
    form.querySelectorAll('[data-form-alert]').forEach((el) => { el.classList.add('d-none'); el.innerHTML = ''; });
  }
  function fieldFor(form, key) {
    const candidates = [key, key.replace(/\.(\w+)/g, '[$1]')];
    for (const k of candidates) {
      let el = form.querySelector(`[name="${CSS.escape(k)}"]`) || form.querySelector(`[data-field="${CSS.escape(k)}"]`);
      if (!el && form.elements) { const n = form.elements.namedItem(k); el = n && n.length !== undefined && !n.tagName ? n[0] : n; } // input di luar <form> (atribut form="...")
      if (el) return el;
    }
    return null;
  }
  PM.showErrors = function (form, errors, message) {
    clearErrors(form);
    const alertBox = form.querySelector('[data-form-alert]');
    const unplaced = [];
    for (const [key, msg] of Object.entries(errors || {})) {
      const el = fieldFor(form, key);
      if (!el) { unplaced.push(msg); continue; }
      const wrap = el.closest('[data-field-wrap]');
      const target = el.tomselect ? el.tomselect.wrapper : (el.type === 'radio' || el.type === 'hidden' ? (wrap || el.parentElement) : el);
      target.classList.add('is-invalid');
      const fb = document.createElement('div');
      fb.className = 'invalid-feedback js-err d-block';
      fb.textContent = msg;
      if (wrap) wrap.appendChild(fb);
      else (el.closest('.input-group') || (el.tomselect && el.tomselect.wrapper) || el).insertAdjacentElement('afterend', fb);
    }
    if (alertBox) {
      alertBox.classList.remove('d-none');
      const strong = document.createElement('div'); strong.className = 'fw-semibold'; strong.textContent = message || 'Periksa kembali isian yang ditandai.';
      alertBox.appendChild(strong);
      if (unplaced.length) { const ul = document.createElement('ul'); ul.className = 'mb-0 small'; unplaced.forEach((m) => { const li = document.createElement('li'); li.textContent = m; ul.appendChild(li); }); alertBox.appendChild(ul); }
      alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      PM.toast(unplaced.length ? unplaced.join(' ') : (message || 'Periksa kembali isian Anda.'), 'danger');
    }
    const first = form.querySelector('.is-invalid');
    if (first && !alertBox) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ---------- Submit via fetch (form[data-ajax]) ----------
  PM.submit = async function (form, extra = {}) {
    const fd = new FormData(form);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    const method = (form.getAttribute('method') || 'post').toUpperCase();
    const buttons = form.querySelectorAll('button[type=submit], [data-submit-action]');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const isMultipart = form.enctype === 'multipart/form-data';
      const res = await fetch(form.getAttribute('action') || window.location.pathname, {
        method,
        headers: { 'X-CSRF-Token': csrf, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(isMultipart ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }) },
        body: isMultipart ? fd : new URLSearchParams(fd),
        credentials: 'same-origin',
      });
      let data = {};
      try { data = await res.json(); } catch (_) { data = { ok: false, message: `Server mengembalikan respons tidak valid (HTTP ${res.status}).` }; }
      if (res.ok && data.ok) {
        if (data.download) window.open(data.download, '_blank');
        if (data.temp_password) window.prompt('Password sementara — salin & sampaikan langsung ke pengguna (tidak akan ditampilkan lagi):', data.temp_password);
        if (data.redirect) { sessionStorage.setItem('pm-toast', data.message || ''); window.location.href = data.redirect; return data; }
        if (data.message) PM.toast(data.message);
        const modal = form.closest('.modal');
        if (modal && !form.hasAttribute('data-keep-open')) { bootstrap.Modal.getInstance(modal)?.hide(); }
        if (form.hasAttribute('data-reload')) { sessionStorage.setItem('pm-toast', data.message || ''); window.location.reload(); }
        return data;
      }
      if (!data.needs_confirmation) PM.showErrors(form, data.errors, data.message);
      return data;
    } catch (err) {
      PM.toast('Gagal terhubung ke server. Periksa koneksi lalu coba lagi.', 'danger');
      return { ok: false };
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  };

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.matches('form[data-confirm]') && !form.dataset.confirmed) {
      e.preventDefault();
      const ok = await PM.confirm({ title: form.dataset.confirmTitle || 'Konfirmasi', text: form.dataset.confirm, ok: form.dataset.confirmOk || 'Ya, lanjutkan', tone: form.dataset.confirmTone || 'danger' });
      if (!ok) return;
      if (form.matches('[data-ajax]')) return PM.submit(form);
      form.dataset.confirmed = '1';
      form.requestSubmit ? form.requestSubmit() : form.submit();
      return;
    }
    if (form.matches('form[data-ajax]')) { e.preventDefault(); PM.submit(form); }
  });

  // Toast setelah redirect
  const pending = sessionStorage.getItem('pm-toast');
  if (pending) { sessionStorage.removeItem('pm-toast'); document.addEventListener('DOMContentLoaded', () => PM.toast(pending)); }

  // ---------- Modal form tambah/edit ----------
  // Tombol: data-modal-form="#modalId" data-action="/url" data-title="..." data-values='{"field":"value"}'
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-modal-form]');
    if (!btn) return;
    const modalEl = document.querySelector(btn.dataset.modalForm);
    if (!modalEl) return;
    const form = modalEl.querySelector('form');
    form.reset();
    clearErrors(form);
    if (btn.dataset.action) form.action = btn.dataset.action;
    const title = modalEl.querySelector('.modal-title');
    if (title && btn.dataset.title) title.textContent = btn.dataset.title;
    let values = {};
    try { values = JSON.parse(btn.dataset.values || '{}'); } catch (_) { values = {}; }
    form.querySelectorAll('input:not([type=hidden]), input[type=hidden][data-fill], select, textarea').forEach((el) => {
      if (!(el.name in values)) { if (el.tomselect) el.tomselect.clear(); return; }
      const v = values[el.name];
      if (el.type === 'checkbox') el.checked = v === 1 || v === true || v === '1';
      else if (el.type === 'radio') el.checked = String(el.value) === String(v);
      else if (el.tomselect) el.tomselect.setValue(v === null ? '' : String(v));
      else el.value = v === null || v === undefined ? '' : v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  });

  // ---------- Auto-submit filter ----------
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-autosubmit]')) e.target.form.submit();
  });

  // ---------- Tom Select ----------
  PM.initSelects = function (root = document) {
    root.querySelectorAll('select[data-tom]:not(.tomselected)').forEach((el) => {
      new TomSelect(el, { allowEmptyOption: true, plugins: el.multiple ? ['remove_button'] : [], maxOptions: 300, create: false });
    });
    root.querySelectorAll('select[data-asset-search]:not(.tomselected)').forEach((el) => {
      new TomSelect(el, {
        valueField: 'id', labelField: 'asset_code', searchField: ['asset_code', 'hostname', 'employee_name', 'inventory_number'],
        maxOptions: 30, loadThrottle: 250, preload: 'focus',
        load(q, cb) {
          fetch(`/api/assets/search?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
            .then((r) => r.json()).then((d) => cb(d.items || [])).catch(() => cb());
        },
        render: {
          option(item, esc) {
            return `<div><div class="fw-semibold">${esc(item.hostname || '')} <span class="code-chip ms-1">${esc(item.asset_code)}</span></div><div class="opt-sub">${esc(item.device_type || '')}${item.employee_name ? ' · ' + esc(item.employee_name) : ''}${item.department_name ? ' · ' + esc(item.department_name) : ''}</div></div>`;
          },
          item(item, esc) { return `<div>${esc(item.hostname || '')} <span class="code-chip ms-1">${esc(item.asset_code)}</span></div>`; },
          no_results() { return '<div class="no-results p-2 small text-muted">Perangkat tidak ditemukan. Bila PC belum terdaftar, klik "Daftarkan perangkat baru" di bawah kolom ini.</div>'; },
        },
      });
    });
  };

  // ---------- Grafik (canvas[data-chart] + <script type="application/json" id="...">) ----------
  PM.initCharts = function () {
    if (!window.Chart) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = '#5d6d62';
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    document.querySelectorAll('canvas[data-chart]').forEach((cv) => {
      const src = document.getElementById(cv.dataset.chart);
      if (!src) return;
      const cfg = JSON.parse(src.textContent);
      if (cfg.options && cfg.options.__percentAxis) {
        delete cfg.options.__percentAxis;
        cfg.options.scales = cfg.options.scales || {}; cfg.options.scales.y = { ...(cfg.options.scales.y || {}), suggestedMin: 0, suggestedMax: 100 };
      }
      new Chart(cv, cfg);
    });
  };

  // ---------- Pembaruan otomatis ----------
  // Bila aplikasi di server diperbarui, halaman yang sedang terbuka memuat ulang sendiri.
  // Bila ada isian form yang belum disimpan, tampilkan pemberitahuan saja agar data tidak hilang.
  (function watchVersion() {
    const meta = document.querySelector('meta[name="app-version"]');
    if (!meta || !meta.content) return;
    const current = meta.content;
    let typed = false; let seen = null; let shown = false;
    document.addEventListener('input', (e) => { if (e.target.closest('form') && !e.target.closest('form[method="get"]')) typed = true; }, true);
    const notify = () => {
      if (shown) return; shown = true;
      const bar = document.createElement('div');
      bar.className = 'alert alert-info shadow d-flex align-items-center gap-2 position-fixed bottom-0 end-0 m-3';
      bar.style.zIndex = 2000;
      bar.innerHTML = '<i class="bi bi-arrow-repeat"></i><span>Aplikasi telah diperbarui. Simpan isian Anda, lalu muat ulang halaman.</span>';
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-sm btn-primary'; btn.textContent = 'Muat ulang';
      btn.addEventListener('click', () => window.location.reload());
      bar.appendChild(btn); document.body.appendChild(bar);
    };
    const check = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch('/app-version', { cache: 'no-store', credentials: 'same-origin' });
        if (!r.ok) return;
        const { v } = await r.json();
        if (!v || v === current) { seen = null; return; }
        if (seen !== v) { seen = v; return; } // tunggu versi stabil (pembaruan beberapa file selesai)
        if (typed) notify(); else window.location.reload();
      } catch (_) { /* server sedang memuat ulang — coba lagi nanti */ }
    };
    setInterval(check, 8000);
  }());

  document.addEventListener('DOMContentLoaded', () => {
    PM.initSelects();
    PM.initCharts();
    // Aktifkan tab dari hash URL (#tab-...)
    if (location.hash) { const t = document.querySelector(`[data-bs-target="${location.hash}"]`); if (t) bootstrap.Tab.getOrCreateInstance(t).show(); }
    document.querySelectorAll('[data-bs-toggle="tab"]').forEach((t) => t.addEventListener('shown.bs.tab', () => history.replaceState(null, '', t.dataset.bsTarget)));
  });
})();
