@echo off
setlocal EnableExtensions
REM ============================================================
REM  backup-db.bat -- one-click logical backup of the Supabase
REM  production database (Postgres 17).
REM
REM  Double-click to run, or execute from a schedule. Prompts for
REM  the database password so it never has to live on disk.
REM  Output: backup_YYYYMMDD.sql in this folder, off-machine.
REM
REM  Requires: the standalone pg_dump 17 next to PGDRIVE below.
REM ============================================================

set "PGDUMP=C:\Users\mdmah\pg17tools\pgsql\bin\pg_dump.exe"
set "PGHOST=aws-1-ap-northeast-1.pooler.supabase.com"
set "PGPORT=6543"
set "PGUSER=postgres.flbvusudwszxdylxevfe"
set "PGDATABASE=postgres"

if not exist "%PGDUMP%" (
  echo [ERROR] pg_dump 17 not found at:
  echo         "%PGDUMP%"
  echo         Re-extract the EDB 17 binaries zip to C:\Users\mdmah\pg17tools .
  pause
  exit /b 1
)

REM Locale-independent ISO date stamp via PowerShell.
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"`) do set "STAMP=%%i"
set "OUTFILE=%~dp0backup_%STAMP%.sql"

REM Honor a password already set by a calling schedule/environment; otherwise
REM prompt. This also lets automation (Task Scheduler) pass it via a secret env.
if not defined PGPASSWORD (
  REM Note: typed characters remain visible on screen; that is normal for a
  REM local admin script. Never share this password; keep it in your manager.
  set /p PGPASSWORD="Database password: "
)
if not defined PGPASSWORD (
  echo [ERROR] No database password provided.  Reset in: Dashboard -^> Project Settings -^> Database.
  pause
  exit /b 1
)

echo.
echo Backing up %PGHOST%:%PGPORT%/%PGDATABASE%  as  %OUTFILE%
echo (This can take a minute. Do not close the window.)

"%PGDUMP%" -f "%OUTFILE%"
if errorlevel 1 (
  echo.
  echo [FAILED] The dump did not complete. Likely a wrong password.
  echo          Reset it in: Dashboard -^> Project Settings -^> Database.
  pause
  exit /b 1
)

echo.
echo [OK] Backup written: %OUTFILE%
echo [OK] Memory: move a copy off this computer ^(Drive/USB ^) after every run.
pause
endlocal
