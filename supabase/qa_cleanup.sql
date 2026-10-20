-- QA cleanup — removes everything the end-to-end QA passes created.
-- Safe to run repeatedly. Run in Supabase → SQL Editor (owner only).
-- Keeps the qa-admin@example.test login so QA can be re-run; drop that
-- separately (see the commented block at the bottom) when you are done.

begin;

-- 1. Exam children of the QA exams ------------------------------------------
delete from mcq_submissions
 where exam_id in (select id from exams where title like 'QA %')
    or student_id in (select id from students
                       where name like 'QA Student%'
                          or student_id in ('CF260001', 'CF260002', 'CF260003'));

delete from mcq_questions
 where exam_id in (select id from exams where title like 'QA %');

-- 2. Exams ------------------------------------------------------------------
delete from exams where title like 'QA %';

-- 3. Fee audit trail → fees --------------------------------------------------
delete from fee_audit_logs
 where fee_id in (
   select f.id from fees f join students s on s.id = f.student_id
    where s.name like 'QA Student%'
       or s.student_id in ('CF260001', 'CF260002', 'CF260003')
 );

delete from fees
 where student_id in (select id from students
                       where name like 'QA Student%'
                          or student_id in ('CF260001', 'CF260002', 'CF260003'));

-- 4. SMS log rows written by the QA payments --------------------------------
delete from sms_logs
 where phone = '01790197687'
    or message ilike '%QA Student%';

-- 5. Students + batch -------------------------------------------------------
delete from students
 where name like 'QA Student%'
    or student_id in ('CF260001', 'CF260002', 'CF260003');

delete from batches where name = 'QA Batch A';

commit;

-- Remove the disposable QA admin as well (optional — only after you stop QA):
-- delete from admin_users where email = 'qa-admin@example.test';
