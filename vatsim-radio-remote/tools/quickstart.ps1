<#
  Runs the whole setup in one go: fetches both SDKs, builds the server and
  plugin, installs the plugin into vPilot, opens the firewall, and starts
  the server.

  Usage (from inside the vatsim-radio-remote folder):
    .\tools\quickstart.ps1

  One step needs administrator rights (reserving the URL and opening the
  firewall port so your phone can reach this PC). Windows will show a UAC
  consent prompt for that step - approve it. Nothing else here needs it, and
  that prompt can't be scripted away; it's Windows asking you to confirm a
  network change, not this tool asking.

  Safe to re-run: every step here already tolerates being run again (DLLs get
  re-copied, the firewall rule gets replaced, etc).
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Step($n, $title) {
  Write-Host ''
  Write-Host "[$n/5] $title" -ForegroundColor Cyan
  Write-Host ('-' * 60) -ForegroundColor DarkGray
}

# 1. SimConnect - required. Bail with a clear message if it can't be found.
Step 1 'SimConnect SDK'
& (Join-Path $PSScriptRoot 'fetch-simconnect.ps1')
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'Stopping here - radio tuning needs SimConnect. Fix the message above and re-run.' -ForegroundColor Red
  exit 1
}

# 2. vPilot SDK - optional. You can still build without it; you'll just be
#    missing the ATC list and text messages until vPilot is installed and
#    this is run again.
Step 2 'vPilot plugin SDK'
& (Join-Path $PSScriptRoot 'fetch-vpilot-sdk.ps1')
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Continuing without the vPilot plugin - install vPilot, then run this again to add it.' -ForegroundColor Yellow
}

# 3. Build. Already skips the plugin gracefully if step 2 didn't find the SDK,
#    and installs the plugin into vPilot automatically when it does build.
Step 3 'Build'
& (Join-Path $PSScriptRoot 'build.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 4. Firewall + URL reservation. Self-elevates in a separate window; this
#    script keeps going once that request is issued rather than waiting on it,
#    since the server's own retry-on-bind-failure covers the gap.
Step 4 'Network access for your phone (admin prompt)'
& (Join-Path $PSScriptRoot 'setup-windows.ps1')
Write-Host 'If a UAC prompt appeared, approve it in that window.' -ForegroundColor Yellow
Write-Host 'Waiting a few seconds for it to finish...'
Start-Sleep -Seconds 5

# 5. Run. This is the foreground step - it prints your phone's pairing URL
#    and stays open until you press Ctrl+C.
Step 5 'Starting the server'
& (Join-Path $PSScriptRoot 'run-server.ps1')
