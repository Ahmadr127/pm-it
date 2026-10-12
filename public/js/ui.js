/* PM-IT — interaksi tampilan: progres pengisian form, tombol loading, drag & drop foto, angka dashboard, navigasi bawah HP.
   Tanpa inline script (aman untuk CSP). Menghormati prefers-reduced-motion. */
(function () {
  'use strict';
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visible = (el) => !!el && !el.disabled && !!(el.tomselect ? el.tomselect.wrapper : el).offsetParent && !el.closest('.is-disabled-block');

  // ---------- Bar progres atas + tombol loading saat menyimpan ----------
  const bar = document.createElement('div'); bar.id = 'pm-progress'; document.body.appendChild(bar);
  let lastSubmitter = null;
  document.addEventListener('click', (e) => { const b = e.target.closest('button[type=submit], button:not([type]), [data-submit-action]'); if (b && b.form) lastSubmitter = b; }, true);
  function busy(form, on) {
    document.body.classList.toggle('is-busy', on);
    const btn = lastSubmitter && lastSubmitter.form === form ? lastSubmitter : form.querySelector('button[type=submit], button:not([type])');
    if (!btn) return;
    if (on) {
      btn.classList.add('is-loading'); btn.setAttribute('aria-busy', 'true');
      const msg = form.dataset.loading; if (msg) { btn.dataset.label = btn.innerHTML; btn.textContent = msg; }
    } else {
      btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy');
      if (btn.dataset.label) { btn.innerHTML = btn.dataset.label; delete btn.dataset.label; }
    }
  }
  if (window.PM && PM.submit) {
    const orig = PM.submit;
    PM.submit = async function (form, extra) {
      busy(form, true);
      let res;
      try { res = await orig(form, extra); } finally { if (!(res && res.ok && res.redirect)) busy(form, false); }
      if (res && res.ok) dirtyForms.delete(form);
      return res;
    };
  }
  // Form biasa (bukan AJAX), mis. filter / logout
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.matches('[data-ajax], #pmForm, [data-confirm]:not([data-confirmed])') || e.defaultPrevented) return;
    setTimeout(() => { if (!e.defaultPrevented) { busy(f, true); dirtyForms.delete(f); } }, 0);
  });
  window.addEventListener('pageshow', () => { document.body.classList.remove('is-busy'); $$('.is-loading').forEach((b) => b.classList.remove('is-loading')); });

  // ---------- Tombol aksi POST di dalam tabel/form lain (mis. hapus): button[data-post-url] ----------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-post-url]');
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.confirmText && !(await PM.confirm({ title: btn.dataset.confirmTitle || 'Konfirmasi', text: btn.dataset.confirmText, ok: btn.dataset.confirmOk || 'Ya, hapus', tone: btn.dataset.confirmTone || 'danger' }))) return;
    btn.classList.add('is-loading'); btn.disabled = true; document.body.classList.add('is-busy');
    try {
      const r = await fetch(btn.dataset.postUrl, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': PM.csrf, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
      const data = await r.json().catch(() => ({ ok: false, message: `Gagal (HTTP ${r.status}).` }));
      if (r.ok && data.ok) {
        const row = btn.closest('tr');
        if (row && !btn.hasAttribute('data-reload')) { row.classList.add('row-removed'); setTimeout(() => row.remove(), reduce ? 0 : 300); PM.toast(data.message || 'Berhasil.'); }
        else { sessionStorage.setItem('pm-toast', data.message || ''); window.location.reload(); }
      } else PM.toast(data.message || 'Gagal memproses.', 'danger');
    } catch (_) { PM.toast('Gagal terhubung ke server. Coba lagi.', 'danger'); }
    finally { btn.classList.remove('is-loading'); btn.disabled = false; document.body.classList.remove('is-busy'); }
  });

  // ---------- Peringatan bila meninggalkan halaman dengan isian belum disimpan ----------
  const dirtyForms = new Set();
  document.addEventListener('input', (e) => {
    const f = e.target.closest('form');
    if (f && (f.getAttribute('method') || 'get').toLowerCase() === 'post' && !f.closest('.modal') && f.id !== 'pmForm') dirtyForms.add(f);
  });
  window.addEventListener('beforeunload', (e) => { if (dirtyForms.size) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- Kolom wajib: tanda selesai & pesan langsung ----------
  function isFilled(el) {
    if (el.type === 'checkbox' || el.type === 'radio') return !!(el.form || document).querySelector(`[name="${CSS.escape(el.name)}"]:checked`);
    if (el.type === 'file') return el.files && el.files.length > 0;
    return String(el.value || '').trim() !== '';
  }
  function clearError(el) {
    const target = el.tomselect ? el.tomselect.wrapper : el;
    target.classList.remove('is-invalid');
    const wrap = el.closest('[data-field-wrap]'); if (wrap) wrap.classList.remove('is-invalid');
    const box = el.closest('.input-group') || target;
    let n = box.nextElementSibling; if (n && n.matches('.invalid-feedback.js-err')) n.remove();
    if (wrap) wrap.querySelectorAll('.invalid-feedback.js-err').forEach((x) => x.remove());
  }
  document.addEventListener('input', (e) => { const el = e.target; if (el.matches && el.matches('input, select, textarea') && isFilled(el)) clearError(el); }, true);
  document.addEventListener('change', (e) => { const el = e.target; if (el.matches && el.matches('input, select, textarea') && isFilled(el)) clearError(el); }, true);
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('input[required], select[required], textarea[required]') || el.type === 'radio' || el.type === 'checkbox' || el.type === 'file') return;
    if (!el.dataset.touched) return;
    if (!isFilled(el) && !el.classList.contains('is-invalid') && visible(el)) {
      el.classList.add('is-invalid');
      const fb = document.createElement('div'); fb.className = 'invalid-feedback js-err d-block'; fb.textContent = 'Wajib diisi.';
      (el.closest('.input-group') || el).insertAdjacentElement('afterend', fb);
    }
  });
  document.addEventListener('keydown', (e) => { if (e.target.matches && e.target.matches('input, textarea')) e.target.dataset.touched = '1'; }, true);

  // ---------- Textarea: tinggi menyesuaikan isi + penghitung karakter ----------
  function grow(t) { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight + 2, 480)}px`; }
  function initTextareas(root = document) {
    $$('textarea.form-control:not([data-ux])', root).forEach((t) => {
      t.dataset.ux = '1';
      const max = Number(t.getAttribute('maxlength') || 0);
      let counter = null;
      if (max >= 200) { counter = document.createElement('div'); counter.className = 'char-count'; t.insertAdjacentElement('afterend', counter); }
      const upd = () => { grow(t); if (counter) { counter.textContent = t.value.length ? `${t.value.length.toLocaleString('id-ID')} / ${max.toLocaleString('id-ID')}` : ''; counter.classList.toggle('near', t.value.length > max * 0.9); } };
      t.addEventListener('input', upd); upd();
    });
  }

  // ---------- Angka: roda mouse tidak mengubah nilai tanpa sengaja ----------
  document.addEventListener('wheel', (e) => { if (e.target.matches && e.target.matches('input[type=number]:focus')) e.target.blur(); }, { passive: true });

  // ---------- Unggah file: seret & lepas + pratinjau ----------
  function initDropzones(root = document) {
    $$('input[type=file][multiple]:not([data-ux])', root).forEach((input) => {
      input.dataset.ux = '1';
      const zone = document.createElement('div');
      zone.className = 'dz'; zone.tabIndex = 0; zone.setAttribute('role', 'button');
      zone.innerHTML = '<i class="bi bi-cloud-arrow-up dz-ico"></i><div class="fw-semibold">Seret foto / PDF ke sini</div><div class="small text-muted">atau ketuk untuk memilih file / memotret</div>';
      const list = document.createElement('div'); list.className = 'dz-files';
      input.classList.add('visually-hidden');
      input.insertAdjacentElement('beforebegin', zone); zone.insertAdjacentElement('afterend', list);
      const host = input.closest('.dropzone-hint'); if (host) host.classList.add('dz-ready');
      const maxFiles = Number(input.dataset.maxFiles || 10);
      const accept = (input.accept || '').split(',').map((s) => s.trim()).filter(Boolean);
      const setFiles = (files) => {
        const dt = new DataTransfer();
        files.slice(0, maxFiles).forEach((f) => dt.items.add(f));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const render = () => {
        list.innerHTML = '';
        Array.from(input.files).forEach((f, i) => {
          const tile = document.createElement('div'); tile.className = 'dz-file';
          const okType = !accept.length || accept.includes(f.type);
          const big = f.size > (f.type === 'application/pdf' ? 10 : 5) * 1048576;
          if (!okType || big) tile.classList.add('is-bad');
          if (f.type.startsWith('image/') && okType) { const img = document.createElement('img'); img.alt = ''; img.src = URL.createObjectURL(f); img.onload = () => URL.revokeObjectURL(img.src); tile.appendChild(img); } else { const d = document.createElement('div'); d.className = 'pdf'; d.innerHTML = '<i class="bi bi-file-earmark-pdf fs-3 text-danger"></i>'; tile.appendChild(d); }
          const name = document.createElement('div'); name.className = 'text-truncate mt-1'; name.title = f.name; name.textContent = f.name; tile.appendChild(name);
          const meta = document.createElement('div'); meta.className = big || !okType ? 'text-danger' : 'text-muted'; meta.textContent = !okType ? 'Tipe tidak didukung' : big ? 'Terlalu besar' : `${(f.size / 1048576).toFixed(1)} MB`; tile.appendChild(meta);
          const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rm'; rm.title = 'Hapus dari daftar'; rm.setAttribute('aria-label', `Hapus ${f.name}`); rm.innerHTML = '<i class="bi bi-x-lg"></i>';
          rm.addEventListener('click', () => { adding = null; setFiles(Array.from(input.files).filter((_, j) => j !== i)); });
          tile.appendChild(rm); list.appendChild(tile);
        });
        zone.classList.toggle('has-files', input.files.length > 0);
        zone.querySelector('.fw-semibold').textContent = input.files.length ? `${input.files.length} file dipilih — tambah lagi?` : 'Seret foto / PDF ke sini';
      };
      let adding = null;
      zone.addEventListener('click', () => { adding = Array.from(input.files); input.click(); });
      window.addEventListener('focus', () => setTimeout(() => { adding = null; }, 800)); // pemilih file ditutup tanpa memilih
      zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zone.click(); } });
      input.addEventListener('change', () => {
        if (adding) { const prev = adding; adding = null; if (input.files.length) { setFiles(prev.concat(Array.from(input.files))); return; } setFiles(prev); return; }
        render();
      });
      ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('is-over'); }));
      zone.addEventListener('drop', (e) => { adding = null; if (e.dataTransfer && e.dataTransfer.files.length) setFiles(Array.from(input.files).concat(Array.from(e.dataTransfer.files))); });
      render();
    });
  }

  // ---------- Progres pengisian form panjang (form[data-progress]) ----------
  function initProgress(form) {
    const sections = $$('[data-section], .soft-card', form).filter((s) => s.querySelector('.soft-title') || s.dataset.section);
    if (sections.length < 3) return;
    const nav = document.createElement('div'); nav.className = 'form-progress'; nav.setAttribute('aria-label', 'Bagian form');
    nav.innerHTML = '<div class="fp-head"><span data-fp-text>Mengisi form</span><span data-fp-pct></span></div><div class="fp-bar"><span data-fp-fill></span></div><div class="fp-steps"></div>';
    const steps = nav.querySelector('.fp-steps');
    const items = sections.map((sec, i) => {
      const title = sec.dataset.section || sec.querySelector('.soft-title').textContent.trim();
      const b = document.createElement('button'); b.type = 'button'; b.className = 'fp-step';
      b.innerHTML = `<span class="dot">${i + 1}</span><span></span>`; b.lastChild.textContent = title.replace(/ & Tindak Lanjut| \/ Storage Monitoring| Monitoring|Pemeriksaan /g, '').trim();
      b.addEventListener('click', () => {
        sec.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        sec.classList.remove('is-flash'); void sec.offsetWidth; sec.classList.add('is-flash');
        const first = sec.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
        if (first && visible(first) && first.type !== 'radio' && !first.tomselect) setTimeout(() => first.focus({ preventScroll: true }), reduce ? 0 : 450);
      });
      steps.appendChild(b);
      return { sec, b };
    });
    const firstChild = form.querySelector('[data-form-alert]') || form.firstElementChild;
    firstChild.insertAdjacentElement('beforebegin', nav);

    function required(sec) {
      const out = [];
      $$('.form-label', sec).forEach((lb) => {
        const r = lb.querySelector('.req'); if (!r || r.classList.contains('d-none') || r.offsetParent === null) return;
        const box = lb.parentElement;
        const ctl = box.querySelector('select, textarea, input:not([type=hidden]):not([type=checkbox])');
        if (ctl && visible(ctl)) out.push({ el: ctl, label: lb, ok: isFilled(ctl) });
      });
      $$('[data-field-wrap]', sec).forEach((w) => {
        const r = w.querySelector('input[type=radio]'); if (!r || !visible(r.closest('.form-check') ? r.closest('[data-field-wrap]') : r)) return;
        out.push({ el: r, label: null, ok: isFilled(r) });
      });
      $$('[data-task]', sec).forEach((row) => { if (row.classList.contains('d-none') || row.offsetParent === null) return; const r = row.querySelector('input[type=radio]'); if (r) out.push({ el: r, label: null, ok: isFilled(r) }); });
      return out;
    }
    let raf = 0;
    function update() {
      raf = 0;
      let total = 0; let done = 0;
      items.forEach(({ sec, b }) => {
        const req = required(sec);
        req.forEach((x) => { if (x.label) x.label.classList.toggle('is-done', x.ok); });
        const n = req.filter((x) => x.ok).length;
        total += req.length; done += n;
        const anyFilled = $$('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea', sec).some((el) => visible(el) && isFilled(el) && !el.readOnly);
        const complete = req.length ? n === req.length : anyFilled;
        b.classList.toggle('is-done', complete);
        b.classList.toggle('has-error', !!sec.querySelector('.is-invalid, .task-row.missing'));
        const dot = b.querySelector('.dot'); const want = complete ? 'ok' : 'n';
        if (dot.dataset.state !== want) { dot.dataset.state = want; dot.innerHTML = complete ? '<i class="bi bi-check-lg"></i>' : String(items.findIndex((x) => x.sec === sec) + 1); }
        const t = req.length ? `${n} dari ${req.length} isian wajib terisi` : 'Tidak ada isian wajib'; if (b.title !== t) b.title = t;
      });
      const pct = total ? Math.round((done / total) * 100) : 0;
      nav.querySelector('[data-fp-fill]').style.width = `${pct}%`;
      nav.querySelector('[data-fp-pct]').textContent = `${pct}%`;
      nav.querySelector('[data-fp-text]').textContent = pct === 100 ? 'Semua isian wajib sudah lengkap — siap disimpan' : `${done} dari ${total} isian wajib terisi`;
      nav.classList.toggle('is-complete', pct === 100);
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    form.addEventListener('input', schedule); form.addEventListener('change', schedule); form.addEventListener('click', () => setTimeout(schedule, 50));
    new MutationObserver((muts) => { if (muts.some((m) => !nav.contains(m.target) && !(m.attributeName === 'class' && m.target.classList && m.target.classList.contains('form-label')))) schedule(); }).observe(form, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) { items.forEach(({ sec, b }) => b.classList.toggle('is-current', sec === en.target)); const cur = items.find((x) => x.sec === en.target); if (cur) cur.b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' }); } });
      }, { rootMargin: '-170px 0px -60% 0px' });
      sections.forEach((s) => io.observe(s));
    }
    // Enter di kolom isian = pindah ke kolom berikutnya (bukan menyimpan form tanpa sengaja)
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || !e.target.matches('input:not([type=submit]):not([type=button]):not([type=file])') || e.target.closest('.ts-wrapper')) return;
      e.preventDefault();
      const fields = $$('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]), select, textarea', form).filter((el) => visible(el) && !el.readOnly);
      const next = fields[fields.indexOf(e.target) + 1];
      if (next) { if (next.tomselect) next.tomselect.focus(); else next.focus(); }
    });
    update();
  }

  // ---------- Angka statistik dashboard: hitung naik sekali saat dibuka ----------
  function countUp() {
    if (reduce) return;
    $$('.stat-value').forEach((el) => {
      const txt = el.textContent.trim(); if (!/^\d{1,6}$/.test(txt)) return;
      const end = Number(txt); if (end < 2) return;
      const t0 = performance.now(); const dur = 650 + Math.min(end, 400);
      el.textContent = '0';
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = String(Math.round(end * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  // ---------- Pencarian cepat di topbar ----------
  function initSearch() {
    const box = document.querySelector('[data-gsearch]');
    if (!box) return;
    const input = box.querySelector('[data-gsearch-input]');
    const out = box.querySelector('[data-gsearch-results]');
    let timer = null; let seq = 0; let items = []; let active = -1;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const mark = (s, q) => { const t = esc(s); if (!q) return t; const i = t.toLowerCase().indexOf(esc(q).toLowerCase()); return i < 0 ? t : `${t.slice(0, i)}<mark>${t.slice(i, i + esc(q).length)}</mark>${t.slice(i + esc(q).length)}`; };
    const close = () => { out.hidden = true; active = -1; document.body.classList.remove('gsearch-open'); };
    const setActive = (i) => { const els = out.querySelectorAll('.gs-item'); els.forEach((el, j) => el.classList.toggle('is-active', j === i)); active = i; if (els[i]) els[i].scrollIntoView({ block: 'nearest' }); };
    function render(d) {
      const q = d.q; items = [];
      let html = '';
      if (d.assets.length) {
        html += '<div class="gs-group">Perangkat</div>';
        d.assets.forEach((a) => { items.push(`/assets/${a.id}`); html += `<a class="gs-item" role="option" href="/assets/${a.id}"><i class="bi ${a.type === 'Laptop' ? 'bi-laptop' : 'bi-pc-display'}"></i><div class="min-w-0"><div><span class="code-chip">${mark(a.code, q)}</span> ${a.name && a.name !== a.type ? mark(a.name, q) : ''}</div><div class="gs-sub text-truncate">${mark(a.sub || a.type, q)}</div></div></a>`; });
      }
      if (d.employees.length) {
        html += '<div class="gs-group">Pengguna PC</div>';
        d.employees.forEach((e) => { items.push(`/employees/${e.id}`); html += `<a class="gs-item" role="option" href="/employees/${e.id}"><i class="bi bi-person"></i><div class="min-w-0"><div>${mark(e.name, q)}</div><div class="gs-sub text-truncate">${mark(e.sub, q)}</div></div></a>`; });
      }
      if (!items.length) html = `<div class="gs-empty">Tidak ada hasil untuk "<strong>${esc(q)}</strong>". Coba kode aset, nama pengguna, atau ruangan.</div>`;
      else if (d.assets.length) html += `<a class="gs-all" href="/assets?q=${encodeURIComponent(q)}">Lihat semua hasil di Master Aset PC</a>`;
      out.innerHTML = html; out.hidden = false; active = -1;
    }
    async function run() {
      const q = input.value.trim();
      if (q.length < 2) { out.hidden = true; return; }
      const my = ++seq;
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        const d = await r.json();
        if (my === seq && d.ok) render(d);
      } catch (_) { /* koneksi terputus: abaikan */ }
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && out.innerHTML) out.hidden = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) setActive((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setActive((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items.length) window.location.href = items[Math.max(active, 0)]; else if (input.value.trim()) window.location.href = `/assets?q=${encodeURIComponent(input.value.trim())}`; }
      else if (e.key === 'Escape') { input.blur(); close(); }
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-gsearch-open]')) { document.body.classList.add('gsearch-open'); setTimeout(() => input.focus(), 30); return; }
      if (!box.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.target.closest('input, textarea, select, [contenteditable]')) { e.preventDefault(); input.focus(); input.select(); }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTextareas(); initSearch(); initDropzones();
    $$('form[data-progress]').forEach(initProgress);
    if (document.querySelector('.sticky-actions')) document.body.classList.add('has-sticky-actions');
    if (document.querySelector('.bottom-nav')) document.body.classList.add('has-bottom-nav');
    countUp();
  });
  // Elemen yang ditambahkan dinamis (mis. blok SSD/HDD baru)
  new MutationObserver((muts) => { if (muts.some((m) => m.addedNodes.length)) { initTextareas(); initDropzones(); } }).observe(document.documentElement, { childList: true, subtree: true });
  window.PMui = { initTextareas, initDropzones };
}());
