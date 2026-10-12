-- Fitur Agent Hardware dihapus: cabut hak akses terkait. Tabel agent_* dibiarkan (tidak dipakai lagi).
-- Versi PostgreSQL.
DELETE FROM role_permissions rp USING permissions p WHERE rp.permission_id = p.id AND p.code = 'agent.manage';
DELETE FROM permissions WHERE code = 'agent.manage';
