# Stops the local PostgreSQL server.
$PgBin = 'C:\foodos\pg\pgsql\bin'
$PgData = 'C:\foodos\pgdata'

if (-not (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)) {
    Write-Host 'PostgreSQL is not running.'
    exit 0
}

# -m fast rolls back open transactions instead of waiting for clients to leave.
& "$PgBin\pg_ctl.exe" -D $PgData -m fast stop

if ($LASTEXITCODE -eq 0) {
    Write-Host 'PostgreSQL stopped.'
} else {
    exit 1
}
