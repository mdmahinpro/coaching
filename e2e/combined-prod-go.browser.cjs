/* Combined PRODUCTION-GO audit harness — admin + student + combined flows.
 *
 * Drives real headless Edge against the local dev server (127.0.0.1:5173)
 * and the live Supabase project. Uses ONLY disposable records:
 *   - ADMIN seeds/cleans via an authenticated Supabase client
 *   - student = public ADMISSION submission -> admin APPROVE -> portal login
 *   - fee = student SUBMIT payment -> admin APPROVE round trip
 *   - everything uses the shared cleanup helper (incl. admin_delete_student)
 *
 * Credentials come from e2e/admin-creds.json (git-ignored, never printed).
 * No source data is touched; every created row is traced and removed.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { gotoReady, waitForPath } = require('./readiness.cjs');
const { submitPublicAdmission } = require('./admission-form-flow.cjs');
const { randomUUID } = require('node:crypto');
const runTag = randomUUID().slice(0, 8);

const BASE = require('./disposable-guard.cjs').isolatedBaseUrl();
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const {
  requireDisposableTarget,
  assertAppTargetsDisposable,
  assertServerEndpointsDisposable,
  readIsolatedCreds,
} = require('./disposable-guard.cjs');

// Fail closed BEFORE any login, seed, mutation, or cleanup.
const target = requireDisposableTarget();
const creds = readIsolatedCreds();
const sb = createClient(target.url, target.key);

const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok === null ? 'BLOCKED' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
};

function safeError(error) {
  let message = String(error?.message || error || 'Unknown failure');
  for (const secret of [creds.password, target.key, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean)) message = message.split(secret).join('[redacted]');
  return `${error?.code || 'ERROR'}: ${message.slice(0, 240)}`;
}
async function requireResult(query, label) {
  const result = await query;
  if (result?.error) throw Object.assign(new Error(`${label}: ${safeError(result.error)}`), { code: result.error.code });
  return result?.data;
}

/* Track everything we create so cleanup is exact and idempotent. */
const created = { admissionIds: [], studentIds: [], feeIds: [], approvalIds: [], examIds: [], batchIds: [], noticeIds: [], teacherIds: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cleanupFailures = 0;
async function cleanupAll() {
  // Children first, then parents. Wrap every step so one failure doesn't abort.
  const q = async (fn, lbl) => { try { const result = await fn(); if (result?.error) throw result.error; } catch (e) { cleanupFailures += 1; console.log('cleanup warn:', lbl, safeError(e)); } };
  for (const id of created.approvalIds) await q(() => sb.from('payment_approvals').delete().eq('id', id), 'approval');
  for (const id of created.admissionIds) await q(() => sb.from('admission_requests').delete().eq('id', id), 'admission');
  for (const id of created.studentIds) {
    await q(async () => {
      const data = await requireResult(sb.from('fees').select('id').eq('student_id', id), 'cleanup fee lookup');
      for (const f of data ?? []) { await requireResult(sb.from('fee_audit_logs').delete().eq('fee_id', f.id), 'cleanup fee audit'); }
      const { error } = await sb.rpc('admin_delete_student', { p_student_id: id });
      if (error) {
        throw new Error(`Transactional student cleanup unavailable: ${error.message}`);
      }
    }, 'student ' + id);
  }
  for (const id of created.examIds) {
    await q(async () => {
      await sb.from('mcq_questions').delete().eq('exam_id', id);
      await sb.from('mcq_submissions').delete().eq('exam_id', id);
      await sb.from('exam_tokens').delete().eq('exam_id', id);
      await sb.from('exams').delete().eq('id', id);
    }, 'exam ' + id);
  }
  for (const id of created.noticeIds) await q(() => sb.from('notices').delete().eq('id', id), 'notice');
  for (const id of created.batchIds) await q(() => sb.from('batches').delete().eq('id', id), 'batch');
  for (const id of created.teacherIds) await q(() => sb.from('teachers').delete().eq('id', id), 'teacher');
}

(async () => {
  const configBrowser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const configPage = await configBrowser.newPage();
  await gotoReady(configPage, BASE + '/admin/login', { marker: 'Admin Panel', selector: 'input[autocomplete="email"]' });
  await assertAppTargetsDisposable(configPage, target.url);
  await configBrowser.close();
  await assertServerEndpointsDisposable(BASE, target.url);
  // ── Admin auth (seed client) ────────────────────────────────
  const { error: authErr } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (authErr) { console.error('AUTH ERROR', authErr.message); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const consoleErrors = [];
  const rpcFailures = [];
  page.on('response', async (response) => {
    try {
      const u = new URL(response.url());
      if (response.status() >= 400 && /^\/rest\/v1\/(rpc\/(register_student|increment_enrolled|portal_submit_payment)|admission_requests)/.test(u.pathname)) {
        const body = await response.json().catch(() => ({}));
        rpcFailures.push(`${u.pathname}: HTTP ${response.status()} ${safeError(body)}`);
      }
    } catch {}
  });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e && e.message).slice(0, 240)));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().length && !r.url().endsWith('/admin/fees') && !r.url().endsWith('/admin/backup')) {
      consoleErrors.push('REST ' + r.status() + ' ' + r.url().slice(0, 200));
    }
  });

  const clickText = async (needle, timeout = 10000) => {
    await page.waitForFunction(
      (n) => Array.from(document.querySelectorAll('button,a')).some((el) => (el.textContent || '').includes(n)),
      { timeout }, needle
    );
    return page.evaluate((n) => {
      const el = Array.from(document.querySelectorAll('button,a')).find((b) => (b.textContent || '').includes(n));
      if (!el) return false; el.click(); return true;
    }, needle);
  };
  const typeInto = async (sel, val) => {
    const el = await page.$(sel);
    if (!el) return false;
    await el.click({ clickCount: 3 });
    await el.type(val);
    return true;
  };
  const bodyText = () => page.evaluate(() => document.body.innerText);

  // ═══════════ 1. ADMIN LOGIN ═══════════
  await gotoReady(page, BASE + '/admin/login', { marker: 'Admin Panel', selector: 'input[autocomplete="email"]' });
  await typeInto('input[autocomplete="email"]', creds.email);
  await typeInto('input[autocomplete="current-password"]', creds.password);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      (x) => x.type === 'submit' && /Login|প্রবেশ|Sign In|লগইন|ভর্তি/i.test(x.textContent)
    );
    if (b) b.click();
  });
  try { await page.waitForFunction(() => location.pathname.includes('/admin/dashboard'), { timeout: 20000 }); } catch {}
  await sleep(1800);
  step('ADMIN: login -> dashboard', page.url().includes('/admin/dashboard'));

  // ═══════════ 2. BATCH CRUD ═══════════
  await gotoReady(page, BASE + '/admin/batches', { marker: 'Batch' });
  await sleep(1200);
  await clickText('New Batch');
  await sleep(600);
  const batchName = 'ADM-COMBINED Batch ' + runTag;
  const nameInput = 'input[placeholder*="SSC English"], input[placeholder*="Batch"]';
  await typeInto(nameInput, batchName);
  await page.evaluate(() => {
    const subj = document.querySelector('input[placeholder*="Type a subject"]');
    if (subj) { subj.value = 'E2E Subject'; subj.dispatchEvent(new Event('input', { bubbles: true })); }
    const add = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Add') && b.textContent.trim().length < 8);
    if (add) add.click();
  });
  await sleep(400);
  await clickText('Create Batch');
  await sleep(1800);
  step('ADMIN: batch create', (await bodyText()).includes(batchName), batchName);

  const { data: createdBatch } = await sb.from('batches').select('id').eq('name', batchName).maybeSingle();
  if (createdBatch) created.batchIds.push(createdBatch.id);

  // Disable (soft delete) with confirm
  const disabled = await page.evaluate((n) => {
    const cards = Array.from(document.querySelectorAll('[class*="card"]'));
    for (const c of cards) {
      if (!c.textContent.includes(n)) continue;
      const del = Array.from(c.querySelectorAll('button')).find((b) => /hover:bg-red-500\/15/.test(b.className));
      if (del) { del.click(); return true; }
    }
    return false;
  }, batchName);
  await sleep(800);
  const confirmShown = await page.evaluate(() => /Disable/u.test(document.body.innerText));
  if (confirmShown) await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('Disable'));
    if (b) b.click();
  });
  await sleep(1200);
  const afterDisable = await sb.from('batches').select('is_active').eq('id', createdBatch?.id) ;
  step('ADMIN: batch disable confirm + soft delete', disabled && confirmShown && afterDisable.data?.[0]?.is_active === false,
    `foundCard=${disabled} confirm=${confirmShown}`);

  // ═══════════ 3. TEACHERS CRUD ═══════════
  await gotoReady(page, BASE + '/admin/teachers', { marker: 'Teacher' });
  await sleep(1200);
  await clickText('Add Teacher');          // opens teacher modal
  await sleep(700);
  const teacherName = 'ADM-COMBINED Teacher ' + runTag;
  await typeInto('input[placeholder="Teacher name"]', teacherName);
  await typeInto('input[placeholder="e.g. Mathematics"]', 'E2E Subject');
  const tPhone = '017555' + Date.now().toString().slice(-5);
  await typeInto('input[placeholder="01XXXXXXXXX"]', tPhone);
  await typeInto('input[placeholder="teacher@example.com"]', 'combined-teacher' + Date.now().toString().slice(-4) + '@example.com');
  // Register the response wait BEFORE clicking. A click is not a completed save.
  const teacherSaveResponse = page.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== 'POST') return false;
    try {
      const u = new URL(response.url());
      if (u.origin !== new URL(target.url).origin || u.pathname !== '/rest/v1/teachers') return false;
      const payload = JSON.parse(request.postData() || 'null');
      return (Array.isArray(payload) ? payload : [payload]).some(row => row?.name === teacherName);
    } catch { return false; }
  }, { timeout: 20000 }).then(response => ({ response })).catch(() => ({ response: null }));
  const teacherClicked = await page.evaluate(() => {
    // The header also says Add Teacher; the modal submit is last in DOM order.
    const all = Array.from(document.querySelectorAll('button')).filter(
      (x) => /Add Teacher/i.test(x.textContent) && x.textContent.trim().length < 25 && !x.disabled
    );
    const button = all[all.length - 1];
    if (!button) return false;
    button.click();
    return true;
  });
  const { response: teacherResponse } = await teacherSaveResponse;
  let teacherIssue = !teacherClicked ? 'TEACHER_SUBMIT_BUTTON_UNAVAILABLE'
    : !teacherResponse ? 'TEACHER_SAVE_RESPONSE_TIMEOUT: inspect form validation/network'
    : '';
  if (teacherResponse && !teacherResponse.ok()) {
    const body = await teacherResponse.json().catch(() => ({}));
    teacherIssue = `TEACHER_SAVE_HTTP_${teacherResponse.status()} ${safeError(body)}`;
  }
  let teacherRow = null;
  try {
    // Bounded read-only polling, exact run-scoped name. Do not match old fixtures.
    const deadline = Date.now() + 5000;
    do {
      teacherRow = await requireResult(sb.from('teachers').select('id').eq('name', teacherName).maybeSingle(), 'teacher persistence lookup');
      if (teacherRow?.id) break;
      if (Date.now() >= deadline) break;
      await sleep(200);
    } while (true);
  } catch (error) {
    teacherIssue = teacherIssue ? `${teacherIssue}; lookup: ${safeError(error)}` : safeError(error);
  }
  if (teacherRow?.id) created.teacherIds.push(teacherRow.id);
  step('ADMIN: teacher create persisted', Boolean(teacherClicked && teacherResponse?.ok() && teacherRow?.id && !teacherIssue),
    teacherIssue || (teacherRow?.id ? 'save response + exact fixture persisted' : 'TEACHER_ROW_NOT_FOUND_AFTER_SAVE'));

  // ═══════════ 4A. PUBLIC ADMISSION FORM (functional submission check) ═══════════
  const uniq = Date.now().toString().slice(-6);
  // Public admission needs its OWN active batch; the CRUD batch above was disabled.
  const pubName = 'ADM-COMBINED Public ' + uniq;
  const pubPhone = ('018' + uniq + '0000').slice(0, 11); // 11 digits (schema requires >=10)
  const guardianPhone = ('019' + uniq + '0000').slice(0, 11);
  try {
    const publicBatch = await requireResult(sb.from('batches').insert({
      name: 'ADM-COMBINED PublicBatch ' + runTag,
      capacity: 20, is_active: true, fee: 1500, monthly_fee: 1500,
    }).select('id').single(), 'public admission batch seed');
    if (!publicBatch?.id) throw new Error('PUBLIC_BATCH_SEED_RETURNED_NO_ID');
    created.batchIds.push(publicBatch.id);
    await submitPublicAdmission(page, {
      baseUrl: BASE, batchId: publicBatch.id,
      fields: { name: pubName, email: 'combined' + uniq + '@example.com',
        phone: pubPhone, guardian_name: 'Combined Guardian', guardian_phone: guardianPhone },
    });
    const publicRow = await requireResult(sb.from('admission_requests').select('id,reference_no')
      .eq('phone', pubPhone).eq('name', pubName).maybeSingle(), 'public admission persistence');
    if (publicRow?.id) created.admissionIds.push(publicRow.id);
    step('ADMIN(+public): admission form submits with reference', Boolean(publicRow?.reference_no),
      publicRow?.reference_no ? 'success screen + exact persisted fixture confirmed' : 'UI succeeded but fixture record/reference not confirmed');
  } catch (error) {
    step('ADMIN(+public): admission form submits with reference', false, safeError(error));
    // Recover only this exact fixture's ID for cleanup if the UI succeeded before a later check failed.
    const recovery = await sb.from('admission_requests').select('id').eq('phone', pubPhone).eq('name', pubName);
    if (recovery.error) console.log('cleanup discovery warn:', safeError(recovery.error));
    for (const row of recovery.data || []) if (!created.admissionIds.includes(row.id)) created.admissionIds.push(row.id);
  }

  // ═══════════ 4B. SEEDED ADMISSION -> ADMIN APPROVE -> PORTAL LOGIN ═══════════
  // Deterministic combined flow: a fresh disposable batch gives capacity +
  // a guaranteed-unique student ID (real approvals colliding on the live
  // students.student_id UNIQUE key are the production defect register_student
  // retry handles — covered separately). Register the batch + admission via the
  // authenticated admin client, then drive the UI approval.
  let studentRow = null;
  let approvedOk = false;
  let portalLoggedIn = false;
  try {
  const apprBatch = await requireResult(sb.from('batches').insert({
    name: 'ADM-COMBINED ApprBatch ' + runTag, capacity: 20, is_active: true, code: 'Q',
  }).select('id').single(), 'approval batch seed');
  if (!apprBatch?.id) throw new Error('APPROVAL_BATCH_SEED_RETURNED_NO_ID');
  created.batchIds.push(apprBatch.id);
  const apprName = 'ADM-COMBINED Seed ' + uniq;
  const apprPhone = ('017' + uniq + '0000').slice(0, 11);
  const apprAdmission = await requireResult(sb.from('admission_requests').insert({
    name: apprName, phone: apprPhone, email: 'seed' + uniq + '@example.com',
    guardian_name: 'Seed Guardian', guardian_phone: '01900000000',
    status: 'pending', reference_no: 'APP-' + uniq, class_level: 'Class 9',
    batch_id: apprBatch?.id,
  }).select('id, reference_no').single(), 'approval admission seed');
  if (!apprAdmission?.id) throw new Error('APPROVAL_ADMISSION_SEED_RETURNED_NO_ID');
  created.admissionIds.push(apprAdmission.id);

  await gotoReady(page, BASE + '/admin/admissions', { marker: 'Admission' });
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 15000 }, apprName);
  await sleep(600);
  // The admission row hydrates shortly after its text first appears; a single
  // 600ms probe can miss it, so poll the row+button until it can be clicked.
  const findAndClickApprove = async (name, tries = 20) => {
    for (let i = 0; i < tries; i++) {
      const ok = await page.evaluate((n) => {
        const rows = Array.from(document.querySelectorAll('tr, [class*="card"]'));
        for (const r of rows) {
          if (!r.textContent.includes(n)) continue;
          const b = Array.from(r.querySelectorAll('button')).find(
            (x) => /Approve|অনুমোদন/i.test(x.textContent)
              || x.title === 'Approve'
              || (x.getAttribute('aria-label') || '').includes('Approve')
          );
          if (b) { b.click(); return true; }
        }
        return false;
      }, name);
      if (ok) return true;
      await sleep(400);
    }
    return false;
  };
  const approvalPressed = await findAndClickApprove(apprName);
  await page.waitForFunction((n) => /Approved! Student ID|default password is the admission reference/i.test(document.body.innerText), { timeout: 15000 }, apprName).catch(() => {});
  await sleep(1200);
  const approvalToast = /Approved! Student ID|default password is the admission reference/i.test(await bodyText());
  // Judge approval by persisted state below; toast text is diagnostic only.

  // Verify approved student exists + login as it in portal
  studentRow = await requireResult(sb.from('students')
    .select('id, phone, is_approved, status')
    .eq('phone', apprPhone)
    .limit(1)
    .maybeSingle(), 'approved student lookup');
  if (studentRow) created.studentIds.push(studentRow.id);
  approvedOk = !!studentRow && studentRow.is_approved === true && studentRow.status === 'active';
  const admissionAfter = await requireResult(sb.from('admission_requests').select('status').eq('id', apprAdmission.id).single(), 'admission status after approval');
  step('ADMIN: approve admission (creates approved student)', approvalPressed && approvedOk && admissionAfter?.status === 'approved',
    `clicked=${approvalPressed} admission=${admissionAfter?.status || 'missing'} student=${approvedOk} toast=${approvalToast}`);
  step('ADMIN+student: verified approved active student row', approvedOk, studentRow ? studentRow.id : (rpcFailures.at(-1) || 'MISSING; no captured RPC error'));

  if (!approvedOk) throw new Error(rpcFailures.at(-1) || 'APPROVED_STUDENT_NOT_CONFIRMED');
  if (approvedOk) {
    // Seed a pending monthly fee so the student has something to pay in the
    // portal — this flow is the true end-to-end student->admin payment loop.
    const now = new Date();
    const MONTH = ['January','February','March','April','May','June','July','August','September','October','November','December'][now.getMonth()] + ' ' + now.getFullYear();
    const due = new Date(`${MONTH} 01`); due.setDate(10);
    const feeSeed = await requireResult(sb.from('fees').insert({
      student_id: studentRow.id, amount: 1500, month: MONTH, status: 'pending',
      due_date: due.toISOString().slice(0, 10), note: 'COMBINED-E2E',
    }).select('id').single(), 'student fee seed');
    if (feeSeed) created.feeIds.push(feeSeed.id);
    const trxId = 'PORTAL-TRX-' + uniq;

    // Portal login
    await gotoReady(page, BASE + '/portal/login', { marker: 'ছাত্র পোর্টাল', selector: 'input[type="tel"]' });
    await sleep(800);
    await page.type('input[type="tel"], input[placeholder="01XXXXXXXXX"]', apprPhone);
    const defaultPw = (apprAdmission?.reference_no || '') + '';
    await page.type('input[type="password"]', defaultPw);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.type === 'submit');
      if (b) b.click();
    });
    try { await waitForPath(page, '/portal/dashboard'); } catch {}
    await sleep(1500);
    const portalIn = page.url().includes('/portal/dashboard');
    portalLoggedIn = portalIn;
    step('ADMIN(+student): approved student logs into portal with reference password', portalIn, portalIn ? '' : 'login failed');
    if (!portalIn) throw new Error('PORTAL_LOGIN_NOT_CONFIRMED');
    if (portalIn) step('PORTAL: dashboard renders fees/results/notices sections', /ফি|ফলাফল|নোটিশ|পরীক্ষা/i.test(await bodyText()), '');

    // Portal pays the pending fee: bKash -> transaction modal -> submit.
    await gotoReady(page, BASE + '/portal/fees', { marker: 'ফি রেকর্ড' });
    await sleep(2000);
    const bKashShown = await page.evaluate(() => Array.from(document.querySelectorAll('button')).some((b) => /bKash|বিকাশ/i.test(b.textContent)));
    step('PORTAL: fees page renders bKash payment option (pending fee listed)', bKashShown, `trx=${trxId}`);
    const modalOpened = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /bKash|বিকাশ/i.test(x.textContent));
      if (b) { b.click(); return true; }
      return false;
    });
    await sleep(900);
    await typeInto('input[placeholder="TRX1234567890"], input[placeholder="Transaction ID"]', trxId);
    await sleep(300);
    const portalSubmitted = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('জমা দিন'));
      if (b) { b.click(); return true; }
      return false;
    });
    await sleep(2000);
    // Verify the student's submission created a pending approval server-side.
    const approvalRow = await requireResult(sb.from('payment_approvals')
      .select('id, status, transaction_id')
      .eq('transaction_id', trxId).limit(1).maybeSingle(), 'payment approval lookup');
    if (approvalRow) created.approvalIds.push(approvalRow.id);
    step('PORTAL: submitted bKash transaction creates pending approval',
      modalOpened && portalSubmitted && !!approvalRow && approvalRow.status === 'pending',
      approvalRow ? `status=${approvalRow.status}` : 'no approval row');
  }

  } catch (error) {
    step('ADMISSION/PORTAL CHAIN: first blocking error', false, safeError(error));
  }

  // ═══════════ 5. ADMIN APPROVES THE STUDENT-SUBMITTED PAYMENT ═══════════
  const approvalId = created.approvalIds[created.approvalIds.length - 1];
  if (studentRow && approvalId) {
    await page.goto(BASE + '/admin/fees', { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1400);
    await clickText('Payment Approvals');
    await sleep(1000);
    const rowVisible = (await bodyText()).includes('PORTAL-TRX-' + uniq);
    const clicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /Approve/i.test(x.textContent));
      if (b) { b.click(); return true; }
      return false;
    });
    await sleep(2200);
    const { data: feeAfter } = await sb.from('fees').select('status, note').eq('id', created.feeIds[0]).single();
    const paidOk = feeAfter?.status === 'paid';
    const noteHasReceipt = paidOk && /RCT-/.test(feeAfter?.note || '');
    step('ADMIN+student: approve student-submitted fee -> paid',
      rowVisible && clicked && paidOk && noteHasReceipt,
      `trx=PORTAL-TRX-${uniq} status=${feeAfter?.status || '-'} receipt=${noteHasReceipt}`);
  } else {
    step('ADMIN+student: approve student-submitted fee -> paid', null, 'upstream admission/student/payment prerequisite failed; not an independent payment failure');
  }

  // ═══════════ 6. EXAMS: admin page + exam list render ═══════════
  await page.goto(BASE + '/admin/exams', { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1500);
  step('ADMIN: exams page renders (create/list/results tabs)', /Create Exam|All Exams|Exam Info|Timer/i.test(await bodyText()), '');

  // ═══════════ 7. NOTICES: create + public notice appears ═══════════
  await page.goto(BASE + '/admin/notices', { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1200);
  await page.waitForSelector('input[placeholder*="Notice title"]', { timeout: 8000 }).catch(() => {});
  const noticeTitle = 'COMBINED Notice ' + runTag;
  await typeInto('input[placeholder*="Notice title"]', noticeTitle);
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    if (ta) { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, 'Combined notice body'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    // Check "Publish immediately" (plain checkbox, not a Radix switch)
    const cb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find((c) => {
      const lbl = (c.parentElement?.textContent || '').includes('Publish immediately');
      return lbl;
    });
    if (cb && !cb.checked) cb.click();
    // Publish Notice submit (last button in DOM order)
    const all = Array.from(document.querySelectorAll('button')).filter(
      (x) => /Publish Notice|প্রকাশ/i.test(x.textContent) && x.textContent.trim().length < 25
    );
    const b = all[all.length - 1];
    if (b) b.click();
  });
  await sleep(1600);
  const { data: noticeRow } = await sb.from('notices')
    .select('id, title, is_published')
    .order('created_at', { ascending: false })
    .limit(20);
  const noticeMatch = (noticeRow ?? []).find((n) => n.title === noticeTitle);
  if (noticeMatch) created.noticeIds.push(noticeMatch.id);
  step('ADMIN: notice created + published', !!noticeMatch, noticeMatch ? `title=${noticeMatch.title} published=${noticeMatch.is_published}` : 'no matching row');

  // ═══════════ 8. PORTAL ROUTE COVERAGE (exams/results/notices/profile) ═══════════
  let portalRouteOk = true;
  if (portalLoggedIn) {
    for (const [route, key] of [['/portal/exams', 'Exam'], ['/portal/results', 'Result'], ['/portal/notices', 'Notice'], ['/portal/profile', 'Profile']]) {
      await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
      await sleep(1400);
      const still = await page.evaluate(() => location.pathname);
      if (still.includes('/portal/login')) { portalRouteOk = false; }
    }
    step('PORTAL: exams/results/notices/profile render (no redirect to login)', portalRouteOk, '');
  } else {
    step('PORTAL: exams/results/notices/profile render (no redirect to login)', null, 'student prerequisite failed; these routes were not tested');
  }

  // ═══════════ 9. REPORTS + backup page renders (no data mutation) ═══════════
  await page.goto(BASE + '/admin/reports', { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1400);
  step('ADMIN: reports render', (await bodyText()).length > 200, '');
  await page.goto(BASE + '/admin/backup', { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1400);
  step('ADMIN: backup page renders (manual/auto restore sections)', /ব্যাকআপ|Backup|রিস্টোর|Restore/i.test(await bodyText()), '');

  // ═══════════ 10. CONSOLE ERROR CLASSIFICATION ═══════════
  // Two 404s are KNOWN deployment/environment facts, not app defects:
  //  (1) REST `/rest/v1/backups?` — `backups` table migration (automated_backups.sql)
  //      not applied to the live project.
  //  (2) `/api/send-sms` — the SMS serverless function is unavailable under
  //      `pnpm dev` (README: use Netlify/Vercel). Both trigger a REST 404 +
  //      a matching "Failed to load resource 404" console entry.
  const restBackups404 = consoleErrors.some((e) => /\/rest\/v1\/backups\?/.test(e));
  const sessionErrors = consoleErrors.filter((e) =>
    !/429|rate|network/i.test(e)
    && !/\/rest\/v1\/backups\?/.test(e)
    && !/\/api\/send-sms/i.test(e)
    && !/Failed to load resource.*404/i.test(e) // mirrors the backups / send-sms 404
    && !/REST 404 http:\/\/127\.0\.0\.1:5173\/api\/send-sms/.test(e)
  );
  step('ENVIRONMENT: backups table exists (migration gap check)', restBackups404 ? false : true, restBackups404 ? 'backups table NOT FOUND (migration not applied)' : 'backups reachable');
  step('CONSOLE: no unexpected page errors (known env 404s excluded)', sessionErrors.length === 0, sessionErrors.length ? sessionErrors[0] : 'clean');

  await browser.close();
  console.log('\n—— console captures (' + consoleErrors.length + ') ——');
  [...new Set(consoleErrors)].slice(0, 10).forEach((l) => console.log('  • ' + l));

  const passed = results.filter((r) => r.ok === true).length;
  const blocked = results.filter((r) => r.ok === null).length;
  const envGapFails = results.filter((r) => r.ok === false && /ENVIRONMENT:/.test(r.name)).length;
  const appFails = results.filter((r) => r.ok === false && !/ENVIRONMENT:/.test(r.name)).length;
  console.log(`\n==== COMBINED PRODUCT GO AUDIT: ${passed}/${results.length} passed ====`);
  console.log(`     (failed assertions requiring diagnosis: ${appFails}; blocked/not run: ${blocked}; environment failures: ${envGapFails})`);
  await cleanupAll();
  console.log(`Cleanup errors: ${cleanupFailures}. No claim of zero residue without verification.`);
  process.exit(appFails === 0 && blocked === 0 && cleanupFailures === 0 ? 0 : 1);
})().catch(async (e) => { console.error('FATAL', e); await cleanupAll(); process.exit(1); });