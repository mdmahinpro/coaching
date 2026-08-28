const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:5173';
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PHONE = '01900000000';
const PASSWORD = 'E2ePass!2026';
const DL_DIR = path.join(__dirname, 'downloads');
fs.mkdirSync(DL_DIR, { recursive: true });

const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
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
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });
  const rootText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  step('Public home renders (content > 120 chars)', rootText.trim().length > 120, rootText.replace(/\n/g, ' ').slice(0, 70));

  // 2. Portal login → dashboard
  await page.goto(BASE + '/portal/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await page.waitForSelector('input[type="tel"]', { timeout: 10000 });
  await page.type('input[type="tel"]', PHONE);
  await page.type('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname.includes('/portal/dashboard'), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 2500));
  const dashText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  step('Portal login → dashboard (no 42804)', dashText.length > 300, `path=${new URL(page.url()).pathname} len=${dashText.length}`);
  step('Dashboard renders portal sections', /ফি|ফলাফল|নোটিশ|পরীক্ষা/i.test(dashText), '');

  // 3. Strict exam round trip
  await page.goto(BASE + '/exam/' + process.env.EXAM_ID, { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
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

  // 4. Portal results: submission listed + PDF download button works.
  await page.goto(BASE + '/portal/results', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  body = await page.evaluate(() => document.body.innerText);
  step('Portal results shows the E2E exam submission', /E2E Exam|__E2E Exam__/.test(body) || /100%/.test(body), body.slice(0, 90).replace(/\n/g, ' '));

  // Assert the PDF module (the exact code the Download button runs) emits a
  // valid PDF. Headless Chromium cancels the actual blob download, so we
  // validate the produced bytes instead.
  const pdf = await page.evaluate(async () => {
    const orig = URL.createObjectURL;
    const blobs = {};
    URL.createObjectURL = function (b) { const u = orig.call(this, b); blobs[u] = b; return u; };
    try {
      const mod = await import('/src/lib/pdf.ts');
      const sub = document.body.innerText;
      const m = sub.match(/(\d+)\s*\/\s*(\d+)/);
      await mod.generateResultCard({
        studentName: 'E2E Student', studentId: '__E2E0001', examTitle: '__E2E Exam__',
        subject: 'E2E Subject', score: Number(m?.[1] ?? 0), totalMarks: Number(m?.[2] ?? 0),
        passMarks: 1, correctCount: 2, wrongCount: 0, timeTaken: 60, rank: 1,
        submittedAt: '2026-08-29', instituteName: 'Techely Learning Academy',
      });
      await new Promise(r => setTimeout(r, 1500));
      const keys = Object.keys(blobs);
      if (!keys.length) return { ok:false, err:'save() created no blob' };
      const bytes = new Uint8Array(await blobs[keys[0]].arrayBuffer());
      const head = Array.from(bytes.slice(0,5)).map(b=>String.fromCharCode(b)).join('');
      return { ok: head === '%PDF-', bytes: bytes.length, head };
    } catch (e) {
      return { ok:false, err:String(e && e.message || e).slice(0,120) };
    } finally {
      URL.createObjectURL = orig;
    }
  });
  step('Result PDF generates valid %PDF bytes', pdf.ok, pdf.ok ? `${pdf.bytes} bytes` : pdf.err);

  if (consoleLogs.length) { console.log('--- console captures ---'); consoleLogs.slice(0,20).forEach(l => console.log(l)); }
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== ${passed}/${results.length} passed ====`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('E2E FATAL:', e.message); process.exit(1); });
