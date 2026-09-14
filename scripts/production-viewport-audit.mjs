#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const baseUrl = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:4173';
const supabaseOrigin = process.env.AUDIT_SUPABASE_ORIGIN ?? 'https://m4n8p2q6r0s3t7v1w5x9.supabase.co';
const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('CHROME_PATH is required');

const viewports = [
  { name: 'phone-320', width: 320, height: 568 },
  { name: 'phone-375', width: 375, height: 667 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1366', width: 1366, height: 768 },
];
const routes = ['/', '/courses', '/admission', '/notices', '/contact', '/admin/login', '/portal/login', '/portal/signup', '/does-not-exist'];
const report = { generatedAt: new Date().toISOString(), baseUrl, checks: [], failures: [] };
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const viewport of viewports) {
    for (const route of routes) {
      const page = await browser.newPage();
      await page.setViewport(viewport);
      const consoleErrors = [];
      page.on('pageerror', (error) => consoleErrors.push(String(error.message ?? error)));
      page.on('console', (message) => {
        const text = message.text();
        const expectedOfflineApiFailure = text.includes(new URL(supabaseOrigin).hostname) || text.includes('maps.googleapis.com') || text === 'Failed to load resource: net::ERR_FAILED';
        if (message.type() === 'error' && !expectedOfflineApiFailure) consoleErrors.push(text);
      });
      const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle0', timeout: 20_000 });
      const metrics = await page.evaluate(() => {
        const html = document.documentElement;
        const body = document.body;
        const interactive = [...document.querySelectorAll('button, a, input, select, textarea')];
        const outside = interactive
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { tag: element.tagName, text: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 80), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          })
          .filter((rect) => rect.right > innerWidth + 1 || rect.left < -1);
        return {
          title: document.title,
          horizontalOverflow: Math.max(html.scrollWidth, body.scrollWidth) - innerWidth,
          outside,
          visibleTextLength: (body.innerText || '').trim().length,
        };
      });
      const check = { viewport: viewport.name, route, status: response?.status() ?? null, ...metrics, consoleErrors };
      report.checks.push(check);
      if ((check.status ?? 500) >= 400 || check.horizontalOverflow > 1 || check.outside.length || check.visibleTextLength < 10 || consoleErrors.length) report.failures.push(check);
      await page.close();
    }
  }

  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 320, height: 568 });
  await mobile.goto(`${baseUrl}/`, { waitUntil: 'networkidle0' });
  const menuButton = await mobile.$('button[aria-label="Open navigation menu"]');
  if (menuButton) {
    await menuButton.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const menu = await mobile.$eval('#public-mobile-menu', (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth };
    });
    report.mobileMenu = menu;
    if (menu.left < -1 || menu.right > menu.viewport + 1) report.failures.push({ viewport: 'phone-320', route: '/', mobileMenu: menu });
  } else {
    report.failures.push({ viewport: 'phone-320', route: '/', error: 'Mobile menu trigger not found' });
  }
  await mobile.close();
} finally {
  await browser.close();
}

const output = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'production-readiness-viewport-report.json');
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(`Wrote ${output}`);
console.log(`checks=${report.checks.length} failures=${report.failures.length}`);
if (report.failures.length) process.exitCode = 1;
