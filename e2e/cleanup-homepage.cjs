const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:5173';
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin-creds.json'), 'utf8'));
(async () => {
  const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.goto(BASE + '/admin/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await p.waitForSelector('input[autocomplete="email"]', { timeout: 10000 });
  const t = async (sel, val) => { const el = await p.$(sel); await el.click({ clickCount: 3 }); await el.type(val); };
  await t('input[autocomplete="email"]', creds.email);
  await t('input[autocomplete="current-password"]', creds.password);
  await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.type === 'submit' && /Login|Sign In/i.test(x.textContent)); if (b) b.click(); });
  await p.waitForFunction(() => location.pathname.includes('/admin/dashboard'), { timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  const r = await p.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const nb = await supabase.from('batches').delete().like('name', 'E2E Realtime%');
    const nn = await supabase.from('notices').delete().like('title', 'E2E TICKER%');
    return { batchErr: nb.error && nb.error.message, noticeErr: nn.error && nn.error.message };
  });
  console.log('cleanup', JSON.stringify(r));
  await b.close();
})();
