# Stops the Foodos frontend dev server started by start.ps1 (Windows PowerShell).
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $RootDir '.frontend.pid'

if (-not (Test-Path $PidFile)) {
    Write-Host 'No running frontend found (no PID file).'
    exit 0
}

$targetPid = Get-Content $PidFile

$proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
if ($proc) {
    Stop-Process -Id $targetPid -Force
    Write-Host "Stopped frontend (PID $targetPid)."
} else {
    Write-Host "Frontend process (PID $targetPid) was not running."
}

Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
