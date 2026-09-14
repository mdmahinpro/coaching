#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const baseUrl = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:4173';
const supabaseOrigin = process.env.AUDIT_SUPABASE_ORIGIN ?? 'https://m4n8p2q6r0s3t7v1w5x9.supabase.co';
const supabaseProjectRef = new URL(supabaseOrigin).hostname.split('.')[0];
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('CHROME_PATH is required');
const uuid = '11111111-1111-4111-8111-111111111111';
const now = Math.floor(Date.now() / 1000);
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: uuid, email: 'admin@example.test', role: 'authenticated', exp: now + 3600, aud: 'authenticated' })}.signature`;
const user = { id: uuid, aud: 'authenticated', role: 'authenticated', email: 'admin@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = { access_token: accessToken, refresh_token: 'offline-test-refresh', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer', user };
const student = { id: uuid, name: 'Viewport Test Student', student_id: 'VIEW26001', phone: '01700000000', email: 'student@example.test', class_level: '10', batch_id: null, batch_name: '', photo_url: null, status: 'active', is_approved: true, token: 'offline-student-token' };
const viewports = [
  { name: 'phone-320', width: 320, height: 568 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1366', width: 1366, height: 768 },
];
const routes = [
  '/admin/dashboard', '/admin/students', '/admin/batches', '/admin/teachers', '/admin/fees', '/admin/exams', '/admin/results', '/admin/notices', '/admin/admissions', '/admin/sms', '/admin/reports', '/admin/settings', '/admin/backup',
  '/portal/dashboard', '/portal/fees', '/portal/exams', '/portal/results', '/portal/notices', '/portal/profile',
];
const report = { generatedAt: new Date().toISOString(), checks: [], failures: [] };
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const viewport of viewports) {
    for (const route of routes) {
      const page = await browser.newPage();
      await page.setViewport(viewport);
      await page.evaluateOnNewDocument(({ session, student, supabaseProjectRef }) => {
        localStorage.setItem(`sb-${supabaseProjectRef}-auth-token`, JSON.stringify(session));
        sessionStorage.setItem('student-session', JSON.stringify({ state: { student }, version: 0 }));
      }, { session, student, supabaseProjectRef });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = request.url();
        if (!url.startsWith(`${supabaseOrigin}/`)) return request.continue();
        const headers = {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': 'authorization, apikey, content-type, content-profile, accept-profile, x-client-info, x-retry-count, x-supabase-api-version, prefer, range',
          'content-type': 'application/json',
        };
        if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers, body: '' });
        if (url.includes('/rpc/is_admin')) return request.respond({ status: 200, headers, body: 'true' });
        if (url.includes('/rpc/portal_validate_session') || url.includes('/rpc/portal_get_profile')) return request.respond({ status: 200, headers, body: JSON.stringify([student]) });
        if (url.includes('/auth/v1/user')) return request.respond({ status: 200, headers, body: JSON.stringify(user) });
        if (url.includes('/auth/v1/token')) return request.respond({ status: 200, headers, body: JSON.stringify(session) });
        if (url.includes('/realtime/')) return request.abort();
        return request.respond({ status: 200, headers: { ...headers, 'content-range': '0-0/0' }, body: '[]' });
      });
      const consoleErrors = [];
      page.on('pageerror', (error) => consoleErrors.push(String(error.message ?? error)));
      page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error' && text !== 'Failed to load resource: net::ERR_FAILED') consoleErrors.push(text);
      });
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle0', timeout: 20_000 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const metrics = await page.evaluate(() => {
        const html = document.documentElement;
        const body = document.body;
        const isInsideIntentionalScroller = (element) => {
          let parent = element.parentElement;
          while (parent && parent !== body) {
            const style = getComputedStyle(parent);
            if (/(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1) return true;
            parent = parent.parentElement;
          }
          return false;
        };
        const outside = [...document.querySelectorAll('button, a, input, select, textarea')]
          .filter((element) => !isInsideIntentionalScroller(element))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { tag: element.tagName, text: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 60), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          })
          .filter((rect) => rect.right > innerWidth + 1 || rect.left < -1);
        return { pathname: location.pathname, horizontalOverflow: Math.max(html.scrollWidth, body.scrollWidth) - innerWidth, outside, visibleTextLength: (body.innerText || '').trim().length };
      });
      const check = { viewport: viewport.name, route, ...metrics, consoleErrors };
      report.checks.push(check);
      if (metrics.pathname !== route || metrics.horizontalOverflow > 1 || metrics.outside.length || metrics.visibleTextLength < 10 || consoleErrors.length) report.failures.push(check);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
const output = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'authenticated-viewport-report.json');
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(`Wrote ${output}`);
console.log(`checks=${report.checks.length} failures=${report.failures.length}`);
if (report.failures.length) process.exitCode = 1;
