-- Wipe disposable ADM-E2E records created by admin.browser.cjs (idempotent).
DELETE FROM students WHERE name LIKE 'ADM E2E %' OR phone = '01800000000';
DELETE FROM batches WHERE name LIKE 'ADM-E2E %';
