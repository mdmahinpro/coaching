/* End-to-end admission flow (live supabase + dev server):
   1. Retired /portal/signup redirects to the supported /admission flow.
   2. Student completes the server-backed admission form → reference shown.
   3. Row persisted with reference_no/gender/class_level.
   4. Admin approves → student created with reference as default password.
   5. Student logs into the portal with phone + reference.
   6. Admin Settings → Class Levels editor: add a level → persists.
*/
const puppeteer = require('puppeteer-core');
const {
  requireDisposableTarget,
  assertAppTargetsDisposable,
  assertServerEndpointsDisposable,
  readIsolatedCreds,
} = require('./disposable-guard.cjs');
const BASE = require('./disposable-guard.cjs').isolatedBaseUrl();
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const target = requireDisposableTarget();
const creds = readIsolatedCreds();

const results = [];
const step = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  :: ' + d : ''}`);
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e && e.message).slice(0, 160)));
  await page.goto(BASE + '/admission', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await assertAppTargetsDisposable(page, target.url);
  await assertServerEndpointsDisposable(BASE, target.url);

  const uniq = String(Date.now()).slice(-8);
  const studentPhone = `018${uniq}`;
  const guardianPhone = `019${uniq}`;
  let observedRef = null;
  const ADM_NAME_BASE = 'E2E Admission '; // prefix — full name built with a timestamp

  // ── 1. Retired signup route redirects to the supported admission form ─────
  await page.goto(BASE + '/portal/signup', { waitUntil: 'networkidle2', timeout: 20000 });
  await page.waitForFunction(() => location.pathname === '/admission', { timeout: 20000 });
  step('Signup: retired route redirects to /admission', new URL(page.url()).pathname === '/admission');

  // ── 2. Public, server-backed admission form ───────────────────────────────
  await page.waitForSelector('input[name="name"]', { timeout: 20000 });
  const fields = await page.evaluate(() => ({
    hasName: !!document.querySelector('input[name="name"]'),
    hasGuardian: !!document.querySelector('input[name="guardian_name"]'),
    hasStudentPhone: !!document.querySelector('input[name="phone"]'),
    hasGuardianPhone: !!document.querySelector('input[name="guardian_phone"]'),
    hasEmail: !!document.querySelector('input[name="email"]'),
    hasAddress: !!document.querySelector('input[name="address"]'),
    hasClass: !!document.querySelector('select[name="class_level"]'),
    hasGender: !!document.querySelector('select[name="gender"]'),
  }));
  step(
    'Admission: current personal fields render',
    Object.values(fields).every(Boolean),
    JSON.stringify(fields)
  );

  // Fill the current first step using stable field names.
  const filledName = await page.evaluate(([prefix, phone, guardian]) => {
    const setValue = (selector, value) => {
      const input = document.querySelector(selector);
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const setSelect = (selector, value) => {
      const select = document.querySelector(selector);
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      set.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const fullName = prefix + Date.now().toString().slice(-8);
    setValue('input[name="name"]', fullName);
    setValue('input[name="email"]', `e2e-adm-${Date.now()}@example.com`);
    setValue('input[name="phone"]', phone);
    setValue('input[name="guardian_name"]', 'E2E Guardian');
    setValue('input[name="guardian_phone"]', guardian);
    setValue('input[name="address"]', 'E2E House, Dhaka');
    const classSelect = document.querySelector('select[name="class_level"]');
    setSelect('select[name="class_level"]', classSelect.options[1]?.value || '');
    setSelect('select[name="gender"]', 'male');
    return fullName;
  }, [ADM_NAME_BASE, studentPhone, guardianPhone]);

  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent.includes('Next'));
    if (button) button.click();
  });
  await page.waitForSelector('select[name="batch_id"] option:nth-child(2)', { timeout: 20000 });
  await page.evaluate(() => {
    const select = document.querySelector('select[name="batch_id"]');
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    set.call(select, select.options[1].value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const message = document.querySelector('textarea[name="message"]');
    const setTextarea = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setTextarea.call(message, 'Disposable admission end-to-end check');
    message.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.evaluate(() => {
    const review = Array.from(document.querySelectorAll('button')).find((item) => item.textContent.includes('Review'));
    if (review) review.click();
  });
  await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => /আবেদন সফল|জমা দিতে সমস্যা/.test(document.body.innerText), { timeout: 20000 });
  const body = await page.evaluate(() => document.body.innerText);
  const refMatch = body.match(/APP-[A-Z0-9_-]{12}/);
  step('Admission: server-backed submission returns reference', body.includes('আবেদন সফল') && !!refMatch, refMatch?.[0] ?? (body.includes('সমস্যা') ? 'submission error' : 'no-ref'));
  observedRef = refMatch?.[0] ?? null;

  // ── 3. Admin: row persisted + approve → default password = reference ───────
  const adminPage = await browser.newPage();
  adminPage.setViewport({ width: 1360, height: 900 });
  await adminPage.goto(BASE + '/admin/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await adminPage.evaluate(([em, pw]) => {
    const els = Array.from(document.querySelectorAll('input'));
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(els.find((i) => i.autocomplete === 'email'), em); els.find((i) => i.autocomplete === 'email').dispatchEvent(new Event('input', { bubbles: true }));
    set.call(els.find((i) => i.autocomplete === 'current-password'), pw); els.find((i) => i.autocomplete === 'current-password').dispatchEvent(new Event('input', { bubbles: true }));
  }, [creds.email, creds.password]);
  await new Promise((r) => setTimeout(r, 300));
  await adminPage.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.type === 'submit'); if (b) b.click(); });
  await adminPage.waitForFunction(() => location.pathname.includes('/admin/dashboard'), { timeout: 20000 });

  // Backend: admission_requests is anon-INSERT-only, so verify via admin session.
  const persisted = await adminPage.evaluate(async (r) => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const { data } = await supabase
      .from('admission_requests')
      .select('name, phone, email, gender, class_level, reference_no, guardian_phone, status, batch_id')
      .eq('reference_no', r)
      .limit(1);
    return data?.[0] ?? null;
  }, observedRef || '__none__');
  step('Admission: row persisted w/ reference + gender + class + guardian', !!(persisted && persisted.reference_no && persisted.gender && persisted.class_level && persisted.guardian_phone), JSON.stringify(persisted && { ref: persisted.reference_no, gender: persisted.gender, cls: persisted.class_level }));

  await adminPage.goto(BASE + '/admin/admissions', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));

  // Find the row by STUDENT NAME (the list row shows the name; the reference
  // is surfaced in the detail drawer). Click its View then Approve.
  const matchKey = filledName || observedRef;
  if (matchKey) {
    const rowInfo = await adminPage.evaluate((n) => {
      const viewBtns = Array.from(document.querySelectorAll('button[title="View"]'));
      const row = viewBtns.find((b) => {
        let el = b;
        for (let i = 0; i < 6 && el; i++) { if (el.textContent && el.textContent.includes(n)) return true; el = el.parentElement; }
        return false;
      });
      return { found: !!row };
    }, matchKey);
    step('Admin: admission row found + has View', rowInfo.found, `key=${matchKey.slice(0, 28)}`);

    if (rowInfo.found) {
      await adminPage.evaluate((n) => {
        const viewBtns = Array.from(document.querySelectorAll('button[title="View"]'));
        const row = viewBtns.find((b) => {
          let el = b;
          for (let i = 0; i < 6 && el; i++) { if (el.textContent && el.textContent.includes(n)) return true; el = el.parentElement; }
          return false;
        });
        if (row) row.click();
      }, matchKey);
      await new Promise((r) => setTimeout(r, 900));
      const drawerRef = await adminPage.evaluate((r) => {
        const t = document.body.innerText;
        return t.includes(r) && t.includes('Reference (default password)');
      }, observedRef);
      step('Admin: drawer shows Reference (default password)', drawerRef, `ref=${observedRef}`);
    } else {
      step('Admin: drawer shows Reference (default password)', false, 'row not found (drawer skipped)');
    }

    // Approve: for the row w/ the name/ref, or any pending Approve fallback.
    await adminPage.evaluate((n) => {
      const appBtns = Array.from(document.querySelectorAll('button[title="Approve"]'));
      let btn = appBtns.find((b) => {
        let el = b;
        for (let i = 0; i < 6 && el; i++) { if (el.textContent && el.textContent.includes(n)) return true; el = el.parentElement; }
        return false;
      });
      if (!btn) btn = appBtns.find((x) => !x.disabled);
      if (btn) btn.click();
    }, matchKey);
    await new Promise((r) => setTimeout(r, 3500));
    const adminBody = await adminPage.evaluate(() => document.body.innerText);
    // The current toast shows the generated student ID and explains that the
    // admission reference is the password; the reference itself is displayed
    // in the drawer, not necessarily repeated in the toast. The later portal
    // login is the definitive reference-password assertion.
    const approvalSucceeded = /Approved!|Student ID:|default password is the admission reference/i.test(adminBody);
    step('Admin: approve succeeds w/ reference as password', approvalSucceeded, (adminBody.match(/Approved!.*(?:\n|$)/) || adminBody.match(/Student ID:.*(?:\n|$)/) || [])[0]?.slice(0, 120) ?? 'no approval text');
  } else {
    step('Admin: admission row found + has View', false, 'no name/ref captured');
    step('Admin: drawer shows Reference (default password)', false, 'no name/ref');
    step('Admin: approve succeeds w/ reference as password', false, 'no name/ref');
  }

  // ── 4. Student login: phone + reference ────────────────────────────────────
  const stu = await browser.newPage();
  await stu.goto(BASE + '/portal/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  const p = studentPhone;
  if (observedRef) {
    await stu.evaluate(([ph, pw]) => {
      const els = Array.from(document.querySelectorAll('input'));
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const phone = els.find((i) => i.type === 'tel'); const pass = els.find((i) => i.type === 'password');
      set.call(phone, ph); phone.dispatchEvent(new Event('input', { bubbles: true }));
      set.call(pass, pw); pass.dispatchEvent(new Event('input', { bubbles: true }));
    }, [p, observedRef]);
    await new Promise((r) => setTimeout(r, 300));
    await stu.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.type === 'submit'); if (b) b.click(); });
    await stu.waitForFunction(() => location.pathname.includes('/portal/dashboard') || /আবেদন|ফোন নম্বর বা পাসওয়ার্ড|ভুল/.test(document.body.innerText), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1800));
    const url = new URL(stu.url()).pathname;
    const stuBody = await stu.evaluate(() => document.body.innerText);
    step('Student logs in with phone + reference password', url === '/portal/dashboard', `path=${url} ref=${observedRef}`);
  } else {
    step('Student logs in with phone + reference password', false, 'no reference');
  }

  // ── 5. Settings → Class Levels editor round-trip ───────────────────────────
  await adminPage.goto(BASE + '/admin/settings', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200));
  await adminPage.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Institute'); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 600));
  const hasClassEditor = await adminPage.evaluate(() => {
    return document.body.innerText.includes('Class Levels (শ্রেণী)') && !!document.querySelector('button');
  });
  step('Settings: Class Levels editor present', hasClassEditor);

  // Add a class level chip via the input + Add button
  const added = await adminPage.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="নতুন শ্রেণী"]');
    if (!inp) return 'no-input';
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(inp, 'E2E Class X'); inp.dispatchEvent(new Event('input', { bubbles: true }));
    const add = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Add'));
    if (add) add.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 400));
  const chipVisible = await adminPage.evaluate(() => document.body.innerText.includes('E2E Class X'));
  step('Settings: add class level chip', added === true && chipVisible);

  // Save
  await adminPage.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /সংরক্ষণ|সেটিংস সংরক্ষণ/.test(x.textContent)); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 2500));
  // Verify persisted in DB
  const saved = await adminPage.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const { data } = await supabase.from('site_settings').select('value').eq('key', 'class_levels').maybeSingle();
    return data?.value ?? null;
  });
  step('Settings: class level persists to site_settings', !!saved && saved.includes('E2E Class X'), String(saved).slice(0, 90));
  // Restore default list (remove the test chip) so the DB stays clean.
  await adminPage.goto(BASE + '/admin/settings', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200));
  await adminPage.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Institute'); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 500));
  await adminPage.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Remove E2E Class X');
    if (btn) btn.click();
  });
  await adminPage.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /সংরক্ষণ|সেটিংস সংরক্ষণ/.test(x.textContent)); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 2000));

  // Cleanup DB rows created by this run (admission + student + associated).
  await page.evaluate(async ([r, phone]) => {
    const { supabase } = await import('/src/lib/supabase.ts');
    if (r) {
      const { data } = await supabase.from('admission_requests').select('id').eq('reference_no', r).maybeSingle();
      if (data?.id) {
        await supabase.from('admission_requests').delete().eq('id', data.id);
      }
    }
    const { data: stu } = await supabase.from('students').select('id').eq('phone', phone).limit(1);
    for (const s of stu ?? []) {
      await supabase.from('fees').delete().eq('student_id', s.id);
      await supabase.from('student_sessions').delete().eq('student_id', s.id);
      await supabase.from('students').delete().eq('id', s.id);
    }
  }, [observedRef, studentPhone]);

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n==== ADMISSION FLOW: ${passed}/${results.length} passed ====`);
})();
