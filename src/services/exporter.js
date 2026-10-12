'use strict';
/**
 * Ekspor data: CSV (pengolahan data), Excel (rekapitulasi), PDF (laporan resmi).
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const config = require('../config');
const h = require('../utils/helpers');

const LOGO = path.join(__dirname, '..', '..', 'public', 'img', 'logo-azra.png');

const FONT_DIR = path.join(config.root, 'node_modules', '@fontsource', 'plus-jakarta-sans', 'files');
const FONTS = {
  regular: path.join(FONT_DIR, 'plus-jakarta-sans-latin-400-normal.woff'),
  semibold: path.join(FONT_DIR, 'plus-jakarta-sans-latin-600-normal.woff'),
  bold: path.join(FONT_DIR, 'plus-jakarta-sans-latin-700-normal.woff'),
};

function cellValue(col, row) {
  const v = typeof col.value === 'function' ? col.value(row) : row[col.key];
  return v === undefined ? null : v;
}

// ---------------- CSV ----------------
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // cegah CSV/formula injection
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvEscape(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(cellValue(c, r))).join(','));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8'); // BOM agar Excel membaca UTF-8 dengan benar
}

// ---------------- Excel ----------------
async function toXlsx(sheets, meta = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = config.appName;
  wb.created = new Date();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: sh.title ? 4 : 1 }] });
    let headerRow = 1;
    if (sh.title) {
      ws.mergeCells(1, 1, 1, Math.max(sh.columns.length, 1));
      ws.getCell(1, 1).value = sh.title;
      ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF22302A' } };
      ws.getCell(2, 1).value = [config.companyName, meta.filters].filter(Boolean).join(' · ');
      ws.getCell(2, 1).font = { size: 9, color: { argb: 'FF6B7393' } };
      ws.getCell(3, 1).value = `Dicetak: ${h.fmtDateTime(h.nowDateTime())}${meta.by ? ` oleh ${meta.by}` : ''}`;
      ws.getCell(3, 1).font = { size: 9, color: { argb: 'FF6B7393' } };
      headerRow = 4;
    }
    const hr = ws.getRow(headerRow);
    sh.columns.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF22302A' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      ws.getColumn(i + 1).width = c.width || Math.min(Math.max(String(c.header).length + 4, 12), 40);
    });
    hr.height = 22;
    for (const r of sh.rows) {
      const values = sh.columns.map((c) => {
        const v = cellValue(c, r);
        if (v === null) return null;
        if (c.type === 'number' && v !== '' && !isNaN(Number(v))) return Number(v);
        if (c.type === 'date' && v) return String(v).slice(0, 10);
        return typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v;
      });
      const row = ws.addRow(values);
      row.alignment = { vertical: 'top', wrapText: true };
    }
    if (sh.rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: sh.columns.length } };
    if (!sh.rows.length) ws.addRow(['(Tidak ada data untuk filter ini)']);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function send(res, buf, filename, type) {
  const types = {
    csv: 'text/csv; charset=utf-8',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pdf: 'application/pdf',
  };
  res.setHeader('Content-Type', types[type]);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
}

// ---------------- PDF ----------------
function pdfText(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/÷/g, '/').replace(/[—–]/g, '-').replace(/…/g, '...').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

function newPdf({ landscape = false, title = 'Laporan' } = {}) {
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: { top: 40, bottom: 50, left: 36, right: 36 }, bufferPages: true, info: { Title: title, Author: config.companyName, Creator: config.appName } });
  try {
    doc.registerFont('R', FONTS.regular); doc.registerFont('S', FONTS.semibold); doc.registerFont('B', FONTS.bold);
  } catch (_) {
    doc.registerFont('R', 'Helvetica'); doc.registerFont('S', 'Helvetica-Bold'); doc.registerFont('B', 'Helvetica-Bold');
  }
  doc.font('R');
  return doc;
}

function pdfHeader(doc, title, subtitle) {
  const x = doc.page.margins.left; const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.save().roundedRect(x, doc.y, w, 54, 8).fill('#22302A').restore();
  const y0 = doc.y;
  // Logo instansi (kotak putih di kanan header)
  let logoW = 0;
  if (fs.existsSync(LOGO)) {
    logoW = 104;
    doc.save().roundedRect(x + w - logoW - 8, y0 + 7, logoW, 40, 6).fill('#FFFFFF').restore();
    try { doc.image(LOGO, x + w - logoW - 2, y0 + 11, { fit: [logoW - 12, 32], align: 'center', valign: 'center' }); } catch (_) { /* abaikan */ }
  }
  doc.save().rect(x + 8, y0 + 51, w - 16, 3).fill('#82BE42').restore();
  doc.fillColor('#FFFFFF').font('B').fontSize(13).text(pdfText(title), x + 14, y0 + 11, { width: w - 28 - logoW });
  doc.font('R').fontSize(8.5).fillColor('#CFE3D3').text(pdfText(subtitle || config.companyName), x + 14, y0 + 31, { width: w - 28 - logoW });
  doc.y = y0 + 66; doc.x = x;
  doc.fillColor('#1B2240');
}

function pdfFooter(doc, by) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - 32;
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('R').fontSize(7.5).fillColor('#6B7393');
    doc.text(pdfText(`${config.appName} · ${config.companyName} · Dicetak ${h.fmtDateTime(h.nowDateTime())}${by ? ` oleh ${by}` : ''}`), doc.page.margins.left, bottom, { lineBreak: false });
    const label = `Halaman ${i + 1} dari ${range.count}`;
    doc.text(label, doc.page.width - doc.page.margins.right - doc.widthOfString(label), bottom, { lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
}

/** Tabel dengan header berulang per halaman & tinggi baris otomatis. */
function pdfTable(doc, columns, rows, { fontSize = 7.5, zebra = true } = {}) {
  const x0 = doc.page.margins.left;
  const totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const weights = columns.map((c) => c.w || 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / sum) * totalW);
  const pad = 4;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 10;

  const drawHeader = () => {
    doc.font('S').fontSize(fontSize);
    const hh = Math.max(...columns.map((c, i) => doc.heightOfString(pdfText(c.header), { width: widths[i] - pad * 2 }))) + pad * 2;
    doc.save().rect(x0, doc.y, totalW, hh).fill('#EEF6E4').restore();
    let x = x0; const y = doc.y;
    columns.forEach((c, i) => { doc.fillColor('#2F5E17').text(pdfText(c.header), x + pad, y + pad, { width: widths[i] - pad * 2, align: c.align || 'left' }); x += widths[i]; });
    doc.y = y + hh; doc.fillColor('#1B2240');
  };
  drawHeader();
  if (!rows.length) {
    doc.font('R').fontSize(8).fillColor('#6B7393').text('Tidak ada data untuk filter yang dipilih.', x0 + pad, doc.y + 8);
    doc.moveDown(); return;
  }
  rows.forEach((r, idx) => {
    doc.font('R').fontSize(fontSize);
    const texts = columns.map((c) => pdfText(cellValue(c, r) ?? '-'));
    const rh = Math.max(...texts.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i] - pad * 2 }))) + pad * 2;
    if (doc.y + rh > bottomLimit()) { doc.addPage(); drawHeader(); doc.font('R').fontSize(fontSize); }
    const y = doc.y;
    if (zebra && idx % 2 === 1) doc.save().rect(x0, y, totalW, rh).fill('#F7F8FC').restore();
    let x = x0;
    texts.forEach((t, i) => {
      const col = columns[i];
      doc.fillColor(col.color ? col.color(r) || '#1B2240' : '#1B2240').text(t, x + pad, y + pad, { width: widths[i] - pad * 2, align: col.align || 'left' });
      x += widths[i];
    });
    doc.save().moveTo(x0, y + rh).lineTo(x0 + totalW, y + rh).lineWidth(0.4).strokeColor('#E6E8F2').stroke().restore();
    doc.y = y + rh;
  });
  doc.x = x0;
  doc.moveDown(0.6);
}

function pdfToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Laporan tabel lengkap siap kirim. */
async function tablePdf({ title, subtitle, filters, columns, rows, landscape = true, by, summary }) {
  const doc = newPdf({ landscape, title });
  pdfHeader(doc, title, subtitle);
  if (filters) { doc.font('R').fontSize(8).fillColor('#6B7393').text(pdfText(`Filter: ${filters}`)); doc.moveDown(0.4); }
  if (summary && summary.length) {
    doc.font('S').fontSize(8.5).fillColor('#1B2240').text(pdfText(summary.join('   |   ')));
    doc.moveDown(0.5);
  }
  pdfTable(doc, columns, rows);
  pdfFooter(doc, by);
  return pdfToBuffer(doc);
}

module.exports = { toCsv, toXlsx, send, tablePdf, newPdf, pdfHeader, pdfFooter, pdfTable, pdfToBuffer, pdfText };
