-- Fitur Agent Hardware dihapus: cabut hak akses terkait. Tabel agent_* dibiarkan (tidak dipakai lagi).
DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'agent.manage';
DELETE FROM permissions WHERE code = 'agent.manage';
