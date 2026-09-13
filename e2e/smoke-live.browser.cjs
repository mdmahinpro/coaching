/* smoke-live.browser.cjs — verify a DEPLOYED (production) site is healthy.
 *
 * Usage (point it at your live URL):
 *   node e2e/smoke-live.browser.cjs                 # uses LIVE_URL env or e2e/live-url.txt
 *   LIVE_URL=https://your-site.netlify.app node e2e/smoke-live.browser.cjs
 *
 * This is READ-ONLY by design so it is safe to run against a live production
 * site. It does NOT create/delete any records. It checks:
 *   - the public site + admission form load (no fatal errors)
 *   - the admin login page loads
 *   - (optional, if e2e/admin-creds.json exists) admin login works and the
 *     core admin pages render without a redirect to login
 *   - the Netlify serverless SMS route responds 405 for GET (function deployed)
 *
 * No credentials are ever printed.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// Resolve the live URL: LIVE_URL env > live-url file > error.
function resolveLiveUrl() {
  if (process.env.LIVE_URL) return process.env.LIVE_URL.replace(/\/+$/, '');
  const f = path.join(__dirname, 'live-url.txt');
  if (fs.existsSync(f)) {
    const v = fs.readFileSync(f, 'utf8').trim();
    if (v) return v.replace(/\/+$/, '');
  }
  throw new Error('Set LIVE_URL env var or create e2e/live-url.txt with your deployed URL.');
}

const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const LIVE = resolveLiveUrl();
  console.log('Smoke testing:', LIVE, '\n');

  const credsPath = path.join(__dirname, 'admin-creds.json');
  const hasCreds = fs.existsSync(credsPath);

  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e && e.message).slice(0, 200)));

  const bodyText = () => page.evaluate(() => document.body && document.body.innerText || '');
  const goto = async (p) => {
    try {
      await page.goto(LIVE + p, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (e) {
      consoleErrors.push('nav fail ' + p + ': ' + e.message.slice(0, 120));
    }
    await sleep(1200);
  };

  // ── 1. Public site ──────────────────────────────────────────────
  await goto('/');
  const homeText = (await bodyText()) || '';
  step('Public home page renders content', homeText.trim().length > 120,
    homeText.replace(/\s+/g, ' ').slice(0, 60));

  await goto('/admission');
  const admText = (await bodyText()) || '';
  step('Public admission form loads', /Admission|Apply|ভর্তি|আবেদন/i.test(admText),
    admText.replace(/\s+/g, ' ').slice(0, 60));

  // ── 2. Logins render ────────────────────────────────────────────
  await goto('/admin/login');
  const adminLogin = (await bodyText()) || '';
  await page.waitForSelector('input[autocomplete="email"]', { timeout: 15000 }).catch(() => {});
  step('Admin login page loads (has email field)', /addmin|admin|login/i.test(adminLogin) &&
    (await page.$('input[autocomplete="email"]')) !== null, '');

  await goto('/portal/login');
  const portalLogin = (await bodyText()) || '';
  step('Student portal login page loads', /student|portal|login|প্রবেশ/i.test(portalLogin) &&
    (await page.$('input[type="tel"]')) !== null, '');

  // ── 3. Netlify serverless SMS route is deployed ─────────────────
  const smsRes = await fetch(LIVE + '/api/send-sms', { method: 'GET' }).catch(() => null);
  step('SMS serverless route deployed (GET -> 405)', !!smsRes && smsRes.status === 405,
    smsRes ? 'status ' + smsRes.status : 'route not found');

  // ── 4. (Optional) Admin login + core pages render ───────────────
  if (hasCreds) {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    await goto('/admin/login');
    await page.waitForSelector('input[autocomplete="email"]', { timeout: 15000 }).catch(() => {});
    const el = await page.$('input[autocomplete="email"]');
    const pw = await page.$('input[autocomplete="current-password"]');
    if (el && pw) {
      await el.click({ clickCount: 3 }); await el.type(creds.email);
      await pw.click({ clickCount: 3 }); await pw.type(creds.password);
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find((x) => x.type === 'submit');
        if (b) b.click();
      });
      try { await page.waitForFunction(() => location.pathname.includes('/admin/dashboard'), { timeout: 20000 }); } catch {}
      await sleep(1500);
      const loggedIn = page.url().includes('/admin/dashboard');
      step('(optional) Admin login -> dashboard on live site', loggedIn, loggedIn ? '' : 'login failed');
      if (loggedIn) {
        const routes = ['/admin/students', '/admin/fees', '/admin/notices', '/admin/admissions', '/admin/sms', '/admin/reports', '/admin/backup', '/admin/settings'];
        for (const r of routes) {
          await goto(r);
          const text = (await bodyText()) || '';
          // Anything but the login page counts as "rendered"
          const ok = page.url().includes(r) || page.url().includes('/admin/login') === false;
          step('Admin route renders on live: ' + r, ok, '' + text.trim().length + ' chars');
        }
      }
    } else {
      step('(optional) Admin login skipped (fields not found)', false, '');
    }
  } else {
    step('(optional) Admin-login smoke skipped (no e2e/admin-creds.json)', true, '');
  }

  // ── 5. Console error classification ──────────────────────────────
  const unexpected = consoleErrors.filter((e) =>
    !/429|rate|network/i.test(e) && !/favicon/i.test(e));
  step('No unexpected page/JS errors on live site', unexpected.length === 0,
    unexpected.length ? unexpected[0] : 'clean');

  if (unexpected.length) { console.log('\n—— console errors ——'); [...new Set(unexpected)].slice(0, 8).forEach((l) => console.log('  • ' + l)); }

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== LIVE SMOKE: ${passed}/${results.length} passed ====`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('SMOKE FATAL', e.message); process.exit(1); });