'use strict';
// Menu sidebar. Item hanya tampil bila user memiliki permission terkait
// (otorisasi sebenarnya tetap diperiksa di setiap route backend).
module.exports = [
  { section: null, items: [
    { href: '/', icon: 'bi-grid-1x2-fill', label: 'Dashboard', perm: 'dashboard.view', match: /^\/$/ },
  ] },
  { section: 'Inventaris', items: [
    { href: '/assets', icon: 'bi-pc-display', label: 'Master Aset PC', perm: 'asset.view', match: /^\/assets/ },
    { href: '/scan', icon: 'bi-qr-code-scan', label: 'Scan QR', perm: 'asset.view', match: /^\/(scan|s)(\/|$)/ },
    { href: '/employees', icon: 'bi-people-fill', label: 'Pengguna PC', perm: 'employee.view', match: /^\/employees/ },
    { href: '/spare-parts', icon: 'bi-box-seam', label: 'Stok Spare Part', perm: 'sparepart.view', match: /^\/spare-parts/ },
    { href: '/perangkat-lain', icon: 'bi-printer', label: 'Printer, UPS & Scanner', perm: 'asset.view', match: /^\/perangkat-lain/ },
  ] },
  { section: 'Maintenance', items: [
    { href: '/maintenance', icon: 'bi-clipboard2-pulse-fill', label: 'Preventive Maintenance', perm: 'maintenance.view', match: /^\/maintenance/ },
    { href: '/schedules', icon: 'bi-calendar2-week-fill', label: 'Jadwal Maintenance', perm: 'schedule.view', match: /^\/schedules/ },
    { href: '/follow-ups', icon: 'bi-tools', label: 'Tindak Lanjut', perm: 'followup.view', match: /^\/follow-ups/ },
  ] },
  { section: 'Laporan', items: [
    { href: '/reports', icon: 'bi-file-earmark-bar-graph-fill', label: 'Laporan', perm: 'report.view', match: /^\/reports/ },
  ] },
  { section: 'Administrasi', items: [
    { href: '/pengaturan', icon: 'bi-gear-wide-connected', label: 'Pengaturan Data', perm: 'data.settings', match: /^\/pengaturan/ },
    { href: '/admin/thresholds', icon: 'bi-thermometer-half', label: 'Threshold & Interval', perm: 'threshold.manage', match: /^\/admin\/thresholds/ },
    { href: '/admin/settings', icon: 'bi-sliders', label: 'Pengaturan Sistem', perm: 'settings.manage', match: /^\/admin\/settings/ },
    { href: '/admin/users', icon: 'bi-person-badge-fill', label: 'Akun Pengguna', perm: 'user.manage', match: /^\/admin\/users/ },
    { href: '/admin/roles', icon: 'bi-shield-lock-fill', label: 'Role & Hak Akses', perm: 'role.manage', match: /^\/admin\/roles/ },
    { href: '/admin/audit', icon: 'bi-journal-text', label: 'Audit Log', perm: 'audit.view', match: /^\/admin\/audit/ },
    { href: '/admin/backup', icon: 'bi-database-fill-check', label: 'Backup Data', perm: 'backup.manage', match: /^\/admin\/backup/ },
  ] },
];
