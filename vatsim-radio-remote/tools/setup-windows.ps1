<#
  One-time setup, run as administrator.

  Windows blocks a normal program from accepting connections from other devices
  on a URL prefix, and the firewall blocks the port. This grants both, so your
  iPhone can reach the server.

  Right-click this file > Run with PowerShell, and approve the admin prompt.
  To undo later, run:  tools\setup-windows.ps1 -Remove
#>

param([switch]$Remove)

$ErrorActionPreference = 'Stop'

$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'This needs administrator rights - relaunching...' -ForegroundColor Yellow
  $argList = "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
  if ($Remove) { $argList += ' -Remove' }
  Start-Process powershell -Verb RunAs -ArgumentList $argList
  return
}

$root = Split-Path -Parent $PSScriptRoot
$port = 8420
$configPath = Join-Path $root 'server\bin\Release\config.json'
if (Test-Path $configPath) {
  try {
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($cfg.port) { $port = [int]$cfg.port }
  } catch { }
}

$url  = "http://+:$port/"
$rule = 'VATSIM Radio Remote'

if ($Remove) {
  netsh http delete urlacl url=$url | Out-Null
  netsh advfirewall firewall delete rule name="$rule" | Out-Null
  Write-Host "Removed the URL reservation and firewall rule for port $port." -ForegroundColor Green
} else {
  netsh http delete urlacl url=$url 2>$null | Out-Null
  netsh http add urlacl url=$url user=Everyone | Out-Null
  netsh advfirewall firewall delete rule name="$rule" 2>$null | Out-Null
  netsh advfirewall firewall add rule name="$rule" dir=in action=allow protocol=TCP localport=$port profile=private,domain | Out-Null

  Write-Host ''
  Write-Host "  Port $port is now reachable from your phone on this network." -ForegroundColor Green
  Write-Host '  The firewall rule covers Private and Domain networks only. If your Wi-Fi is'
  Write-Host '  set to Public in Windows, change it to Private (Settings > Network > Wi-Fi).'
}

Write-Host ''
Write-Host 'Press Enter to close.'
Read-Host | Out-Null
