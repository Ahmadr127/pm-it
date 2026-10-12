-- Hak akses menu Backup Data (hanya Administrator secara bawaan)
-- Versi PostgreSQL.
INSERT INTO permissions (code, name, group_name) VALUES ('backup.manage', 'Membuat, mengunduh & memulihkan backup data', 'Administrasi')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'backup.manage' WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;
