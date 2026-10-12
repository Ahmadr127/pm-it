-- Menu Pengaturan Data (unit kerja, lokasi kerja, kode aset) untuk Administrator & Manager IT
-- Versi PostgreSQL.
INSERT INTO permissions (code, name, group_name) VALUES ('data.settings', 'Pengaturan data: unit kerja, lokasi kerja & kode aset', 'Administrasi')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'data.settings' WHERE r.code IN ('ADMIN', 'MANAGER_IT')
ON CONFLICT DO NOTHING;
