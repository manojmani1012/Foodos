# Starts the local PostgreSQL server used for development.
#
# PostgreSQL 17.6 lives outside this repository so it is never committed:
#   binaries  C:\foodos\pg\pgsql
#   data      C:\foodos\pgdata
#
# It is not a Windows service, so it does not survive a reboot. Run this script
# after restarting the machine, before starting the backend.
$PgBin = 'C:\foodos\pg\pgsql\bin'
$PgData = 'C:\foodos\pgdata'
$LogFile = Join-Path $PgData 'server.log'

if (-not (Test-Path $PgBin)) {
    Write-Host "PostgreSQL is not installed at $PgBin." -ForegroundColor Red
    exit 1
}

$listening = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue

if ($listening) {
    Write-Host 'PostgreSQL is already running on port 5432.'
    exit 0
}

& "$PgBin\pg_ctl.exe" -D $PgData -l $LogFile start

if ($LASTEXITCODE -eq 0) {
    Write-Host 'PostgreSQL is running on 127.0.0.1:5432 (database: foodos).'
} else {
    Write-Host "PostgreSQL failed to start. Last lines of ${LogFile}:" -ForegroundColor Red
    Get-Content $LogFile -Tail 15
    exit 1
}
