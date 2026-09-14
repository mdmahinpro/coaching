@echo off
setlocal EnableExtensions
REM ============================================================
REM  apply-migrations.bat - one-click schema installer
REM
REM  Double-click this file. It resolves paths relative to this
REM  script's folder, asks once for the database password, verifies
REM  the connection, then applies EVERY required SQL migration in
REM  the approved order, followed by the optional operational
REM  (backups / cron) migrations.
REM
REM  Required migrations STOP on the first failure (things the app
REM  needs). Operational migrations are applied best-effort and
REM  reported (they may need optional Supabase extensions).
REM ============================================================

REM --- locate psql (EDB 17 binaries) ---
set "PSQL=C:\Users\mdmah\pg17tools\pgsql\bin\psql.exe"

REM --- connection settings (Supabase pooler) --------------------
REM Point this at the project you want to install. The current values
REM target the production project. To target another project, change
REM PGHOST/PGPORT/PGUSER/PGDATABASE here.
set "PGHOST=aws-1-ap-northeast-1.pooler.supabase.com"
set "PGPORT=6543"
set "PGUSER=postgres.flbvusudwszxdylxevfe"
set "PGDATABASE=postgres"

REM --- resolve the migrations folder relative to THIS script ----
REM %~dp0 ends with a backslash and points at the scripts\ folder,
REM so the repo root is %~dp0..\ and migrations live in %~dp0..\supabase\migrations
set "SCRIPT_DIR=%~dp0"
set "MIG_DIR=%SCRIPT_DIR%..\supabase\migrations"

if not exist "%PSQL%" (
  echo [ERROR] psql 17 not found at "%PSQL%"
  echo         Re-extract the EDB 17 binaries zip to C:\Users\mdmah\pg17tools .
  pause
  exit /b 1
)

REM --- timestamped log next to this script ---
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "STAMP=%%i"
set "LOGFILE=%SCRIPT_DIR%migration_apply_%STAMP%.log"
if exist "%LOGFILE%" del "%LOGFILE%"

REM --- password prompt (never stored on disk automatically) ---
if not defined PGPASSWORD (
  set /p PGPASSWORD="Database password: "
)
if not defined PGPASSWORD (
  echo [ERROR] No database password provided. Get/reset it in: Dashboard -^> Project Settings -^> Database.
  pause
  exit /b 1
)

REM --- verify connection BEFORE applying anything ---
echo Connecting to %PGHOST% as %PGUSER% ...
"%PSQL%" -v ON_ERROR_STOP=1 -c "SELECT version();" > "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [FAIL] Could not connect. Check the database password and host, then re-run.
  echo        Details: %LOGFILE%
  pause
  exit /b 1
)
echo [OK] Connected.

REM --- migration ledger: records each successfully-applied migration so
REM --- re-runs SKIP them instead of re-fighting idempotency/drift errors. ---
"%PSQL%" -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS public._applied_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()); REVOKE ALL ON public._applied_migrations FROM PUBLIC, anon, authenticated;" >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [WARN] Could not create the migration ledger; running without skip-tracking.
)

REM Optional rebuild: when FORCE_REBUILD is set, clear the ledger first so every
REM migration is re-applied (recreates database functions after they were dropped).
if defined FORCE_REBUILD (
  echo [INFO] FORCE_REBUILD set - clearing applied-migration ledger; all migrations will re-apply.
  "%PSQL%" -v ON_ERROR_STOP=1 -c "TRUNCATE public._applied_migrations;" >> "%LOGFILE%" 2>&1
)

REM Snapshot which migrations are already applied (ONE query; fast, no per-file
REM reconnects). The skip checks read this file below.
set "APPLIED_FILE=%TEMP%\_applied_migrations.txt"
"%PSQL%" -t -A -c "SELECT filename FROM public._applied_migrations;" > "%APPLIED_FILE%" 2>nul

echo.
echo ===== REQUIRED migrations =====
set "REQUIRED_LIST=20250816000000_update_student_auth.sql 20250816000001_rate_limiting.sql 20250817000000_support_tables.sql 20250818000000_student_sessions.sql 20250818000001_portal_rpcs.sql 20250818000002_exam_rpcs.sql 20250818000003_core_rls.sql 20250820000000_restore_student_portal.sql 20250824000000_security_hardening.sql 20250825000000_lock_counter_rpcs.sql 20250825000001_gate_exam_leaderboard.sql 20250825000002_narrow_teacher_columns.sql 20250825000003_fix_exam_join_ambiguity.sql 20250825000004_fix_latent_ambiguity.sql 20250827000001_batch_fixes.sql 20250827000002_student_id.sql 20250827000003_exam_batches.sql 20250827000004_exam_penalty.sql 20250829000001_security_controls.sql 20250829000002_exam_auth_penalty.sql 20250829000003_fix_portal_exams_42804.sql 20250830000001_exam_batch_backfill.sql 20250830000002_payment_approvals.sql 20250830000004_admission_reference_gender.sql 20250831000001_fix_default_password_login.sql 20250831000002_batch_end_time.sql 20250904000001_admin_safe_mutations.sql 20250905000005_feedback_email.sql 20250905000006_provider_secrets.sql 20250906000001_phase2_session_validation.sql 20250906000002_atomic_admission_approval.sql 20250906000003_phase2_payment_audit_atomic.sql 20250907000001_exam_session_only_and_avatar_storage.sql 20250909000001_postinstall_repairs.sql 20250910000001_fee_audit_logs_admin_rls.sql 20250911000001_atomic_exam_deletion.sql 20250912000001_student_auth_hardening.sql 20250913000001_private_avatars_public_assets.sql 20250914000001_public_form_abuse_prevention.sql 20250915000001_durable_message_outbox.sql 20250915000002_messaging_worker_heartbeat.sql 20250915000003_messaging_channel_claims.sql 20250915000004_messaging_ambiguous_outcomes.sql 20250915000005_atomic_message_attempts.sql 20250915000006_atomic_message_job_aggregate.sql 20250915000007_non_idempotent_sms_dispatch.sql 20250915000008_provider_neutral_messaging.sql 20250915000009_mim_dispatch_fence.sql 20250916000001_home_stats_rpc.sql"

for %%M in (%REQUIRED_LIST%) do (
  call :ApplyRequired "%%M"
  if errorlevel 1 goto :failed
)

echo.
echo ===== OPTIONAL operational migrations (backups / cron) =====
set "OPERATIONAL_LIST=20250905000001_backups_admin_rls.sql 20250905000002_backup_coverage.sql 20250905000003_backup_restore_coverage.sql 20250905000004_admin_backup_now.sql automated_backups.sql 20250905000007_backup_payload_redaction.sql keep_alive_cron.sql"

for %%M in (%OPERATIONAL_LIST%) do (
  call :ApplyOperational "%%M"
)

echo.
echo ===== Summary =====
if not defined HAD_REQUIRED_OK set "HAD_REQUIRED_OK=1"
if defined OPT_WARN (
  echo [WARN] One or more optional operational migrations did not apply.
) else (
  echo [OK] Optional operational migrations applied.
)
echo [OK] Required migrations applied successfully.
echo [OK] Full log written to %LOGFILE%
echo.
echo Next: in the app set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL in the
echo       deployment (Netlify) environment, then redeploy. Re-run the combined
echo       audit with  pnpm e2e:combined  to confirm features.
echo.
echo Done. The migration summary is above.
pause
goto :end

:AlreadyApplied
  REM Returns errorlevel 0 if %~1 is already recorded in the applied snapshot.
  set "FILE=%~1"
  if not exist "%APPLIED_FILE%" (exit /b 1)
  findstr /x /c:"%FILE%" "%APPLIED_FILE%" >nul
  if errorlevel 1 (exit /b 1) else (exit /b 0)

:RecordApplied
  set "FILE=%~1"
  "%PSQL%" -v ON_ERROR_STOP=1 -c "INSERT INTO public._applied_migrations (filename) VALUES ('%FILE%') ON CONFLICT (filename) DO NOTHING;" >> "%LOGFILE%" 2>&1
  exit /b 0

:ApplyRequired
  set "FILE=%~1"
  if not exist "%MIG_DIR%\%FILE%" (
    echo [MISSING] %FILE%
    exit /b 1
  )
  call :AlreadyApplied "%FILE%"
  if not errorlevel 1 (
    echo [SKIP] %FILE% (already applied)
    exit /b 0
  )
  echo Applying required: %FILE%
  "%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG_DIR%\%FILE%" >> "%LOGFILE%" 2>&1
  if errorlevel 1 (
    echo [FAIL] %FILE% - see %LOGFILE%
    exit /b 1
  )
  echo [OK] %FILE%
  set "HAD_REQUIRED_OK=1"
  call :RecordApplied "%FILE%"
  exit /b 0

:ApplyOperational
  set "FILE=%~1"
  if not exist "%MIG_DIR%\%FILE%" (
    echo [SKIP] %FILE% (not found)
    exit /b 0
  )
  call :AlreadyApplied "%FILE%"
  if not errorlevel 1 (
    echo [SKIP] %FILE% (already applied)
    exit /b 0
  )
  echo Applying optional: %FILE%
  "%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG_DIR%\%FILE%" >> "%LOGFILE%" 2>&1
  if errorlevel 1 (
    echo [WARN] %FILE% did not apply (often needs an optional Supabase extension). See %LOGFILE%
    set "OPT_WARN=1"
  ) else (
    echo [OK] %FILE%
    call :RecordApplied "%FILE%"
  )
  exit /b 0

:failed
echo.
echo [FAILED] A required migration did not complete. See %LOGFILE%
echo Tip: if it was already applied, review the log for the specific error.
pause
exit /b 1

:end
endlocal