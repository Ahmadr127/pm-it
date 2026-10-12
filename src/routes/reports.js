'use strict';
const express = require('express');
const db = require('../config/db');
const config = require('../config');
const audit = require('../services/audit');
const R = require('../services/reports');
const exporter = require('../services/exporter');
const { technicians } = require('./maintenance');
const { lookups, locText } = require('./org');
const { can } = require('../middleware/auth');
const { isValidDate } = require('../utils/validate');
const h = require('../utils/helpers');

const router = express.Router();

function cleanQuery(q) {
  const out = { type: R.TYPES[q.type] ? q.type : 'hasil' };
  for (const k of ['from', 'to']) if (isValidDate(q[k] || '')) out[k] = q[k];
  for (const k of ['technician_user_id', 'department_id', 'work_unit_id', 'location_id', 'asset_id']) if (/^\d+$/.test(q[k] || '')) out[k] = q[k];
  if (q.asset_q) out.asset_q = String(q.asset_q).slice(0, 60);
  if (['Baik', 'Baik dengan catatan', 'Perlu Monitoring', 'Perlu Perbaikan', 'Kritis'].includes(q.final_condition)) out.final_condition = q.final_condition;
  if (['Terjadwal', 'Dalam Proses', 'Selesai', 'Ditunda'].includes(q.status)) out.status = q.status;
  if (['BAIK', 'PERHATIAN', 'KRITIS', 'TIDAK_TERSEDIA'].includes(q.storage_status)) out.storage_status = q.storage_status;
  if (q.include_attention === '1') out.include_attention = '1';
  if (!out.from && !out.to && ['hasil', 'ringkasan'].includes(out.type) && !q.all) { out.from = `${h.today().slice(0, 7)}-01`; out.to = h.today(); }
  return out;
}

async function names(q) {
  const n = {};
  if (q.technician_user_id) n.technician_user_id = (await db.one('SELECT full_name x FROM users WHERE id=?', [q.technician_user_id]) || {}).x;
  if (q.department_id) n.department_id = (await db.one('SELECT name x FROM departments WHERE id=?', [q.department_id]) || {}).x;
  if (q.work_unit_id) n.work_unit_id = (await db.one('SELECT name x FROM work_units WHERE id=?', [q.work_unit_id]) || {}).x;
  if (q.location_id) { const l = await db.one('SELECT * FROM locations WHERE id=?', [q.location_id]); n.location_id = l ? locText(l) : null; }
  return n;
}

router.get('/', can('report.view'), async (req, res) => {
  const q = cleanQuery(req.query);
  const [report, techs, lk, units] = await Promise.all([
    R.run(q.type, q), technicians(), lookups(),
    db.query('SELECT w.id, w.name, d.name AS department_name FROM work_units w JOIN departments d ON d.id=w.department_id WHERE w.deleted_at IS NULL ORDER BY d.name, w.name'),
  ]);
  const total = report.rows.length;
  const { page, per, offset } = h.paging(req.query, 50);
  res.render('reports/index', {
    title: 'Laporan', q, report, rows: report.rows.slice(offset, offset + per), pg: { page, per, total }, techs, ...lk, units, locText,
    TYPES: R.TYPES, filterLabel: R.filterText(q, await names(q)), exportQuery: h.buildQuery(q, {}),
  });
});

router.get('/export', can('report.export'), async (req, res) => {
  const q = cleanQuery(req.query);
  const fmt = ['pdf', 'xlsx', 'csv'].includes(req.query.fmt) ? req.query.fmt : 'pdf';
  const report = await R.run(q.type, q);
  const filters = R.filterText(q, await names(q));
  const name = `laporan-${q.type}-${h.today()}.${fmt}`;
  await audit.log(req, 'EXPORT', { entity: 'reports', description: `${report.title} (${fmt}, ${report.rows.length} baris) — ${filters}` });
  const cols = report.columns.map((c) => ({ ...c, width: Math.round((c.w || 1) * 16) }));
  if (fmt === 'csv') return exporter.send(res, exporter.toCsv(cols, report.rows), name, 'csv');
  if (fmt === 'xlsx') {
    return exporter.send(res, await exporter.toXlsx([{ name: report.title.slice(0, 31), title: report.title, columns: cols, rows: report.rows }], { filters, by: req.user.full_name }), name, 'xlsx');
  }
  const doc = exporter.newPdf({ landscape: true, title: report.title });
  exporter.pdfHeader(doc, report.title.toUpperCase(), config.companyName);
  doc.font('R').fontSize(8).fillColor('#6B7393').text(exporter.pdfText(`Filter: ${filters}`)); doc.moveDown(0.3);
  if (report.summary && report.summary.length) { doc.font('S').fontSize(8.5).fillColor('#1B2240').text(exporter.pdfText(report.summary.join('   |   '))); doc.moveDown(0.4); }
  exporter.pdfTable(doc, report.columns, report.rows, { fontSize: report.columns.length > 10 ? 6.6 : 7.5 });
  if (report.signature) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 100) doc.addPage();
    doc.moveDown(1);
    const x0 = doc.page.margins.left; const w = doc.page.width - x0 - doc.page.margins.right; const y = doc.y;
    [['Dibuat oleh,', req.user.full_name], ['Diperiksa / disetujui,', 'Manager IT']].forEach(([a, b], i) => {
      const x = x0 + w - (2 - i) * 220;
      doc.font('R').fontSize(8).fillColor('#6B7393').text(a, x, y, { width: 200, align: 'center' });
      doc.save().moveTo(x + 20, y + 52).lineTo(x + 180, y + 52).lineWidth(0.6).strokeColor('#9AA1BF').stroke().restore();
      doc.font('S').fontSize(8).fillColor('#1B2240').text(exporter.pdfText(i === 0 ? b : '(.............................)'), x, y + 56, { width: 200, align: 'center' });
      if (i === 1) doc.font('R').fontSize(7).fillColor('#6B7393').text(b, x, y + 68, { width: 200, align: 'center' });
    });
    doc.y = y + 85; doc.x = x0;
  }
  exporter.pdfFooter(doc, req.user.full_name);
  return exporter.send(res, await exporter.pdfToBuffer(doc), name, 'pdf');
});

module.exports = router;
