<#
  Copies the two SimConnect DLLs out of your MSFS SDK (or the sim itself) into
  vatsim-radio-remote\lib so the server can be built against them.

  These files belong to Microsoft and are not redistributed with this project.
  If you do not have the SDK: start MSFS 2024, Options > General > Developers >
  turn on Developer Mode, then Help > SDK Installer.
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$lib  = Join-Path $root 'lib'
New-Item -ItemType Directory -Force -Path $lib | Out-Null

$managedName = 'Microsoft.FlightSimulator.SimConnect.dll'
$nativeName  = 'SimConnect.dll'

$candidates = @(
  'C:\MSFS 2024 SDK\SimConnect SDK\lib',
  'C:\MSFS SDK\SimConnect SDK\lib',
  "$env:ProgramFiles\MSFS 2024 SDK\SimConnect SDK\lib",
  "$env:ProgramFiles\MSFS SDK\SimConnect SDK\lib"
)

function Find-In-Roots([string]$fileName) {
  foreach ($dir in $candidates) {
    if (-not (Test-Path $dir)) { continue }
    $hit = Get-ChildItem -Path $dir -Filter $fileName -Recurse -ErrorAction SilentlyContinue |
           Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

function Find-In-Sim([string]$fileName) {
  $simRoots = @(
    "$env:LOCALAPPDATA\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache",
    "$env:APPDATA\Microsoft Flight Simulator 2024",
    "${env:ProgramFiles(x86)}\Steam\steamapps\common\Microsoft Flight Simulator 2024",
    "${env:ProgramFiles(x86)}\Steam\steamapps\common\MicrosoftFlightSimulator2024",
    "$env:ProgramFiles\WindowsApps"
  )
  foreach ($dir in $simRoots) {
    if (-not (Test-Path $dir)) { continue }
    $hit = Get-ChildItem -Path $dir -Filter $fileName -Recurse -Depth 4 -ErrorAction SilentlyContinue |
           Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

$found = $true
foreach ($name in @($managedName, $nativeName)) {
  $src = Find-In-Roots $name
  if (-not $src) { $src = Find-In-Sim $name }

  if ($src) {
    Copy-Item -Path $src -Destination (Join-Path $lib $name) -Force
    Write-Host "  OK   $name" -ForegroundColor Green
    Write-Host "       from $src" -ForegroundColor DarkGray
  } else {
    $found = $false
    Write-Host "  MISS $name" -ForegroundColor Red
  }
}

Write-Host ''
if ($found) {
  Write-Host 'SimConnect is ready. Next: tools\build.ps1' -ForegroundColor Cyan
} else {
  Write-Host 'Could not find the SimConnect SDK automatically.' -ForegroundColor Yellow
  Write-Host 'Install it from inside MSFS 2024 (Developer Mode > Help > SDK Installer),'
  Write-Host "then copy both DLLs into:  $lib"
  exit 1
}
