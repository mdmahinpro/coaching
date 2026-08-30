-- Wipe disposable ADM-E2E records created by admin.browser.cjs (idempotent).
DELETE FROM payment_approvals WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'ADM E2E %' OR phone = '01800000000');
DELETE FROM fee_audit_logs WHERE fee_id IN (SELECT id FROM fees WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'ADM E2E %' OR phone = '01800000000'));
DELETE FROM fees WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'ADM E2E %' OR phone = '01800000000');
DELETE FROM students WHERE name LIKE 'ADM E2E %' OR phone = '01800000000';
DELETE FROM batches WHERE name LIKE 'ADM-E2E %';
