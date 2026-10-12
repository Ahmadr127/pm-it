-- Pilihan "Ada SSD / Tidak Ada SSD" (sama seperti HDD). TIDAK_ADA => tidak ada baris SSD (NULL, bukan 0%).
ALTER TABLE maintenance_records
  ADD COLUMN ssd_presence ENUM('ADA','TIDAK_ADA') NULL COMMENT 'TIDAK_ADA => tidak ada baris SSD (NULL, bukan 0%)' AFTER hdd_presence;

UPDATE maintenance_records r
   SET r.ssd_presence = 'ADA'
 WHERE r.ssd_presence IS NULL AND EXISTS (SELECT 1 FROM maintenance_storage_readings s WHERE s.maintenance_record_id = r.id AND s.storage_type = 'SSD');
