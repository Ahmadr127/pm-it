/* Form Preventive Maintenance — auto-fill aset, multi-storage, validasi, konfirmasi tindak lanjut */
(function () {
  'use strict';
  const form = document.getElementById('pmForm');
  if (!form) return;
  const $ = (s, r = form) => r.querySelector(s);
  const $$ = (s, r = form) => Array.from(r.querySelectorAll(s));
  let dirty = false;
  form.addEventListener('input', () => { dirty = true; });

  // ---------- Blok storage ----------
  const counters = { SSD: $$('[data-storage-list="SSD"] [data-storage-item]').length, HDD: $$('[data-storage-list="HDD"] [data-storage-item]').length };
  function renumber(type) {
    $$(`[data-storage-list="${type}"] [data-storage-item]`).forEach((el, i) => { const n = el.querySelector('[data-storage-no]'); if (n) n.textContent = `#${i + 1}`; });
  }
  function addStorage(type, data) {
    const tpl = document.getElementById(`tpl${type}`);
    const idx = counters[type]++;
    const html = tpl.innerHTML.replace(/__IDX__/g, String(idx));
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const el = wrap.firstElementChild;
    if (data) {
      data = { ...data, model: [data.brand, data.model].filter(Boolean).join(' ') || null }; // Merek & model jadi satu kolom
      const set = (f, v) => { const i = el.querySelector(`[name$="[${f}]"]`); if (i && v !== null && v !== undefined) i.value = v; };
      ['storage_device_id', 'interface', 'brand', 'model', 'serial_number', 'capacity_gb', 'temperature_c', 'health_percent', 'used_percent', 'smart_status', 'reading_tool', 'data_source'].forEach((f) => set(f, data[f]));
    }
    $(`[data-storage-list="${type}"]`).appendChild(el);
    renumber(type);
    return el;
  }
  form.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-storage]');
    if (add) { addStorage(add.dataset.addStorage); dirty = true; }
    const rm = e.target.closest('[data-remove-storage]');
    if (rm) {
      const item = rm.closest('[data-storage-item]'); const type = item.dataset.type;
      item.remove(); renumber(type); dirty = true;
      if (type === 'SSD' && !$$('[data-storage-list="SSD"] [data-storage-item]').length) addStorage('SSD');
    }
    const tn = e.target.closest('[data-task-note-toggle]');
    if (tn) { const n = tn.closest('[data-task]').querySelector('[data-task-note]'); n.classList.toggle('d-none'); if (!n.classList.contains('d-none')) n.focus(); }
    const markAll = e.target.closest('[data-mark-all]');
    if (markAll) {
      $$('[data-task]').forEach((row) => {
        if (row.classList.contains('d-none')) return;
        const r = row.querySelector(`input[value="${markAll.dataset.markAll}"]`); if (r) r.checked = true;
        row.classList.remove('missing');
      });
      dirty = true;
    }
    if (e.target.closest('[data-mark-all-na]')) {
      $$('[data-task]').forEach((row) => {
        if (row.classList.contains('d-none')) return;
        if (!row.querySelector('input[type=radio]:checked')) { const r = row.querySelector('input[value="Tidak diperlukan"]'); if (r) r.checked = true; }
      });
      dirty = true;
    }
  });

  // ---------- SSD / HDD ada / tidak ada ----------
  function syncPresence(type) {
    const v = ($(`[data-presence="${type}"]:checked`) || {}).value;
    const block = $(`[data-presence-block="${type}"]`);
    const none = v === 'TIDAK_ADA';
    block.classList.toggle('is-disabled-block', none);
    $$('input, select, textarea', block).forEach((i) => { i.disabled = none; });
    $(`[data-presence-note="${type}"]`).classList.toggle('d-none', !none);
    if (v === 'ADA' && !$$(`[data-storage-list="${type}"] [data-storage-item]`).length) addStorage(type);
  }
  const markPresent = (type) => { const yes = $(`#${type.toLowerCase()}Yes`); if (!$(`[data-presence="${type}"]:checked`)) { yes.checked = true; syncPresence(type); } };
  const syncHdd = () => syncPresence('HDD');
  $$('[data-presence]').forEach((r) => r.addEventListener('change', () => syncPresence(r.dataset.presence)));

  // ---------- CPU tidak dapat dibaca ----------
  const cpuIn = $('[data-cpu-input]'); const cpuNA = $('[data-cpu-na]');
  function syncCpu() { if (cpuNA.checked) { cpuIn.value = ''; cpuIn.disabled = true; } else cpuIn.disabled = false; }
  cpuNA.addEventListener('change', syncCpu);

  // ---------- Sumber data: nilai yang diubah teknisi = MANUAL ----------
  form.addEventListener('input', (e) => {
    if (!e.target.matches('[data-measured]')) return;
    if (e.target === cpuIn) { $('[data-cpu-source]').value = 'MANUAL'; return; }
    const holder = e.target.closest('[data-storage-item]') || e.target.closest('[data-battery-fields]');
    const flag = holder && holder.querySelector('[data-source-flag]');
    if (flag) flag.value = 'MANUAL';
  });

  // ---------- Perangkat: baterai & checklist sesuai jenis ----------
  function syncDevice() {
    const hb = form.dataset.hasBattery; const type = form.dataset.deviceType;
    const fields = $('[data-battery-fields]');
    $('[data-battery-pending]').classList.toggle('d-none', hb !== '');
    $('[data-battery-na]').classList.toggle('d-none', hb !== '0');
    fields.classList.toggle('d-none', hb !== '1');
    $$('input, select, textarea', fields).forEach((i) => { i.disabled = hb !== '1'; });
    $$('[data-task]').forEach((row) => {
      const ap = row.dataset.applies;
      const show = ap === 'SEMUA' || !type || (ap === 'LAPTOP' && type === 'Laptop') || (ap === 'DESKTOP' && type !== 'Laptop');
      row.classList.toggle('d-none', !show);
      row.querySelectorAll('input').forEach((i) => { i.disabled = !show; });
    });
  }

  function blockIsEmpty(el) {
    return Array.from(el.querySelectorAll('input:not([type=hidden]), select')).every((i) => !i.value);
  }

  async function loadAsset(id) {
    if (!id) return;
    try {
      const res = await fetch(`/api/assets/${encodeURIComponent(id)}/context`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const data = await res.json();
      if (!data.ok) { PM.toast(data.message || 'Gagal memuat data aset.', 'danger'); return; }
      const a = data.asset;
      const setCtx = (k, v) => { const el = $(`[data-ctx="${k}"]`); if (el) el.value = v || ''; };
      setCtx('device_type', a.device_type); setCtx('hostname', a.hostname); setCtx('employee_name', a.employee_name);
      setCtx('department_name', a.department_name); setCtx('work_unit_name', a.work_unit_name);
      setCtx('location_full', [a.location_text, a.room ? `R. ${a.room}` : null].filter(Boolean).join(' · '));
      setCtx('last_maintenance', a.last_maintenance_date || 'Belum pernah');
      $('[data-ctx="employee_name"]').placeholder = 'Belum ada pengguna aktif';
      form.dataset.hasBattery = a.has_battery ? '1' : '0';
      form.dataset.deviceType = a.device_type;
      syncDevice();
      // Ganti blok storage kosong dengan storage terdaftar pada aset
      for (const type of ['SSD', 'HDD']) {
        const list = $(`[data-storage-list="${type}"]`);
        const items = Array.from(list.querySelectorAll('[data-storage-item]'));
        const reg = a.storages.filter((s) => s.storage_type === type);
        if (items.every(blockIsEmpty) && reg.length) {
          items.forEach((i) => i.remove());
          reg.forEach((s) => addStorage(type, { ...s, storage_device_id: s.id }));
        }
      }
      if (a.storages.some((s) => s.storage_type === 'HDD')) markPresent('HDD');
      if (a.storages.some((s) => s.storage_type === 'SSD')) markPresent('SSD');
    } catch (err) { PM.toast('Gagal memuat data aset.', 'danger'); }
  }

  const assetSel = document.getElementById('assetSelect');
  if (assetSel) {
    const hook = () => {
      if (assetSel.tomselect) assetSel.tomselect.on('change', (v) => loadAsset(v));
      else assetSel.addEventListener('change', () => loadAsset(assetSel.value));
    };
    if (assetSel.tomselect) hook(); else document.addEventListener('DOMContentLoaded', hook);
    if (assetSel.value) document.addEventListener('DOMContentLoaded', () => loadAsset(assetSel.value));
  }


  // ---------- Penanda wajib ----------
  function syncRequired() {
    const fin = $('[data-final]').value;
    $('[data-req-findings]').classList.toggle('d-none', !fin || fin === 'Baik');
  }
  $('[data-final]').addEventListener('change', syncRequired);

  // ---------- Validasi sisi browser (backend tetap memvalidasi ulang) ----------
  function num(v) { return v === '' ? null : Number(String(v).replace(',', '.')); }
  function clientValidate(action) {
    const errors = {};
    const statusSel = $('[data-status-select]');
    const complete = action === 'complete' || action === 'complete_print' || ((action === 'save' || action === 'save_print') && statusSel && statusSel.value === 'Selesai');
    const req = (name, msg) => { const el = form.querySelector(`[name="${name}"]`); if (el && !el.disabled && !el.value) errors[name] = msg; };
    if (isNewMode()) {
      req('na[hostname]', 'Nama perangkat / hostname wajib diisi.');
      req('na[device_type]', 'Jenis perangkat wajib dipilih.');
    } else if (!form.querySelector('[name="asset_id"]').value) errors.asset_id = 'Perangkat wajib dipilih (atau klik "Daftarkan perangkat baru").';
    req('maintenance_date', 'Tanggal maintenance wajib diisi.');
    if (action !== 'draft') { req('check_time', 'Jam pemeriksaan wajib diisi.'); req('technician_user_id', 'Petugas IT wajib dipilih.'); }
    $$('[data-numeric]').forEach((el) => {
      if (el.disabled || el.value === '') return;
      const n = num(el.value);
      if (Number.isNaN(n)) { errors[el.name] = 'Harus berupa angka.'; return; }
      if (el.dataset.min !== undefined && n < Number(el.dataset.min)) errors[el.name] = `Minimal ${el.dataset.min}.`;
      if (el.dataset.max !== undefined && n > Number(el.dataset.max)) errors[el.name] = `Maksimal ${el.dataset.max}.`;
    });
    if (complete) {
      if (!cpuNA.checked && cpuIn.value === '') errors.cpu_temp_c = 'Isi suhu CPU hasil pengukuran atau centang "Sensor tidak dapat dibaca".';
      const ssdItemsFilled = $$('[data-storage-list="SSD"] [data-storage-item]').some((it) => !blockIsEmpty(it));
      if (!$('[data-presence="SSD"]:checked') && !ssdItemsFilled) errors.ssd_presence = 'Pilih "Ada SSD" atau "Tidak Ada SSD".';
      if (!$('[data-presence="HDD"]:checked')) errors.hdd_presence = 'Pilih "Ada HDD" atau "Tidak Ada HDD".';
      if ($('#ssdNo').checked && $('#hddNo').checked) errors.storage = 'Perangkat harus memiliki SSD atau HDD — pilih "Ada" pada salah satunya.';
      $$('[data-storage-item]').forEach((it) => {
        const sm = it.querySelector('[data-smart]');
        if (!sm.disabled && !sm.value && !blockIsEmpty(it)) errors[sm.name] = 'Status SMART wajib dipilih (pilih "Tidak Tersedia" bila tidak dapat dibaca).';
      });
      if (!errors.storage && $$('[data-storage-item]').filter((it) => !it.querySelector('[data-smart]').disabled && !blockIsEmpty(it)).length === 0) errors.storage = 'Isi minimal satu pemeriksaan storage (SSD atau HDD).';
      if ($('#ssdYes').checked && !ssdItemsFilled) errors.ssd_presence = 'Isi data SSD atau pilih "Tidak Ada SSD".';
      req('physical_condition', 'Kondisi fisik wajib dipilih.');
      req('final_condition', 'Kondisi akhir wajib dipilih.');
      const fin = $('[data-final]').value;
      if (fin && fin !== 'Baik' && !form.querySelector('[name="findings"]').value.trim()) errors.findings = 'Catatan wajib diisi bila kondisi akhir bukan "Baik".';
      if (form.dataset.hasBattery === '1') req('battery[battery_status]', 'Status baterai wajib dipilih untuk laptop.');
      $$('[data-task]').forEach((row) => {
        row.classList.remove('missing');
        if (row.classList.contains('d-none')) return;
        if (!row.querySelector('input[type=radio]:checked')) { row.classList.add('missing'); errors[row.querySelector('input[type=radio]').name] = 'Belum dikonfirmasi teknisi.'; }
      });
    }
    // File
    $$('input[type=file]').forEach((el) => {
      if (el.files.length > Number(el.dataset.maxFiles || 5)) errors[el.name] = `Maksimal ${el.dataset.maxFiles || 5} file.`;
      const max = Number(el.dataset.maxMb || 5) * 1048576; const accept = el.accept.split(',');
      for (const f of el.files) {
        if (!accept.includes(f.type)) errors[el.name] = `"${f.name}" bukan tipe file yang diizinkan.`;
        else if (f.size > max) errors[el.name] = `"${f.name}" melebihi ${el.dataset.maxMb} MB.`;
      }
    });
    return errors;
  }

  // ---------- Submit ----------
  const followModalEl = document.getElementById('followModal');
  let pendingAction = null;
  async function submit(action, confirmed) {
    const errors = clientValidate(action);
    if (Object.keys(errors).length) { PM.showErrors(form, errors, 'Lengkapi isian wajib yang ditandai sebelum menyimpan.'); return; }
    const data = await PM.submit(form, { action, confirm_followup: confirmed ? '1' : '0' });
    if (data && data.ok) { dirty = false; return; }
    if (data && data.needs_confirmation) {
      pendingAction = action;
      const ev = data.evaluation;
      const badge = { KRITIS: ['danger', 'Kritis'], PERHATIAN: ['warning', 'Perlu Perhatian'], BAIK: ['success', 'Baik'] }[ev.overall] || ['secondary', ev.overall_label];
      followModalEl.querySelector('[data-follow-status]').innerHTML = `<span class="st st-${badge[0]}">${badge[1]}</span>`;
      followModalEl.querySelector('[data-follow-priority]').textContent = ev.priority ? `Prioritas: ${ev.priority}` : '';
      const fill = (sel, list) => { const ul = followModalEl.querySelector(sel); ul.innerHTML = ''; list.forEach((x) => { const li = document.createElement('li'); li.textContent = typeof x === 'string' ? x : x.text; ul.appendChild(li); }); };
      fill('[data-follow-issues]', ev.issues.length ? ev.issues : ['Kondisi akhir dari teknisi memerlukan tindak lanjut.']);
      fill('[data-follow-flags]', ev.flags);
      followModalEl.querySelector('[data-follow-flags-title]').classList.toggle('d-none', !ev.flags.length);
      fill('[data-follow-recs]', ev.recommendations.length ? ev.recommendations : ['Tentukan PIC dan target penyelesaian tindak lanjut.']);
      bootstrap.Modal.getOrCreateInstance(followModalEl).show();
    }
  }
  followModalEl.querySelector('[data-follow-confirm]').addEventListener('click', () => {
    bootstrap.Modal.getInstance(followModalEl).hide();
    submit(pendingAction, true);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const action = (e.submitter && e.submitter.dataset.submitAction) || 'save';
    submit(action, false);
  });

  // ---------- Hapus lampiran ----------
  form.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-attachment]');
    if (!btn) return;
    if (!(await PM.confirm({ title: 'Hapus lampiran?', text: 'Lampiran akan dihapus dari laporan ini.', ok: 'Ya, hapus' }))) return;
    const res = await fetch(btn.dataset.deleteAttachment, { method: 'POST', headers: { 'X-CSRF-Token': PM.csrf, Accept: 'application/json' }, credentials: 'same-origin' }).then((r) => r.json()).catch(() => null);
    if (res && res.ok) { btn.closest('.col-6').remove(); PM.toast(res.message); } else PM.toast((res && res.message) || 'Gagal menghapus lampiran.', 'danger');
  });

  // ---------- Batal ----------
  $('[data-cancel]').addEventListener('click', async (e) => {
    if (!dirty) return;
    e.preventDefault();
    if (await PM.confirm({ title: 'Batalkan pengisian?', text: 'Perubahan yang belum disimpan akan hilang.', ok: 'Ya, batalkan', tone: 'warning' })) window.location.href = e.target.closest('a').href;
  });

  // ---------- Mode "Perangkat baru" (PC belum ada di Master Aset) ----------
  const modeInput = $('[data-asset-mode-input]');
  const naType = $('[data-na-type]');
  function isNewMode() { return !!modeInput && modeInput.value === 'new'; }
  function syncNewType() {
    const t = naType ? naType.value : '';
    form.dataset.deviceType = t;
    form.dataset.hasBattery = t ? (t === 'Laptop' ? '1' : '0') : '';
    syncDevice();
  }
  function applyMode(load) {
    if (!modeInput) return;
    const isNew = isNewMode();
    $$('[data-new-only]').forEach((el) => el.classList.toggle('d-none', !isNew));
    $$('[data-existing-only]').forEach((el) => el.classList.toggle('d-none', isNew));
    $$('[data-na]').forEach((i) => { i.disabled = !isNew; });
    if (assetSel) {
      if (assetSel.tomselect) { if (isNew) assetSel.tomselect.disable(); else assetSel.tomselect.enable(); }
      assetSel.disabled = isNew;
    }
    if (isNew) {
      syncNewType();
    } else if (load) {
      if (assetSel && assetSel.value) loadAsset(assetSel.value);
      else { form.dataset.hasBattery = ''; form.dataset.deviceType = ''; syncDevice(); }
    }
  }
  form.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-asset-mode]');
    if (!sw) return;
    e.preventDefault();
    modeInput.value = sw.dataset.assetMode;
    applyMode(true);
    if (isNewMode()) { const f = form.querySelector('[name="na[hostname]"]'); if (f) f.focus(); }
  });
  if (naType) naType.addEventListener('change', syncNewType);

  syncPresence('SSD'); syncHdd(); syncCpu(); syncDevice(); syncRequired();
  applyMode(false);
  document.addEventListener('DOMContentLoaded', () => applyMode(false));
})();
