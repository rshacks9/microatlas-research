$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'server\bin\Release\VatsimRadioRemote.exe'
if (-not (Test-Path $exe)) {
  Write-Host 'Not built yet. Run tools\build.ps1 first.' -ForegroundColor Red
  exit 1
}
& $exe
