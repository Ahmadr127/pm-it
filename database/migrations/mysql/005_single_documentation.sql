-- Form maintenance memakai SATU kolom unggahan "Dokumentasi" (foto, screenshot, PDF).
-- Kategori lama tetap disimpan agar lampiran yang sudah ada tidak berubah.
ALTER TABLE maintenance_attachments
  MODIFY category ENUM('DOKUMENTASI','FOTO_SEBELUM','FOTO_SESUDAH','SCREENSHOT_STORAGE','DOKUMEN_PDF','BUKTI_SPAREPART') NOT NULL DEFAULT 'DOKUMENTASI';
