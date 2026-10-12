CREATE TABLE IF NOT EXISTS spare_parts (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  category    VARCHAR(80)  NULL,
  unit        VARCHAR(20)  NOT NULL DEFAULT 'pcs',
  stock       INTEGER          NOT NULL DEFAULT 0,
  min_stock   INTEGER          NOT NULL DEFAULT 0,
  notes       VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP NULL
);
CREATE INDEX idx_sp_name ON spare_parts (name);
CREATE INDEX idx_sp_category ON spare_parts (category);
CREATE TABLE IF NOT EXISTS spare_part_movements (
  id                    SERIAL PRIMARY KEY,
  spare_part_id         INTEGER NOT NULL,
  movement_type TEXT CONSTRAINT chk_spare_part_movements_movement_type CHECK (movement_type IN ('MASUK','KELUAR','KOREKSI')) NOT NULL,
  qty                   INTEGER NOT NULL,
  stock_after           INTEGER NOT NULL,
  asset_id              INTEGER NULL,
  maintenance_record_id INTEGER NULL,
  note                  VARCHAR(255) NULL,
  created_by            INTEGER NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_spm_part   FOREIGN KEY (spare_part_id)         REFERENCES spare_parts(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_spm_asset  FOREIGN KEY (asset_id)              REFERENCES assets(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_spm_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_spm_part ON spare_part_movements (spare_part_id, created_at);
CREATE INDEX idx_spm_record ON spare_part_movements (maintenance_record_id);
CREATE INDEX idx_spm_asset ON spare_part_movements (asset_id);
INSERT INTO permissions (code, name, group_name) VALUES
  ('sparepart.view', 'Melihat stok spare part', 'Spare Part'),
  ('sparepart.manage', 'Mengelola stok spare part (masuk, pakai, koreksi)', 'Spare Part')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('sparepart.view', 'sparepart.manage') WHERE r.code IN ('ADMIN', 'MANAGER_IT', 'IT_STAFF')
ON CONFLICT DO NOTHING;

CREATE TRIGGER trg_touch_spare_parts BEFORE UPDATE ON spare_parts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
