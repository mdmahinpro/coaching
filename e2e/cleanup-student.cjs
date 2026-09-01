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
    const prior = (await supabase.from('students').select('id').or(`student_id.like.%E2E%,phone.eq.01900000000`)).data || [];
    for (const p of prior) { await supabase.from('mcq_submissions').delete().eq('student_id', p.id); await supabase.from('student_sessions').delete().eq('student_id', p.id); }
    const exams = (await supabase.from('exams').select('id').like('title', '__E2E%')).data || [];
    for (const e of exams) { await supabase.from('mcq_questions').delete().eq('exam_id', e.id); await supabase.from('exam_tokens').delete().eq('exam_id', e.id); await supabase.from('exams').delete().eq('id', e.id); }
    for (const p of prior) await supabase.from('students').delete().eq('id', p.id);
    await supabase.from('batches').delete().like('name', '__E2E%');
    return { deletedStudents: prior.length, deletedExams: exams.length };
  });
  console.log('CLEANUP:', JSON.stringify(out));
  await b.close();
})();
