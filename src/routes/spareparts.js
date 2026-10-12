'use strict';
/**
 * Stok spare part sederhana.
 *  - Daftar barang + stok, peringatan stok menipis (stok <= stok minimum)
 *  - Stok masuk, pemakaian (keluar, dapat dikaitkan ke PC / laporan maintenance), koreksi hasil hitung fisik
 *  - Setiap perubahan stok tercatat di riwayat (tidak dapat diubah), stok tidak pernah minus
 */
const express = require('express');
const db = require('../config/db');
const audit = require('../services/audit');
const notifications = require('../services/notifications');
const { can, has } = require('../middleware/auth');
const { validate, ValidationError } = require('../utils/validate');
const h = require('../utils/helpers');

const router = express.Router();
const TYPES = { MASUK: 'Stok masuk', KELUAR: 'Dipakai / keluar', KOREKSI: 'Koreksi stok' };
const CATEGORIES = ['Bahan perawatan', 'Komponen PC', 'Storage', 'Memori (RAM)', 'Periferal', 'Kabel & adaptor', 'Lainnya'];
const fail = (message, status = 422) => Object.assign(new Error(message), { status });

const partSchema = {
  name: { label: 'Nama barang', required: true, maxLength: 150 },
  category: { label: 'Kategori', maxLength: 80 },
  unit: { label: 'Satuan', maxLength: 20 },
  min_stock: { label: 'Stok minimum', type: 'int', min: 0, max: 100000 },
  notes: { label: 'Catatan', maxLength: 255 },
};

router.get('/', can('sparepart.view'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = req.query.filter === 'menipis' ? 'menipis' : '';
  const where = ['p.deleted_at IS NULL']; const params = [];
  if (q) { where.push('(p.name LIKE ? OR COALESCE(p.category,\'\') LIKE ?)'); params.push(`%${h.likeEscape(q)}%`, `%${h.likeEscape(q)}%`); }
  if (filter) where.push('p.stock <= p.min_stock');
  const [parts, stats, recent] = await Promise.all([
    db.query(`SELECT p.*, (SELECT MAX(m.created_at) FROM spare_part_movements m WHERE m.spare_part_id=p.id AND m.movement_type='KELUAR') AS last_used
                FROM spare_parts p WHERE ${where.join(' AND ')} ORDER BY (p.stock <= p.min_stock) DESC, p.name`, params),
    db.one(`SELECT COUNT(*) total, SUM(stock <= min_stock AND stock > 0) low, SUM(stock = 0) empty FROM spare_parts WHERE deleted_at IS NULL`),
    db.query(`SELECT m.*, p.name, p.unit, a.asset_code, a.hostname, u.full_name AS user_name, r.maintenance_no
                FROM spare_part_movements m JOIN spare_parts p ON p.id=m.spare_part_id
                LEFT JOIN assets a ON a.id=m.asset_id LEFT JOIN users u ON u.id=m.created_by LEFT JOIN maintenance_records r ON r.id=m.maintenance_record_id
               ORDER BY m.id DESC LIMIT 12`),
  ]);
  res.render('spareparts/index', { title: 'Stok Spare Part', parts, stats, recent, q, filter, TYPES, CATEGORIES, manage: has(req.user, 'sparepart.manage') });
});

router.get('/:id', can('sparepart.view'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const p = await db.one('SELECT * FROM spare_parts WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!p) throw fail('Spare part tidak ditemukan.', 404);
  const moves = await db.query(`SELECT m.*, a.asset_code, a.hostname, u.full_name AS user_name, r.maintenance_no
      FROM spare_part_movements m LEFT JOIN assets a ON a.id=m.asset_id LEFT JOIN users u ON u.id=m.created_by
      LEFT JOIN maintenance_records r ON r.id=m.maintenance_record_id WHERE m.spare_part_id=? ORDER BY m.id DESC LIMIT 300`, [p.id]);
  res.render('spareparts/show', { title: p.name, p, moves, TYPES, CATEGORIES, manage: has(req.user, 'sparepart.manage') });
});

router.post('/', can('sparepart.manage'), async (req, res) => {
  const v = validate(req.body, { ...partSchema, stock: { label: 'Stok awal', type: 'int', min: 0, max: 100000 } });
  if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  const dup = await db.one('SELECT id FROM spare_parts WHERE name=? AND deleted_at IS NULL', [d.name]);
  if (dup) throw new ValidationError({ name: `"${d.name}" sudah ada di daftar. Gunakan tombol Stok masuk untuk menambah jumlahnya.` });
  const stock = d.stock || 0;
  const id = await db.transaction(async (t) => {
    const r = await t.query('INSERT INTO spare_parts (name, category, unit, stock, min_stock, notes) VALUES (?,?,?,?,?,?)',
      [d.name, d.category, d.unit || 'pcs', stock, d.min_stock || 0, d.notes]);
    if (stock > 0) await t.query("INSERT INTO spare_part_movements (spare_part_id, movement_type, qty, stock_after, note, created_by) VALUES (?, 'MASUK', ?, ?, 'Stok awal', ?)", [r.insertId, stock, stock, req.user.id]);
    await audit.log(req, 'CREATE', { entity: 'spare_parts', id: r.insertId, description: `Spare part ${d.name} ditambahkan (stok ${stock})` }, t);
    return r.insertId;
  });
  notifications.clear();
  res.done(`${d.name} ditambahkan.`, '/spare-parts', { id });
});

// Pemakaian dari halaman laporan maintenance (stok langsung berkurang)
router.post('/use', can('sparepart.manage'), async (req, res) => {
  const v = validate(req.body, {
    spare_part_id: { label: 'Spare part', type: 'id', required: true },
    qty: { label: 'Jumlah', type: 'int', min: 1, max: 100000, required: true },
    maintenance_record_id: { label: 'Laporan maintenance', type: 'id' },
    note: { label: 'Catatan', maxLength: 255 },
  });
  if (!v.ok) throw new ValidationError(v.errors);
  let assetId = null;
  if (v.data.maintenance_record_id) {
    const r = await db.one('SELECT id, asset_id FROM maintenance_records WHERE id=? AND deleted_at IS NULL', [v.data.maintenance_record_id]);
    if (!r) throw fail('Laporan maintenance tidak ditemukan.', 404);
    assetId = r.asset_id;
  }
  const r = await move(req, v.data.spare_part_id, { type: 'KELUAR', qty: v.data.qty, assetId, recordId: v.data.maintenance_record_id, note: v.data.note });
  const back = v.data.maintenance_record_id ? `/maintenance/${v.data.maintenance_record_id}` : '/spare-parts';
  res.done(`Pemakaian ${v.data.qty} ${r.part.unit} ${r.part.name} dicatat. Sisa stok ${r.after}.`, back);
});

router.post('/:id', can('sparepart.manage'), async (req, res) => {
  const before = await db.one('SELECT * FROM spare_parts WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!before) throw fail('Spare part tidak ditemukan.', 404);
  const v = validate(req.body, partSchema);
  if (!v.ok) throw new ValidationError(v.errors);
  const d = v.data;
  const dup = await db.one('SELECT id FROM spare_parts WHERE name=? AND deleted_at IS NULL AND id<>?', [d.name, before.id]);
  if (dup) throw new ValidationError({ name: `"${d.name}" sudah ada di daftar.` });
  await db.query('UPDATE spare_parts SET name=?, category=?, unit=?, min_stock=?, notes=? WHERE id=?', [d.name, d.category, d.unit || 'pcs', d.min_stock || 0, d.notes, before.id]);
  await audit.log(req, 'UPDATE', { entity: 'spare_parts', id: before.id, ...audit.diff(before, d) });
  notifications.clear();
  res.done('Data spare part diperbarui.', req.get('referer') || '/spare-parts');
});

/** Ubah stok dalam transaksi (baris dikunci); stok tidak boleh minus. */
async function move(req, partId, { type, qty, assetId = null, recordId = null, note = null }) {
  return db.transaction(async (t) => {
    const part = await t.one('SELECT * FROM spare_parts WHERE id=? AND deleted_at IS NULL FOR UPDATE', [partId]);
    if (!part) throw fail('Spare part tidak ditemukan.', 404);
    let after;
    if (type === 'MASUK') after = part.stock + qty;
    else if (type === 'KELUAR') {
      if (qty > part.stock) throw new ValidationError({ qty: `Stok ${part.name} tidak cukup (tersisa ${part.stock} ${part.unit}).` });
      after = part.stock - qty;
    } else after = qty; // KOREKSI: qty = jumlah hasil hitung fisik
    const delta = type === 'KOREKSI' ? after - part.stock : qty;
    await t.query('UPDATE spare_parts SET stock=? WHERE id=?', [after, part.id]);
    await t.query('INSERT INTO spare_part_movements (spare_part_id, movement_type, qty, stock_after, asset_id, maintenance_record_id, note, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [part.id, type, delta, after, assetId, recordId, note, req.user.id]);
    await audit.log(req, 'UPDATE', { entity: 'spare_parts', id: part.id, description: `${TYPES[type]} ${part.name}: ${part.stock} → ${after} ${part.unit}${note ? ` (${note})` : ''}` }, t);
    notifications.clear();
    return { part, after };
  });
}

router.post('/:id/stock', can('sparepart.manage'), async (req, res) => {
  const v = validate(req.body, {
    movement_type: { label: 'Jenis', type: 'enum', values: Object.keys(TYPES), required: true },
    qty: { label: 'Jumlah', type: 'int', min: 0, max: 100000, required: true },
    asset_id: { label: 'Dipakai untuk PC', type: 'id' },
    note: { label: 'Catatan', maxLength: 255 },
  });
  if (v.data.movement_type !== 'KOREKSI' && v.data.qty === 0) v.errors.qty = 'Jumlah minimal 1.';
  if (v.data.movement_type === 'KOREKSI' && !v.data.note) v.errors.note = 'Tuliskan alasan koreksi (mis. hasil hitung fisik).';
  if (Object.keys(v.errors).length) throw new ValidationError(v.errors);
  const r = await move(req, req.params.id, { type: v.data.movement_type, qty: v.data.qty, assetId: v.data.movement_type === 'KELUAR' ? v.data.asset_id : null, note: v.data.note });
  res.done(`${TYPES[v.data.movement_type]} ${r.part.name} dicatat. Stok sekarang ${r.after} ${r.part.unit}.`, req.get('referer') || '/spare-parts');
});

router.post('/:id/delete', can('sparepart.manage'), async (req, res) => {
  const p = await db.one('SELECT * FROM spare_parts WHERE id=? AND deleted_at IS NULL', [req.params.id]);
  if (!p) throw fail('Spare part tidak ditemukan atau sudah dihapus.', 404);
  await db.query('UPDATE spare_parts SET deleted_at=NOW() WHERE id=?', [p.id]);
  await audit.log(req, 'DELETE', { entity: 'spare_parts', id: p.id, description: `Spare part ${p.name} dihapus (riwayat tetap tersimpan)` });
  notifications.clear();
  res.done(`${p.name} dihapus dari daftar.`, '/spare-parts');
});

/** Untuk halaman laporan maintenance. */
async function forRecord(recordId) {
  return db.query(`SELECT m.*, p.name, p.unit, u.full_name AS user_name FROM spare_part_movements m JOIN spare_parts p ON p.id=m.spare_part_id
                    LEFT JOIN users u ON u.id=m.created_by WHERE m.maintenance_record_id=? ORDER BY m.id`, [recordId]);
}
async function options() {
  return db.query('SELECT id, name, unit, stock FROM spare_parts WHERE deleted_at IS NULL ORDER BY name');
}

module.exports = router;
module.exports.forRecord = forRecord;
module.exports.options = options;
