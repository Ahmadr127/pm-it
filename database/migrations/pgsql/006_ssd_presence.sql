-- Pilihan "Ada SSD / Tidak Ada SSD" (sama seperti HDD). TIDAK_ADA => tidak ada baris SSD (NULL, bukan 0%).
-- Versi PostgreSQL.
ALTER TABLE maintenance_records ADD COLUMN ssd_presence TEXT CONSTRAINT chk_maintenance_records_ssd_presence CHECK (ssd_presence IN ('ADA','TIDAK_ADA'));

UPDATE maintenance_records r
   SET ssd_presence = 'ADA'
 WHERE r.ssd_presence IS NULL AND EXISTS (SELECT 1 FROM maintenance_storage_readings s WHERE s.maintenance_record_id = r.id AND s.storage_type = 'SSD');
