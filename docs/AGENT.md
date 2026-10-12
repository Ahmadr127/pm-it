# Pengambilan Data Hardware Otomatis (Agent)

Tahap awal: **form manual adalah jalur utama** dan sudah berfungsi penuh. Agent adalah fitur lanjutan yang arsitekturnya sudah disiapkan.

## Alur
```
Agent Windows ──HTTPS + Bearer token──▶ POST /api/agent/readings
                                          │ validasi per parameter (rentang wajar, enum)
                                          │ nilai tidak tersedia/invalid → NULL + catatan
                                          ▼
                                   agent_readings (staging: VALID / SEBAGIAN / DITOLAK)
                                          │ teknisi membuka form maintenance aset tsb.
                                          ▼
                     banner "Data agent tersedia" → klik "Gunakan data agent"
                                          │ hanya nilai yang terbaca yang diisikan,
                                          │ sumber ditandai AGENT; bila teknisi mengubah nilai → MANUAL
                                          ▼
                     maintenance_records / readings (data_source, read_at tersimpan)
```
Data agent **tidak pernah** langsung menjadi hasil maintenance tanpa teknisi.

## Token
Menu **Administrasi → Agent Hardware** → buat token. Token ditampilkan **sekali**; yang disimpan hanya hash SHA-256. Token dapat dicabut kapan saja.

## Format payload
```json
{
  "agent_version": "1.0.0",
  "collected_at": "2026-10-09T10:00:00+07:00",
  "device": { "asset_code": "ADEV-IT-PC-0008", "hostname": "IT-PC-08", "serial_number": "ABC123",
              "os": "Windows 11 Pro 10.0.22631", "cpu": "Intel Core i5-12500", "ram_gb": 16,
              "ip_address": "10.10.1.25", "mac_address": "00:1A:2B:3C:4D:5E" },
  "cpu": { "available": true, "temperature_c": 54.5, "source": "LibreHardwareMonitor" },
  "storages": [
    { "storage_type": "SSD", "interface": "NVMe", "brand": "Samsung", "model": "980 PRO", "serial_number": "S5GX...",
      "capacity_gb": 512, "temperature_c": 41, "health_percent": 97, "used_percent": 63, "smart_status": "Baik" }
  ],
  "battery": { "present": true, "design_capacity_mwh": 50000, "full_charge_capacity_mwh": 44000, "cycle_count": 210 }
}
```
- Pencocokan aset: `asset_code` → `serial_number` → `hostname` (hanya bila unik).
- `smart_status`: `Baik | Peringatan | Kritis | Tidak Tersedia` (nilai lain → `Tidak Tersedia`).
- Rentang wajar: suhu −10…130 °C, health 0–100 %, battery health 0–150 %.

Respons: `201` (cocok aset), `202` (diterima tapi aset tidak cocok), `401` (token salah), `422` (struktur salah).

## Keterbatasan sensor (penting)
- **Suhu CPU**: WMI `MSAcpi_ThermalZoneTemperature` sering tidak tersedia atau hanya suhu zona ACPI. Pembacaan per-core memerlukan driver/library seperti **LibreHardwareMonitor** (berjalan sebagai Administrator). Bila tidak terbaca, kirim `"available": false`.
- **Storage**: `Get-StorageReliabilityCounter` memberi suhu & *Wear* pada banyak SSD/HDD modern, namun tidak semua controller RAID/USB mendukung. Health SSD = 100 − Wear; definisi health berbeda antarprodusen.
- **Baterai**: kelas WMI `BatteryStaticData` / `BatteryFullChargedCapacity` tergantung driver ACPI vendor.

## Contoh agent
`agent/pmit-agent.ps1` — uji tanpa mengirim: `-DryRun`. Jadwalkan via Task Scheduler dengan *Run with highest privileges*.
