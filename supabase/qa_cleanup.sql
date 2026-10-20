-- ============================================================================
--  QA CLEANUP  —  Coaching / Techely Learning Academy
--  Supabase project: flbvusudwszxdylxevfe
--
--  Removes everything the QA pass of 2026-10-20 left in the live database.
--  Paste the whole file into Supabase Dashboard -> SQL Editor -> Run.
--  No login needed, no crypt()/gen_salt(), nothing secret in here.
--
--  Removes (counts read from the live DB right before writing this script):
--    exams titled 'QA …' ........ 3   (QA MCQ Test 2146, QA Live Exam 4361,
--                                      QA Live Exam 9426)
--    their mcq_questions ........ 7
--    their mcq_submissions ...... 3
--    batch 'QA Batch A' ......... 1   (students detached first)
--    QA students ................ 1   (CF260003 — the long-name test student)
--    fees created during QA ..... 86  (full 21-student batches for January 2026,
--                                      November 2026, December 2026, February 2027
--                                      + 2 one-off rows)
--    fee_audit_logs ............. 10
--    sms_logs ................... 4
--
--  Keeps: every seeded student (CF250001-CF250005, TLY…), batch, exam, teacher,
--  notice, site_setting, and every fee row created before 2026-10-20.
--  Keeps the disposable admin qa-admin@example.test (removal block at the end).
--
--  Idempotent and wrapped in one transaction: re-running is harmless, and any
--  error rolls the whole cleanup back.
-- ============================================================================

begin;

-- 0. Preview — the counts appear in the "Notices"/messages pane ---------------
do $$
declare n_exams int; n_q int; n_sub int; n_fees int; n_audit int; n_sms int; n_batch int; n_stu int;
begin
  select count(*) into n_exams from public.exams where title like 'QA %';
  select count(*) into n_q     from public.mcq_questions  where exam_id in (select id from public.exams where title like 'QA %');
  select count(*) into n_sub   from public.mcq_submissions where exam_id in (select id from public.exams where title like 'QA %');
  select count(*) into n_stu   from public.students where name like 'QA %'
                                  or student_id in ('CF260001','CF260002','CF260003');
  select count(*) into n_fees  from public.fees           where created_at >= timestamptz '2026-10-20 00:00:00+00';
  select count(*) into n_audit from public.fee_audit_logs where created_at >= timestamptz '2026-10-20 00:00:00+00';
  select count(*) into n_sms   from public.sms_logs       where created_at >= timestamptz '2026-10-20 00:00:00+00';
  select count(*) into n_batch from public.batches        where name like 'QA %';
  raise notice 'QA cleanup preview -> exams %, questions %, submissions %, students %, fees %, audit %, sms %, batches %',
    n_exams, n_q, n_sub, n_stu, n_fees, n_audit, n_sms, n_batch;
end $$;

-- 1. Exam children, then the exams (child rows first) ------------------------
delete from public.mcq_submissions
 where exam_id in (select id from public.exams where title like 'QA %')
    or student_id in (select id from public.students
                       where name like 'QA %'
                          or student_id in ('CF260001','CF260002','CF260003'));

delete from public.mcq_questions
 where exam_id in (select id from public.exams where title like 'QA %');

delete from public.exams where title like 'QA %';

-- 2. QA students: dependants first, then the student rows --------------------
delete from public.fee_audit_logs
 where fee_id in (select f.id from public.fees f
                   join public.students s on s.id = f.student_id
                  where s.name like 'QA %'
                     or s.student_id in ('CF260001','CF260002','CF260003'));

delete from public.fees
 where student_id in (select id from public.students
                       where name like 'QA %'
                          or student_id in ('CF260001','CF260002','CF260003'));

update public.students set batch_id = null
 where batch_id in (select id from public.batches where name like 'QA %');

delete from public.students
 where name like 'QA %'
    or student_id in ('CF260001','CF260002','CF260003');

-- 3. QA batch ----------------------------------------------------------------
delete from public.batches where name like 'QA %';

-- 4. Fees generated during the QA run (their audit rows first) ---------------
delete from public.fee_audit_logs
 where created_at >= timestamptz '2026-10-20 00:00:00+00';

delete from public.fees
 where created_at >= timestamptz '2026-10-20 00:00:00+00';

-- 5. Remaining QA CRM/reporting noise ---------------------------------------
delete from public.fee_audit_logs
 where admin_email = 'qa-admin@example.test'
    or student_name like 'QA %';
delete from public.sms_logs
 where created_at >= timestamptz '2026-10-20 00:00:00+00'
    or phone = '01790197687'
    or message ilike '%QA Student%';

commit;

-- 6. Verify — every row below should read 0 ---------------------------------
select 'QA exams'            as leftover, count(*) from public.exams          where title like 'QA %'
union all select 'QA questions',       count(*) from public.mcq_questions   where exam_id not in (select id from public.exams)
union all select 'QA students',        count(*) from public.students        where name like 'QA %'
union all select 'QA batches',         count(*) from public.batches         where name like 'QA %'
union all select 'fees from QA run',   count(*) from public.fees            where created_at >= timestamptz '2026-10-20 00:00:00+00'
union all select 'audit from QA run',  count(*) from public.fee_audit_logs  where created_at >= timestamptz '2026-10-20 00:00:00+00'
union all select 'sms from QA run',    count(*) from public.sms_logs        where created_at >= timestamptz '2026-10-20 00:00:00+00';

-- 7. OPTIONAL — also remove the disposable QA admin login -------------------
-- delete from public.admin_users where email = 'qa-admin@example.test';
