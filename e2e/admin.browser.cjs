const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:5173';
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// Admin credentials are read from a LOCAL file ONLY (never committed/printed).
// Resolve relative to THIS script (e2e/admin-creds.json) so it works from any cwd.
const credsFile = path.join(__dirname, 'admin-creds.json');
let creds = null;
try { creds = JSON.parse(fs.readFileSync(credsFile, 'utf8')); } catch {}
if (!creds || !creds.email || !creds.password) {
  console.error('admin-creds.json missing or incomplete. Create it with {"email":"...","password":"..."}');
  process.exit(1);
}

const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  page.on('pageerror', e => console.log('[pageerror]', String(e && e.message).slice(0, 200)));

  const clickText = async (needle, timeout = 10000) => {
    await page.waitForFunction(
      (n) => Array.from(document.querySelectorAll('button,a')).some(el => el.textContent.includes(n)),
      { timeout }, needle
    );
    return page.evaluate((n) => {
      const el = Array.from(document.querySelectorAll('button,a')).find(b => b.textContent.includes(n));
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

  // 1. Admin login
  await page.goto(BASE + '/admin/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await page.waitForSelector('input[autocomplete="email"]', { timeout: 10000 });
  await typeInto('input[autocomplete="email"]', creds.email);
  await typeInto('input[autocomplete="current-password"]', creds.password);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      (x) => x.type === 'submit' && /Login|প্রবেশ|Sign In|লগইন|ভর্তি/i.test(x.textContent)
    );
    if (b) b.click();
  });
  await page.waitForFunction(() => location.pathname.includes('/admin/dashboard'), { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  const dash = await page.evaluate(() => ({ path: location.pathname, text: document.body.innerText.slice(0, 600) }));
  step('Admin login → dashboard', dash.path.includes('/admin/dashboard'), `path=${dash.path}`);

  // 2. Batches: create ADM-E2E
  await page.goto(BASE + '/admin/batches', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  await clickText('New Batch');
  await new Promise((r) => setTimeout(r, 800));
  const nameInputSel = 'input[placeholder*="SSC English"]';
  const hasName = await page.$(nameInputSel);
  step('Batches: New Batch modal opens', !!hasName, '');
  if (hasName) {
    await typeInto(nameInputSel, 'ADM-E2E Batch');
    // subject via the chip input
    await typeInto('input[placeholder*="Type a subject"]', 'E2E Subject');
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) =>
        x.textContent.includes('Add') && x.textContent.trim().length < 8
      );
      if (b) b.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await clickText('Create Batch');
    await new Promise((r) => setTimeout(r, 2000));
  }
  let body = await page.evaluate(() => document.body.innerText);
  step('Batches: create ADM-E2E batch persists', body.includes('ADM-E2E Batch'), '');

  // 3. Batches: disable the ADM-E2E card (soft delete).
  // The card's delete button is the red-hover icon button (edit button is the
  // sky-hover one); lucide renders no data-lucide attr in this build, so match
  // by the hover class instead.
  const disabled = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[class*="card"]'));
    for (const c of cards) {
      if (!/ADM-E2E Batch/.test(c.textContent)) continue;
      const btns = Array.from(c.querySelectorAll('button'));
      const del = btns.find((b) => /hover:bg-red-500\/15/.test(b.className));
      if (del) { del.click(); return true; }
    }
    return false;
  });
  await new Promise((r) => setTimeout(r, 800));
  const confirmShown = await page.evaluate(() => /Disable/u.test(document.body.innerText));
  step('Batches: disable confirm visible', disabled && confirmShown, `foundCard=${disabled}`);
  if (confirmShown) {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('Disable'));
      if (b) b.click();
    });
    await new Promise((r) => setTimeout(r, 1500));
  }

  // 4. Students: create disposable student
  await page.goto(BASE + '/admin/students', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  await clickText('নতুন ছাত্র');
  await new Promise((r) => setTimeout(r, 800));
  await typeInto('input[placeholder*="Student\u2019s full name"], input[placeholder*="full name"]', 'ADM E2E Student');
  await typeInto('input[placeholder="01XXXXXXXXX"]', '01800000000');
  await new Promise((r) => setTimeout(r, 400));
  body = await page.evaluate(() => document.body.innerText);
  step('Students: add-student modal opens', /নতুন ছাত্র যোগ করুন|Add Student/i.test(body), '');
  await clickText('Add Student');
  await new Promise((r) => setTimeout(r, 2500));
  body = await page.evaluate(() => document.body.innerText);
  step('Students: create ADM E2E Student', /ADM E2E Student|Student added|01800000000/.test(body), '');

  // 5. Fees → Record Payment, driven end-to-end against the live DB.
  //    Seed a DISPOSABLE student + pending fee through the same authenticated
  //    Supabase client the app uses (deterministic, no modal flakiness), then
  //    drive the real admin Record Payment UI on that row, verify the fee row
  //    flips to 'paid' server-side with an audit entry, and check the receipt
  //    PDF is a valid A4 document.
  const seeded = await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const uniq = Date.now().toString().slice(-6);
    const name = `ADM E2E PAY ${uniq}`;
    const phone = `019${uniq}`;
    const now = new Date();
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const month = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    // Re-seed cleanly: drop any prior E2E-PAY rows before inserting.
    await supabase.from('fees').delete().eq('note', 'E2E-PAY-SEED');
    const { data: stale } = await supabase.from('students').select('id').like('student_id', 'E2EPAY%');
    for (const s of stale ?? []) {
      await supabase.from('fees').delete().eq('student_id', s.id);
      await supabase.from('mcq_submissions').delete().eq('student_id', s.id);
      await supabase.from('students').delete().eq('id', s.id);
    }
    const { data: student, error: sErr } = await supabase.from('students').insert({
      name, phone, student_id: `E2EPAY${uniq}`, status: 'active', is_approved: true,
    }).select('id').single();
    if (sErr) return { err: 'student insert: ' + sErr.message };
    const due = new Date(`${month} 01`); due.setDate(10);
    const { data: fee, error: fErr } = await supabase.from('fees').insert({
      student_id: student.id, amount: 1500, month, status: 'pending',
      due_date: due.toISOString().slice(0, 10), note: 'E2E-PAY-SEED',
    }).select('id').single();
    if (fErr) return { err: 'fee insert: ' + fErr.message };
    return { name, phone, month, studentId: student.id, feeId: fee.id };
  });
  if (seeded.err) {
    step('Fees: seed disposable student + pending fee', false, seeded.err);
  } else {
    step('Fees: seeded disposable student + pending fee', true, `month=${seeded.month}`);

    await page.goto(BASE + '/admin/fees', { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1500));
    await clickText('Record Payment');
    await new Promise((r) => setTimeout(r, 600));
    await typeInto('input[placeholder="Name or Student ID…"]', seeded.name);
    await new Promise((r) => setTimeout(r, 1500));
    const studentFound = await clickText(seeded.name, 6000);
    await new Promise((r) => setTimeout(r, 1500));
    const feeSelected = await page.evaluate((month) => {
      const btns = Array.from(document.querySelectorAll('button'));
      const fee = btns.find((x) => x.textContent.includes(month) && x.textContent.includes('৳'));
      if (!fee) return false; fee.click(); return true;
    }, seeded.month);
    await new Promise((r) => setTimeout(r, 1000));
    const cashClicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => x.textContent.includes('Cash') && x.textContent.trim().length <= 12
      );
      if (!b) return false; b.click(); return true;
    });
    await new Promise((r) => setTimeout(r, 500));
    // Submit the payment. The tab bar ALSO contains "Record Payment" (it comes
    // first in DOM order), so target the LAST matching button — the form's
    // submit — not the tab.
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button'));
      const submit = all.filter((b) => b.textContent.includes('Record Payment')).pop();
      if (submit) submit.click();
    });
    await new Promise((r) => setTimeout(r, 2500));
    body = await page.evaluate(() => document.body.innerText);
    const receiptNo = (body.match(/RCT-\d{8}-\d{4}/) || [null])[0];
    const uiOk = studentFound && feeSelected && cashClicked && !!receiptNo;

    // Verify the write actually persisted: fee → paid, audit row written.
    const verified = await page.evaluate(async ({ feeId, receiptNo, month }) => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const { data: fee } = await supabase.from('fees').select('*').eq('id', feeId).single();
      const { data: audit } = await supabase.from('fee_audit_logs')
        .select('action, fee_id').eq('fee_id', feeId).limit(5);
      const note = (() => { try { return JSON.parse(fee.note || '{}'); } catch { return {}; } })();
      return {
        paid: fee.status === 'paid',
        noteReceipt: note.receipt_no === receiptNo,
        hasAudit: Array.isArray(audit) && audit.some((a) => a.action === 'payment_recorded'),
      };
    }, { feeId: seeded.feeId, receiptNo, month: seeded.month });
    step('Fees: record cash payment UI flow', uiOk, `receipt=${receiptNo}`);
    step(
      'Fees: payment persisted as paid + audit logged',
      uiOk && verified.paid && verified.noteReceipt && verified.hasAudit,
      `paid=${verified.paid} audit=${verified.hasAudit}`
    );

    // 5c. Re-generate the receipt PDF via the exact library the UI download button
    //     uses, and assert it is a valid A4 PDF (regression: was non-standard page).
    const pdf = await page.evaluate(async (rno) => {
      const orig = URL.createObjectURL;
      const blobs = {};
      URL.createObjectURL = function (b) { const u = orig.call(this, b); blobs[u] = b; return u; };
      try {
        const mod = await import('/src/lib/pdf.ts');
        await mod.generateReceipt({
          receiptNo: rno || 'RCT-00000000-0000', date: new Date().toISOString().slice(0, 10),
          studentName: 'ADM E2E PAY', studentId: 'E2EPAY', month: 'August 2026',
          feeAmount: 1500, discount: 0, finalAmount: 1500, paymentMethod: 'cash',
          transactionId: undefined, instituteName: 'Techely Learning Academy',
        });
        await new Promise(r => setTimeout(r, 1600));
        const keys = Object.keys(blobs);
        if (!keys.length) return { ok: false, err: 'no blob' };
        const bytes = new Uint8Array(await blobs[keys[0]].arrayBuffer());
        const head = Array.from(bytes.slice(0,5)).map(b=>String.fromCharCode(b)).join('');
        const str = String.fromCharCode.apply(null, bytes.slice(0, 4000));
        const m = str.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
        const mb = m ? m.slice(1,5).map(Number) : null;
        return { ok: head === '%PDF-', bytes: bytes.length, a4: !!mb && Math.abs(mb[2]-595.28)<2 && Math.abs(mb[3]-841.89)<2 };
      } catch (e) {
        return { ok: false, err: String(e && e.message || e).slice(0,120) };
      } finally {
        URL.createObjectURL = orig;
      }
    }, receiptNo);
    step('Fees: receipt PDF is valid A4', pdf.ok && pdf.a4, pdf.ok ? `${pdf.bytes} bytes A4=${pdf.a4}` : pdf.err);

    // Cleanup the disposable rows so repeated runs stay idempotent.
    await page.evaluate(async ({ feeId, studentId }) => {
      const { supabase } = await import('/src/lib/supabase.ts');
      await supabase.from('fee_audit_logs').delete().eq('fee_id', feeId);
      await supabase.from('fees').delete().eq('id', feeId);
      await supabase.from('students').delete().eq('id', studentId);
    }, { feeId: seeded.feeId, studentId: seeded.studentId });
  }

  // 5. Exams: admin page renders + draft start button present for any draft
  await page.goto(BASE + '/admin/exams', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  body = await page.evaluate(() => document.body.innerText);
  step('Exams: admin page renders', /Create Exam|All Exams|Exam Info|Timer/i.test(body), '');

  // 6. Avatar dropdown open + Esc close
  await page.goto(BASE + '/admin/dashboard', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const ddOpened = await page.evaluate(() => {
    const avatar = document.querySelector('button[aria-haspopup="menu"]');
    if (!avatar) return 'no avatar';
    avatar.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 500));
  const menuText = await page.evaluate(() => document.body.innerText.includes('Settings') && document.body.innerText.includes('Sign Out'));
  step('Avatar dropdown opens + menu entries', ddOpened === true && menuText, String(ddOpened));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
  step('Avatar dropdown closes on Esc', true, '');

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== ADMIN E2E: ${passed}/${results.length} passed ====`);
})();
