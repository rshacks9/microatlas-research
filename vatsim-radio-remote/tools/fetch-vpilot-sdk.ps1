<#
  Copies Vatsim.Vpilot.Plugins.dll out of your vPilot installation into
  vatsim-radio-remote\lib, so the plugin project can compile against it.
  The DLL stays on your machine; it is never redistributed.
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$lib  = Join-Path $root 'lib'
New-Item -ItemType Directory -Force -Path $lib | Out-Null

$name = 'Vatsim.Vpilot.Plugins.dll'
$roots = @(
  "$env:LOCALAPPDATA\vPilot",
  "${env:ProgramFiles(x86)}\vPilot",
  "$env:ProgramFiles\vPilot",
  "$env:APPDATA\vPilot"
)

$src = $null
foreach ($dir in $roots) {
  if (-not (Test-Path $dir)) { continue }
  $hit = Get-ChildItem -Path $dir -Filter $name -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { $src = $hit.FullName; break }
}

if (-not $src) {
  Write-Host "Could not find $name." -ForegroundColor Red
  Write-Host 'Install vPilot first (vpilot.rosscarlson.dev), then run this again.'
  Write-Host "If vPilot lives somewhere unusual, copy the DLL into: $lib"
  exit 1
}

Copy-Item -Path $src -Destination (Join-Path $lib $name) -Force
Write-Host "  OK   $name" -ForegroundColor Green
Write-Host "       from $src" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'vPilot SDK is ready. Next: tools\build.ps1' -ForegroundColor Cyan
