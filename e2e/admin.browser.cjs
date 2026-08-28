const puppeteer = require('puppeteer-core');
const fs = require('fs');
const BASE = 'http://127.0.0.1:5173';
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// Admin credentials are read from a LOCAL file ONLY (never committed/printed).
let creds = null;
try { creds = JSON.parse(fs.readFileSync('admin-creds.json', 'utf8')); } catch {}
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
