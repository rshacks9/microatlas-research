<#
  Builds the server and (if the vPilot SDK is present) the plugin, then installs
  the plugin into vPilot.

  Requirements: the .NET SDK (dotnet --version). Get it from
  https://dotnet.microsoft.com/download - any 6.0+ SDK can build these projects.
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$lib  = Join-Path $root 'lib'

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  Write-Host 'The .NET SDK is not installed.' -ForegroundColor Red
  Write-Host 'Install it from https://dotnet.microsoft.com/download and run this again.'
  exit 1
}

if (-not (Test-Path (Join-Path $lib 'Microsoft.FlightSimulator.SimConnect.dll'))) {
  Write-Host 'SimConnect is missing - running tools\fetch-simconnect.ps1 first.' -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot 'fetch-simconnect.ps1')
}

Write-Host ''
Write-Host 'Building the server...' -ForegroundColor Cyan
dotnet build (Join-Path $root 'server\VatsimRadioRemote.Server.csproj') -c Release -v minimal
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Test-Path (Join-Path $lib 'Vatsim.Vpilot.Plugins.dll')) {
  Write-Host ''
  Write-Host 'Building the vPilot plugin...' -ForegroundColor Cyan
  dotnet build (Join-Path $root 'plugin\VatsimRadioRemote.VPilotPlugin.csproj') -c Release -v minimal
  if ($LASTEXITCODE -eq 0) { & (Join-Path $PSScriptRoot 'install-plugin.ps1') }
} else {
  Write-Host ''
  Write-Host 'Skipping the vPilot plugin - run tools\fetch-vpilot-sdk.ps1 to enable it.' -ForegroundColor Yellow
  Write-Host 'Without it you still get radio tuning and PTT, but no ATC list or text messages.'
}

$exe = Join-Path $root 'server\bin\Release\VatsimRadioRemote.exe'
Write-Host ''
Write-Host 'Build finished.' -ForegroundColor Green
Write-Host "Start the server with:  $exe"
