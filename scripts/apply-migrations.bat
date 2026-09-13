@echo off
setlocal EnableExtensions
REM ============================================================
REM  apply-migrations.bat -- apply the production-hardening
REM  migration to the Supabase database (Postgres 17) via psql.
REM
REM  Double-click this file anywhere and it works: paths are
REM  resolved from THIS script's folder, not the current directory.
REM  It prompts for the database password so it never sits on disk.
REM  Output is printed to the console AND written to
REM  migration_apply_YYYYMMDD.log next to this script.
REM
REM  For a NON-TECHNICAL operator:  run this ONCE, type/ paste the
REM  database password when asked, and check the end result says
REM  [OK] Migration applied successfully.
REM ============================================================

REM --- connection settings (same as backup-db.bat) ---
set "PSQL=C:\Users\mdmah\pg17tools\pgsql\bin\psql.exe"
set "PGHOST=aws-1-ap-northeast-1.pooler.supabase.com"
set "PGPORT=6543"
set "PGUSER=postgres.flbvusudwszxdylxevfe"
set "PGDATABASE=postgres"

REM --- resolve the migration path RELATIVE TO THIS script ----
REM %~dp0 ends with a backslash and points at the scripts\ folder,
REM so the repo root is `%~dp0..\` and migrations live in
REM `%~dp0..\supabase\migrations\...`
set "SCRIPT_DIR=%~dp0"
set "MIG_DIR=%SCRIPT_DIR%..\supabase\migrations"
set "MIG1=%MIG_DIR%\20250904000001_admin_safe_mutations.sql"
set "MIG2=%MIG_DIR%\20250905000002_backup_coverage.sql"
set "MIG3=%MIG_DIR%\20250905000003_backup_restore_coverage.sql"
set "MIG4=%MIG_DIR%\20250905000004_admin_backup_now.sql"
set "MIG5=%MIG_DIR%\20250905000005_feedback_email.sql"
set "MIG6=%MIG_DIR%\20250905000006_provider_secrets.sql"
set "MIG7=%MIG_DIR%\20250906000001_phase2_session_validation.sql"
set "MIG8=%MIG_DIR%\20250906000002_atomic_admission_approval.sql"
set "MIG9=%MIG_DIR%\20250906000003_phase2_payment_audit_atomic.sql"
set "MIG10=%MIG_DIR%\20250910000001_fee_audit_logs_admin_rls.sql"

if not exist "%PSQL%" (
  echo [ERROR] psql 17 not found at "%PSQL%"
  echo         Re-extract the EDB 17 binaries zip to C:\Users\mdmah\pg17tools .
  pause
  exit /b 1
)
for %%F in ("%MIG1%" "%MIG2%" "%MIG3%" "%MIG4%" "%MIG5%" "%MIG6%" "%MIG7%" "%MIG8%" "%MIG9%" "%MIG10%") do if not exist "%%~F" (
  echo [ERROR] Migration not found at "%%~F"
  echo.
  echo Tip: this script must live in the "scripts" folder of the project.
  echo   Correct location: ...\coaching-center\scripts\apply-migrations.bat
  echo   Migration folder:  ...\coaching-center\supabase\migrations\
  pause
  exit /b 1
)

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"`) do set "STAMP=%%i"
set "LOGFILE=%SCRIPT_DIR%migration_apply_%STAMP%.log"

if not defined PGPASSWORD (
  set /p PGPASSWORD="Database password: "
)
if not defined PGPASSWORD (
  echo [ERROR] No database password provided. Reset in: Dashboard -^> Project Settings -^> Database.
  pause
  exit /b 1
)

echo Applying production hardening migrations...
"%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG1%" > "%LOGFILE%" 2>&1
if errorlevel 1 goto :failed
"%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG2%" >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :failed
"%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG3%" >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :failed
"%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG4%" >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :failed
"%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG5%" >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :failed
"%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG6%" >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :failed
"%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG7%" >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :failed
"%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG8%" >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :failed
"%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG9%" >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :failed
"%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG10%" >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :failed
goto :success

:failed
  echo.
  echo [FAILED] One or more migrations did not complete. See %LOGFILE%
  echo Tip: a common cause is an empty / wrong database password, or the
  echo       matching migration already being applied. Review the log.
  pause
  exit /b 1

:success

echo.
echo [OK] Migration applied successfully.
echo [OK] Log written to %LOGFILE%
echo [OK] Verify the new RPCs exist (optional):
echo        SELECT proname FROM pg_proc WHERE proname IN ('admin_delete_student','admin_restore_backup');
echo.
echo Next step: in the app, run  pnpm e2e:combined  to confirm
echo everything works and the backups page loads without errors.
endlocal
