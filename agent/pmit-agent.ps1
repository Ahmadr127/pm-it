<#
.SYNOPSIS
  Agent contoh PM-IT: membaca data hardware Windows lalu mengirim ke server (POST /api/agent/readings).

.DESCRIPTION
  - Hanya mengirim nilai yang BENAR-BENAR terbaca. Parameter yang tidak tersedia dikirim sebagai $null
    (server menyimpannya sebagai NULL dan menandainya "tidak tersedia"), tidak pernah diisi tebakan.
  - Suhu CPU via WMI (MSAcpi_ThermalZoneTemperature) sering TIDAK tersedia atau tidak akurat; bergantung
    pada BIOS/ACPI, sensor, dan driver. Untuk pembacaan andal, integrasikan LibreHardwareMonitor
    (lihat docs/AGENT.md) dan isi $cpu.temperature_c dari sensor CPU Package.
  - Suhu & wear storage via Get-StorageReliabilityCounter (Windows 8+/Server 2012+, perlu hak Administrator,
    tidak semua controller/driver mendukung). Health dihitung 100 - Wear hanya bila Wear tersedia.
  - Data masuk ke staging di server dan baru dipakai bila teknisi memilih "Gunakan data agent" di form.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File pmit-agent.ps1 -ServerUrl https://pmit.perusahaan.local -Token pmit_xxx -AssetCode ADEV-IT-PC-0008
  # Jadwalkan via Task Scheduler (Run with highest privileges) mis. setiap hari 10:00.
#>
param(
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$AssetCode = $null,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$AgentVersion = '1.0.0'

function Try-Get([scriptblock]$Block) { try { & $Block } catch { $null } }

# ---------- Identitas perangkat ----------
$cs   = Try-Get { Get-CimInstance Win32_ComputerSystem }
$bios = Try-Get { Get-CimInstance Win32_BIOS }
$os   = Try-Get { Get-CimInstance Win32_OperatingSystem }
$cpuInfo = Try-Get { Get-CimInstance Win32_Processor | Select-Object -First 1 }
$nic  = Try-Get { Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled = True" | Select-Object -First 1 }

$device = [ordered]@{
  asset_code    = $AssetCode
  hostname      = $env:COMPUTERNAME
  serial_number = if ($bios) { $bios.SerialNumber.Trim() } else { $null }
  os            = if ($os) { "$($os.Caption) $($os.Version)" } else { $null }
  cpu           = if ($cpuInfo) { $cpuInfo.Name.Trim() } else { $null }
  ram_gb        = if ($cs) { [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) } else { $null }
  ip_address    = if ($nic -and $nic.IPAddress) { ($nic.IPAddress | Where-Object { $_ -match '^\d+\.' } | Select-Object -First 1) } else { $null }
  mac_address   = if ($nic) { $nic.MACAddress } else { $null }
}

# ---------- Suhu CPU (sering tidak tersedia) ----------
$cpu = [ordered]@{ available = $false; temperature_c = $null; source = $null }
$zones = Try-Get { Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature }
if ($zones) {
  $max = ($zones | ForEach-Object { ($_.CurrentTemperature / 10) - 273.15 } | Measure-Object -Maximum).Maximum
  # Nilai di luar rentang wajar dianggap tidak valid (beberapa BIOS mengembalikan konstanta palsu)
  if ($max -gt 5 -and $max -lt 120) { $cpu.available = $true; $cpu.temperature_c = [math]::Round($max, 1); $cpu.source = 'ACPI Thermal Zone (perkiraan zona, bukan sensor core)' }
}

# ---------- Storage ----------
$predict = Try-Get { Get-CimInstance -Namespace root/wmi -ClassName MSStorageDriver_FailurePredictStatus }
$storages = @()
$disks = Try-Get { Get-PhysicalDisk }
foreach ($d in @($disks)) {
  if (-not $d) { continue }
  $type = switch ($d.MediaType) { 'SSD' { 'SSD' } 'HDD' { 'HDD' } default { if ($d.BusType -eq 'NVMe') { 'SSD' } else { $null } } }
  if (-not $type) { continue }   # jenis tidak diketahui -> tidak dikirim daripada menebak
  $rel = Try-Get { $d | Get-StorageReliabilityCounter }
  $temp = if ($rel -and $rel.Temperature -gt 0) { [double]$rel.Temperature } else { $null }
  $health = if ($rel -and $rel.Wear -ne $null -and $type -eq 'SSD') { [double](100 - $rel.Wear) } else { $null }
  $smart = 'Tidak Tersedia'
  if ($d.HealthStatus -eq 'Unhealthy') { $smart = 'Kritis' }
  elseif ($d.HealthStatus -eq 'Warning') { $smart = 'Peringatan' }
  elseif ($predict) {
    $smart = if (@($predict | Where-Object { $_.PredictFailure }).Count -gt 0) { 'Kritis' } else { 'Baik' }
  } elseif ($d.HealthStatus -eq 'Healthy') { $smart = 'Baik' }
  $iface = switch ($d.BusType) { 'NVMe' { 'NVMe' } 'SATA' { 'SATA' } 'SAS' { 'SAS' } 'USB' { 'USB' } default { 'Lainnya' } }
  $storages += [ordered]@{
    storage_type = $type; interface = $iface; brand = $null; model = $d.FriendlyName; serial_number = ($d.SerialNumber -as [string]).Trim()
    capacity_gb = [math]::Round($d.Size / 1GB, 0); temperature_c = $temp; health_percent = $health; used_percent = $null; smart_status = $smart
  }
}

# ---------- Baterai (laptop) ----------
$battery = [ordered]@{ present = $false }
$static = Try-Get { Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData | Select-Object -First 1 }
$full   = Try-Get { Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity | Select-Object -First 1 }
$cycle  = Try-Get { Get-CimInstance -Namespace root/wmi -ClassName BatteryCycleCount | Select-Object -First 1 }
if ($static -or $full) {
  $battery = [ordered]@{
    present = $true
    design_capacity_mwh = if ($static -and $static.DesignedCapacity -gt 0) { [int]$static.DesignedCapacity } else { $null }
    full_charge_capacity_mwh = if ($full -and $full.FullChargedCapacity -gt 0) { [int]$full.FullChargedCapacity } else { $null }
    cycle_count = if ($cycle -and $cycle.CycleCount -gt 0) { [int]$cycle.CycleCount } else { $null }
    health_percent = $null   # dihitung server dari full charge / design bila keduanya tersedia
  }
}

$payload = [ordered]@{
  agent_version = $AgentVersion
  collected_at  = (Get-Date).ToString('o')
  device = $device; cpu = $cpu; storages = $storages; battery = $battery
}
$json = $payload | ConvertTo-Json -Depth 6
if ($DryRun) { $json; exit 0 }

try {
  $res = Invoke-RestMethod -Method Post -Uri ($ServerUrl.TrimEnd('/') + '/api/agent/readings') -ContentType 'application/json' `
    -Headers @{ Authorization = "Bearer $Token" } -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 30
  Write-Output ("Terkirim: id={0} status={1}" -f $res.id, $res.status)
  if ($res.notes) { $res.notes | ForEach-Object { Write-Output "  - $_" } }
} catch {
  Write-Error "Gagal mengirim data: $($_.Exception.Message)"
  exit 1
}
