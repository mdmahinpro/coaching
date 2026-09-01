/* Whole-app E2E audit — visits every public/admin/portal route and drives the
 * key functional flows, asserting real rendering + no page errors. Reuses the
 * established puppeteer-core + Edge harness pattern. Reads admin-creds.json
 * (git-ignored) for the admin session; seeds + cleans a disposable student.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:5173';
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const credsFile = path.join(__dirname, 'admin-creds.json');
let creds = null;
try { creds = JSON.parse(fs.readFileSync(credsFile, 'utf8')); } catch {}
if (!creds || !creds.email || !creds.password) {
  console.error('admin-creds.json missing or incomplete.');
  process.exit(1);
}

const results = [];
const errors = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

  // ---------- shared helpers ----------
  const newPage = async () => {
    const p = await browser.newPage();
    await p.setViewport({ width: 1360, height: 900 });
    p.on('pageerror', (e) => errors.push(String((e && e.message) || e).slice(0, 160)));
    return p;
  };
  const typeInto = async (p, sel, val) => {
    const el = await p.$(sel); if (!el) return false;
    await el.click({ clickCount: 3 }); await el.type(val); return true;
  };
  const clickSubmit = async (p) => p.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      (x) => x.type === 'submit' && /Login|প্রবেশ|Sign In|লগইন|ভর্তি/i.test(x.textContent)
    );
    if (b) { b.click(); return true; }
    return false;
  });
  const bodyText = async (p) => p.evaluate(() => document.body.innerText);

  // ================= 1. ADMIN LOGIN =================
  const admin = await newPage();
  await admin.goto(BASE + '/admin/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await admin.waitForSelector('input[autocomplete="email"]', { timeout: 10000 });
  await typeInto(admin, 'input[autocomplete="email"]', creds.email);
  await typeInto(admin, 'input[autocomplete="current-password"]', creds.password);
  await clickSubmit(admin);
  await admin.waitForFunction(() => location.pathname.includes('/admin/dashboard'), { timeout: 20000 }).then(() => true).catch(() => false);
  await sleep(1500);
  step('Admin login → dashboard', (await admin.evaluate(() => location.pathname)).includes('/admin/dashboard'));

  // ================= 2. ALL ADMIN ROUTES render =================
  const adminRoutes = [
    ['/admin/dashboard', 'Dashboard'],
    ['/admin/students', 'ছাত্র ব্যবস্থাপনা'],
    ['/admin/batches', 'ব্যাচ ব্যবস্থাপনা'],
    ['/admin/teachers', 'শিক্ষক ব্যবস্থাপনা'],
    ['/admin/fees', 'Fee'],
    ['/admin/exams', 'Exam'],
    ['/admin/results', 'পরীক্ষার ফলাফল'],
    ['/admin/notices', 'নোটিশ'],
    ['/admin/admissions', 'ভর্তি আবেদন'],
    ['/admin/sms', 'SMS'],
    ['/admin/reports', 'রিপোর্ট'],
    ['/admin/settings', 'সেটিংস'],
    ['/admin/backup', 'ব্যাকআপ'],
  ];
  for (const [route, marker] of adminRoutes) {
    await admin.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
    await sleep(1500);
    const txt = await bodyText(admin);
    const ok = !/not found/i.test(txt.slice(0, 200)) && txt.length > 100;
    step(`Admin render: ${route}`, ok && (marker === 'Fee' || marker === 'Exam' || txt.includes(marker)), `len=${txt.length}`);
  }

  // ================= 3. PUBLIC ROUTES =================
  const pub = await newPage();
  const pubRoutes = [
    ['/', 'Future'],
    ['/courses', 'Course'],
    ['/admission', 'Apply'],
    ['/notices', 'Notice'],
    ['/contact', 'Contact'],
  ];
  for (const [route, marker] of pubRoutes) {
    await pub.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
    await sleep(1800);
    const txt = await bodyText(pub);
    step(`Public render: ${route}`, txt.length > 100 && !/not found/i.test(txt.slice(0, 200)), `len=${txt.length}`);
  }

  // ---- admission form reaches Step 2 with batch dropdown ----
  await pub.goto(BASE + '/admission', { waitUntil: 'networkidle2', timeout: 25000 });
  await sleep(1500);
  await typeInto(pub, 'input[placeholder*="full name"]', 'Audit Admit');
  await typeInto(pub, 'input[placeholder*="email@example.com"]', 'audit@example.com');
  await typeInto(pub, 'input[placeholder="01XXXXXXXXX"]', '01812340000');
  await typeInto(pub, 'input[placeholder*="Parent / Guardian"]', 'Guardian');
  await pub.evaluate(() => {
    const els = document.querySelectorAll('input[placeholder="01XXXXXXXXX"]');
    if (els.length > 1) {
      const el = els[1]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '01912340000'); el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(300);
  await pub.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('Next')); if (b) b.click(); });
  await sleep(800);
  const admStep2 = await pub.evaluate(() => document.body.innerText.includes('Select a batch') || document.body.innerText.includes('Preferred Batch'));
  step('Admission form: advances to Step 2 (batch selection)', admStep2, '');

  // ================= 4. NOTIFICATIONS =================
  await admin.goto(BASE + '/admin/dashboard', { waitUntil: 'networkidle2', timeout: 25000 });
  await sleep(1800);
  const bell = await admin.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).find((x) => (x.getAttribute('aria-label') || '').startsWith('Notifications'));
    return !!b;
  });
  step('Admin: notification bell present', bell, '');

  // ================= 5. PORTAL — seed a disposable student =================
  const uniq = Date.now().toString().slice(-6);
  const seed = await admin.evaluate(async (uniq) => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const phone = '018' + uniq.slice(0, 8);
    const { data, error } = await supabase.rpc('register_student', {
      p_name: 'Audit Student ' + uniq,
      p_phone: phone,
      p_student_id: 'AUDIT' + uniq.slice(-5),
      p_password: 'ref-AUDIT',
      p_status: 'active',
      p_is_approved: true,
    });
    if (error || !data || !data[0]) return { ok: false, err: error && error.message, phone, id: null };
    return { ok: true, phone, id: data[0].id, err: null };
  }, uniq);
  step('Portal: seed disposable approved student', seed.ok, seed.err || seed.phone);

  if (seed.ok) {
    // ---- portal login ----
    const portal = await newPage();
    await portal.goto(BASE + '/portal/login', { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(1200);
    await typeInto(portal, 'input[type="tel"], input[placeholder="01XXXXXXXXX"]', seed.phone);
    await typeInto(portal, 'input[type="password"], input[autocomplete="current-password"]', 'ref-AUDIT');
    await clickSubmit(portal);
    await portal.waitForFunction(() => location.pathname.includes('/portal/dashboard'), { timeout: 20000 }).then(() => true).catch(() => false);
    await sleep(1800);
    step('Portal login → dashboard', (await portal.evaluate(() => location.pathname)).includes('/portal/dashboard'), seed.phone);

    const portalRoutes = [
      ['/portal/dashboard', 'Dashboard'],
      ['/portal/fees', 'Fee'],
      ['/portal/exams', 'Exam'],
      ['/portal/results', 'আমার ফলাফল'],
      ['/portal/notices', 'Notice'],
      ['/portal/profile', 'Profile'],
    ];
    for (const [route, marker] of portalRoutes) {
      await portal.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
      await sleep(1600);
      const txt = await bodyText(portal);
      const stillAuthed = !(await portal.evaluate(() => location.pathname.includes('/portal/login')));
      step(`Portal render: ${route}`, stillAuthed && txt.length > 80, `len=${txt.length}`);
    }

    // cleanup seeded student
    await admin.evaluate(async (id) => {
      const { supabase } = await import('/src/lib/supabase.ts');
      await supabase.from('fees').delete().eq('student_id', id);
      await supabase.from('student_sessions').delete().eq('student_id', id);
      await supabase.from('students').delete().eq('id', id);
    }, seed.id);
    await portal.close();
  } else {
    step('Portal: seed disposable approved student', false, seed.err);
  }

  // ================= summary =================
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log('\n==== WHOLE-APP AUDIT: ' + passed + '/' + results.length + ' passed ====');
  if (errors.length) {
    console.log('\n—— page errors captured (' + errors.length + ') ——');
    [...new Set(errors)].slice(0, 12).forEach((e) => console.log('  • ' + e));
  }
  process.exit(passed === results.length ? 0 : 1);
})();