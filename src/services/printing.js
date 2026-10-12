'use strict';
/** Laporan resmi PDF per maintenance: identitas aset & pengguna, parameter hardware, tindakan, temuan, kondisi akhir, tanda tangan. */
const config = require('../config');
const ex = require('./exporter');
const h = require('../utils/helpers');
const { LEVEL_LABEL } = require('./evaluation');

const LEVEL_COLOR = { BAIK: '#13774A', PERHATIAN: '#946500', KRITIS: '#B42323' };
const t = ex.pdfText;

function section(doc, title) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 70) doc.addPage();
  doc.moveDown(0.4);
  const x = doc.page.margins.left; const w = doc.page.width - x - doc.page.margins.right;
  doc.save().rect(x, doc.y, 3, 13).fill('#82BE42').restore();
  doc.font('B').fontSize(10).fillColor('#22302A').text(t(title), x + 8, doc.y, { width: w });
  doc.moveDown(0.3);
  doc.x = x;
}

function kvGrid(doc, pairs, cols = 2) {
  const x0 = doc.page.margins.left; const w = doc.page.width - x0 - doc.page.margins.right;
  const colW = w / cols; const labelW = colW * 0.38;
  for (let i = 0; i < pairs.length; i += cols) {
    const row = pairs.slice(i, i + cols);
    doc.font('R').fontSize(8);
    const hgt = Math.max(...row.map(([, v]) => doc.heightOfString(t(v ?? '-') || '-', { width: colW - labelW - 8 }))) + 4;
    if (doc.y + hgt > doc.page.height - doc.page.margins.bottom - 10) doc.addPage();
    const y = doc.y;
    row.forEach(([k, v], j) => {
      const x = x0 + j * colW;
      doc.font('R').fontSize(8).fillColor('#6B7393').text(t(k), x, y, { width: labelW - 4 });
      doc.font('S').fontSize(8).fillColor('#1B2240').text(t(v === null || v === undefined || v === '' ? '-' : v), x + labelW, y, { width: colW - labelW - 8 });
    });
    doc.y = y + hgt;
  }
  doc.x = x0;
}

function para(doc, label, text) {
  if (!text) return;
  doc.font('S').fontSize(8).fillColor('#6B7393').text(t(label));
  doc.font('R').fontSize(8.5).fillColor('#1B2240').text(t(text), { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
  doc.moveDown(0.3);
}

async function maintenanceReport(r, user) {
  const doc = ex.newPdf({ title: `Laporan Maintenance ${r.maintenance_no}` });
  ex.pdfHeader(doc, 'LAPORAN PREVENTIVE MAINTENANCE PC', `${config.companyName} · No. ${r.maintenance_no} · ${h.fmtDate(r.maintenance_date, true)}`);
  const ev = r.evaluation || { items: [], recommendations: [], flags: [] };

  section(doc, 'Informasi Maintenance');
  kvGrid(doc, [
    ['No. maintenance', r.maintenance_no], ['Status', r.status],
    ['Tanggal', h.fmtDate(r.maintenance_date, true)], ['Jam pemeriksaan', r.check_time ? r.check_time.slice(0, 5) : '-'],
    ['Petugas IT', r.technician_name], ['Sumber data', { MANUAL: 'Input manual', AGENT: 'Agent otomatis', CAMPURAN: 'Manual + agent' }[r.data_source]],
  ]);
  section(doc, 'Identitas Aset & Pengguna (saat pemeriksaan)');
  kvGrid(doc, [
    ['Kode aset', r.asset_code_snapshot], ['Nama perangkat', r.hostname_snapshot],
    ['Jenis perangkat', r.device_type_snapshot], ['Brand / model', r.brand_model_snapshot],
    ['Pengguna PC', r.employee_name_snapshot ? `${r.employee_name_snapshot}${r.employee_nik_snapshot ? ` (${r.employee_nik_snapshot})` : ''}` : '-'], ['Departemen', r.department_snapshot],
    ['Unit kerja', r.work_unit_snapshot], ['Lokasi / ruangan', [r.location_snapshot, r.room_snapshot].filter(Boolean).join(' · R. ')],
  ]);

  section(doc, 'Pemeriksaan CPU');
  kvGrid(doc, [
    ['Suhu CPU', r.cpu_temp_c !== null ? `${h.fmtNum(r.cpu_temp_c)} °C` : 'Tidak dapat dibaca / tidak diperiksa'], ['Kondisi beban', r.cpu_load_condition],
    ['Alat ukur', r.cpu_reading_tool], ['Sumber', r.cpu_data_source],
  ]);

  section(doc, 'Pemeriksaan Storage (SSD / HDD)');
  const st = [...r.storages];
  if (r.ssd_presence === 'TIDAK_ADA') st.unshift({ storage_type: 'SSD', none: true });
  if (r.hdd_presence === 'TIDAK_ADA') st.push({ storage_type: 'HDD', none: true });
  ex.pdfTable(doc, [
    { header: 'Jenis', w: 0.8, value: (s) => (s.none ? s.storage_type : `${s.storage_type}${s.interface ? ` ${s.interface}` : ''}`) },
    { header: 'Merek / Model', w: 2, value: (s) => (s.none ? `Tidak ada ${s.storage_type} (tidak berlaku)` : [s.brand, s.model].filter(Boolean).join(' ') || '-') },
    { header: 'Kapasitas', w: 0.9, value: (s) => (s.none ? '-' : h.fmtCapacity(s.capacity_gb)) },
    { header: 'Suhu', w: 0.7, value: (s) => (s.none ? '-' : h.show(s.temperature_c, ' °C', 'Tdk diperiksa')) },
    { header: 'Health', w: 0.7, value: (s) => (s.none ? '-' : h.show(s.health_percent, '%', 'Tdk diperiksa')) },
    { header: 'Terpakai', w: 0.7, value: (s) => (s.none ? '-' : h.show(s.used_percent, '%', '-')) },
    { header: 'SMART', w: 0.9, value: (s) => (s.none ? '-' : s.smart_status || 'Tdk diperiksa') },
    { header: 'Evaluasi', w: 0.9, value: (s) => (s.none ? 'Tidak Berlaku' : LEVEL_LABEL[s.evaluated_level] || '-'), color: (s) => LEVEL_COLOR[s.evaluated_level] },
  ], st);

  section(doc, 'Pemeriksaan Baterai');
  const b = r.battery;
  if (!b || !b.is_applicable) {
    doc.font('R').fontSize(8.5).fillColor('#1B2240').text('Tidak Berlaku (perangkat tidak memiliki baterai).');
  } else {
    kvGrid(doc, [
      ['Battery health', h.show(b.health_percent, '%', 'Tidak diperiksa')], ['Status baterai', b.battery_status],
      ['Design capacity', h.show(b.design_capacity_mwh, ' mWh', '-')], ['Full charge capacity', h.show(b.full_charge_capacity_mwh, ' mWh', '-')],
      ['Cycle count', h.show(b.cycle_count, '', '-')], ['Catatan', b.notes],
    ]);
  }

  section(doc, 'Perawatan Fisik');
  ex.pdfTable(doc, [
    { header: 'No', w: 0.4, value: (x) => x._n },
    { header: 'Item pemeriksaan / perawatan', w: 3.2, key: 'task_name' },
    { header: 'Status', w: 1.3, value: (x) => x.status || 'Belum dikonfirmasi', color: (x) => (x.status === 'Belum dilakukan' || !x.status ? '#B42323' : x.status === 'Sudah dilakukan' ? '#13774A' : '#6B7393') },
    { header: 'Catatan', w: 2.2, key: 'notes' },
  ], r.tasks.map((x, i) => ({ ...x, _n: i + 1 })));
  kvGrid(doc, [['Kondisi fisik', r.physical_condition]], 2);

  section(doc, 'Catatan Preventive Maintenance');
  para(doc, 'Catatan', r.findings);
  para(doc, 'Keluhan pengguna', r.user_complaint);
  para(doc, 'Analisis penyebab', r.root_cause);
  para(doc, 'Tindakan yang dilakukan', r.actions_taken);
  para(doc, 'Rekomendasi IT', r.recommendation);
  para(doc, 'Kebutuhan spare part', r.spare_parts_needed);
  if (![r.user_complaint, r.findings, r.root_cause, r.actions_taken, r.recommendation, r.spare_parts_needed].some(Boolean)) doc.font('R').fontSize(8.5).text('-');

  section(doc, 'Kondisi Akhir & Evaluasi Sistem');
  kvGrid(doc, [
    ['Kondisi akhir (teknisi)', r.final_condition], ['Hasil evaluasi sistem', LEVEL_LABEL[r.evaluated_status]],
    ['Prioritas', r.priority], ['Status tindak lanjut', r.follow_up_status],
    ['PIC tindak lanjut', r.follow_up_pic], ['Target penyelesaian', h.fmtDate(r.follow_up_target_date)],
    ['Maintenance berikutnya', h.fmtDate(r.next_maintenance_date)], ['Persetujuan', `${r.approval_status}${r.approver_name ? ` oleh ${r.approver_name}` : ''}`],
  ]);
  const issues = (ev.items || []).filter((i) => ['KRITIS', 'PERHATIAN'].includes(i.level));
  if (issues.length || (ev.flags || []).length) {
    doc.moveDown(0.2);
    doc.font('S').fontSize(8).fillColor('#B42323').text('Parameter yang perlu perhatian:');
    for (const i of issues) doc.font('R').fontSize(8).fillColor('#1B2240').text(t(`• [${LEVEL_LABEL[i.level]}] ${i.scope ? `${i.scope} – ` : ''}${i.message}`));
    for (const f of ev.flags || []) doc.font('R').fontSize(8).fillColor('#946500').text(t(`• ${f.message}`));
  }
  if ((ev.recommendations || []).length) {
    doc.moveDown(0.2);
    doc.font('S').fontSize(8).fillColor('#22302A').text('Rekomendasi sistem:');
    for (const rc of ev.recommendations) doc.font('R').fontSize(8).fillColor('#1B2240').text(t(`• ${rc}`));
  }
  if (r.attachments && r.attachments.length) {
    doc.moveDown(0.2);
    doc.font('S').fontSize(8).fillColor('#6B7393').text(`Lampiran dokumentasi: ${r.attachments.length} file (tersimpan di sistem).`);
  }

  // Tanda tangan
  if (doc.y > doc.page.height - doc.page.margins.bottom - 120) doc.addPage();
  doc.moveDown(1.2);
  const x0 = doc.page.margins.left; const w = doc.page.width - x0 - doc.page.margins.right; const cw = w / 3; const y = doc.y;
  const sigs = [
    ['Dikerjakan oleh,', 'Petugas IT', r.technician_name, null],
    ['Diketahui oleh,', 'Pengguna PC', r.employee_name_snapshot, null],
    ['Disetujui oleh,', 'Manager IT', r.approver_name, r.approval_status === 'Disetujui' ? `Disetujui elektronik ${h.fmtDateTime(r.approved_at)}` : r.approval_status === 'Menunggu' ? 'Menunggu persetujuan' : null],
  ];
  sigs.forEach(([a, role, name, note], i) => {
    const x = x0 + i * cw;
    doc.font('R').fontSize(8).fillColor('#6B7393').text(t(a), x, y, { width: cw - 10, align: 'center' });
    doc.font('S').fontSize(8).fillColor('#1B2240').text(t(role), x, y + 11, { width: cw - 10, align: 'center' });
    if (note) doc.font('R').fontSize(7).fillColor(r.approval_status === 'Disetujui' ? '#13774A' : '#946500').text(t(note), x, y + 34, { width: cw - 10, align: 'center' });
    doc.save().moveTo(x + 20, y + 62).lineTo(x + cw - 30, y + 62).lineWidth(0.6).strokeColor('#9AA1BF').stroke().restore();
    doc.font('S').fontSize(8).fillColor('#1B2240').text(t(name || '(.............................)'), x, y + 66, { width: cw - 10, align: 'center' });
  });
  doc.y = y + 90; doc.x = x0;
  ex.pdfFooter(doc, user && user.full_name);
  return ex.pdfToBuffer(doc);
}

module.exports = { maintenanceReport };
