@echo off
setlocal EnableExtensions
REM ============================================================
REM  restore-functions.bat  -- direct recovery
REM
REM  Re-applies EVERY migration directly (no ledger, no skip) so all
REM  dropped database functions are recreated. Migrations are
REM  idempotent, so re-applying is safe. Prompts for the DB password.
REM ============================================================
set "PSQL=C:\Users\mdmah\pg17tools\pgsql\bin\psql.exe"
set "PGHOST=aws-1-ap-northeast-1.pooler.supabase.com"
set "PGPORT=6543"
set "PGUSER=postgres.flbvusudwszxdylxevfe"
set "PGDATABASE=postgres"
set "SCRIPT_DIR=%~dp0"
set "MIG_DIR=%SCRIPT_DIR%..\supabase\migrations"

if not exist "%PSQL%" (
  echo [ERROR] psql not found at "%PSQL%"
  pause
  exit /b 1
)

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "STAMP=%%i"
set "LOGFILE=%SCRIPT_DIR%restore_functions_%STAMP%.log"
if exist "%LOGFILE%" del "%LOGFILE%"

set /p PGPASSWORD="Database password: "
if not defined PGPASSWORD (
  echo [ERROR] No password provided.
  pause
  exit /b 1
)

echo Connecting to %PGHOST% as %PGUSER% ...
"%PSQL%" -v ON_ERROR_STOP=1 -c "SELECT version();" > "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [FAIL] Could not connect. Check the password.
  pause
  exit /b 1
)
echo [OK] Connected.

set "MIG_LIST=20250816000000_update_student_auth.sql 20250816000001_rate_limiting.sql 20250817000000_support_tables.sql 20250818000000_student_sessions.sql 20250818000001_portal_rpcs.sql 20250818000002_exam_rpcs.sql 20250818000003_core_rls.sql 20250820000000_restore_student_portal.sql 20250824000000_security_hardening.sql 20250825000000_lock_counter_rpcs.sql 20250825000001_gate_exam_leaderboard.sql 20250825000002_narrow_teacher_columns.sql 20250825000003_fix_exam_join_ambiguity.sql 20250825000004_fix_latent_ambiguity.sql 20250827000001_batch_fixes.sql 20250827000002_student_id.sql 20250827000003_exam_batches.sql 20250827000004_exam_penalty.sql 20250829000001_security_controls.sql 20250829000002_exam_auth_penalty.sql 20250829000003_fix_portal_exams_42804.sql 20250830000001_exam_batch_backfill.sql 20250830000002_payment_approvals.sql 20250830000004_admission_reference_gender.sql 20250831000001_fix_default_password_login.sql 20250831000002_batch_end_time.sql 20250904000001_admin_safe_mutations.sql 20250905000005_feedback_email.sql 20250905000006_provider_secrets.sql 20250906000001_phase2_session_validation.sql 20250906000002_atomic_admission_approval.sql 20250906000003_phase2_payment_audit_atomic.sql 20250907000001_exam_session_only_and_avatar_storage.sql 20250909000001_postinstall_repairs.sql 20250910000001_fee_audit_logs_admin_rls.sql 20250911000001_atomic_exam_deletion.sql 20250912000001_student_auth_hardening.sql 20250913000001_private_avatars_public_assets.sql 20250914000001_public_form_abuse_prevention.sql 20250915000001_durable_message_outbox.sql 20250915000002_messaging_worker_heartbeat.sql 20250915000003_messaging_channel_claims.sql 20250915000004_messaging_ambiguous_outcomes.sql 20250915000005_atomic_message_attempts.sql 20250915000006_atomic_message_job_aggregate.sql 20250915000007_non_idempotent_sms_dispatch.sql 20250915000008_provider_neutral_messaging.sql 20250915000009_mim_dispatch_fence.sql 20250916000001_home_stats_rpc.sql 20250916000002_public_assets_admin_storage_rls.sql 20250905000001_backups_admin_rls.sql 20250905000002_backup_coverage.sql 20250905000003_backup_restore_coverage.sql 20250905000004_admin_backup_now.sql automated_backups.sql 20250905000007_backup_payload_redaction.sql keep_alive_cron.sql"

echo.
echo ===== Restoring all migrations (recreating functions) =====
for %%M in (%MIG_LIST%) do (
  call :ApplyOne "%%M"
)

echo.
echo [OK] Restore complete. Log: %LOGFILE%
echo Now try logging in again.
pause
goto :eof

:ApplyOne
  set "F=%~1"
  if not exist "%MIG_DIR%\%F%" (
    echo [MISSING] %F%
    goto :eof
  )
  echo Applying: %F%
  "%PSQL%" -v ON_ERROR_STOP=1 -f "%MIG_DIR%\%F%" >> "%LOGFILE%" 2>&1
  if errorlevel 1 (
    echo [WARN] %F% had an issue
  ) else (
    echo [OK] %F%
  )
  goto :eof
