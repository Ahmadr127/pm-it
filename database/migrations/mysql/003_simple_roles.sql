-- Penyederhanaan role: sistem hanya dipakai tim IT.
--   ADMIN      -> "Administrator" (akses penuh)
--   SUPERVISOR -> "Manager IT" (kode MANAGER_IT; akun yang ada tetap di role ini)
--   IT_STAFF   -> "Staff IT"
-- Role lama USER (portal karyawan) dihapus; akun karyawan (bila ada) dinonaktifkan.
-- Pengguna PC tetap dicatat di tabel employees (tanpa akun login).

UPDATE roles SET code = 'MANAGER_IT', name = 'Manager IT', description = 'Memantau seluruh data & laporan, menyetujui hasil maintenance, mengelola jadwal & tindak lanjut'
 WHERE code = 'SUPERVISOR' AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM roles WHERE code = 'MANAGER_IT') x);

UPDATE users u JOIN roles r ON r.id = u.role_id JOIN roles s ON s.code = 'IT_STAFF'
   SET u.role_id = s.id, u.is_active = 0
 WHERE r.code = 'USER';

UPDATE users SET employee_id = NULL WHERE employee_id IS NOT NULL;

DELETE rp FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'USER';

DELETE FROM roles WHERE code = 'USER';

DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
 WHERE p.code IN ('self.devices', 'self.complaint', 'complaint.manage');

DELETE FROM permissions WHERE code IN ('self.devices', 'self.complaint', 'complaint.manage');

UPDATE roles SET name = 'Administrator', description = 'Akses penuh: seluruh data, threshold, akun, role & pengaturan sistem' WHERE code = 'ADMIN';

UPDATE roles SET name = 'Staff IT', description = 'Mengisi maintenance, mendaftarkan perangkat, unggah dokumentasi, jadwal, tindak lanjut & laporan' WHERE code = 'IT_STAFF';

UPDATE app_settings SET description = 'Persetujuan Manager IT: SEMUA, KRITIS (hanya hasil Perhatian/Kritis), atau TIDAK' WHERE setting_key = 'approval_mode';

