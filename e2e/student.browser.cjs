const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { gotoReady, waitForPath } = require('./readiness.cjs');
const { verifyResultsAndDownload } = require('./student-results-check.cjs');

const BASE = require('./disposable-guard.cjs').isolatedBaseUrl();
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const {
  requireDisposableTarget,
  assertAppTargetsDisposable,
  assertServerEndpointsDisposable,
  readIsolatedCreds,
} = require('./disposable-guard.cjs');

// Fail closed BEFORE any login, seed, mutation, or cleanup. Configuration must
// come from the isolated env (E2E_DISPOSABLE_*), never from `.env.local`.
const target = requireDisposableTarget();
const adminCreds = readIsolatedCreds();
const DL_DIR = path.join(__dirname, 'downloads');
fs.mkdirSync(DL_DIR, { recursive: true });
const adminClient = createClient(target.url, target.key);

const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok === null ? 'BLOCKED' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
};

let cleanup = async () => {};
let cleanupErrors = 0;
let browserToClose = null;
let configBrowser = null;
function safeError(error) {
  let message = String(error?.message || error || 'Unknown failure');
  for (const secret of [adminCreds.password, target.key, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean)) message = message.split(secret).join('[redacted]');
  return `${error?.code || 'ERROR'}: ${message.slice(0, 240)}`;
}
(async () => {
  configBrowser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const configPage = await configBrowser.newPage();
  await gotoReady(configPage, BASE + '/portal/login', { marker: 'ছাত্র পোর্টাল', selector: 'input[type="tel"]' });
  await assertAppTargetsDisposable(configPage, target.url);
  await configBrowser.close();
  configBrowser = null;
  await assertServerEndpointsDisposable(BASE, target.url);
  const runId = Date.now().toString().slice(-8);
  const PHONE = `019${runId}`;
  const PASSWORD = `E2ePass!${runId}`;
  let batchId = null;
  let studentId = null;
  let examId = null;
  const auth = await adminClient.auth.signInWithPassword({ email: adminCreds.email, password: adminCreds.password });
  if (auth.error) throw new Error('Admin authentication failed for runtime exam seed');
  cleanup = async () => {
    const attempt = async (label, operation) => {
      try {
        const result = await operation();
        if (result?.error) throw result.error;
      } catch (error) {
        cleanupErrors += 1;
        console.log(`CLEANUP WARNING: ${label}: ${safeError(error)}`);
      }
    };
    if (studentId) {
      // student_sessions and the other student-owned tables are private.
      // Direct deletes are denied (42501) because the hardening migration
      // reduced authenticated to SELECT on the token tables. Use the installed
      // admin-gated transaction instead; it removes sessions, exam tokens,
      // submissions, fees/audits, approvals, and the student atomically
      // without broadening table permissions.
      await attempt('student fixture', () =>
        adminClient.rpc('admin_delete_student', { p_student_id: studentId })
      );
    }
    if (examId) {
      // exam_tokens for this student were removed by admin_delete_student;
      // the exams FK cascades any remaining tokens when the exam is deleted.
      await attempt('exam submissions', () => adminClient.from('mcq_submissions').delete().eq('exam_id', examId));
      await attempt('exam questions', () => adminClient.from('mcq_questions').delete().eq('exam_id', examId));
      await attempt('exam fixture', () => adminClient.from('exams').delete().eq('id', examId));
    }
    if (batchId) await attempt('batch fixture', () => adminClient.from('batches').delete().eq('id', batchId));
  };
  const batch = await adminClient.from('batches').insert({ name: `__E2E Runtime Batch ${runId}`, capacity: 10, is_active: true }).select('id').single();
  if (batch.error) throw new Error(`Runtime batch seed failed: ${batch.error.message}`);
  batchId = batch.data.id;
  const student = await adminClient.rpc('register_student', { p_name: `E2E Runtime Student ${runId}`, p_phone: PHONE, p_student_id: `__E2E${runId}`, p_password: PASSWORD, p_status: 'active', p_is_approved: true, p_batch_id: batchId });
  if (student.error) throw new Error(`Runtime student seed failed: ${student.error.message}`);
  studentId = Array.isArray(student.data) ? student.data[0]?.id : student.data?.id;
  const examTitle = `__E2E Runtime Exam ${runId}`;
  const exam = await adminClient.from('exams').insert({ title: examTitle, subject: 'E2E Subject', status: 'active', exam_date: new Date().toISOString().slice(0, 10), duration_minutes: 30, total_marks: 3, pass_marks: 1, instructions: 'E2E instructions', start_time: new Date(Date.now() - 5 * 60000).toISOString(), end_time: new Date(Date.now() + 30 * 60000).toISOString(), timer_enabled: true, strict_mode: true, type: 'mcq', batch_id: batchId, batch_ids: [batchId] }).select('id').single();
  if (exam.error) throw new Error(`Runtime exam seed failed: ${exam.error.message}`);
  examId = exam.data.id;
  const questions = await adminClient.from('mcq_questions').insert([
    { exam_id: examId, question_text: 'E2E Q1: two plus two?', option_a: '3', option_b: '4', option_c: '5', option_d: '6', correct_option: 'b', marks: 1, order_num: 1 },
    { exam_id: examId, question_text: 'E2E Q2: first letter?', option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'a', marks: 2, order_num: 2 },
  ]);
  if (questions.error) throw new Error(`Runtime exam questions seed failed: ${questions.error.message}`);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  browserToClose = browser;
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const consoleLogs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleLogs.push('['+m.type()+'] ' + m.text().slice(0,300)); });
  page.on('pageerror', (e) => consoleLogs.push('[pageerror] ' + String(e && e.message).slice(0,300)));
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR }).catch(() => {});

  const clickButtonContaining = async (needle, timeout = 8000) => {
    await page.waitForFunction((n) => Array.from(document.querySelectorAll('button')).some((el) => el.textContent.includes(n)), { timeout }, needle);
    return page.evaluate((n) => {
      const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes(n));
      if (!el) return false; el.click(); return true;
    }, needle);
  };
  const clickOption = async (value) =>
    page.evaluate((v) => {
      const btns = Array.from(document.querySelectorAll('button'));
      const opt = btns.find((b) => { const t = (b.textContent || '').trim(); return t.endsWith(v) && t.length <= 4; })
        || btns.find((b) => (b.textContent || '').includes(v));
      if (!opt) return false; opt.click(); return true;
    }, value);

  // 1. Public home — page must render (nav + intro), Bengali or English.
  await gotoReady(page, BASE + '/', { marker: 'Excellence in Education' });
  const rootText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  step('Public home renders (content > 120 chars)', rootText.trim().length > 120, rootText.replace(/\n/g, ' ').slice(0, 70));

  // 2. Portal login → dashboard
  await gotoReady(page, BASE + '/portal/login', { marker: 'ছাত্র পোর্টাল', selector: 'input[type="tel"]' });
  await page.type('input[type="tel"]', PHONE);
  await page.type('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await waitForPath(page, '/portal/dashboard');
  await page.waitForSelector('a[href="/portal/fees"], a[href="/portal/exams"]', { visible: true, timeout: 15000 });
  const dashText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  step('Portal login → dashboard (no 42804)', dashText.length > 300, `path=${new URL(page.url()).pathname} len=${dashText.length}`);
  step('Dashboard renders portal sections', /ফি|ফলাফল|নোটিশ|পরীক্ষা/i.test(dashText), '');

  // 3. Strict exam round trip
  await gotoReady(page, BASE + '/exam/' + examId, { marker: '__E2E Runtime Exam' });
  let body = await page.evaluate(() => document.body.innerText);
  step('Exam instructions (strict active)', body.includes('পরীক্ষা শুরু করুন'), '');

  await clickButtonContaining('পরীক্ষা শুরু করুন');
  await new Promise((r) => setTimeout(r, 1500));
  await clickOption('4');
  await new Promise((r) => setTimeout(r, 500));
  await clickButtonContaining('পরে');
  await new Promise((r) => setTimeout(r, 700));
  await clickOption('A');
  await new Promise((r) => setTimeout(r, 500));
  await clickButtonContaining('জমা দিন');
  await new Promise((r) => setTimeout(r, 600));
  await clickButtonContaining('Submit করুন');
  await page.waitForFunction(() => /অভিনন্দন|আরও চেষ্টা|PASSED|FAILED|ফলাফল/.test(document.body.innerText), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  body = await page.evaluate(() => document.body.innerText);
  const scoreLine = body.match(/(\d+%)\s+(\d+)\s*\/\s*(\d+)/);
  step('Exam submitted — result with score %', scoreLine !== null && scoreLine[1] === '100%', scoreLine ? `${scoreLine[1]} ${scoreLine[2]}/${scoreLine[3]}` : '-');
  step('Result shows correct/wrong/unanswered breakdown', /সঠিক|ভুল|উত্তর নেই/i.test(body), '');
  step('Result back-to-dashboard button', body.includes('ড্যাশবোর্ডে যান'), '');

  // 4. Wait for the exact submitted exam card, not merely the page heading.
  // Test its REAL Download button; do not fabricate zero-valued PDF data.
  const resultCheck = await verifyResultsAndDownload(page, {
    baseUrl: BASE, examId, examTitle, timeoutMs: 30000,
  });
  step('Portal results shows the E2E exam submission', resultCheck.listed,
    resultCheck.listed ? 'exact runtime exam card rendered' : JSON.stringify(resultCheck.diagnostics));
  if (resultCheck.listed) {
    step('Result PDF generates valid %PDF bytes', Boolean(resultCheck.pdf?.ok),
      resultCheck.pdf?.ok ? `${resultCheck.pdf.bytes} bytes from the real Download button`
        : `${resultCheck.pdf?.err || 'PDF_NOT_CONFIRMED'} ${JSON.stringify(resultCheck.diagnostics)}`);
  } else {
    step('Result PDF generates valid %PDF bytes', null, 'results card unavailable; PDF click was not attempted');
  }

  if (consoleLogs.length) { console.log('--- console captures ---'); consoleLogs.slice(0,20).forEach(l => console.log(l)); }
  await browser.close();
  browserToClose = null;
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== ${passed}/${results.length} passed ====`);
  process.exitCode = passed === results.length ? 0 : 1;
})().catch((error) => {
  console.error('E2E FATAL:', safeError(error));
  process.exitCode = 1;
}).finally(async () => {
  if (configBrowser) await configBrowser.close().catch(() => {});
  if (browserToClose) await browserToClose.close().catch(() => {});
  await cleanup().catch((error) => { cleanupErrors += 1; console.log('CLEANUP WARNING:', safeError(error)); });
  await adminClient.auth.stopAutoRefresh();
  console.log(`Cleanup errors: ${cleanupErrors}. Zero errors do not prove no prior-run residue.`);
  if (cleanupErrors) process.exitCode = 1;
});
