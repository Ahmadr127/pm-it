-- Form maintenance memakai SATU kolom unggahan "Dokumentasi" (foto, screenshot, PDF).
-- Versi PostgreSQL.
ALTER TABLE maintenance_attachments DROP CONSTRAINT IF EXISTS chk_maintenance_attachments_category;
ALTER TABLE maintenance_attachments ALTER COLUMN category SET DEFAULT 'DOKUMENTASI';
ALTER TABLE maintenance_attachments ADD CONSTRAINT chk_maintenance_attachments_category
  CHECK (category IN ('DOKUMENTASI','FOTO_SEBELUM','FOTO_SESUDAH','SCREENSHOT_STORAGE','DOKUMEN_PDF','BUKTI_SPAREPART'));
