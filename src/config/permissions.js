'use strict';
// Sistem hanya dipakai tim IT: Administrator, Manager IT, dan Staff IT. Pengguna PC (karyawan) TIDAK memiliki akun.
// Daftar hak akses. Pemeriksaan dilakukan di backend (middleware can()) untuk setiap endpoint.
const PERMISSIONS = [
  ['dashboard.view', 'Melihat dashboard', 'Dashboard'],
  ['asset.view', 'Melihat data aset', 'Inventaris'],
  ['asset.create', 'Menambah aset', 'Inventaris'],
  ['asset.update', 'Mengubah aset', 'Inventaris'],
  ['asset.delete', 'Menghapus aset', 'Inventaris'],
  ['asset.import', 'Impor data aset', 'Inventaris'],
  ['asset.export', 'Ekspor data aset', 'Inventaris'],
  ['employee.view', 'Melihat pengguna PC', 'Pengguna PC & Unit'],
  ['employee.manage', 'Mengelola pengguna PC & penugasan perangkat', 'Pengguna PC & Unit'],
  ['master.view', 'Melihat master unit kerja', 'Pengguna PC & Unit'],
  ['master.manage', 'Mengelola departemen, unit kerja, lokasi', 'Pengguna PC & Unit'],
  ['maintenance.view', 'Melihat data maintenance', 'Maintenance'],
  ['maintenance.create', 'Mengisi form maintenance', 'Maintenance'],
  ['maintenance.update', 'Memperbarui hasil maintenance', 'Maintenance'],
  ['maintenance.edit_completed', 'Mengubah maintenance yang sudah Selesai', 'Maintenance'],
  ['maintenance.delete', 'Menghapus maintenance', 'Maintenance'],
  ['maintenance.approve', 'Menyetujui hasil maintenance', 'Maintenance'],
  ['attachment.upload', 'Mengunggah dokumentasi', 'Maintenance'],
  ['schedule.view', 'Melihat jadwal maintenance', 'Jadwal'],
  ['schedule.manage', 'Mengelola jadwal & penugasan teknisi', 'Jadwal'],
  ['followup.view', 'Melihat tindak lanjut', 'Tindak Lanjut'],
  ['followup.manage', 'Mengelola tindak lanjut & perbaikan', 'Tindak Lanjut'],
  ['sparepart.view', 'Melihat stok spare part', 'Spare Part'],
  ['sparepart.manage', 'Mengelola stok spare part (masuk, pakai, koreksi)', 'Spare Part'],
  ['report.view', 'Melihat laporan', 'Laporan'],
  ['report.export', 'Ekspor laporan PDF/Excel/CSV', 'Laporan'],
  ['threshold.manage', 'Mengatur threshold hardware & interval', 'Administrasi'],
  ['settings.manage', 'Mengatur pengaturan sistem', 'Administrasi'],
  ['user.manage', 'Mengelola akun pengguna', 'Administrasi'],
  ['role.manage', 'Mengelola hak akses role', 'Administrasi'],
  ['audit.view', 'Melihat audit log', 'Administrasi'],
  ['data.settings', 'Pengaturan data: unit kerja, lokasi kerja & kode aset', 'Administrasi'],
  ['backup.manage', 'Membuat, mengunduh & memulihkan backup data', 'Administrasi'],
];

const ALL = PERMISSIONS.map((p) => p[0]);

const ROLE_DEFAULTS = {
  ADMIN: { name: 'Administrator', description: 'Akses penuh: seluruh data, threshold, akun, role & pengaturan sistem', perms: ALL },
  MANAGER_IT: {
    name: 'Manager IT',
    description: 'Memantau seluruh data & laporan, menyetujui hasil maintenance, mengelola jadwal & tindak lanjut',
    perms: ['dashboard.view', 'asset.view', 'asset.export', 'employee.view', 'master.view',
      'maintenance.view', 'maintenance.approve', 'schedule.view', 'schedule.manage', 'followup.view',
      'followup.manage', 'report.view', 'report.export', 'audit.view', 'data.settings', 'sparepart.view', 'sparepart.manage'],
  },
  IT_STAFF: {
    name: 'Staff IT',
    description: 'Mengisi maintenance, mendaftarkan perangkat, unggah dokumentasi, jadwal, tindak lanjut & laporan',
    perms: ['dashboard.view', 'asset.view', 'asset.create', 'asset.update', 'asset.export',
      'employee.view', 'employee.manage', 'master.view', 'maintenance.view', 'maintenance.create',
      'maintenance.update', 'attachment.upload', 'schedule.view', 'schedule.manage', 'followup.view',
      'followup.manage', 'report.view', 'report.export', 'sparepart.view', 'sparepart.manage'],
  },
};

/** Role bawaan lama yang sudah tidak dipakai. SUPERVISOR (SPV / Kepala IT) diganti MANAGER_IT. */
const RETIRED_ROLES = ['SUPERVISOR', 'USER'];
const RETIRED_PERMISSIONS = ['self.devices', 'self.complaint', 'complaint.manage'];

module.exports = { PERMISSIONS, ALL, ROLE_DEFAULTS, RETIRED_ROLES, RETIRED_PERMISSIONS };
