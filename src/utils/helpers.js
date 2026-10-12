'use strict';

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function pad(n) { return String(n).padStart(2, '0'); }

/** Tanggal hari ini (zona waktu proses / TZ). */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nowTime() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function nowDateTime() { const d = new Date(); return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}
function diffDays(a, b) { // a - b dalam hari
  return Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
}

function fmtDate(s, long = false) {
  if (!s) return '-';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  if (!y || !m) return s;
  return `${Number(d)} ${(long ? BULAN : BLN)[Number(m) - 1]} ${y}`;
}
function fmtDateTime(s) {
  if (!s) return '-';
  return `${fmtDate(s)} ${String(s).slice(11, 16)}`;
}
function fmtNum(v, digits = 1) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(digits).replace('.', ',');
}
/** Tampilan nilai: NULL -> teks pengganti (tidak pernah ditampilkan sebagai 0). */
function show(v, unit = '', empty = 'Tidak diperiksa') {
  const s = fmtNum(v);
  return s === null ? empty : `${s}${unit}`;
}
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function fmtCapacity(gb) {
  if (gb === null || gb === undefined) return '-';
  const n = Number(gb);
  return n >= 1000 ? `${fmtNum(n / 1000, 2)} TB` : `${fmtNum(n)} GB`;
}

/** Pagination standar: ?page=&per_page= */
function paging(q, defaultPer = 20) {
  const per = Math.min(Math.max(parseInt(q.per_page, 10) || defaultPer, 5), 200);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { page, per, offset: (page - 1) * per };
}

/** Sorting aman: hanya kolom whitelist. */
function sorting(q, allowed, defaultKey, defaultDir = 'asc') {
  const key = Object.prototype.hasOwnProperty.call(allowed, q.sort) ? q.sort : defaultKey;
  const dir = String(q.dir).toLowerCase() === 'desc' ? 'DESC' : (String(q.dir).toLowerCase() === 'asc' ? 'ASC' : defaultDir.toUpperCase());
  return { key, dir, sql: `${allowed[key]} ${dir}` };
}

function likeEscape(s) { return String(s).replace(/[\\%_]/g, (c) => `\\${c}`); }

function buildQuery(base, changes) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...changes })) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

const STATUS_BADGE = {
  BAIK: ['success', 'Baik', 'bi-check-circle-fill'],
  PERHATIAN: ['warning', 'Perlu Perhatian', 'bi-exclamation-triangle-fill'],
  KRITIS: ['danger', 'Kritis', 'bi-x-octagon-fill'],
  BELUM_DIEVALUASI: ['secondary', 'Belum Dievaluasi', 'bi-dash-circle'],
  TIDAK_TERSEDIA: ['secondary', 'Tidak Tersedia', 'bi-question-circle'],
  TIDAK_DIPERIKSA: ['light', 'Tidak Diperiksa', 'bi-dash'],
  TIDAK_BERLAKU: ['light', 'Tidak Berlaku', 'bi-slash-circle'],
  INFO: ['info', 'Informasi', 'bi-info-circle'],
};
const RECORD_STATUS_BADGE = {
  Draft: 'secondary', Terjadwal: 'info', 'Dalam Proses': 'primary', Selesai: 'success', Ditunda: 'warning', Dibatalkan: 'dark',
};
const FINAL_BADGE = { Baik: 'success', 'Baik dengan catatan': 'success', 'Perlu Monitoring': 'warning', 'Perlu Perbaikan': 'warning', Kritis: 'danger' };
const PRIORITY_BADGE = { Rendah: 'secondary', Sedang: 'info', Tinggi: 'warning', Kritis: 'danger' };

/** Nama perangkat untuk tampilan. Nama yang sama dengan kode aset (diberi otomatis) tidak ditampilkan dobel. */
function deviceName(code, host, fallback = '') {
  return host && String(host).trim() && String(host).trim().toUpperCase() !== String(code || '').trim().toUpperCase() ? host : fallback;
}

module.exports = {
  deviceName,
  today, nowTime, nowDateTime, addDays, diffDays, fmtDate, fmtDateTime, fmtNum, show, fmtBytes, fmtCapacity,
  paging, sorting, likeEscape, buildQuery, STATUS_BADGE, RECORD_STATUS_BADGE, FINAL_BADGE, PRIORITY_BADGE, BULAN, BLN,
};

// ---------- Helper HTML (hanya menghasilkan markup dari nilai yang sudah di-escape) ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pill(text, tone = 'secondary', icon = null) {
  return `<span class="st st-${esc(tone)}">${icon ? `<i class="bi ${esc(icon)}"></i>` : ''}${esc(text)}</span>`;
}
function statusBadge(level) {
  const [tone, label, icon] = STATUS_BADGE[level] || STATUS_BADGE.BELUM_DIEVALUASI;
  return pill(label, tone, icon);
}
function recordBadge(status) { return pill(status || '-', RECORD_STATUS_BADGE[status] || 'secondary'); }
function finalBadge(c) { return c ? pill(c, FINAL_BADGE[c] || 'secondary') : pill('Belum diisi', 'light'); }
function priorityBadge(p) { return p ? pill(p, PRIORITY_BADGE[p] || 'secondary', 'bi-flag-fill') : '<span class="text-muted">-</span>'; }
function approvalBadge(a) {
  const t = { 'Tidak Diperlukan': 'light', Menunggu: 'warning', Disetujui: 'success', Ditolak: 'danger' }[a] || 'secondary';
  return pill(a || '-', t);
}
function assetStatusBadge(s) {
  const t = { Aktif: 'success', Dipinjamkan: 'info', 'Dalam Perbaikan': 'warning', Cadangan: 'secondary', Nonaktif: 'dark' }[s] || 'secondary';
  return pill(s, t);
}
function followBadge(s) {
  const t = { Terbuka: 'danger', 'Dalam Proses': 'primary', 'Menunggu Sparepart': 'warning', Selesai: 'success', Dibatalkan: 'dark' }[s] || 'secondary';
  return pill(s, t);
}
/** Header kolom tabel yang bisa di-sort (link GET, sort key divalidasi whitelist di backend). */
function sortTh(label, key, query, cls = '') {
  const active = query.sort === key;
  const dir = active && String(query.dir).toLowerCase() === 'asc' ? 'desc' : 'asc';
  const icon = active ? (String(query.dir).toLowerCase() === 'asc' ? 'bi-sort-up' : 'bi-sort-down') : 'bi-arrow-down-up opacity-25';
  return `<th class="${esc(cls)}"><a class="sort ${active ? 'active' : ''}" href="${esc(buildQuery(query, { sort: key, dir, page: 1 }))}">${esc(label)} <i class="bi ${icon}"></i></a></th>`;
}

Object.assign(module.exports, { esc, pill, statusBadge, recordBadge, finalBadge, priorityBadge, approvalBadge, assetStatusBadge, followBadge, sortTh });
