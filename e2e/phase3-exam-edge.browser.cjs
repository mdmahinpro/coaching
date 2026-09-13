/* Phase 3 disposable-only exam edge audit.
 * Requires E2E_DISPOSABLE_SUPABASE_URL and E2E_DISPOSABLE_SUPABASE_ANON_KEY.
 * It refuses to use the current customer/project configuration.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { requireDisposableTarget, readIsolatedCreds } = require('./disposable-guard.cjs');

// Fail closed on missing config, original/customer target, or wrong project.
const target = requireDisposableTarget();
const url = target.url;
const key = target.key;

const creds = readIsolatedCreds();
const admin = createClient(url, key);
const run = Date.now().toString().slice(-8);
const created = { batch: null, student: null, exam: null };
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`); };

async function cleanup() {
  if (created.exam) {
    await admin.from('mcq_submissions').delete().eq('exam_id', created.exam);
    await admin.from('exam_tokens').delete().eq('exam_id', created.exam);
    await admin.from('mcq_questions').delete().eq('exam_id', created.exam);
    await admin.from('exams').delete().eq('id', created.exam);
  }
  if (created.student) {
    await admin.from('student_sessions').delete().eq('student_id', created.student);
    await admin.from('students').delete().eq('id', created.student);
  }
  if (created.batch) await admin.from('batches').delete().eq('id', created.batch);
}

(async () => {
  const auth = await admin.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (auth.error) throw auth.error;

  const batch = await admin.from('batches').insert({ name: `__PHASE3 ${run}`, capacity: 10, is_active: true }).select('id').single();
  if (batch.error) throw batch.error;
  created.batch = batch.data.id;
  const student = await admin.rpc('register_student', {
    p_name: `Phase3 Student ${run}`, p_phone: `019${run}`, p_student_id: `P3${run}`,
    p_password: `Phase3!${run}`, p_status: 'active', p_is_approved: true, p_batch_id: created.batch,
  });
  if (student.error) throw student.error;
  created.student = Array.isArray(student.data) ? student.data[0]?.id : student.data?.id;
  const exam = await admin.from('exams').insert({
    title: `__PHASE3 Exam ${run}`, subject: 'Phase3', status: 'active', exam_date: new Date().toISOString().slice(0, 10),
    duration_minutes: 1, total_marks: 10, pass_marks: 4, start_time: new Date(Date.now() - 60000).toISOString(),
    end_time: new Date(Date.now() + 60000).toISOString(), timer_enabled: true, strict_mode: true,
    type: 'mcq', batch_id: created.batch, batch_ids: [created.batch],
  }).select('id').single();
  if (exam.error) throw exam.error;
  created.exam = exam.data.id;
  const questions = await admin.from('mcq_questions').insert([
    { exam_id: created.exam, question_text: 'P3 one?', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'a', marks: 5, order_num: 1 },
    { exam_id: created.exam, question_text: 'P3 two?', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'b', marks: 5, order_num: 2 },
  ]);
  if (questions.error) throw questions.error;

  const login = await admin.rpc('verify_student_login', { p_phone: `019${run}`, p_password: `Phase3!${run}` });
  const token = login.data?.[0]?.session_token;
  step('Student login mints token', !!token);

  if (token) {
    const invalid = await admin.rpc('exam_get_questions', { p_exam_token: 'not-a-real-token' });
    step('Invalid exam token is rejected', !!invalid.error || !invalid.data?.length, invalid.error?.message || 'empty');
  } else {
    step('Invalid exam token is rejected', false, 'No student token');
  }

  /* The exact exam token is minted by exam_join and is intentionally not
     bypassed here. A deployed environment with the Phase 3 migrations should
     add the join-token call and run duplicate/concurrency assertions below. */
  step('Duplicate/concurrent submit edge tests', false, 'Blocked until exam_join token contract is verified in disposable DB');
  step('Timer expiry and strict penalty edge tests', false, 'Blocked until disposable exam token contract is verified');
  step('Pause/resume/import/recalculation edge tests', false, 'Not covered by current verified contract');

  await cleanup();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`PHASE3 EXAM EDGE: ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(async (error) => {
  console.error('PHASE3 EXAM FATAL:', error.message);
  await cleanup();
  process.exit(1);
});
