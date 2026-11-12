param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$env:ATLAS_POWERSHELL = (Get-Process -Id $PID).Path
if (-not $NodePath) { $NodePath = (Get-Command node -ErrorAction Stop).Source }
$listening = Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  $nodeArgument = '"' + (Join-Path $PSScriptRoot 'local.mjs') + '"'
  Start-Process -FilePath $NodePath -ArgumentList $nodeArgument -WorkingDirectory $project -WindowStyle Hidden
}
