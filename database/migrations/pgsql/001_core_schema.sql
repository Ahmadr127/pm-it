CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TABLE roles (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(40)  NOT NULL,
  name          VARCHAR(100) NOT NULL,
  description   VARCHAR(255) NULL,
  is_system     SMALLINT   NOT NULL DEFAULT 0,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_roles_code UNIQUE (code)
);
CREATE TABLE permissions (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(60)  NOT NULL,
  name        VARCHAR(150) NOT NULL,
  group_name  VARCHAR(60)  NOT NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_permissions_code UNIQUE (code)
);
CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE departments (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(30)  NULL,
  name        VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  is_active   SMALLINT   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP NULL,
  CONSTRAINT uq_departments_name UNIQUE (name)
);
CREATE INDEX idx_departments_active ON departments (is_active);
CREATE TABLE locations (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  building    VARCHAR(120) NULL,
  floor       VARCHAR(30)  NULL,
  room        VARCHAR(120) NULL,
  is_active   SMALLINT   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP NULL,
  CONSTRAINT uq_locations UNIQUE (name, building, room)
);
CREATE INDEX idx_locations_active ON locations (is_active);
CREATE TABLE employees (
  id              SERIAL PRIMARY KEY,
  nik             VARCHAR(40)  NOT NULL,
  full_name       VARCHAR(150) NOT NULL,
  position        VARCHAR(120) NULL,
  department_id   INTEGER NULL,
  work_unit_id    INTEGER NULL,
  location_id     INTEGER NULL,
  room            VARCHAR(120) NULL,
  phone_ext       VARCHAR(20)  NULL,
  email           VARCHAR(150) NULL,
  supervisor_name VARCHAR(150) NULL,
  status TEXT CONSTRAINT chk_employees_status CHECK (status IN ('Aktif','Dipindahkan','Dipinjamkan','Tidak Aktif')) NOT NULL DEFAULT 'Aktif',
  notes           TEXT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP NULL,
  CONSTRAINT uq_employees_nik UNIQUE (nik),
  CONSTRAINT fk_emp_dept FOREIGN KEY (department_id) REFERENCES departments(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_emp_loc  FOREIGN KEY (location_id)   REFERENCES locations(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_employees_name ON employees (full_name);
CREATE INDEX idx_employees_dept ON employees (department_id);
CREATE INDEX idx_employees_unit ON employees (work_unit_id);
CREATE INDEX idx_employees_status ON employees (status);
CREATE TABLE work_units (
  id              SERIAL PRIMARY KEY,
  department_id   INTEGER NOT NULL,
  name            VARCHAR(120) NOT NULL,
  location_id     INTEGER NULL,
  pic_employee_id INTEGER NULL,
  pic_name        VARCHAR(150) NULL,
  is_active       SMALLINT NOT NULL DEFAULT 1,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP NULL,
  CONSTRAINT uq_work_units UNIQUE (department_id, name),
  CONSTRAINT fk_wu_dept FOREIGN KEY (department_id)   REFERENCES departments(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_wu_loc  FOREIGN KEY (location_id)     REFERENCES locations(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_wu_pic  FOREIGN KEY (pic_employee_id) REFERENCES employees(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_work_units_active ON work_units (is_active);
ALTER TABLE employees
  ADD CONSTRAINT fk_emp_unit FOREIGN KEY (work_unit_id) REFERENCES work_units(id);
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  role_id              INTEGER NOT NULL,
  employee_id          INTEGER NULL,
  username             VARCHAR(60)  NOT NULL,
  full_name            VARCHAR(150) NOT NULL,
  email                VARCHAR(150) NULL,
  password_hash        VARCHAR(255) NOT NULL,
  must_change_password SMALLINT   NOT NULL DEFAULT 0,
  is_active            SMALLINT   NOT NULL DEFAULT 1,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TIMESTAMP NULL,
  last_login_at        TIMESTAMP NULL,
  password_changed_at  TIMESTAMP NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at           TIMESTAMP NULL,
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id)     REFERENCES roles(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_users_emp  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_users_role ON users (role_id);
CREATE TABLE assets (
  id                        SERIAL PRIMARY KEY,
  asset_code                VARCHAR(50)  NOT NULL,
  inventory_number          VARCHAR(60)  NULL,
  hostname                  VARCHAR(100) NOT NULL,
  device_type TEXT CONSTRAINT chk_assets_device_type CHECK (device_type IN ('Desktop PC','Laptop','Workstation','Lainnya')) NOT NULL,
  device_type_other         VARCHAR(80)  NULL,
  brand                     VARCHAR(80)  NULL,
  model                     VARCHAR(120) NULL,
  serial_number             VARCHAR(100) NULL,
  processor                 VARCHAR(150) NULL,
  ram_gb                    DECIMAL(6,1) NULL,
  storage_summary           VARCHAR(200) NULL,
  gpu                       VARCHAR(150) NULL,
  operating_system          VARCHAR(120) NULL,
  ip_address                VARCHAR(45)  NULL,
  mac_address               VARCHAR(17)  NULL,
  location_id               INTEGER NULL,
  purchase_date             DATE NULL,
  warranty_status TEXT CONSTRAINT chk_assets_warranty_status CHECK (warranty_status IN ('Aktif','Habis','Tidak Ada','Tidak Diketahui')) NOT NULL DEFAULT 'Tidak Diketahui',
  warranty_until            DATE NULL,
  physical_condition TEXT CONSTRAINT chk_assets_physical_condition CHECK (physical_condition IN ('Baik','Cukup','Rusak Ringan','Rusak Berat')) NULL,
  asset_status TEXT CONSTRAINT chk_assets_asset_status CHECK (asset_status IN ('Aktif','Dipinjamkan','Dalam Perbaikan','Cadangan','Nonaktif')) NOT NULL DEFAULT 'Aktif',
  has_battery               SMALLINT NOT NULL DEFAULT 0,
  maintenance_interval_days INTEGER NULL,
  photo_path                VARCHAR(255) NULL,
  notes                     TEXT NULL,

  current_employee_id       INTEGER NULL,
  current_department_id     INTEGER NULL,
  current_work_unit_id      INTEGER NULL,
  current_health_status TEXT CONSTRAINT chk_assets_current_health_status CHECK (current_health_status IN ('BELUM_DIEVALUASI','BAIK','PERHATIAN','KRITIS')) NOT NULL DEFAULT 'BELUM_DIEVALUASI',
  last_maintenance_date     DATE NULL,
  next_maintenance_date     DATE NULL,
  created_by                INTEGER NULL,
  updated_by                INTEGER NULL,
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at                TIMESTAMP NULL,
  CONSTRAINT uq_assets_code UNIQUE (asset_code),
  CONSTRAINT uq_assets_inventory UNIQUE (inventory_number),
  CONSTRAINT fk_assets_loc  FOREIGN KEY (location_id)           REFERENCES locations(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_assets_emp  FOREIGN KEY (current_employee_id)   REFERENCES employees(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_assets_dept FOREIGN KEY (current_department_id) REFERENCES departments(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_assets_unit FOREIGN KEY (current_work_unit_id)  REFERENCES work_units(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_assets_hostname ON assets (hostname);
CREATE INDEX idx_assets_serial ON assets (serial_number);
CREATE INDEX idx_assets_type ON assets (device_type);
CREATE INDEX idx_assets_status ON assets (asset_status);
CREATE INDEX idx_assets_health ON assets (current_health_status);
CREATE INDEX idx_assets_next ON assets (next_maintenance_date);
CREATE INDEX idx_assets_unit ON assets (current_work_unit_id);
CREATE INDEX idx_assets_loc ON assets (location_id);
CREATE TABLE asset_assignments (
  id              SERIAL PRIMARY KEY,
  asset_id        INTEGER NOT NULL,
  employee_id     INTEGER NULL,
  assignment_role TEXT CONSTRAINT chk_asset_assignments_assignment_role CHECK (assignment_role IN ('PENGGUNA_UTAMA','PIC_UNIT')) NOT NULL DEFAULT 'PENGGUNA_UTAMA',
  department_id   INTEGER NULL,
  work_unit_id    INTEGER NULL,
  location_id     INTEGER NULL,
  room            VARCHAR(120) NULL,
  employee_name_snapshot   VARCHAR(150) NULL,
  department_name_snapshot VARCHAR(120) NULL,
  work_unit_name_snapshot  VARCHAR(120) NULL,
  location_text_snapshot   VARCHAR(255) NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NULL,
  status TEXT CONSTRAINT chk_asset_assignments_status CHECK (status IN ('Aktif','Dipindahkan','Dipinjamkan','Tidak Aktif')) NOT NULL DEFAULT 'Aktif',
  is_current      SMALLINT NOT NULL DEFAULT 1,
  reason          VARCHAR(255) NULL,
  notes           TEXT NULL,
  created_by      INTEGER NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_aa_asset FOREIGN KEY (asset_id)      REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_aa_emp   FOREIGN KEY (employee_id)   REFERENCES employees(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_aa_dept  FOREIGN KEY (department_id) REFERENCES departments(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_aa_unit  FOREIGN KEY (work_unit_id)  REFERENCES work_units(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_aa_loc   FOREIGN KEY (location_id)   REFERENCES locations(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_aa_asset ON asset_assignments (asset_id, is_current);
CREATE INDEX idx_aa_emp ON asset_assignments (employee_id, is_current);
CREATE INDEX idx_aa_unit ON asset_assignments (work_unit_id);
CREATE TABLE asset_movements (
  id            SERIAL PRIMARY KEY,
  asset_id      INTEGER NOT NULL,
  movement_type TEXT CONSTRAINT chk_asset_movements_movement_type CHECK (movement_type IN ('PENGGUNA','DEPARTEMEN','UNIT_KERJA','LOKASI','STATUS')) NOT NULL,
  from_value    VARCHAR(255) NULL,
  to_value      VARCHAR(255) NULL,
  moved_at      TIMESTAMP NOT NULL,
  reason        VARCHAR(255) NULL,
  moved_by      INTEGER NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_am_asset FOREIGN KEY (asset_id) REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_am_user  FOREIGN KEY (moved_by) REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_am_asset ON asset_movements (asset_id, moved_at);
CREATE TABLE storage_devices (
  id            SERIAL PRIMARY KEY,
  asset_id      INTEGER NOT NULL,
  storage_type TEXT CONSTRAINT chk_storage_devices_storage_type CHECK (storage_type IN ('SSD','HDD')) NOT NULL,
  interface TEXT CONSTRAINT chk_storage_devices_interface CHECK (interface IN ('SATA','NVMe','SAS','USB','Lainnya')) NULL,
  brand         VARCHAR(80)  NULL,
  model         VARCHAR(120) NULL,
  serial_number VARCHAR(100) NULL,
  capacity_gb   DECIMAL(10,1) NULL,
  is_active     SMALLINT NOT NULL DEFAULT 1,
  installed_at  DATE NULL,
  removed_at    DATE NULL,
  notes         VARCHAR(255) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sd_asset FOREIGN KEY (asset_id) REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_sd_asset ON storage_devices (asset_id, is_active);
CREATE INDEX idx_sd_serial ON storage_devices (serial_number);
CREATE TABLE maintenance_intervals (
  id            SERIAL PRIMARY KEY,
  device_type TEXT CONSTRAINT chk_maintenance_intervals_device_type CHECK (device_type IN ('Desktop PC','Laptop','Workstation','Lainnya')) NOT NULL,
  interval_type TEXT CONSTRAINT chk_maintenance_intervals_interval_type CHECK (interval_type IN ('Mingguan','Bulanan','Triwulanan','Semesteran','Tahunan','Kustom')) NOT NULL DEFAULT 'Triwulanan',
  interval_days INTEGER NOT NULL,
  notes         VARCHAR(255) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_mi_type UNIQUE (device_type)
);
CREATE TABLE hardware_thresholds (
  id             SERIAL PRIMARY KEY,
  parameter TEXT CONSTRAINT chk_hardware_thresholds_parameter CHECK (parameter IN ('CPU_TEMP','SSD_TEMP','HDD_TEMP','SSD_HEALTH','HDD_HEALTH','BATTERY_HEALTH')) NOT NULL,
  device_type TEXT CONSTRAINT chk_hardware_thresholds_device_type CHECK (device_type IN ('Desktop PC','Laptop','Workstation','Lainnya')) NULL,
  interface TEXT CONSTRAINT chk_hardware_thresholds_interface CHECK (interface IN ('SATA','NVMe','SAS','USB','Lainnya')) NULL,
  brand          VARCHAR(80)  NULL,
  model_pattern  VARCHAR(120) NULL,
  warning_value  DECIMAL(6,1) NOT NULL,
  critical_value DECIMAL(6,1) NOT NULL,
  direction TEXT CONSTRAINT chk_hardware_thresholds_direction CHECK (direction IN ('HIGHER_IS_WORSE','LOWER_IS_WORSE')) NOT NULL,
  reference      VARCHAR(255) NULL,
  notes          VARCHAR(255) NULL,
  is_active      SMALLINT NOT NULL DEFAULT 1,
  created_by     INTEGER NULL,
  updated_by     INTEGER NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ht_param ON hardware_thresholds (parameter, is_active);
CREATE TABLE app_settings (
  setting_key   VARCHAR(80) PRIMARY KEY,
  setting_value VARCHAR(500) NULL,
  description   VARCHAR(255) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE task_definitions (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(40)  NOT NULL,
  name        VARCHAR(150) NOT NULL,
  applies_to TEXT CONSTRAINT chk_task_definitions_applies_to CHECK (applies_to IN ('SEMUA','LAPTOP','DESKTOP')) NOT NULL DEFAULT 'SEMUA',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   SMALLINT NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_td_code UNIQUE (code)
);
CREATE TABLE number_sequences (
  seq_key     VARCHAR(40) PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE maintenance_schedules (
  id                    SERIAL PRIMARY KEY,
  asset_id              INTEGER NOT NULL,
  scheduled_date        DATE NOT NULL,
  technician_user_id    INTEGER NULL,
  interval_type         VARCHAR(30) NULL,
  status TEXT CONSTRAINT chk_maintenance_schedules_status CHECK (status IN ('Terjadwal','Dalam Proses','Selesai','Ditunda','Dibatalkan')) NOT NULL DEFAULT 'Terjadwal',
  source TEXT CONSTRAINT chk_maintenance_schedules_source CHECK (source IN ('MANUAL','OTOMATIS')) NOT NULL DEFAULT 'MANUAL',
  maintenance_record_id INTEGER NULL,
  notes                 VARCHAR(255) NULL,
  created_by            INTEGER NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at            TIMESTAMP NULL,
  CONSTRAINT fk_ms_asset FOREIGN KEY (asset_id)           REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_ms_tech  FOREIGN KEY (technician_user_id) REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_ms_date ON maintenance_schedules (scheduled_date, status);
CREATE INDEX idx_ms_asset ON maintenance_schedules (asset_id, status);
CREATE INDEX idx_ms_tech ON maintenance_schedules (technician_user_id);
CREATE TABLE maintenance_records (
  id                     SERIAL PRIMARY KEY,
  maintenance_no         VARCHAR(30) NOT NULL,
  asset_id               INTEGER NOT NULL,
  schedule_id            INTEGER NULL,
  maintenance_date       DATE NOT NULL,
  check_time             TIME NULL,
  technician_user_id     INTEGER NULL,
  status TEXT CONSTRAINT chk_maintenance_records_status CHECK (status IN ('Draft','Terjadwal','Dalam Proses','Selesai','Ditunda')) NOT NULL DEFAULT 'Draft',

  asset_code_snapshot    VARCHAR(50)  NOT NULL,
  hostname_snapshot      VARCHAR(100) NULL,
  device_type_snapshot   VARCHAR(40)  NULL,
  brand_model_snapshot   VARCHAR(200) NULL,
  employee_id            INTEGER NULL,
  employee_name_snapshot VARCHAR(150) NULL,
  employee_nik_snapshot  VARCHAR(40)  NULL,
  department_id          INTEGER NULL,
  department_snapshot    VARCHAR(120) NULL,
  work_unit_id           INTEGER NULL,
  work_unit_snapshot     VARCHAR(120) NULL,
  location_id            INTEGER NULL,
  location_snapshot      VARCHAR(255) NULL,
  room_snapshot          VARCHAR(120) NULL,

  cpu_temp_c             DECIMAL(5,1) NULL,
  cpu_load_condition TEXT CONSTRAINT chk_maintenance_records_cpu_load_condition CHECK (cpu_load_condition IN ('Idle','Normal','Beban Tinggi','Tidak Diketahui')) NULL,
  cpu_reading_tool       VARCHAR(80) NULL,
  cpu_data_source TEXT CONSTRAINT chk_maintenance_records_cpu_data_source CHECK (cpu_data_source IN ('MANUAL','AGENT')) NOT NULL DEFAULT 'MANUAL',
  cpu_read_at            TIMESTAMP NULL,
  hdd_presence TEXT CONSTRAINT chk_maintenance_records_hdd_presence CHECK (hdd_presence IN ('ADA','TIDAK_ADA')) NULL,
  physical_condition TEXT CONSTRAINT chk_maintenance_records_physical_condition CHECK (physical_condition IN ('Baik','Cukup','Rusak Ringan','Rusak Berat')) NULL,

  final_condition TEXT CONSTRAINT chk_maintenance_records_final_condition CHECK (final_condition IN ('Baik','Baik dengan catatan','Perlu Monitoring','Perlu Perbaikan','Kritis')) NULL,
  user_complaint         TEXT NULL,
  findings               TEXT NULL,
  root_cause             TEXT NULL,
  actions_taken          TEXT NULL,
  recommendation         TEXT NULL,
  spare_parts_needed     TEXT NULL,
  follow_up_status TEXT CONSTRAINT chk_maintenance_records_follow_up_status CHECK (follow_up_status IN ('Tidak Perlu','Perlu Tindak Lanjut','Dalam Proses','Selesai')) NULL,
  follow_up_pic          VARCHAR(150) NULL,
  follow_up_target_date  DATE NULL,
  next_maintenance_date  DATE NULL,

  evaluated_status TEXT CONSTRAINT chk_maintenance_records_evaluated_status CHECK (evaluated_status IN ('BELUM_DIEVALUASI','BAIK','PERHATIAN','KRITIS')) NOT NULL DEFAULT 'BELUM_DIEVALUASI',
  storage_status TEXT CONSTRAINT chk_maintenance_records_storage_status CHECK (storage_status IN ('BELUM_DIEVALUASI','BAIK','PERHATIAN','KRITIS','TIDAK_TERSEDIA')) NOT NULL DEFAULT 'BELUM_DIEVALUASI',
  priority TEXT CONSTRAINT chk_maintenance_records_priority CHECK (priority IN ('Rendah','Sedang','Tinggi','Kritis')) NULL,
  evaluation_json        TEXT NULL,
  evaluated_at           TIMESTAMP NULL,

  approval_status TEXT CONSTRAINT chk_maintenance_records_approval_status CHECK (approval_status IN ('Tidak Diperlukan','Menunggu','Disetujui','Ditolak')) NOT NULL DEFAULT 'Tidak Diperlukan',
  approved_by            INTEGER NULL,
  approved_at            TIMESTAMP NULL,
  approval_notes         VARCHAR(500) NULL,
  completed_at           TIMESTAMP NULL,
  data_source TEXT CONSTRAINT chk_maintenance_records_data_source CHECK (data_source IN ('MANUAL','AGENT','CAMPURAN')) NOT NULL DEFAULT 'MANUAL',
  created_by             INTEGER NULL,
  updated_by             INTEGER NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at             TIMESTAMP NULL,
  CONSTRAINT uq_mr_no UNIQUE (maintenance_no),
  CONSTRAINT fk_mr_asset    FOREIGN KEY (asset_id)           REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_mr_schedule FOREIGN KEY (schedule_id)        REFERENCES maintenance_schedules(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_mr_tech     FOREIGN KEY (technician_user_id) REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_mr_emp      FOREIGN KEY (employee_id)        REFERENCES employees(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_mr_approver FOREIGN KEY (approved_by)        REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_mr_asset_date ON maintenance_records (asset_id, maintenance_date);
CREATE INDEX idx_mr_date ON maintenance_records (maintenance_date);
CREATE INDEX idx_mr_status ON maintenance_records (status);
CREATE INDEX idx_mr_tech ON maintenance_records (technician_user_id);
CREATE INDEX idx_mr_dept ON maintenance_records (department_id);
CREATE INDEX idx_mr_unit ON maintenance_records (work_unit_id);
CREATE INDEX idx_mr_eval ON maintenance_records (evaluated_status);
CREATE INDEX idx_mr_final ON maintenance_records (final_condition);
ALTER TABLE maintenance_schedules
  ADD CONSTRAINT fk_ms_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE SET NULL;
CREATE TABLE maintenance_storage_readings (
  id                    SERIAL PRIMARY KEY,
  maintenance_record_id INTEGER NOT NULL,
  storage_device_id     INTEGER NULL,
  storage_type TEXT CONSTRAINT chk_maintenance_storage_readings_storage_type CHECK (storage_type IN ('SSD','HDD')) NOT NULL,
  interface TEXT CONSTRAINT chk_maintenance_storage_readings_interface CHECK (interface IN ('SATA','NVMe','SAS','USB','Lainnya')) NULL,
  brand                 VARCHAR(80)  NULL,
  model                 VARCHAR(120) NULL,
  serial_number         VARCHAR(100) NULL,
  capacity_gb           DECIMAL(10,1) NULL,
  temperature_c         DECIMAL(5,1) NULL,
  health_percent        DECIMAL(5,1) NULL,
  used_percent          DECIMAL(5,1) NULL,
  smart_status TEXT CONSTRAINT chk_maintenance_storage_readings_smart_status CHECK (smart_status IN ('Baik','Peringatan','Kritis','Tidak Tersedia')) NULL,
  reading_tool          VARCHAR(80) NULL,
  data_source TEXT CONSTRAINT chk_maintenance_storage_readings_data_source CHECK (data_source IN ('MANUAL','AGENT')) NOT NULL DEFAULT 'MANUAL',
  read_at               TIMESTAMP NULL,
  evaluated_level TEXT CONSTRAINT chk_maintenance_storage_readings_evaluated_level CHECK (evaluated_level IN ('BAIK','PERHATIAN','KRITIS','TIDAK_TERSEDIA')) NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msr_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_msr_device FOREIGN KEY (storage_device_id)     REFERENCES storage_devices(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_msr_record ON maintenance_storage_readings (maintenance_record_id);
CREATE INDEX idx_msr_device ON maintenance_storage_readings (storage_device_id);
CREATE TABLE maintenance_battery_readings (
  id                       SERIAL PRIMARY KEY,
  maintenance_record_id    INTEGER NOT NULL,
  is_applicable            SMALLINT NOT NULL DEFAULT 1,
  health_percent           DECIMAL(5,1) NULL,
  design_capacity_mwh      INTEGER NULL,
  full_charge_capacity_mwh INTEGER NULL,
  cycle_count              INTEGER NULL,
  battery_status TEXT CONSTRAINT chk_maintenance_battery_readings_battery_status CHECK (battery_status IN ('Baik','Menurun','Perlu Penggantian','Tidak Terdeteksi','Tidak Dapat Dibaca')) NULL,
  notes                    TEXT NULL,
  data_source TEXT CONSTRAINT chk_maintenance_battery_readings_data_source CHECK (data_source IN ('MANUAL','AGENT')) NOT NULL DEFAULT 'MANUAL',
  read_at                  TIMESTAMP NULL,
  evaluated_level TEXT CONSTRAINT chk_maintenance_battery_readings_evaluated_level CHECK (evaluated_level IN ('BAIK','PERHATIAN','KRITIS','TIDAK_TERSEDIA')) NULL,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_mbr_record UNIQUE (maintenance_record_id),
  CONSTRAINT fk_mbr_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE maintenance_tasks (
  id                    SERIAL PRIMARY KEY,
  maintenance_record_id INTEGER NOT NULL,
  task_definition_id    INTEGER NULL,
  task_code             VARCHAR(40)  NOT NULL,
  task_name             VARCHAR(150) NOT NULL,
  status TEXT CONSTRAINT chk_maintenance_tasks_status CHECK (status IN ('Sudah dilakukan','Tidak diperlukan','Belum dilakukan')) NULL,
  notes                 VARCHAR(255) NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_mt UNIQUE (maintenance_record_id, task_code),
  CONSTRAINT fk_mt_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_mt_def    FOREIGN KEY (task_definition_id)    REFERENCES task_definitions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE maintenance_attachments (
  id                    SERIAL PRIMARY KEY,
  maintenance_record_id INTEGER NULL,
  repair_record_id      INTEGER NULL,
  category TEXT CONSTRAINT chk_maintenance_attachments_category CHECK (category IN ('FOTO_SEBELUM','FOTO_SESUDAH','SCREENSHOT_STORAGE','DOKUMEN_PDF','BUKTI_SPAREPART')) NOT NULL,
  original_name         VARCHAR(255) NOT NULL,
  stored_path           VARCHAR(255) NOT NULL,
  mime_type             VARCHAR(80)  NOT NULL,
  size_bytes            INTEGER NOT NULL,
  sha256                CHAR(64)     NOT NULL,
  uploaded_by           INTEGER NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at            TIMESTAMP NULL,
  CONSTRAINT fk_matt_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_matt_user   FOREIGN KEY (uploaded_by)           REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_matt_record ON maintenance_attachments (maintenance_record_id);
CREATE TABLE repair_records (
  id                    SERIAL PRIMARY KEY,
  asset_id              INTEGER NOT NULL,
  maintenance_record_id INTEGER NULL,
  follow_up_id          INTEGER NULL,
  repair_date           DATE NOT NULL,
  repair_type TEXT CONSTRAINT chk_repair_records_repair_type CHECK (repair_type IN ('Perbaikan','Penggantian Komponen','Upgrade')) NOT NULL,
  component             VARCHAR(120) NOT NULL,
  old_part              VARCHAR(200) NULL,
  new_part              VARCHAR(200) NULL,
  new_part_serial       VARCHAR(100) NULL,
  cost                  DECIMAL(14,2) NULL,
  vendor                VARCHAR(150) NULL,
  technician_user_id    INTEGER NULL,
  description           TEXT NULL,
  created_by            INTEGER NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at            TIMESTAMP NULL,
  CONSTRAINT fk_rr_asset  FOREIGN KEY (asset_id)              REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_rr_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_rr_tech   FOREIGN KEY (technician_user_id)    REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_rr_asset ON repair_records (asset_id, repair_date);
ALTER TABLE maintenance_attachments
  ADD CONSTRAINT fk_matt_repair FOREIGN KEY (repair_record_id) REFERENCES repair_records(id);
CREATE TABLE user_complaints (
  id                 SERIAL PRIMARY KEY,
  asset_id           INTEGER NOT NULL,
  reporter_user_id   INTEGER NOT NULL,
  employee_id        INTEGER NULL,
  category TEXT CONSTRAINT chk_user_complaints_category CHECK (category IN ('Performa Lambat','Panas Berlebih','Suara Kipas','Baterai','Storage / Disk','Layar','Keyboard / Mouse','Jaringan','Lainnya')) NOT NULL,
  description        TEXT NOT NULL,
  status TEXT CONSTRAINT chk_user_complaints_status CHECK (status IN ('Baru','Ditinjau','Ditindaklanjuti','Selesai','Ditolak')) NOT NULL DEFAULT 'Baru',
  it_response        TEXT NULL,
  handled_by         INTEGER NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_uc_asset    FOREIGN KEY (asset_id)         REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_uc_reporter FOREIGN KEY (reporter_user_id) REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_uc_handler  FOREIGN KEY (handled_by)       REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_uc_asset ON user_complaints (asset_id);
CREATE INDEX idx_uc_status ON user_complaints (status);
CREATE TABLE follow_up_actions (
  id                    SERIAL PRIMARY KEY,
  asset_id              INTEGER NOT NULL,
  maintenance_record_id INTEGER NULL,
  complaint_id          INTEGER NULL,
  title                 VARCHAR(200) NOT NULL,
  description           TEXT NULL,
  priority TEXT CONSTRAINT chk_follow_up_actions_priority CHECK (priority IN ('Rendah','Sedang','Tinggi','Kritis')) NOT NULL DEFAULT 'Sedang',
  status TEXT CONSTRAINT chk_follow_up_actions_status CHECK (status IN ('Terbuka','Dalam Proses','Menunggu Sparepart','Selesai','Dibatalkan')) NOT NULL DEFAULT 'Terbuka',
  pic_user_id           INTEGER NULL,
  pic_name              VARCHAR(150) NULL,
  target_date           DATE NULL,
  completed_at          TIMESTAMP NULL,
  resolution            TEXT NULL,
  is_auto_generated     SMALLINT NOT NULL DEFAULT 0,
  reviewed_by           INTEGER NULL,
  reviewed_at           TIMESTAMP NULL,
  created_by            INTEGER NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at            TIMESTAMP NULL,
  CONSTRAINT fk_fu_asset     FOREIGN KEY (asset_id)              REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_fu_record    FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_fu_complaint FOREIGN KEY (complaint_id)          REFERENCES user_complaints(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_fu_pic       FOREIGN KEY (pic_user_id)           REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_fu_status ON follow_up_actions (status, priority);
CREATE INDEX idx_fu_asset ON follow_up_actions (asset_id);
CREATE INDEX idx_fu_pic ON follow_up_actions (pic_user_id);
ALTER TABLE repair_records
  ADD CONSTRAINT fk_rr_followup FOREIGN KEY (follow_up_id) REFERENCES follow_up_actions(id) ON DELETE SET NULL;
CREATE TABLE agent_tokens (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  token_prefix CHAR(8)      NOT NULL,
  token_hash   CHAR(64)     NOT NULL,
  is_active    SMALLINT   NOT NULL DEFAULT 1,
  last_used_at TIMESTAMP NULL,
  created_by   INTEGER NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_agent_hash UNIQUE (token_hash)
);
CREATE TABLE agent_readings (
  id                SERIAL PRIMARY KEY,
  agent_token_id    INTEGER NULL,
  asset_id          INTEGER NULL,
  reported_hostname VARCHAR(100) NULL,
  reported_serial   VARCHAR(100) NULL,
  agent_version     VARCHAR(30)  NULL,
  collected_at      TIMESTAMP NOT NULL,
  received_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload_json      TEXT NOT NULL,
  validation_status TEXT CONSTRAINT chk_agent_readings_validation_status CHECK (validation_status IN ('VALID','SEBAGIAN','DITOLAK')) NOT NULL,
  validation_notes  TEXT NULL,
  used_in_record_id INTEGER NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ar_token  FOREIGN KEY (agent_token_id)    REFERENCES agent_tokens(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_ar_asset  FOREIGN KEY (asset_id)          REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_ar_record FOREIGN KEY (used_in_record_id) REFERENCES maintenance_records(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_ar_asset ON agent_readings (asset_id, collected_at);
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NULL,
  username    VARCHAR(60) NULL,
  action      VARCHAR(60) NOT NULL,
  entity_type VARCHAR(60) NULL,
  entity_id   VARCHAR(40) NULL,
  description VARCHAR(500) NULL,
  old_values  TEXT NULL,
  new_values  TEXT NULL,
  ip_address  VARCHAR(45) NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_logs (user_id, created_at);
CREATE INDEX idx_audit_created ON audit_logs (created_at);
CREATE TABLE demo_registry (
  id         SERIAL PRIMARY KEY,
  table_name VARCHAR(60) NOT NULL,
  record_id  INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_demo_table ON demo_registry (table_name);

CREATE TRIGGER trg_touch_roles BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_permissions BEFORE UPDATE ON permissions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_departments BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_locations BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_employees BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_work_units BEFORE UPDATE ON work_units FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_assets BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_asset_assignments BEFORE UPDATE ON asset_assignments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_asset_movements BEFORE UPDATE ON asset_movements FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_storage_devices BEFORE UPDATE ON storage_devices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_maintenance_intervals BEFORE UPDATE ON maintenance_intervals FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_hardware_thresholds BEFORE UPDATE ON hardware_thresholds FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_app_settings BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_task_definitions BEFORE UPDATE ON task_definitions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_number_sequences BEFORE UPDATE ON number_sequences FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_maintenance_schedules BEFORE UPDATE ON maintenance_schedules FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_maintenance_records BEFORE UPDATE ON maintenance_records FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_maintenance_storage_readings BEFORE UPDATE ON maintenance_storage_readings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_maintenance_battery_readings BEFORE UPDATE ON maintenance_battery_readings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_maintenance_tasks BEFORE UPDATE ON maintenance_tasks FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_maintenance_attachments BEFORE UPDATE ON maintenance_attachments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_repair_records BEFORE UPDATE ON repair_records FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_user_complaints BEFORE UPDATE ON user_complaints FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_follow_up_actions BEFORE UPDATE ON follow_up_actions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_agent_tokens BEFORE UPDATE ON agent_tokens FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_agent_readings BEFORE UPDATE ON agent_readings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_audit_logs BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_demo_registry BEFORE UPDATE ON demo_registry FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
