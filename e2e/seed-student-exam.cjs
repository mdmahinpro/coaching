const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:5173';
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin-creds.json'), 'utf8'));
(async () => {
  const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const admin = await b.newPage();
  await admin.goto(BASE + '/admin/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await admin.waitForSelector('input[autocomplete="email"]', { timeout: 10000 });
  const t = async (sel, val) => { const el = await admin.$(sel); await el.click({ clickCount: 3 }); await el.type(val); };
  await t('input[autocomplete="email"]', creds.email);
  await t('input[autocomplete="current-password"]', creds.password);
  await admin.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.type === 'submit' && /Login|প্রবেশ|Sign In|লগইন/i.test(x.textContent)); if (b) b.click(); });
  await admin.waitForFunction(() => location.pathname.includes('/admin/dashboard'), { timeout: 20000 }).then(()=>true).catch(()=>false);
  await new Promise(r => setTimeout(r, 1500));
  const out = await admin.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    // cleanup prior E2E rows
    const prior = (await supabase.from('students').select('id').eq('phone','01900000000')).data || [];
    for (const p of prior) { await supabase.from('mcq_submissions').delete().eq('student_id', p.id); }
    const oldExams = (await supabase.from('exams').select('id').like('title', '__E2E%')).data || [];
    for (const e of oldExams) {
      await supabase.from('mcq_questions').delete().eq('exam_id', e.id);
      await supabase.from('exam_tokens').delete().eq('exam_id', e.id);
      await supabase.from('exams').delete().eq('id', e.id);
    }
    for (const p of prior) await supabase.from('students').delete().eq('id', p.id);
    await supabase.from('batches').delete().like('name', '__E2E%');
    // create disposable batch + student + active strict exam + questions
    const { data: b1, error: bErr } = await supabase.from('batches').insert({ name: '__E2E Batch__', capacity: 10, is_active: true }).select('id').single();
    if (bErr) return { err: 'batch: ' + bErr.message };
    const { data: s1, error: sErr } = await supabase.rpc('register_student', {
      p_name: 'E2E Student', p_phone: '01900000000', p_student_id: '__E2E0001', p_password: 'E2ePass!2026',
      p_status: 'active', p_is_approved: true, p_batch_id: b1.id,
    });
    if (sErr) return { err: 'student: ' + sErr.message };
    const { data: e1, error: eErr } = await supabase.from('exams').insert({
      title: '__E2E Exam__', subject: 'E2E Subject', status: 'active', exam_date: new Date().toISOString().slice(0,10),
      duration_minutes: 30, total_marks: 3, pass_marks: 1, instructions: 'E2E instructions',
      start_time: new Date(Date.now()-5*60000).toISOString(), end_time: new Date(Date.now()+30*60000).toISOString(),
      timer_enabled: true, strict_mode: true, type: 'mcq', batch_id: b1.id, batch_ids: [b1.id],
    }).select('id').single();
    if (eErr) return { err: 'exam: ' + eErr.message };
    const { error: qErr } = await supabase.from('mcq_questions').insert([
      { exam_id: e1.id, question_text: 'E2E Q1: two plus two?', option_a: '3', option_b: '4', option_c: '5', option_d: '6', correct_option: 'b', marks: 1, order_num: 1 },
      { exam_id: e1.id, question_text: 'E2E Q2: first letter?', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'a', marks: 2, order_num: 2 },
    ]);
    if (qErr) return { err: 'questions: ' + qErr.message };
    return { examId: e1.id };
  });
  console.log(JSON.stringify(out));
  await b.close();
})();
