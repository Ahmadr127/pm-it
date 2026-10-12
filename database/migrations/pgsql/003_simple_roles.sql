-- Penyederhanaan role: sistem hanya dipakai tim IT.
-- Versi PostgreSQL (setara 003_simple_roles.sql MySQL).

UPDATE roles SET code = 'MANAGER_IT', name = 'Manager IT', description = 'Memantau seluruh data & laporan, menyetujui hasil maintenance, mengelola jadwal & tindak lanjut'
 WHERE code = 'SUPERVISOR' AND NOT EXISTS (SELECT 1 FROM roles WHERE code = 'MANAGER_IT');

UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'IT_STAFF'), is_active = 0
 WHERE role_id IN (SELECT id FROM roles WHERE code = 'USER');

UPDATE users SET employee_id = NULL WHERE employee_id IS NOT NULL;

DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code = 'USER');

DELETE FROM roles WHERE code = 'USER';

DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('self.devices', 'self.complaint', 'complaint.manage'));

DELETE FROM permissions WHERE code IN ('self.devices', 'self.complaint', 'complaint.manage');

UPDATE roles SET name = 'Administrator', description = 'Akses penuh: seluruh data, threshold, akun, role & pengaturan sistem' WHERE code = 'ADMIN';

UPDATE roles SET name = 'Staff IT', description = 'Mengisi maintenance, mendaftarkan perangkat, unggah dokumentasi, jadwal, tindak lanjut & laporan' WHERE code = 'IT_STAFF';

UPDATE app_settings SET description = 'Persetujuan Manager IT: SEMUA, KRITIS (hanya hasil Perhatian/Kritis), atau TIDAK' WHERE setting_key = 'approval_mode';
