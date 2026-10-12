'use strict';
const express = require('express');
const db = require('../config/db');
const audit = require('../services/audit');
const A = require('../services/assets');
const M = require('../services/maintenance');
const Q = require('../services/quickAsset');
const uploads = require('../services/uploads');
const notifications = require('../services/notifications');
const settings = require('../services/settings');
const printing = require('../services/printing');
const exporter = require('../services/exporter');
const { lookups, locText } = require('./org');
const { can, has, wantsJson } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');
const h = require('../utils/helpers');

const router = express.Router();
const notFound = () => Object.assign(new Error('Data maintenance tidak ditemukan.'), { status: 404 });

async function technicians() {
  return db.query(`SELECT u.id, u.full_name, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
                    WHERE u.is_active=1 AND u.deleted_at IS NULL AND r.code IN ('IT_STAFF','MANAGER_IT','ADMIN') ORDER BY u.full_name`);
}

function canEdit(user, rec) {
  if (rec.status === 'Selesai') return has(user, 'maintenance.edit_completed');
  return has(user, 'maintenance.update') || (has(user, 'maintenance.create') && rec.created_by === user.id);
}

// ---------------- Daftar ----------------
const SORTS = { no: 'r.maintenance_no', date: 'r.maintenance_date', asset: 'r.asset_code_snapshot', tech: 'u.full_name', status: 'r.status',
  final: "FIELD(r.final_condition,'Kritis','Perlu Perbaikan','Perlu Monitoring','Baik dengan catatan','Baik')", eval: "FIELD(r.evaluated_status,'KRITIS','PERHATIAN','BAIK','BELUM_DIEVALUASI')", dept: 'r.department_snapshot' };

function listFilters(q) {
  const where = ['r.deleted_at IS NULL']; const params = [];
  if (q.q) { const like = `%${h.likeEscape(q.q.trim())}%`; where.push('(r.maintenance_no LIKE ? OR r.asset_code_snapshot LIKE ? OR r.hostname_snapshot LIKE ? OR r.employee_name_snapshot LIKE ?)'); params.push(like, like, like, like); }
  if (q.from) { where.push('r.maintenance_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('r.maintenance_date <= ?'); params.push(q.to); }
  const eq = { technician_user_id: 'r.technician_user_id', department_id: 'r.department_id', work_unit_id: 'r.work_unit_id', status: 'r.status',
    final_condition: 'r.final_condition', evaluated_status: 'r.evaluated_status', approval: 'r.approval_status', asset_id: 'r.asset_id' };
  for (const [k, col] of Object.entries(eq)) if (q[k]) { where.push(`${col} = ?`); params.push(q[k]); }
  return { where: where.join(' AND '), params };
}

router.get('/', can('maintenance.view'), async (req, res) => {
  const { page, per, offset } = h.paging(req.query);
  const s = h.sorting(req.query, SORTS, 'date', 'desc');
  const f = listFilters(req.query);
  const from = 'FROM maintenance_records r LEFT JOIN users u ON u.id=r.technician_user_id';
  const [[{ total }], rows, techs, lk, units] = await Promise.all([
    db.query(`SELECT COUNT(*) total ${from} WHERE ${f.where}`, f.params),
    db.query(`SELECT r.*, u.full_name AS technician ${from} WHERE ${f.where} ORDER BY ${s.sql}, r.id DESC LIMIT ? OFFSET ?`, [...f.params, per, offset]),
    technicians(), lookups(),
    db.query('SELECT w.id, w.name, d.name AS department_name FROM work_units w JOIN departments d ON d.id=w.department_id WHERE w.deleted_at IS NULL ORDER BY d.name, w.name'),
  ]);
  res.render('maintenance/index', { title: 'Preventive Maintenance', rows, pg: { page, per, total }, techs, ...lk, units, M });
});

// ---------------- Form ----------------
async function formPage(req, res, { record = null, assetId = null, scheduleId = null }) {
  const techs = await technicians();
  let ctx = null;
  const aid = record ? record.asset_id : assetId;
  if (aid) ctx = await A.maintenanceContext(aid);
  const deviceType = ctx ? ctx.device_type : null;
  const allTasks = await db.query('SELECT * FROM task_definitions WHERE is_active=1 ORDER BY sort_order, id');
  let schedule = null;
  if (!record && scheduleId) schedule = await db.one("SELECT * FROM maintenance_schedules WHERE id=? AND deleted_at IS NULL AND status IN ('Terjadwal','Ditunda','Dalam Proses')", [scheduleId]);
  if (!record && !schedule && ctx) schedule = await db.one("SELECT * FROM maintenance_schedules WHERE asset_id=? AND deleted_at IS NULL AND status IN ('Terjadwal','Ditunda','Dalam Proses') ORDER BY scheduled_date LIMIT 1", [ctx.id]);
  const cfg = await settings.all();
  // Data pilihan untuk mode "Perangkat baru" (registrasi aset langsung dari form)
  let reg = null;
  if (!record && has(req.user, 'asset.create')) {
    const [departments, units, locations, employees, [{ n }]] = await Promise.all([
      db.query('SELECT name FROM departments WHERE deleted_at IS NULL AND is_active=1 ORDER BY name'),
      db.query('SELECT DISTINCT w.name FROM work_units w WHERE w.deleted_at IS NULL AND w.is_active=1 ORDER BY w.name'),
      db.query('SELECT DISTINCT name FROM locations WHERE deleted_at IS NULL AND is_active=1 ORDER BY name'),
      db.query("SELECT full_name, nik FROM employees WHERE deleted_at IS NULL AND status<>'Tidak Aktif' ORDER BY full_name LIMIT 2000"),
      db.query('SELECT COUNT(*) n FROM assets WHERE deleted_at IS NULL'),
    ]);
    reg = { departments, units, locations, employees, startNew: !ctx && (req.query.mode === 'new' || Number(n) === 0) };
  }
  res.render('maintenance/form', {
    title: record ? `Ubah Maintenance ${record.maintenance_no}` : 'Form Preventive Maintenance',
    record, ctx, techs, allTasks, deviceType, schedule, M, A, cfg, reg,
    defaults: { maintenance_date: h.today(), check_time: h.nowTime(), technician_user_id: req.user.id },
  });
}

router.get('/new', can('maintenance.create'), async (req, res) => {
  await formPage(req, res, { assetId: /^\d+$/.test(req.query.asset_id || '') ? req.query.asset_id : null, scheduleId: /^\d+$/.test(req.query.schedule_id || '') ? req.query.schedule_id : null });
});

router.get('/:id/edit', can('maintenance.create', 'maintenance.update'), async (req, res) => {
  const record = await M.loadRecord(req.params.id);
  if (!record) throw notFound();
  if (!canEdit(req.user, record)) throw Object.assign(new Error(record.status === 'Selesai' ? 'Maintenance yang sudah Selesai hanya dapat diubah oleh Administrator.' : 'Anda tidak berhak mengubah data ini.'), { status: 403 });
  await formPage(req, res, { record });
});

async function handleSave(req, res, existing) {
  const action = ['draft', 'save', 'complete', 'save_print', 'complete_print'].includes(req.body.action) ? req.body.action : 'save';
  const printAfter = action === 'save_print' || action === 'complete_print';
  // Mode "Perangkat baru": PC belum ada di Master Aset -> didaftarkan otomatis saat maintenance disimpan
  const newMode = !existing && req.body.asset_mode === 'new';
  let asset; let na = null;
  if (newMode) {
    if (!has(req.user, 'asset.create')) { uploads.removeTemp(req.files); throw Object.assign(new Error('Anda tidak berhak mendaftarkan perangkat baru. Minta admin menambahkan aset terlebih dahulu.'), { status: 403 }); }
    na = await Q.check(req.body.na);
    asset = Q.pseudoAsset(na.data);
  } else {
    const assetId = existing ? existing.asset_id : Number(req.body.asset_id);
    if (!assetId) { uploads.removeTemp(req.files); throw new ValidationError({ asset_id: 'Perangkat wajib dipilih (atau gunakan "Daftarkan perangkat baru" bila PC belum terdaftar).' }); }
    asset = await db.one('SELECT * FROM assets WHERE id=? AND deleted_at IS NULL', [assetId]);
    if (!asset) { uploads.removeTemp(req.files); throw new ValidationError({ asset_id: 'Aset tidak ditemukan.' }); }
  }
  const taskDefs = await M.taskDefinitions(asset.device_type);
  const parsed = await M.parse(req.body, { save_print: 'save', complete_print: 'complete' }[action] || action, asset, taskDefs);
  if (na) Object.assign(parsed.errors, na.errors);
  // Kolom lama yang tidak lagi ada di form: pertahankan nilai record lama (tidak terhapus saat diubah)
  if (existing) {
    for (const k of ['user_complaint', 'root_cause', 'actions_taken', 'recommendation', 'spare_parts_needed', 'follow_up_pic', 'follow_up_target_date', 'next_maintenance_date']) {
      if (!(k in req.body)) parsed.data[k] = existing[k] ?? null;
    }
  }
  if (existing && existing.status === 'Selesai' && parsed.data.status === 'Draft') parsed.errors.status = 'Maintenance yang sudah Selesai tidak dapat dikembalikan menjadi Draft.';
  if (Object.keys(parsed.errors).length) { uploads.removeTemp(req.files); throw new ValidationError(parsed.errors); }

  // Konfirmasi bila kondisi perangkat memerlukan tindak lanjut
  if (parsed.data.status !== 'Draft' && req.body.confirm_followup !== '1') {
    const ev = await M.preview(asset, parsed, existing && existing.id);
    if (ev.needs_follow_up) {
      uploads.removeTemp(req.files);
      const payload = {
        ok: false, needs_confirmation: true,
        message: 'Kondisi perangkat memerlukan tindak lanjut. Periksa ringkasan evaluasi lalu konfirmasi penyimpanan.',
        evaluation: { overall: ev.overall, overall_label: ev.overall_label, priority: ev.priority,
          issues: ev.items.filter((i) => ['KRITIS', 'PERHATIAN'].includes(i.level)).map((i) => ({ level: i.level, text: `${i.scope ? `${i.scope}: ` : ''}${i.message}` })),
          flags: ev.flags.map((f) => f.message), recommendations: ev.recommendations },
      };
      if (wantsJson(req)) return res.status(200).json(payload);
      throw new ValidationError({ confirm_followup: payload.message });
    }
  }

  let reg = null;
  const prepare = newMode ? async (t) => { const r = await Q.register(t, req, na.data, parsed); reg = r.info; return r.asset; } : null;
  const result = await M.save({ req, asset, parsed, files: req.files, existing, prepare });
  const statusMsg = { Draft: 'disimpan sebagai Draft', Selesai: 'ditandai Selesai' }[parsed.data.status] || `disimpan (${parsed.data.status})`;
  const extra = [];
  if (result.followUpId) extra.push('tindak lanjut dibuat otomatis');
  if (result.nextSchedule && parsed.data.status === 'Selesai') extra.push(`jadwal berikutnya ${h.fmtDate(result.nextSchedule.date)}`);
  let msg = `Maintenance ${result.maintenance_no} ${statusMsg}${extra.length ? ` — ${extra.join(', ')}` : ''}.`;
  if (reg) msg += ` Perangkat ${reg.asset_code} otomatis terdaftar di Master Aset PC${reg.created.length ? ` (baru: ${reg.created.join(', ')})` : ''}.`;
  return res.done(msg, `/maintenance/${result.id}${printAfter ? '?print=1' : ''}`);
}

router.post('/', can('maintenance.create'), uploads.maintenanceUpload, async (req, res) => {
  if (req.files && Object.keys(req.files).length && !has(req.user, 'attachment.upload')) { uploads.removeTemp(req.files); throw Object.assign(new Error('Anda tidak berhak mengunggah dokumentasi.'), { status: 403 }); }
  await handleSave(req, res, null);
});

router.post('/:id', can('maintenance.create', 'maintenance.update'), uploads.maintenanceUpload, async (req, res) => {
  const existing = await db.one('SELECT * FROM maintenance_records WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) { uploads.removeTemp(req.files); throw notFound(); }
  if (!canEdit(req.user, existing)) { uploads.removeTemp(req.files); throw Object.assign(new Error('Maintenance yang sudah Selesai hanya dapat diubah oleh pengguna dengan izin khusus.'), { status: 403 }); }
  if (req.files && Object.keys(req.files).length && !has(req.user, 'attachment.upload')) { uploads.removeTemp(req.files); throw Object.assign(new Error('Anda tidak berhak mengunggah dokumentasi.'), { status: 403 }); }
  await handleSave(req, res, existing);
});

// ---------------- Detail ----------------
router.get('/:id', can('maintenance.view'), async (req, res) => {
  const r = await M.loadRecord(req.params.id);
  if (!r) throw notFound();
  const SP = require('./spareparts');
  const canSpare = has(req.user, 'sparepart.manage');
  const [followUps, repairs, techs, spareUsed, spareOptions] = await Promise.all([
    db.query('SELECT f.*, u.full_name AS pic FROM follow_up_actions f LEFT JOIN users u ON u.id=f.pic_user_id WHERE f.maintenance_record_id=? AND f.deleted_at IS NULL', [r.id]),
    db.query('SELECT * FROM repair_records WHERE maintenance_record_id=? AND deleted_at IS NULL', [r.id]),
    technicians(),
    has(req.user, 'sparepart.view') ? SP.forRecord(r.id) : [],
    canSpare ? SP.options() : [],
  ]);
  res.render('maintenance/show', { title: `Maintenance ${r.maintenance_no}`, r, followUps, repairs, techs, spareUsed, spareOptions, canSpare, canEditRec: canEdit(req.user, r), autoPrint: req.query.print === '1' });
});

router.get('/:id/print', can('maintenance.view'), async (req, res) => {
  const r = await M.loadRecord(req.params.id);
  if (!r) throw notFound();
  const buf = await printing.maintenanceReport(r, req.user);
  await audit.log(req, 'PRINT', { entity: 'maintenance_records', id: r.id, description: `Cetak laporan ${r.maintenance_no}` });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="Laporan-${r.maintenance_no}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
});

// ---------------- Persetujuan ----------------
router.post('/:id/approve', can('maintenance.approve'), async (req, res) => {
  const v = validate(req.body, {
    decision: { label: 'Keputusan', type: 'enum', values: ['Disetujui', 'Ditolak'], required: true },
    approval_notes: { label: 'Catatan', maxLength: 500 },
  });
  if (v.data.decision === 'Ditolak' && !v.data.approval_notes) v.errors.approval_notes = 'Alasan penolakan wajib diisi.';
  if (Object.keys(v.errors).length) throw new ValidationError(v.errors);
  const r = await db.one('SELECT id, maintenance_no, status, approval_status FROM maintenance_records WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!r) throw notFound();
  if (r.status !== 'Selesai') throw new ValidationError({ decision: 'Hanya maintenance berstatus Selesai yang dapat ditinjau.' });
  await db.transaction(async (t) => {
    await t.query(`UPDATE maintenance_records SET approval_status=?, approved_by=?, approved_at=NOW(), approval_notes=?, status=IF(?='Ditolak','Dalam Proses',status) WHERE id=?`,
      [v.data.decision, req.user.id, v.data.approval_notes, v.data.decision, r.id]);
    await audit.log(req, v.data.decision === 'Disetujui' ? 'APPROVE' : 'REJECT', { entity: 'maintenance_records', id: r.id, description: `${r.maintenance_no} ${v.data.decision.toLowerCase()}`, after: v.data }, t);
  });
  notifications.clear();
  res.done(v.data.decision === 'Disetujui' ? `Maintenance ${r.maintenance_no} disetujui.` : `Maintenance ${r.maintenance_no} ditolak dan dikembalikan ke teknisi untuk revisi.`, `/maintenance/${r.id}`);
});

// ---------------- Hapus ----------------
router.post('/:id/delete', can('maintenance.delete'), async (req, res) => {
  const r = await db.one('SELECT id, maintenance_no, asset_id, status FROM maintenance_records WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!r) throw notFound();
  await db.transaction(async (t) => {
    await t.query('UPDATE maintenance_records SET deleted_at=NOW(), updated_by=? WHERE id=?', [req.user.id, r.id]);
    await t.query("UPDATE maintenance_schedules SET status='Terjadwal', maintenance_record_id=NULL WHERE maintenance_record_id=? AND status<>'Selesai'", [r.id]);
    await audit.log(req, 'DELETE', { entity: 'maintenance_records', id: r.id, description: `${r.maintenance_no} dihapus (soft delete)` }, t);
  });
  notifications.clear();
  res.done(`Maintenance ${r.maintenance_no} dihapus.`, '/maintenance');
});

router.post('/:id/attachments/:aid/delete', can('maintenance.update', 'attachment.upload'), async (req, res) => {
  const rec = await db.one('SELECT * FROM maintenance_records WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!rec) throw notFound();
  if (!canEdit(req.user, rec)) throw Object.assign(new Error('Lampiran pada maintenance Selesai hanya dapat dihapus oleh pengguna berizin.'), { status: 403 });
  const a = await db.one('SELECT id, original_name FROM maintenance_attachments WHERE id=? AND maintenance_record_id=? AND deleted_at IS NULL', [req.params.aid, rec.id]);
  if (!a) throw Object.assign(new Error('Lampiran tidak ditemukan.'), { status: 404 });
  await db.query('UPDATE maintenance_attachments SET deleted_at=NOW() WHERE id=?', [a.id]);
  await audit.log(req, 'DELETE', { entity: 'maintenance_attachments', id: a.id, description: `Lampiran ${a.original_name} dihapus dari ${rec.maintenance_no}` });
  res.done('Lampiran dihapus.', `/maintenance/${rec.id}/edit#dokumentasi`);
});

// ---------------- Ekspor daftar ----------------
router.get('/export/list.:fmt', can('report.export'), async (req, res) => {
  if (!['csv', 'xlsx'].includes(req.params.fmt)) throw notFound();
  const f = listFilters(req.query);
  const rows = await db.query(`SELECT r.*, u.full_name AS technician FROM maintenance_records r LEFT JOIN users u ON u.id=r.technician_user_id WHERE ${f.where} ORDER BY r.maintenance_date DESC`, f.params);
  const cols = [
    { header: 'No. Maintenance', key: 'maintenance_no' }, { header: 'Tanggal', key: 'maintenance_date', type: 'date' }, { header: 'Kode Aset', key: 'asset_code_snapshot' },
    { header: 'Hostname', key: 'hostname_snapshot' }, { header: 'Pengguna', key: 'employee_name_snapshot' }, { header: 'Departemen', key: 'department_snapshot' },
    { header: 'Teknisi', key: 'technician' }, { header: 'Status', key: 'status' }, { header: 'Kondisi Akhir', key: 'final_condition' },
    { header: 'Evaluasi', value: (r) => h.STATUS_BADGE[r.evaluated_status][1] }, { header: 'Suhu CPU (°C)', key: 'cpu_temp_c', type: 'number' },
  ];
  const name = `maintenance-${h.today()}.${req.params.fmt}`;
  if (req.params.fmt === 'csv') return exporter.send(res, exporter.toCsv(cols, rows), name, 'csv');
  return exporter.send(res, await exporter.toXlsx([{ name: 'Maintenance', title: 'Daftar Maintenance', columns: cols, rows }], { by: req.user.full_name }), name, 'xlsx');
});

module.exports = router;
module.exports.technicians = technicians;
module.exports.locText = locText;
