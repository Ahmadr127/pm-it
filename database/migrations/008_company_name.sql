-- Nama instansi dapat diatur dari Pengaturan Sistem (menggantikan COMPANY_NAME di .env)
INSERT IGNORE INTO app_settings (setting_key, setting_value, description)
VALUES ('company_name', 'RS Azra', 'Nama instansi pada tampilan & laporan');
