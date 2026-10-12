-- Stok spare part sederhana: daftar barang + riwayat masuk / keluar / koreksi
CREATE TABLE IF NOT EXISTS spare_parts (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  category    VARCHAR(80)  NULL,
  unit        VARCHAR(20)  NOT NULL DEFAULT 'pcs',
  stock       INT          NOT NULL DEFAULT 0,
  min_stock   INT          NOT NULL DEFAULT 0,
  notes       VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  DATETIME NULL,
  KEY idx_sp_name (name),
  KEY idx_sp_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS spare_part_movements (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  spare_part_id         INT UNSIGNED NOT NULL,
  movement_type         ENUM('MASUK','KELUAR','KOREKSI') NOT NULL,
  qty                   INT NOT NULL,
  stock_after           INT NOT NULL,
  asset_id              INT UNSIGNED NULL,
  maintenance_record_id INT UNSIGNED NULL,
  note                  VARCHAR(255) NULL,
  created_by            INT UNSIGNED NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_spm_part (spare_part_id, created_at),
  KEY idx_spm_record (maintenance_record_id),
  KEY idx_spm_asset (asset_id),
  CONSTRAINT fk_spm_part   FOREIGN KEY (spare_part_id)         REFERENCES spare_parts(id),
  CONSTRAINT fk_spm_asset  FOREIGN KEY (asset_id)              REFERENCES assets(id) ON DELETE SET NULL,
  CONSTRAINT fk_spm_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code, name, group_name) VALUES
  ('sparepart.view', 'Melihat stok spare part', 'Spare Part'),
  ('sparepart.manage', 'Mengelola stok spare part (masuk, pakai, koreksi)', 'Spare Part');
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('sparepart.view', 'sparepart.manage') WHERE r.code IN ('ADMIN', 'MANAGER_IT', 'IT_STAFF');
