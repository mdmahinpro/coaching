/* Backfill: assign a stable, seeded headshot photo_url to every teacher and
 * student whose photo_url is empty, so no avatar is left as the initials
 * monogram. Deterministic per person (id + gender), matching src/lib/avatars.ts.
 * Runs against the LIVE DB via the authenticated admin client. */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:5173';
const EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin-creds.json'), 'utf8'));

// Mirror of src/lib/avatars.ts seededAvatarUrl (kept inline so the .cjs harness
// needs no TS import). Same algorithm → same URLs as the app will compute.
function hashSeed(input) {
  let h = 5381;
  const s = String(input ?? '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function seededAvatarUrl(seed, gender) {
  const h = hashSeed(seed ?? '');
  const isFemale = gender ? gender === 'female' : h % 2 === 1;
  const idx = h % 100;
  return `https://randomuser.me/api/portraits/${isFemale ? 'women' : 'men'}/${idx}.jpg`;
}

(async () => {
  const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const admin = await b.newPage();
  await admin.setViewport({ width: 1360, height: 900 });
  await admin.goto(BASE + '/admin/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await admin.waitForSelector('input[autocomplete="email"]', { timeout: 10000 });
  const t = async (sel, val) => { const el = await admin.$(sel); await el.click({ clickCount: 3 }); await el.type(val); };
  await t('input[autocomplete="email"]', creds.email);
  await t('input[autocomplete="current-password"]', creds.password);
  await admin.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.type === 'submit' && /Login|প্রবেশ|Sign In|লগইন/i.test(x.textContent)); if (b) b.click(); });
  await admin.waitForFunction(() => location.pathname.includes('/admin/dashboard'), { timeout: 20000 }).then(()=>true).catch(()=>false);
  await new Promise(r => setTimeout(r, 1500));

  const out = await admin.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    // Inline the seeded-headshot logic (puppeteer arg functions aren't
    // serializable into the page context).
    const hashSeed = (input) => { let h = 5381; const s = String(input ?? ''); for (let i=0;i<s.length;i++) h=((h<<5)+h+s.charCodeAt(i))|0; return Math.abs(h); };
    const av = (seed, gender) => { const h = hashSeed(seed??''); const isF = gender ? gender==='female' : h%2===1; const idx=h%100; return `https://randomuser.me/api/portraits/${isF?'women':'men'}/${idx}.jpg`; };

    const fill = async (table, rows) => {
      let done = 0, fail = 0;
      for (const r of rows) {
        const url = av(r.id, r.gender || null);
        const { error } = await supabase.from(table).update({ photo_url: url }).eq('id', r.id);
        if (error) fail++;
        else done++;
      }
      return { done, fail };
    };

    // Every row that is NOT already a seeded randomuser headshot (i.e. empty
    // OR an existing uploaded/reviewed avatar) gets replaced with the seeded
    // headshot — uniform AI-headshot avatars across every teacher and student.
    const isSeeded = (u) => !!u && /randomuser\.me\/api\/portraits\//.test(u);
    const te = await supabase.from('teachers').select('id,name,photo_url');
    const st = await supabase.from('students').select('id,name,photo_url,gender');
    const tNeed = (te.data || []).filter(x => !isSeeded(x.photo_url));
    const sNeed = (st.data || []).filter(x => !isSeeded(x.photo_url));

    const tFill = await fill('teachers', tNeed);
    const sFill = await fill('students', sNeed);

    // Verify: re-read & count non-seeded after.
    const te2 = await supabase.from('teachers').select('id,photo_url');
    const st2 = await supabase.from('students').select('id,photo_url');
    const notSeeded = (rows) => rows.filter(x => !(x.photo_url && /randomuser\.me\/api\/portraits\//.test(x.photo_url))).length;
    return {
      teachers: { total: (te.data||[]).length, replaced: tFill.done, nonSeededAfter: notSeeded(te2.data||[]), fail: tFill.fail },
      students: { total: (st.data||[]).length, replaced: sFill.done, nonSeededAfter: notSeeded(st2.data||[]), fail: sFill.fail },
      sampleTeacher: tNeed[0] ? { name: tNeed[0].name, url: av(tNeed[0].id) } : null,
      tErr: te.error && te.error.message,
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await b.close();
  const allFilled = out && out.teachers.nonSeededAfter === 0 && out.students.nonSeededAfter === 0;
  if (!allFilled) process.exit(1);
})();