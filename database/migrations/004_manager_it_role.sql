-- Role Manager IT (pengganti SPV / Kepala IT) untuk instalasi yang sudah menjalankan versi awal migrasi 003.
-- Pada instalasi baru (tabel roles masih kosong) tidak melakukan apa-apa; role dibuat oleh seeder.

UPDATE roles SET name = 'Administrator', description = 'Akses penuh: seluruh data, threshold, akun, role & pengaturan sistem' WHERE code = 'ADMIN';

INSERT INTO roles (code, name, description, is_system)
SELECT 'MANAGER_IT', 'Manager IT', 'Memantau seluruh data & laporan, menyetujui hasil maintenance, mengelola jadwal & tindak lanjut', 1
  FROM roles WHERE code = 'ADMIN' AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM roles WHERE code = 'MANAGER_IT') x) LIMIT 1;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
    ON p.code IN ('dashboard.view', 'asset.view', 'asset.export', 'employee.view', 'master.view', 'maintenance.view', 'maintenance.approve',
                  'schedule.view', 'schedule.manage', 'followup.view', 'followup.manage', 'report.view', 'report.export', 'audit.view')
 WHERE r.code = 'MANAGER_IT'
   AND NOT EXISTS (SELECT 1 FROM (SELECT rp.role_id FROM role_permissions rp JOIN roles r2 ON r2.id = rp.role_id WHERE r2.code = 'MANAGER_IT') y);
