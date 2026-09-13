/* LOCAL REVIEW ONLY: real Vite/Chromium, synthetic upstream responses.
 * Never connects to a Supabase project. No accounts/fixtures are created.
 * Chromium path comes from LOCAL_CHROMIUM_PATH; not needed for normal startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 15499,
  base = `http://127.0.0.1:${port}`;
const target = 'https://hjzwbicauyxffrmdhvgy.supabase.co';
const canary = 'sb_secret_BROWSER_SHOULD_NEVER_RECEIVE_123456';
const before = { ...process.env };
const nativeFetch = globalThis.fetch;
let server, browser;
let failStats = false;
let statsCount = 42;
const findings = [],
  errors = [],
  requests = [];
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,HEAD,OPTIONS,POST',
};
try {
  Object.assign(process.env, {
    E2E_DISPOSABLE_SUPABASE_URL: target,
    E2E_DISPOSABLE_SUPABASE_ANON_KEY: 'sb_publishable_local_review_123456',
    SUPABASE_URL: target,
    SUPABASE_SERVICE_ROLE_KEY: canary,
    ISOLATED_PORT: String(port),
  });
  globalThis.fetch = async (input, options) => {
    const url = typeof input === 'string' ? input : input.url || String(input);
    if (url.startsWith(target)) {
      const u = new URL(url);
      requests.push({ side: 'server', path: u.pathname, method: options?.method });
      if (u.pathname === '/rest/v1/students')
        return failStats
          ? new Response('{"error":"synthetic upstream failure"}', { status: 503 })
          : new Response(null, { status: 200, headers: { 'content-range': `*/${statsCount}` } });
      throw new Error('Unexpected server upstream request blocked in local test');
    }
    if (url.startsWith(base + '/')) return nativeFetch(input, options);
    throw new Error('External fetch blocked in local test');
  };
  server = await createServer({
    root,
    configFile: path.join(root, 'vite.isolated.config.ts'),
    logLevel: 'error',
  });
  await server.listen();
  if (!process.env.LOCAL_CHROMIUM_PATH)
    throw new Error('LOCAL_CHROMIUM_PATH is required for this optional review test.');
  browser = await puppeteer.launch({
    executablePath: process.env.LOCAL_CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.evaluateOnNewDocument(() => {
    window.WebSocket = class {
      constructor() {
        throw new Error('WebSocket disabled in synthetic browser test');
      }
    };
  });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = new URL(req.url());
    if (u.origin === base || u.protocol === 'data:' || u.protocol === 'blob:') {
      await req.continue();
      return;
    }
    if (u.origin === target) {
      requests.push({ side: 'browser', path: u.pathname, method: req.method() });
      if (req.method() === 'OPTIONS') {
        await req.respond({ status: 204, headers: cors });
        return;
      }
      if (u.pathname.startsWith('/rest/v1/')) {
        const table = u.pathname.split('/').at(-1);
        if (table === 'students') {
          await req.respond({
            status: 401,
            headers: cors,
            contentType: 'application/json',
            body: JSON.stringify({
              code: '42501',
              message: 'permission denied for table students',
            }),
          });
          return;
        }
        if (req.method() === 'HEAD') {
          const count = table === 'teachers' ? 5 : table === 'batches' ? 3 : 0;
          await req.respond({
            status: 200,
            headers: {
              ...cors,
              'content-range': `*/${count}`,
              'access-control-expose-headers': 'content-range',
            },
          });
          return;
        }
        const rows =
          table === 'site_settings'
            ? [
                { key: 'stat_auto_from_db', value: 'true' },
                { key: 'show_home_stats', value: 'true' },
                { key: 'stat_success_rate', value: '95' },
              ]
            : [];
        await req.respond({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify(rows),
        });
        return;
      }
      await req.respond({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: '{}',
      });
      return;
    }
    // External imagery/fonts/analytics are not needed to verify these local flows.
    await req.respond({ status: 204, headers: cors });
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1');
  await page.waitForFunction(
    () => document.body.innerText.includes('42+') && document.body.innerText.includes('95%'),
    { timeout: 20000 }
  );
  const bodyText = await page
    .locator('body')
    .map((el) => el.innerText)
    .wait();
  if (!bodyText.includes('5+') || !bodyText.includes('3+'))
    throw new Error('Nonzero teacher/batch stats not rendered');
  if (requests.some((r) => r.side === 'browser' && r.path === '/rest/v1/students'))
    throw new Error('Homepage directly queried private student table');
  findings.push(
    'Homepage renders real React/Vite app with synthetic 42 students / 5 teachers / 3 batches / 95% configured success rate; no direct browser student query.'
  );
  const envText = await page.evaluate(async () => await (await fetch('/src/lib/env.ts')).text());
  if (envText.includes(canary)) throw new Error('Server key leaked to browser module');
  for (const p of ['/e2e/isolated-creds.json', '/server/stats-core.ts', '/api/home-stats.ts']) {
    const out = await page.evaluate(async (p) => {
      const r = await fetch(p);
      return { status: r.status, body: await r.text() };
    }, p);
    if (![403, 404].includes(out.status) || out.body.includes(canary))
      throw new Error('Protected source route accessible');
  }
  findings.push(
    'Credential/server-source paths denied and service-key canary absent from tested frontend module/HTML.'
  );
  failStats = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.body.innerText.includes('—') && document.body.innerText.includes('95%'),
    { timeout: 15000 }
  );
  findings.push(
    'Failed upstream stats show unavailable, preserve independent configured success rate, and do not crash the page.'
  );
  failStats = false;
  statsCount = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.body.innerText.includes('0+') && document.body.innerText.includes('95%'),
    { timeout: 15000 }
  );
  findings.push('Confirmed zero student count renders as zero, not unavailable.');
  for (const route of [
    '/courses',
    '/admission',
    '/notices',
    '/contact',
    '/portal/login',
    '/admin/login',
  ]) {
    await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.getElementById('root')?.textContent?.trim().length > 20,
      { timeout: 15000 }
    );
    const t = await page
      .locator('body')
      .map((el) => el.innerText)
      .wait();
    if (t.includes('Something went wrong. Please try again.'))
      throw new Error('Generic failure on ' + route);
  }
  findings.push(
    'Six public/login routes render under synthetic upstream responses; no login or mutation attempted.'
  );
  const relevantErrors = errors.filter((e) => !e.includes('WebSocket disabled'));
  if (relevantErrors.length) throw new Error('Browser errors: ' + relevantErrors.join('; '));
  fs.writeFileSync(
    path.join(root, 'LOCAL_BROWSER_RESULTS.json'),
    JSON.stringify(
      {
        browser: await browser.version(),
        findings,
        pageErrors: relevantErrors,
        scope:
          'Real local Vite + Chromium; all Supabase and external requests mocked/blocked, no real authentication/database/network-provider proof.',
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify({ passed: findings.length, findings, pageErrors: relevantErrors }, null, 2)
  );
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  globalThis.fetch = nativeFetch;
  for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
  Object.assign(process.env, before);
}
