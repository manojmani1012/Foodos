# Starts the Foodos frontend dev server in the background (Windows PowerShell).
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $RootDir 'frontend'
$PidFile = Join-Path $RootDir '.frontend.pid'
$LogFile = Join-Path $RootDir 'frontend.log'
$Port = 5173

if (Test-Path $PidFile) {
    $existingPid = Get-Content $PidFile
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
        Write-Host "Frontend is already running (PID $existingPid)."
        exit 0
    }
}

Push-Location $FrontendDir

if (-not (Test-Path 'node_modules')) {
    Write-Host 'Installing frontend dependencies...'
    npm install
}

Write-Host 'Starting Foodos frontend...'
$proc = Start-Process -FilePath 'node' -ArgumentList "node_modules/vite/bin/vite.js --port $Port" `
    -RedirectStandardOutput $LogFile -RedirectStandardError "$RootDir\frontend.err.log" `
    -PassThru -WindowStyle Hidden

$proc.Id | Out-File -FilePath $PidFile -Encoding ascii

Pop-Location

# Wait for the server to actually come up before declaring success.
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        Invoke-WebRequest -Uri "http://localhost:$Port" -UseBasicParsing -TimeoutSec 1 | Out-Null
        $ready = $true
        break
    } catch {}
}

if ($ready) {
    Write-Host "Frontend started (PID $($proc.Id))."
    Write-Host "Open: http://localhost:$Port"
} else {
    Write-Host 'Frontend did not respond in time. Last 20 log lines:'
    Get-Content $LogFile -Tail 20
    exit 1
}
