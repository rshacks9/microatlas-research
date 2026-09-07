<#
  Copies the built plugin into vPilot's Plugins folder.
  vPilot must be closed while this runs.
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dll  = Join-Path $root 'plugin\bin\Release\VatsimRadioRemote.VPilotPlugin.dll'

if (-not (Test-Path $dll)) {
  Write-Host 'Plugin has not been built yet. Run tools\build.ps1 first.' -ForegroundColor Red
  exit 1
}

$vpilotRoots = @("$env:LOCALAPPDATA\vPilot", "${env:ProgramFiles(x86)}\vPilot", "$env:ProgramFiles\vPilot")
$target = $null
foreach ($dir in $vpilotRoots) { if (Test-Path $dir) { $target = Join-Path $dir 'Plugins'; break } }

if (-not $target) {
  Write-Host 'Could not find your vPilot installation.' -ForegroundColor Red
  exit 1
}

if (Get-Process -Name 'vPilot' -ErrorAction SilentlyContinue) {
  Write-Host 'vPilot is running. Close it and run this script again.' -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path $dll -Destination $target -Force

# Only write the override file when the server is not on the default port.
$configPath = Join-Path $root 'server\bin\Release\config.json'
if (Test-Path $configPath) {
  $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
  if ($cfg.pluginBridgePort -and $cfg.pluginBridgePort -ne 8421) {
    @{ pluginBridgePort = $cfg.pluginBridgePort } | ConvertTo-Json |
      Set-Content -Path (Join-Path $target 'VatsimRadioRemote.plugin.json') -Encoding UTF8
  }
}

Write-Host "  OK   plugin installed to $target" -ForegroundColor Green
Write-Host '       Start vPilot, then check Settings > Plugins shows "VATSIM Radio Remote".'
