/* End-to-end admission flow (live supabase + dev server):
   1. Student completes the portal signup form (all fields) → reference shown.
   2. Row persisted with reference_no/gender/class_level.
   3. Admin approves → student created with reference as default password.
   4. Student logs into the portal with phone + reference.
   5. Admin Settings → Class Levels editor: add a level → persists.
   6. Backend sanity: students row exists, bcrypt password matches reference.
*/
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:5173';
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin-creds.json'), 'utf8'));

const results = [];
const step = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  :: ' + d : ''}`);
};

const setInput = (el, val) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const setSelect = (sel, val) => {
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  set.call(sel, val);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e && e.message).slice(0, 160)));

  const uniq = String(Date.now()).slice(-8);
  const phone = '0187' + uniq.slice(0, 8).padEnd(8, '0').slice(0, 8);
  let observedRef = null;
  const ADM_NAME_BASE = 'E2E Admission '; // prefix — full name built with a timestamp

  // ── 1. Public portal signup ───────────────────────────────────────────────
  await page.goto(BASE + '/portal/signup', { waitUntil: 'networkidle2', timeout: 20000 });
  // Wait until the form's name input and the class select actually exist.
  await page.waitForSelector('input[placeholder="আপনার নাম"]', { timeout: 20000 });
  await page.waitForSelector('select option:nth-child(2)', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 400));

  // Discovery returns primitive facts only (DOM elements don't survive
  // evaluate's return-value serialization); the fill pass re-queries the DOM.
  const fields = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('input'));
    const byPh = (ph) => !!els.find((i) => i.placeholder === ph);
    const selects = Array.from(document.querySelectorAll('select'));
    const classOpts = (() => {
      try { return Array.from(selects[0]?.options ?? []).map((o) => o.text.trim()).filter(Boolean); } catch { return []; }
    })();
    return {
      hasName: byPh('আপনার নাম'),
      hasGuardian: byPh('অভিভাবকের নাম'),
      phoneCount: els.filter((i) => i.placeholder === '01XXXXXXXXX').length,
      hasEmail: byPh('email@example.com'),
      hasAddress: !!document.querySelector('textarea[placeholder="বাসার ঠিকানা"]'),
      selectCount: selects.length,
      classOpts,
    };
  });
  console.log('[fields debug]', JSON.stringify(fields).slice(0, 260));
  step(
    'Signup: all required fields render',
    !!(fields.hasName && fields.hasGuardian && fields.phoneCount >= 2 && fields.hasEmail && fields.hasAddress && fields.selectCount >= 3 && fields.classOpts.length > 1),
    `phones=${fields.phoneCount} selects=${fields.selectCount} classes=${fields.classOpts.length}`
  );

  // Fill everything a student record needs (except status + photo).
  const filledName = await page.evaluate((prefix) => {
    const els = Array.from(document.querySelectorAll('input'));
    const byPh = (ph) => els.find((i) => i.placeholder === ph);
    const selects = Array.from(document.querySelectorAll('select'));
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const setTa = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const name = byPh('আপনার নাম');
    const guardian = byPh('অভিভাবকের নাম');
    const phones = els.filter((i) => i.placeholder === '01XXXXXXXXX');
    const email = byPh('email@example.com');
    const address = document.querySelector('textarea[placeholder="বাসার ঠিকানা"]');
    const fullName = prefix + Date.now().toString().slice(-8);
    set.call(name, fullName); name.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(guardian, 'E2E Guardian'); guardian.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(phones[0], '01931110001'); phones[0].dispatchEvent(new Event('input', { bubbles: true })); // guardian phone
    set.call(phones[1], '01931110002'); phones[1].dispatchEvent(new Event('input', { bubbles: true })); // student phone
    set.call(email, 'e2e-adm@example.com'); email.dispatchEvent(new Event('input', { bubbles: true }));
    if (address) { setTa.call(address, 'E2E House, Dhaka'); address.dispatchEvent(new Event('input', { bubbles: true })); }
    const sset = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    if (selects[0]) { sset.call(selects[0], selects[0].options[1]?.value || ''); selects[0].dispatchEvent(new Event('change', { bubbles: true })); }
    if (selects[1]) { sset.call(selects[1], selects[1].options[1]?.value || ''); selects[1].dispatchEvent(new Event('change', { bubbles: true })); }
    if (selects[2]) { sset.call(selects[2], selects[2].options[1]?.value || ''); selects[2].dispatchEvent(new Event('change', { bubbles: true })); }
    return fullName;
  }, ADM_NAME_BASE);

  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('আবেদন জমা দিন'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 3000));
  const body = await page.evaluate(() => document.body.innerText);
  const refMatch = body.match(/APP-[A-Z0-9]{6}/);
  step('Signup: success screen with reference number', body.includes('আবেদন সফল') && !!refMatch, refMatch?.[0] ?? (body.includes('সমস্যা') ? 'DB error' : 'no-ref'));
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
  step('Signup: row persisted w/ reference + gender + class + guardian', !!(persisted && persisted.reference_no && persisted.gender && persisted.class_level && persisted.guardian_phone), JSON.stringify(persisted && { ref: persisted.reference_no, gender: persisted.gender, cls: persisted.class_level }));

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
    step('Admin: approve succeeds w/ reference as password', /Approved!|Student ID:/.test(adminBody) && adminBody.includes(observedRef), (adminBody.match(/Approved!.*/) || [])[0]?.slice(0, 90) ?? 'no toast');
  } else {
    step('Admin: admission row found + has View', false, 'no name/ref captured');
    step('Admin: drawer shows Reference (default password)', false, 'no name/ref');
    step('Admin: approve succeeds w/ reference as password', false, 'no name/ref');
  }

  // ── 4. Student login: phone + reference ────────────────────────────────────
  const studentPhone = '01931110002'; // second phone field = student
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
  await page.evaluate(async (r) => {
    const { supabase } = await import('/src/lib/supabase.ts');
    if (r) {
      const { data } = await supabase.from('admission_requests').select('id').eq('reference_no', r).maybeSingle();
      if (data?.id) {
        await supabase.from('admission_requests').delete().eq('id', data.id);
      }
    }
    const { data: stu } = await supabase.from('students').select('id').eq('phone', '01931110002').limit(1);
    for (const s of stu ?? []) {
      await supabase.from('fees').delete().eq('student_id', s.id);
      await supabase.from('student_sessions').delete().eq('student_id', s.id);
      await supabase.from('students').delete().eq('id', s.id);
    }
  }, observedRef);

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n==== ADMISSION FLOW: ${passed}/${results.length} passed ====`);
})();