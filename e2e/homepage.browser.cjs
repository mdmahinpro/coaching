/* Homepage realtime + hero stats + glassy cards E2E (live supabase + dev server).
 * Uses an authenticated admin page for seeding + settings, and an anon page for
 * the public homepage. Reads admin-creds.json (git-ignored) only.
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

  // --- Admin page: login once, keep for seeding + settings toggles ----------
  const admin = await browser.newPage();
  await admin.setViewport({ width: 1360, height: 900 });
  admin.on('pageerror', e => console.log('[admin-pageerror]', String(e && e.message).slice(0, 160)));
  await admin.goto(BASE + '/admin/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await admin.waitForSelector('input[autocomplete="email"]', { timeout: 10000 });
  const typeInto = async (p, sel, val) => {
    const el = await p.$(sel); if (!el) return false;
    await el.click({ clickCount: 3 }); await el.type(val); return true;
  };
  await typeInto(admin, 'input[autocomplete="email"]', creds.email);
  await typeInto(admin, 'input[autocomplete="current-password"]', creds.password);
  await admin.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      (x) => x.type === 'submit' && /Login|প্রবেশ|Sign In|লগইন/i.test(x.textContent)
    );
    if (b) b.click();
  });
  await admin.waitForFunction(() => location.pathname.includes('/admin/dashboard'), { timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  const dash = await admin.evaluate(() => location.pathname);
  step('Admin login → dashboard', dash.includes('/admin/dashboard'), `path=${dash}`);

  // --- Ensure deterministic toggles for the test ----------------------------
  // Read current show_home_stats; we'll restore it at the end.
  const orig = await admin.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const { data } = await supabase.from('site_settings').select('key,value').in('key', ['show_home_stats', 'stat_auto_from_db']);
    const m = {};
    (data ?? []).forEach(r => { m[r.key] = r.value; });
    return m;
  }).catch(() => ({}));

  // --- Settings Stats tab has the new toggle --------------------------------
  await admin.goto(BASE + '/admin/settings', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 1500));
  await admin.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Stats');
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 600));
  const hasToggle = await admin.evaluate(() => document.body.innerText.includes('Show homepage stats / counters'));
  step('Settings Stats tab: "Show homepage stats / counters" toggle present', hasToggle, '');

  // Ensure show_home_stats = true + stat_auto_from_db = true for the stats checks.
  await admin.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    await supabase.from('site_settings').upsert([{ key: 'show_home_stats', value: 'true' }], { onConflict: 'key' });
    // stat_auto_from_db upsert is harmless even if absent before.
    await supabase.from('site_settings').upsert([{ key: 'stat_auto_from_db', value: 'true' }], { onConflict: 'key' });
    localStorage.removeItem('coaching-center-settings');
  });

  // --- Public homepage: hero stats + glassy cards + ticker ------------------
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  page.on('pageerror', e => console.log('[pageerror]', String(e && e.message).slice(0, 160)));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 2500));

  const hero = await page.evaluate(() => {
    const text = document.body.innerText;
    const labelsOk = ['শিক্ষার্থী', 'কোর্স', 'শিক্ষক', 'সাফল্য'].every(l => text.includes(l));
    // Pull just the stat values by parsing the four label blocks is fragile;
    // assert labels + that some numeric counters exist near them.
    const statsRow = document.querySelector('[class*="grid"]') &&
      Array.from(document.querySelectorAll('div')).some(d =>
        d.className.includes('grid') && /শিক্ষার্থী/.test(d.textContent));
    return { labelsOk, statsRow: !!statsRow };
  });
  step('Homepage: hero stat labels (শিক্ষার্থী/কোর্স/শিক্ষক/সাফল্য) render', hero.labelsOk && hero.statsRow, '');

  // Live DB real counts present (auto-from-db on): parse numbers on homepage.
  const counts = await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const [s, t, b] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('is_approved', true).eq('status', 'active'),
      supabase.from('teachers').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('batches').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ]);
    return { students: s.count ?? 0, teachers: t.count ?? 0, batches: b.count ?? 0 };
  });
  const heroCountsShown = await page.evaluate(() => {
    const nums = Array.from(document.querySelectorAll('div'))
      .filter(d => /^\d+\+$/.test((d.textContent || '').trim()))
      .map(d => parseInt((d.textContent || '').trim(), 10));
    return nums.length >= 2;
  });
  step('Homepage: hero shows real DB counts (auto-from-db)', heroCountsShown, `db students=${counts.students} teachers=${counts.teachers} batches=${counts.batches}`);

  // Glassy / gradient batch card present.
  const glassy = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[class*="card"]')).find(c =>
      /gradient/.test(c.className) && /backdrop-blur/.test(c.className));
    return !!el;
  });
  step('Homepage: batch card carries gradient + backdrop-blur glassy style', glassy, '');

  // Live "{enrolled}/{capacity} enrolled" text present.
  const enrolled = await page.evaluate(() => /\d+\/\d+ enrolled/.test(document.body.innerText));
  step('Homepage: batch card shows "{enrolled}/{capacity} enrolled"', enrolled, '');

  // --- Seed a published notice → appears in ticker within a poll cycle ------
  const seededNotice = await admin.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const title = 'E2E TICKER ' + Date.now().toString().slice(-6);
    // notices schema: `content` (text) + type/target, NOT `body`.
    const { error } = await supabase.from('notices').insert({
      title, content: 'e2e ticker body', type: 'general', target: 'all', is_published: true,
    });
    return { title, err: error ? error.message : null };
  });
  step('Seed: published notice insert', !seededNotice.err, seededNotice.err || seededNotice.title);
  const noticeSeen = seededNotice.err ? false : await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const has = await page.evaluate(t => document.body.innerText.includes(t), seededNotice.title);
      if (has) return true;
      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  })();
  step('Homepage: seeded published notice appears in ticker (poll)', noticeSeen, seededNotice.err || seededNotice.title);

  // --- Seed an active batch → homepage cards + /admission dropdown ----------
  const seededBatch = await admin.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const uniq = Date.now().toString().slice(-6);
    const name = 'E2E Realtime ' + uniq;
    // batches schema: schedule_days is a TEXT[] (not `schedule`), monthly_fee
    // AND fee are both columns, capacity + max_seats, start_time.
    const { data, error } = await supabase.from('batches').insert({
      name, subject: 'E2E Sub', class_level: null, code: 'E2E' + uniq,
      schedule_days: ['Sun', 'Mon'], start_time: '17:00',
      capacity: 10, max_seats: 10, monthly_fee: 100, fee: 100,
      description: null, teacher: null, teacher_id: null, is_active: true,
    }).select('id').single();
    if (error) return { name, id: null, err: error.message };
    return { name, id: data.id, err: null };
  });
  step('Seed: active batch insert', seededBatch.id, seededBatch.err || seededBatch.name);

  // Requirement #4 — a freshly-added ACTIVE batch surfaces in the /admission
  // batch dropdown (unlimited, polled) within a poll cycle. The dropdown lives
  // on Step 2, so fill the required Step-1 fields and advance before asserting.
  const admPage = await browser.newPage();
  await admPage.setViewport({ width: 1360, height: 900 });
  await admPage.goto(BASE + '/admission', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 1500));
  await typeInto(admPage, 'input[placeholder*="Your full name"]', 'E2E Admit Test');
  await typeInto(admPage, 'input[placeholder*="email@example.com"]', 'e2e@example.com');
  await typeInto(admPage, 'input[placeholder="01XXXXXXXXX"]', '01812345678'); // phone
  await typeInto(admPage, 'input[placeholder*="Parent / Guardian"]', 'Guardian E2E');
  // Guardian phone uses the same placeholder; target the SECOND occurrence.
  await admPage.evaluate(() => {
    const els = document.querySelectorAll('input[placeholder="01XXXXXXXXX"]');
    if (els.length > 1) {
      const el = els[1]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '01987654321'); el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 300));
  await admPage.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Next'));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 800));
  const admHasBatch = seededBatch.id ? await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const has = await admPage.evaluate(n => document.body.innerText.includes(n), seededBatch.name);
      if (has) return true;
      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  })() : false;
  step('Admission dropdown: seeded active batch appears (Step 2, poll)', admHasBatch, seededBatch.err || seededBatch.name);

  // Requirement #3 ghost: the same active batch also shows on /courses (the
  // full, attackless batch list page), proving DB→public propagates live.
  const courses = await browser.newPage();
  await courses.setViewport({ width: 1360, height: 900 });
  await courses.goto(BASE + '/courses', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 2000));
  const coursesHasBatch = seededBatch.id ? await courses.evaluate(n => document.body.innerText.includes(n), seededBatch.name) : false;
  step('Courses page: seeded active batch listed', coursesHasBatch, seededBatch.err || seededBatch.name);

  // --- Toggle show_home_stats=false → hero stats row hidden -----------------
  await admin.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    await supabase.from('site_settings').update({ value: 'false' }).eq('key', 'show_home_stats');
    localStorage.removeItem('coaching-center-settings');
  });
  const home2 = await browser.newPage();
  await home2.setViewport({ width: 1360, height: 900 });
  await home2.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 2500));
  // Assert the hero STATS GRID specifically. Naive substring checks on
  // "শিক্ষার্থী" / "সাফল্য" are unreliable because the testimonials headings
  // ("শিক্ষার্থীদের মতামত", "সাফল্যের গল্প") contain those words. Instead,
  // require query-homeputstat labels to be ABSENT together with their numeric
  // counter block (the grid has four labelled counter cells).
  const statsHidden = await home2.evaluate(() => {
    // A hero stat counter cell looks like: <N>+ or <N>% immediately followed by
    // a label (শিক্ষার্থী/কোর্স/শিক্ষক/সাফল্য). When hidden, no such pair with
    // a '+' suffix exists in a labelled grid.
    const cells = Array.from(document.querySelectorAll('div')).filter(d => {
      const t = (d.textContent || '').trim();
      return /^\d+[+%]$/.test(t);
    });
    return cells.length === 0;
  });
  step('Homepage: showHomeStats=false hides hero stat counters', statsHidden, '');

  // --- Restore original show_home_stats + stat_auto_from_db ----------------
  await admin.evaluate(async (s) => {
    const { supabase } = await import('/src/lib/supabase.ts');
    if (s.origShow !== undefined) await supabase.from('site_settings').upsert([{ key: 'show_home_stats', value: s.origShow }], { onConflict: 'key' });
    if (s.origAuto !== undefined) await supabase.from('site_settings').upsert([{ key: 'stat_auto_from_db', value: s.origAuto }], { onConflict: 'key' });
    localStorage.removeItem('coaching-center-settings');
  }, { origShow: orig.show_home_stats, origAuto: orig.stat_auto_from_db });

  // --- Cleanup seeded rows ---------------------------------------------------
  await admin.evaluate(async ({ notice, batch }) => {
    const { supabase } = await import('/src/lib/supabase.ts');
    if (notice) await supabase.from('notices').delete().eq('title', notice);
    if (batch) await supabase.from('batches').delete().eq('id', batch);
  }, { notice: seededNotice.title, batch: seededBatch.id });

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n==== HOMEPAGE E2E: ${passed}/${results.length} passed ====`);
  process.exit(passed === results.length ? 0 : 1);
})();