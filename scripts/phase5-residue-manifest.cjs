/* Phase 5: read-only residue manifest.
 * Requires the existing admin credential file but never prints credentials.
 * Writes no database records and does not delete anything.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('=').map((s) => s.trim())));
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'e2e', 'admin-creds.json'), 'utf8'));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const patterns = [
  ['batches', 'name', 'ADM-COMBINED%'], ['batches', 'name', 'ADM-E2E%'],
  ['students', 'name', 'ADM-COMBINED%'], ['students', 'student_id', '__E2E%'],
  ['teachers', 'name', 'ADM-COMBINED%'], ['admission_requests', 'name', 'ADM-COMBINED%'],
  ['notices', 'title', 'COMBINED Notice%'], ['fees', 'note', 'COMBINED-E2E%'],
  ['payment_approvals', 'transaction_id', 'PORTAL-TRX-%'],
];
(async () => {
  const auth = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (auth.error) throw auth.error;
  const manifest = { generated_at: new Date().toISOString(), mode: 'read-only', customer_url: new URL(env.VITE_SUPABASE_URL).hostname, candidates: [] };
  for (const [table, column, pattern] of patterns) {
    const fields = table === 'students' ? 'id,name,student_id,created_at,batch_id' : table === 'batches' ? 'id,name,created_at' : table === 'teachers' ? 'id,name,created_at' : table === 'admission_requests' ? 'id,name,phone,status,created_at' : table === 'notices' ? 'id,title,created_at' : table === 'fees' ? 'id,student_id,month,created_at,note' : 'id,student_id,fee_id,transaction_id,created_at';
    const r = await sb.from(table).select(fields).like(column, pattern).limit(500);
    if (r.error) { manifest.candidates.push({ table, pattern, error: r.error.message }); continue; }
    for (const row of r.data ?? []) {
      const dependents = {};
      if (table === 'students') {
        for (const child of ['fees', 'payment_approvals', 'mcq_submissions', 'student_sessions', 'exam_tokens']) {
          const q = await sb.from(child).select('id', { count: 'exact', head: true }).eq('student_id', row.id);
          dependents[child] = q.count ?? 0;
        }
      }
      manifest.candidates.push({ table, match: { column, pattern }, id: row.id, marker: row.name || row.title || row.student_id || row.transaction_id || row.note, created_at: row.created_at, status: row.status, dependents });
    }
  }
  const out = path.join(__dirname, '..', 'provisioning-reports', `phase5-residue-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ report: out, candidate_count: manifest.candidates.length, mode: manifest.mode }));
})().catch((e) => { console.error('manifest failed:', e.message); process.exit(1); });
