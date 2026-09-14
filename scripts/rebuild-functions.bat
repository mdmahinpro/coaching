@echo off
setlocal EnableExtensions
REM ============================================================
REM  rebuild-functions.bat  -- ONE-TIME recovery
REM
REM  Use this once to restore the database functions that were
REM  accidentally dropped. It forces the installer to re-apply
REM  every migration (recreating verify_student_login, is_admin,
REM  the portal/exam/admin RPCs, etc.) instead of skipping them.
REM
REM  It prompts for the database password, then runs the normal
REM  installer in "force rebuild" mode.
REM ============================================================
set "FORCE_REBUILD=1"
call "%~dp0apply-migrations.bat"