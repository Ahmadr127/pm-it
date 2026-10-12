-- =====================================================================
-- PM-IT Asset Monitoring — Skema inti
-- Kompatibel: MySQL 8.0+ / MariaDB 10.4+ (termasuk XAMPP)
-- Aturan: NULL = tidak berlaku / tidak diperiksa / tidak tersedia.
--         Tidak pernah memakai 0 sebagai pengganti data yang tidak ada.
-- =====================================================================

-- ---------- Akses & akun ----------
CREATE TABLE roles (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(40)  NOT NULL,
  name          VARCHAR(100) NOT NULL,
  description   VARCHAR(255) NULL,
  is_system     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(60)  NOT NULL,
  name        VARCHAR(150) NOT NULL,
  group_name  VARCHAR(60)  NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_permissions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
  role_id       INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Struktur organisasi ----------
CREATE TABLE departments (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(30)  NULL,
  name        VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  DATETIME NULL,
  UNIQUE KEY uq_departments_name (name),
  KEY idx_departments_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE locations (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL COMMENT 'Nama lokasi / site',
  building    VARCHAR(120) NULL     COMMENT 'Nama gedung',
  floor       VARCHAR(30)  NULL,
  room        VARCHAR(120) NULL     COMMENT 'Nama ruangan',
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  DATETIME NULL,
  UNIQUE KEY uq_locations (name, building, room),
  KEY idx_locations_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE employees (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nik             VARCHAR(40)  NOT NULL,
  full_name       VARCHAR(150) NOT NULL,
  position        VARCHAR(120) NULL,
  department_id   INT UNSIGNED NULL,
  work_unit_id    INT UNSIGNED NULL,
  location_id     INT UNSIGNED NULL,
  room            VARCHAR(120) NULL,
  phone_ext       VARCHAR(20)  NULL,
  email           VARCHAR(150) NULL,
  supervisor_name VARCHAR(150) NULL COMMENT 'Nama atasan / PIC unit',
  status          ENUM('Aktif','Dipindahkan','Dipinjamkan','Tidak Aktif') NOT NULL DEFAULT 'Aktif',
  notes           TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  UNIQUE KEY uq_employees_nik (nik),
  KEY idx_employees_name (full_name),
  KEY idx_employees_dept (department_id),
  KEY idx_employees_unit (work_unit_id),
  KEY idx_employees_status (status),
  CONSTRAINT fk_emp_dept FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_emp_loc  FOREIGN KEY (location_id)   REFERENCES locations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE work_units (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id   INT UNSIGNED NOT NULL,
  name            VARCHAR(120) NOT NULL,
  location_id     INT UNSIGNED NULL,
  pic_employee_id INT UNSIGNED NULL,
  pic_name        VARCHAR(150) NULL COMMENT 'Diisi bila PIC bukan karyawan terdaftar',
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  UNIQUE KEY uq_work_units (department_id, name),
  KEY idx_work_units_active (is_active),
  CONSTRAINT fk_wu_dept FOREIGN KEY (department_id)   REFERENCES departments(id),
  CONSTRAINT fk_wu_loc  FOREIGN KEY (location_id)     REFERENCES locations(id),
  CONSTRAINT fk_wu_pic  FOREIGN KEY (pic_employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE employees
  ADD CONSTRAINT fk_emp_unit FOREIGN KEY (work_unit_id) REFERENCES work_units(id);

CREATE TABLE users (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id              INT UNSIGNED NOT NULL,
  employee_id          INT UNSIGNED NULL COMMENT 'Tautan ke data karyawan (wajib untuk role User)',
  username             VARCHAR(60)  NOT NULL,
  full_name            VARCHAR(150) NOT NULL,
  email                VARCHAR(150) NULL,
  password_hash        VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1)   NOT NULL DEFAULT 0,
  is_active            TINYINT(1)   NOT NULL DEFAULT 1,
  failed_attempts      INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until         DATETIME NULL,
  last_login_at        DATETIME NULL,
  password_changed_at  DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at           DATETIME NULL,
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_role (role_id),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id)     REFERENCES roles(id),
  CONSTRAINT fk_users_emp  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Aset ----------
CREATE TABLE assets (
  id                        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_code                VARCHAR(50)  NOT NULL COMMENT 'Contoh: ADEV-IT-PC-0008',
  inventory_number          VARCHAR(60)  NULL,
  hostname                  VARCHAR(100) NOT NULL,
  device_type               ENUM('Desktop PC','Laptop','Workstation','Lainnya') NOT NULL,
  device_type_other         VARCHAR(80)  NULL,
  brand                     VARCHAR(80)  NULL,
  model                     VARCHAR(120) NULL,
  serial_number             VARCHAR(100) NULL,
  processor                 VARCHAR(150) NULL,
  ram_gb                    DECIMAL(6,1) NULL,
  storage_summary           VARCHAR(200) NULL COMMENT 'Ringkasan jenis & kapasitas storage',
  gpu                       VARCHAR(150) NULL,
  operating_system          VARCHAR(120) NULL,
  ip_address                VARCHAR(45)  NULL,
  mac_address               VARCHAR(17)  NULL,
  location_id               INT UNSIGNED NULL,
  purchase_date             DATE NULL,
  warranty_status           ENUM('Aktif','Habis','Tidak Ada','Tidak Diketahui') NOT NULL DEFAULT 'Tidak Diketahui',
  warranty_until            DATE NULL,
  physical_condition        ENUM('Baik','Cukup','Rusak Ringan','Rusak Berat') NULL,
  asset_status              ENUM('Aktif','Dipinjamkan','Dalam Perbaikan','Cadangan','Nonaktif') NOT NULL DEFAULT 'Aktif',
  has_battery               TINYINT(1) NOT NULL DEFAULT 0,
  maintenance_interval_days INT UNSIGNED NULL COMMENT 'Override interval; NULL = ikut kebijakan jenis perangkat',
  photo_path                VARCHAR(255) NULL,
  notes                     TEXT NULL,
  -- denormalisasi status terkini (dipelihara oleh service, untuk filter cepat)
  current_employee_id       INT UNSIGNED NULL,
  current_department_id     INT UNSIGNED NULL,
  current_work_unit_id      INT UNSIGNED NULL,
  current_health_status     ENUM('BELUM_DIEVALUASI','BAIK','PERHATIAN','KRITIS') NOT NULL DEFAULT 'BELUM_DIEVALUASI',
  last_maintenance_date     DATE NULL,
  next_maintenance_date     DATE NULL,
  created_by                INT UNSIGNED NULL,
  updated_by                INT UNSIGNED NULL,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at                DATETIME NULL,
  UNIQUE KEY uq_assets_code (asset_code),
  UNIQUE KEY uq_assets_inventory (inventory_number),
  KEY idx_assets_hostname (hostname),
  KEY idx_assets_serial (serial_number),
  KEY idx_assets_type (device_type),
  KEY idx_assets_status (asset_status),
  KEY idx_assets_health (current_health_status),
  KEY idx_assets_next (next_maintenance_date),
  KEY idx_assets_unit (current_work_unit_id),
  KEY idx_assets_loc (location_id),
  CONSTRAINT fk_assets_loc  FOREIGN KEY (location_id)           REFERENCES locations(id),
  CONSTRAINT fk_assets_emp  FOREIGN KEY (current_employee_id)   REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_dept FOREIGN KEY (current_department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_unit FOREIGN KEY (current_work_unit_id)  REFERENCES work_units(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Riwayat penugasan: TIDAK pernah dihapus saat pindah — baris lama ditutup (end_date).
-- Kolom department/unit/location adalah snapshot saat penugasan berlaku.
CREATE TABLE asset_assignments (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id        INT UNSIGNED NOT NULL,
  employee_id     INT UNSIGNED NULL,
  assignment_role ENUM('PENGGUNA_UTAMA','PIC_UNIT') NOT NULL DEFAULT 'PENGGUNA_UTAMA',
  department_id   INT UNSIGNED NULL,
  work_unit_id    INT UNSIGNED NULL,
  location_id     INT UNSIGNED NULL,
  room            VARCHAR(120) NULL,
  employee_name_snapshot   VARCHAR(150) NULL,
  department_name_snapshot VARCHAR(120) NULL,
  work_unit_name_snapshot  VARCHAR(120) NULL,
  location_text_snapshot   VARCHAR(255) NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NULL,
  status          ENUM('Aktif','Dipindahkan','Dipinjamkan','Tidak Aktif') NOT NULL DEFAULT 'Aktif',
  is_current      TINYINT(1) NOT NULL DEFAULT 1,
  reason          VARCHAR(255) NULL,
  notes           TEXT NULL,
  created_by      INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_aa_asset (asset_id, is_current),
  KEY idx_aa_emp (employee_id, is_current),
  KEY idx_aa_unit (work_unit_id),
  CONSTRAINT fk_aa_asset FOREIGN KEY (asset_id)      REFERENCES assets(id),
  CONSTRAINT fk_aa_emp   FOREIGN KEY (employee_id)   REFERENCES employees(id),
  CONSTRAINT fk_aa_dept  FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_aa_unit  FOREIGN KEY (work_unit_id)  REFERENCES work_units(id),
  CONSTRAINT fk_aa_loc   FOREIGN KEY (location_id)   REFERENCES locations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jejak perpindahan lokasi / pengguna / departemen / status aset (append-only)
CREATE TABLE asset_movements (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id      INT UNSIGNED NOT NULL,
  movement_type ENUM('PENGGUNA','DEPARTEMEN','UNIT_KERJA','LOKASI','STATUS') NOT NULL,
  from_value    VARCHAR(255) NULL,
  to_value      VARCHAR(255) NULL,
  moved_at      DATETIME NOT NULL,
  reason        VARCHAR(255) NULL,
  moved_by      INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_am_asset (asset_id, moved_at),
  CONSTRAINT fk_am_asset FOREIGN KEY (asset_id) REFERENCES assets(id),
  CONSTRAINT fk_am_user  FOREIGN KEY (moved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE storage_devices (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id      INT UNSIGNED NOT NULL,
  storage_type  ENUM('SSD','HDD') NOT NULL,
  interface     ENUM('SATA','NVMe','SAS','USB','Lainnya') NULL,
  brand         VARCHAR(80)  NULL,
  model         VARCHAR(120) NULL,
  serial_number VARCHAR(100) NULL,
  capacity_gb   DECIMAL(10,1) NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  installed_at  DATE NULL,
  removed_at    DATE NULL,
  notes         VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sd_asset (asset_id, is_active),
  KEY idx_sd_serial (serial_number),
  CONSTRAINT fk_sd_asset FOREIGN KEY (asset_id) REFERENCES assets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Kebijakan & konfigurasi ----------
CREATE TABLE maintenance_intervals (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_type   ENUM('Desktop PC','Laptop','Workstation','Lainnya') NOT NULL,
  interval_type ENUM('Mingguan','Bulanan','Triwulanan','Semesteran','Tahunan','Kustom') NOT NULL DEFAULT 'Triwulanan',
  interval_days INT UNSIGNED NOT NULL,
  notes         VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mi_type (device_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Threshold dapat dibuat spesifik per jenis perangkat / antarmuka / merek / pola model.
-- Aturan paling spesifik yang cocok akan dipakai (lihat src/services/evaluation.js).
CREATE TABLE hardware_thresholds (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  parameter      ENUM('CPU_TEMP','SSD_TEMP','HDD_TEMP','SSD_HEALTH','HDD_HEALTH','BATTERY_HEALTH') NOT NULL,
  device_type    ENUM('Desktop PC','Laptop','Workstation','Lainnya') NULL COMMENT 'NULL = semua jenis',
  interface      ENUM('SATA','NVMe','SAS','USB','Lainnya') NULL COMMENT 'Khusus storage; NULL = semua',
  brand          VARCHAR(80)  NULL COMMENT 'NULL = semua merek',
  model_pattern  VARCHAR(120) NULL COMMENT 'Potongan teks model, cocok bila model mengandung teks ini',
  warning_value  DECIMAL(6,1) NOT NULL,
  critical_value DECIMAL(6,1) NOT NULL,
  direction      ENUM('HIGHER_IS_WORSE','LOWER_IS_WORSE') NOT NULL,
  reference      VARCHAR(255) NULL COMMENT 'Sumber: datasheet produsen / kebijakan IT',
  notes          VARCHAR(255) NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_by     INT UNSIGNED NULL,
  updated_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ht_param (parameter, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE app_settings (
  setting_key   VARCHAR(80) PRIMARY KEY,
  setting_value VARCHAR(500) NULL,
  description   VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_definitions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(40)  NOT NULL,
  name        VARCHAR(150) NOT NULL,
  applies_to  ENUM('SEMUA','LAPTOP','DESKTOP') NOT NULL DEFAULT 'SEMUA',
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_td_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE number_sequences (
  seq_key     VARCHAR(40) PRIMARY KEY COMMENT 'mis. PM-202610',
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Maintenance ----------
CREATE TABLE maintenance_schedules (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id              INT UNSIGNED NOT NULL,
  scheduled_date        DATE NOT NULL,
  technician_user_id    INT UNSIGNED NULL,
  interval_type         VARCHAR(30) NULL,
  status                ENUM('Terjadwal','Dalam Proses','Selesai','Ditunda','Dibatalkan') NOT NULL DEFAULT 'Terjadwal',
  source                ENUM('MANUAL','OTOMATIS') NOT NULL DEFAULT 'MANUAL',
  maintenance_record_id INT UNSIGNED NULL,
  notes                 VARCHAR(255) NULL,
  created_by            INT UNSIGNED NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            DATETIME NULL,
  KEY idx_ms_date (scheduled_date, status),
  KEY idx_ms_asset (asset_id, status),
  KEY idx_ms_tech (technician_user_id),
  CONSTRAINT fk_ms_asset FOREIGN KEY (asset_id)           REFERENCES assets(id),
  CONSTRAINT fk_ms_tech  FOREIGN KEY (technician_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Snapshot identitas aset & pengguna disimpan pada record agar riwayat tidak berubah
-- ketika perangkat / pengguna berpindah unit di kemudian hari.
CREATE TABLE maintenance_records (
  id                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  maintenance_no         VARCHAR(30) NOT NULL,
  asset_id               INT UNSIGNED NOT NULL,
  schedule_id            INT UNSIGNED NULL,
  maintenance_date       DATE NOT NULL,
  check_time             TIME NULL,
  technician_user_id     INT UNSIGNED NULL,
  status                 ENUM('Draft','Terjadwal','Dalam Proses','Selesai','Ditunda') NOT NULL DEFAULT 'Draft',
  -- snapshot
  asset_code_snapshot    VARCHAR(50)  NOT NULL,
  hostname_snapshot      VARCHAR(100) NULL,
  device_type_snapshot   VARCHAR(40)  NULL,
  brand_model_snapshot   VARCHAR(200) NULL,
  employee_id            INT UNSIGNED NULL,
  employee_name_snapshot VARCHAR(150) NULL,
  employee_nik_snapshot  VARCHAR(40)  NULL,
  department_id          INT UNSIGNED NULL,
  department_snapshot    VARCHAR(120) NULL,
  work_unit_id           INT UNSIGNED NULL,
  work_unit_snapshot     VARCHAR(120) NULL,
  location_id            INT UNSIGNED NULL,
  location_snapshot      VARCHAR(255) NULL,
  room_snapshot          VARCHAR(120) NULL,
  -- CPU
  cpu_temp_c             DECIMAL(5,1) NULL COMMENT 'NULL = tidak diperiksa / tidak tersedia',
  cpu_load_condition     ENUM('Idle','Normal','Beban Tinggi','Tidak Diketahui') NULL,
  cpu_reading_tool       VARCHAR(80) NULL,
  cpu_data_source        ENUM('MANUAL','AGENT') NOT NULL DEFAULT 'MANUAL',
  cpu_read_at            DATETIME NULL,
  hdd_presence           ENUM('ADA','TIDAK_ADA') NULL COMMENT 'TIDAK_ADA => tidak ada baris HDD (NULL, bukan 0%)',
  physical_condition     ENUM('Baik','Cukup','Rusak Ringan','Rusak Berat') NULL,
  -- kondisi akhir & temuan
  final_condition        ENUM('Baik','Baik dengan catatan','Perlu Monitoring','Perlu Perbaikan','Kritis') NULL,
  user_complaint         TEXT NULL,
  findings               TEXT NULL,
  root_cause             TEXT NULL,
  actions_taken          TEXT NULL,
  recommendation         TEXT NULL,
  spare_parts_needed     TEXT NULL,
  follow_up_status       ENUM('Tidak Perlu','Perlu Tindak Lanjut','Dalam Proses','Selesai') NULL,
  follow_up_pic          VARCHAR(150) NULL,
  follow_up_target_date  DATE NULL,
  next_maintenance_date  DATE NULL,
  -- hasil evaluasi otomatis
  evaluated_status       ENUM('BELUM_DIEVALUASI','BAIK','PERHATIAN','KRITIS') NOT NULL DEFAULT 'BELUM_DIEVALUASI',
  storage_status         ENUM('BELUM_DIEVALUASI','BAIK','PERHATIAN','KRITIS','TIDAK_TERSEDIA') NOT NULL DEFAULT 'BELUM_DIEVALUASI',
  priority               ENUM('Rendah','Sedang','Tinggi','Kritis') NULL,
  evaluation_json        LONGTEXT NULL,
  evaluated_at           DATETIME NULL,
  -- persetujuan
  approval_status        ENUM('Tidak Diperlukan','Menunggu','Disetujui','Ditolak') NOT NULL DEFAULT 'Tidak Diperlukan',
  approved_by            INT UNSIGNED NULL,
  approved_at            DATETIME NULL,
  approval_notes         VARCHAR(500) NULL,
  completed_at           DATETIME NULL,
  data_source            ENUM('MANUAL','AGENT','CAMPURAN') NOT NULL DEFAULT 'MANUAL',
  created_by             INT UNSIGNED NULL,
  updated_by             INT UNSIGNED NULL,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at             DATETIME NULL,
  UNIQUE KEY uq_mr_no (maintenance_no),
  KEY idx_mr_asset_date (asset_id, maintenance_date),
  KEY idx_mr_date (maintenance_date),
  KEY idx_mr_status (status),
  KEY idx_mr_tech (technician_user_id),
  KEY idx_mr_dept (department_id),
  KEY idx_mr_unit (work_unit_id),
  KEY idx_mr_eval (evaluated_status),
  KEY idx_mr_final (final_condition),
  CONSTRAINT fk_mr_asset    FOREIGN KEY (asset_id)           REFERENCES assets(id),
  CONSTRAINT fk_mr_schedule FOREIGN KEY (schedule_id)        REFERENCES maintenance_schedules(id) ON DELETE SET NULL,
  CONSTRAINT fk_mr_tech     FOREIGN KEY (technician_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_mr_emp      FOREIGN KEY (employee_id)        REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_mr_approver FOREIGN KEY (approved_by)        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE maintenance_schedules
  ADD CONSTRAINT fk_ms_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE SET NULL;

CREATE TABLE maintenance_storage_readings (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  maintenance_record_id INT UNSIGNED NOT NULL,
  storage_device_id     INT UNSIGNED NULL,
  storage_type          ENUM('SSD','HDD') NOT NULL,
  interface             ENUM('SATA','NVMe','SAS','USB','Lainnya') NULL,
  brand                 VARCHAR(80)  NULL,
  model                 VARCHAR(120) NULL,
  serial_number         VARCHAR(100) NULL,
  capacity_gb           DECIMAL(10,1) NULL,
  temperature_c         DECIMAL(5,1) NULL COMMENT 'NULL = tidak diperiksa',
  health_percent        DECIMAL(5,1) NULL COMMENT 'NULL = tidak diperiksa',
  used_percent          DECIMAL(5,1) NULL,
  smart_status          ENUM('Baik','Peringatan','Kritis','Tidak Tersedia') NULL COMMENT 'NULL = belum diperiksa',
  reading_tool          VARCHAR(80) NULL,
  data_source           ENUM('MANUAL','AGENT') NOT NULL DEFAULT 'MANUAL',
  read_at               DATETIME NULL,
  evaluated_level       ENUM('BAIK','PERHATIAN','KRITIS','TIDAK_TERSEDIA') NULL,
  sort_order            INT NOT NULL DEFAULT 0,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_msr_record (maintenance_record_id),
  KEY idx_msr_device (storage_device_id),
  CONSTRAINT fk_msr_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_msr_device FOREIGN KEY (storage_device_id)     REFERENCES storage_devices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE maintenance_battery_readings (
  id                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  maintenance_record_id    INT UNSIGNED NOT NULL,
  is_applicable            TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = Tidak Berlaku (desktop / tanpa baterai)',
  health_percent           DECIMAL(5,1) NULL,
  design_capacity_mwh      INT UNSIGNED NULL,
  full_charge_capacity_mwh INT UNSIGNED NULL,
  cycle_count              INT UNSIGNED NULL,
  battery_status           ENUM('Baik','Menurun','Perlu Penggantian','Tidak Terdeteksi','Tidak Dapat Dibaca') NULL,
  notes                    TEXT NULL,
  data_source              ENUM('MANUAL','AGENT') NOT NULL DEFAULT 'MANUAL',
  read_at                  DATETIME NULL,
  evaluated_level          ENUM('BAIK','PERHATIAN','KRITIS','TIDAK_TERSEDIA') NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mbr_record (maintenance_record_id),
  CONSTRAINT fk_mbr_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status NULL = teknisi belum mengonfirmasi (tidak pernah dianggap selesai otomatis)
CREATE TABLE maintenance_tasks (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  maintenance_record_id INT UNSIGNED NOT NULL,
  task_definition_id    INT UNSIGNED NULL,
  task_code             VARCHAR(40)  NOT NULL,
  task_name             VARCHAR(150) NOT NULL,
  status                ENUM('Sudah dilakukan','Tidak diperlukan','Belum dilakukan') NULL,
  notes                 VARCHAR(255) NULL,
  sort_order            INT NOT NULL DEFAULT 0,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mt (maintenance_record_id, task_code),
  CONSTRAINT fk_mt_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_mt_def    FOREIGN KEY (task_definition_id)    REFERENCES task_definitions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE maintenance_attachments (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  maintenance_record_id INT UNSIGNED NULL,
  repair_record_id      INT UNSIGNED NULL,
  category              ENUM('FOTO_SEBELUM','FOTO_SESUDAH','SCREENSHOT_STORAGE','DOKUMEN_PDF','BUKTI_SPAREPART') NOT NULL,
  original_name         VARCHAR(255) NOT NULL,
  stored_path           VARCHAR(255) NOT NULL COMMENT 'Relatif terhadap UPLOAD_DIR, nama acak',
  mime_type             VARCHAR(80)  NOT NULL,
  size_bytes            INT UNSIGNED NOT NULL,
  sha256                CHAR(64)     NOT NULL,
  uploaded_by           INT UNSIGNED NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            DATETIME NULL,
  KEY idx_matt_record (maintenance_record_id),
  CONSTRAINT fk_matt_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id),
  CONSTRAINT fk_matt_user   FOREIGN KEY (uploaded_by)           REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE repair_records (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id              INT UNSIGNED NOT NULL,
  maintenance_record_id INT UNSIGNED NULL,
  follow_up_id          INT UNSIGNED NULL,
  repair_date           DATE NOT NULL,
  repair_type           ENUM('Perbaikan','Penggantian Komponen','Upgrade') NOT NULL,
  component             VARCHAR(120) NOT NULL,
  old_part              VARCHAR(200) NULL,
  new_part              VARCHAR(200) NULL,
  new_part_serial       VARCHAR(100) NULL,
  cost                  DECIMAL(14,2) NULL,
  vendor                VARCHAR(150) NULL,
  technician_user_id    INT UNSIGNED NULL,
  description           TEXT NULL,
  created_by            INT UNSIGNED NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            DATETIME NULL,
  KEY idx_rr_asset (asset_id, repair_date),
  CONSTRAINT fk_rr_asset  FOREIGN KEY (asset_id)              REFERENCES assets(id),
  CONSTRAINT fk_rr_record FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE SET NULL,
  CONSTRAINT fk_rr_tech   FOREIGN KEY (technician_user_id)    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE maintenance_attachments
  ADD CONSTRAINT fk_matt_repair FOREIGN KEY (repair_record_id) REFERENCES repair_records(id);

CREATE TABLE user_complaints (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id           INT UNSIGNED NOT NULL,
  reporter_user_id   INT UNSIGNED NOT NULL,
  employee_id        INT UNSIGNED NULL,
  category           ENUM('Performa Lambat','Panas Berlebih','Suara Kipas','Baterai','Storage / Disk','Layar','Keyboard / Mouse','Jaringan','Lainnya') NOT NULL,
  description        TEXT NOT NULL,
  status             ENUM('Baru','Ditinjau','Ditindaklanjuti','Selesai','Ditolak') NOT NULL DEFAULT 'Baru',
  it_response        TEXT NULL,
  handled_by         INT UNSIGNED NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_uc_asset (asset_id),
  KEY idx_uc_status (status),
  CONSTRAINT fk_uc_asset    FOREIGN KEY (asset_id)         REFERENCES assets(id),
  CONSTRAINT fk_uc_reporter FOREIGN KEY (reporter_user_id) REFERENCES users(id),
  CONSTRAINT fk_uc_handler  FOREIGN KEY (handled_by)       REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE follow_up_actions (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id              INT UNSIGNED NOT NULL,
  maintenance_record_id INT UNSIGNED NULL,
  complaint_id          INT UNSIGNED NULL,
  title                 VARCHAR(200) NOT NULL,
  description           TEXT NULL,
  priority              ENUM('Rendah','Sedang','Tinggi','Kritis') NOT NULL DEFAULT 'Sedang',
  status                ENUM('Terbuka','Dalam Proses','Menunggu Sparepart','Selesai','Dibatalkan') NOT NULL DEFAULT 'Terbuka',
  pic_user_id           INT UNSIGNED NULL,
  pic_name              VARCHAR(150) NULL,
  target_date           DATE NULL,
  completed_at          DATETIME NULL,
  resolution            TEXT NULL,
  is_auto_generated     TINYINT(1) NOT NULL DEFAULT 0,
  reviewed_by           INT UNSIGNED NULL,
  reviewed_at           DATETIME NULL,
  created_by            INT UNSIGNED NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            DATETIME NULL,
  KEY idx_fu_status (status, priority),
  KEY idx_fu_asset (asset_id),
  KEY idx_fu_pic (pic_user_id),
  CONSTRAINT fk_fu_asset     FOREIGN KEY (asset_id)              REFERENCES assets(id),
  CONSTRAINT fk_fu_record    FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id) ON DELETE SET NULL,
  CONSTRAINT fk_fu_complaint FOREIGN KEY (complaint_id)          REFERENCES user_complaints(id) ON DELETE SET NULL,
  CONSTRAINT fk_fu_pic       FOREIGN KEY (pic_user_id)           REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE repair_records
  ADD CONSTRAINT fk_rr_followup FOREIGN KEY (follow_up_id) REFERENCES follow_up_actions(id) ON DELETE SET NULL;

-- ---------- Agent hardware otomatis (tahap lanjut) ----------
CREATE TABLE agent_tokens (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  token_prefix CHAR(8)      NOT NULL,
  token_hash   CHAR(64)     NOT NULL COMMENT 'SHA-256; token asli hanya ditampilkan sekali',
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  last_used_at DATETIME NULL,
  created_by   INT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_agent_hash (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data agent masuk ke staging dulu; baru dipakai di form setelah tervalidasi & dipilih teknisi.
CREATE TABLE agent_readings (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_token_id    INT UNSIGNED NULL,
  asset_id          INT UNSIGNED NULL,
  reported_hostname VARCHAR(100) NULL,
  reported_serial   VARCHAR(100) NULL,
  agent_version     VARCHAR(30)  NULL,
  collected_at      DATETIME NOT NULL,
  received_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload_json      LONGTEXT NOT NULL,
  validation_status ENUM('VALID','SEBAGIAN','DITOLAK') NOT NULL,
  validation_notes  TEXT NULL,
  used_in_record_id INT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ar_asset (asset_id, collected_at),
  CONSTRAINT fk_ar_token  FOREIGN KEY (agent_token_id)    REFERENCES agent_tokens(id) ON DELETE SET NULL,
  CONSTRAINT fk_ar_asset  FOREIGN KEY (asset_id)          REFERENCES assets(id),
  CONSTRAINT fk_ar_record FOREIGN KEY (used_in_record_id) REFERENCES maintenance_records(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Audit & demo ----------
CREATE TABLE audit_logs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NULL,
  username    VARCHAR(60) NULL,
  action      VARCHAR(60) NOT NULL,
  entity_type VARCHAR(60) NULL,
  entity_id   VARCHAR(40) NULL,
  description VARCHAR(500) NULL,
  old_values  LONGTEXT NULL,
  new_values  LONGTEXT NULL,
  ip_address  VARCHAR(45) NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_user (user_id, created_at),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Registri baris data contoh agar seluruh data demo dapat dihapus tuntas.
CREATE TABLE demo_registry (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(60) NOT NULL,
  record_id  INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_demo_table (table_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
