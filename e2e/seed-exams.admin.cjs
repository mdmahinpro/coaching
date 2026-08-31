/* Seed disposable student (01900000000 / E2ePass!2026) + strict active exam
   for e2e/student.browser.cjs — via the admin session (bcrypt via the
   register_student RPC). Idempotent: wipes prior __E2E__ leftovers first. */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map((l) => l.split('=').map((s) => s.trim()))
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

(async () => {
  const creds = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin-creds.json'), 'utf8'));
  const { error: authErr } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (authErr) { console.error('AUTH ERROR', authErr.message); process.exit(1); }

  // Wipe leftovers (idempotent)
  const { data: oldExams } = await sb.from('exams').select('id').like('title', '__E2E%');
  for (const e of oldExams ?? []) {
    await sb.from('mcq_submissions').delete().eq('exam_id', e.id);
    await sb.from('mcq_questions').delete().eq('exam_id', e.id);
    await sb.from('exam_tokens').delete().eq('exam_id', e.id);
    await sb.from('exams').delete().eq('id', e.id);
  }
  const { data: oldStudents } = await sb.from('students').select('id').eq('phone', '01900000000');
  for (const s of oldStudents ?? []) {
    await sb.from('fees').delete().eq('student_id', s.id);
    await sb.from('mcq_submissions').delete().eq('student_id', s.id);
    await sb.from('student_sessions').delete().eq('student_id', s.id);
    await sb.from('students').delete().eq('id', s.id);
  }
  await sb.from('batches').delete().like('name', '__E2E%');

  // Create batch via REST, then register_student (hashes password server-side)
  const { data: batch } = await sb.from('batches').insert({ name: '__E2E Batch__', capacity: 10, is_active: true }).select('id').single();
  if (!batch) { console.error('batch insert failed'); process.exit(1); }

  const reg = await sb.rpc('register_student', {
    p_name: 'E2E Student', p_phone: '01900000000', p_student_id: '__E2E0001',
    p_password: 'E2ePass!2026', p_status: 'active', p_is_approved: true, p_batch_id: batch.id,
  });
  if (reg.error) { console.error('register_student error:', reg.error.message); process.exit(1); }
  const studentId = Array.isArray(reg.data) ? reg.data[0]?.id : reg.data?.id;
  console.log('student seeded:', studentId);

  // Strict, active, already-open exam for that student's batch
  const { data: exam } = await sb.from('exams').insert({
    title: '__E2E Exam__', subject: 'E2E Subject', status: 'active',
    exam_date: new Date().toISOString().slice(0, 10), duration_minutes: 30,
    total_marks: 3, pass_marks: 1, instructions: 'E2E instructions',
    start_time: new Date(Date.now() - 5 * 60000).toISOString(),
    end_time: new Date(Date.now() + 30 * 60000).toISOString(),
    timer_enabled: true, strict_mode: true, type: 'mcq', batch_id: batch.id, batch_ids: [batch.id],
  }).select('id').single();
  if (!exam) { console.error('exam insert failed'); process.exit(1); }

  const qs = await sb.from('mcq_questions').insert([
    { exam_id: exam.id, question_text: 'E2E Q1: two plus two?', option_a: '3', option_b: '4', option_c: '5', option_d: '6', correct_option: 'b', marks: 1, order_num: 1 },
    { exam_id: exam.id, question_text: 'E2E Q2: first letter?', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'a', marks: 2, order_num: 2 },
  ]);
  if (qs.error) { console.error('questions insert failed:', qs.error.message); process.exit(1); }

  console.log('EXAM_ID=' + exam.id);
  console.log('batch=', batch.id);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
