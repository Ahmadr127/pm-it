# Menghentikan server aplikasi PM-IT (termasuk mode pembaruan otomatis) yang berjalan di komputer ini.
# File storage\run\stop memberi tahu skrip penjalan agar tidak menyalakan ulang server.
$root = Split-Path -Parent $PSScriptRoot
$run = Join-Path $root 'storage\run'
New-Item -ItemType Directory -Force -Path $run | Out-Null
Set-Content -Path (Join-Path $run 'stop') -Value 'stop'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'src[\\/]server\.js' }
if (-not $procs) { Write-Output 'Aplikasi tidak sedang berjalan.'; exit 0 }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Output ("Aplikasi dihentikan ({0} proses)." -f @($procs).Count)
