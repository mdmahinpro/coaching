import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { cn, formatDate, sanitize } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, MessageSquare, Eye, EyeOff, Save, Loader2, CheckCircle2, X, RefreshCw } from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { sendSMS, fillTemplate, SMS_TEMPLATES } from '@/lib/sms';
import { handleSupabaseError } from '@/utils/errorHandler';

type Tab = 'send' | 'templates' | 'log' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'send', label: 'Send SMS' },
  { id: 'templates', label: 'Templates' },
  { id: 'log', label: 'SMS Log' },
  { id: 'settings', label: 'Settings' },
];

const VARIABLE_TAGS = ['{নাম}', '{পরিমাণ}', '{মাস}', '{ব্যাচ}', '{ইনস্টিটিউট}', '{তারিখ}', '{রশিদ_নং}', '{আইডি}', '{শিরোনাম}', '{বার্তা}'];

const SAMPLE_VARS: Record<string, string> = {
  'নাম': 'রাহেলা বেগম',
  'পরিমাণ': '১৫০০',
  'মাস': 'জানুয়ারি ২০২৬',
  'ব্যাচ': 'SSC English Morning',
  'ইনস্টিটিউট': 'Coaching Center',
  'তারিখ': new Date().toLocaleDateString('bn-BD'),
  'রশিদ_নং': 'RCT-20260502-1234',
  'আইডি': 'CF250001',
  'শিরোনাম': 'পরীক্ষার বিজ্ঞপ্তি',
  'বার্তা': 'পরীক্ষা আগামীকাল অনুষ্ঠিত হবে',
};

// ── Send SMS Tab ──────────────────────────────────────────────────────────────
function SendSMSTab() {
  const { settings } = useSettingsStore();
  const [batches, setBatches] = useState<any[]>([]);
  const [recipientType, setRecipientType] = useState<'all' | 'batch' | 'due' | 'custom'>('all');
  const [batchId, setBatchId] = useState('');
  const [dueFilter, setDueFilter] = useState<'this_month' | 'overdue'>('this_month');
  const [customNumbers, setCustomNumbers] = useState('');
  const [recipientCount, setRecipientCount] = useState(0);
  const [message, setMessage] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  useEffect(() => {
    supabase.from('batches').select('id,name').eq('is_active', true)
      .then(({ data }) => {
        const cleaned = (data ?? []).map((b: any) => ({ ...b, name: sanitize(b.name) }));
        setBatches(cleaned);
      },
      (err: any) => { handleSupabaseError(err); });
  }, []);

  // Count recipients
  const countRecipients = useCallback(async () => {
    let count = 0;
    try {
      if (recipientType === 'custom') {
        const nums = customNumbers.split('\n').map(n => n.trim()).filter(Boolean);
        count = nums.length;
        return;
      }
      if (recipientType === 'due') {
        let feeQuery = supabase.from('fees').select('student_id').eq('status', dueFilter === 'overdue' ? 'overdue' : 'pending');
        if (dueFilter === 'this_month') {
          const now = new Date();
          const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          const monthStr = `${MONTHS_FULL[now.getMonth()]} ${now.getFullYear()}`;
          feeQuery = feeQuery.eq('month', monthStr);
        }
        const { data: feeRows } = await feeQuery;
        const uniqueIds = new Set((feeRows ?? []).map((f: any) => f.student_id).filter(Boolean));
        count = uniqueIds.size;
        return;
      }
      let q = supabase.from('students').select('*', { count: 'exact', head: true }).eq('status', 'active');
      if (recipientType === 'batch' && batchId) q = q.eq('batch_id', batchId);
      const { count: c } = await q;
      count = c ?? 0;
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setRecipientCount(count);
    }
  }, [recipientType, batchId, customNumbers, dueFilter]);

  useEffect(() => { countRecipients(); }, [countRecipients]);

  const insertTag = (tag: string) => {
    setMessage(prev => prev + tag);
  };

  const charCount = message.length;
  const hasNonGSM = /[^\x00-\x7F]/.test(message);
  const charsPerUnit = hasNonGSM ? 70 : 160;
  const smsUnits = Math.ceil(charCount / charsPerUnit) || 1;

  const preview = fillTemplate(message, SAMPLE_VARS);

  const handleSend = async () => {
    setSending(true);
    setProgress(10);
    setResult(null);

    let phones: string[] = [];
    try {
      // Fetch phone numbers
      if (recipientType === 'custom') {
        phones = customNumbers.split('\n').map(n => n.trim()).filter(Boolean);
      } else if (recipientType === 'due') {
        let feeQuery = supabase.from('fees').select('student_id').eq('status', dueFilter === 'overdue' ? 'overdue' : 'pending');
        if (dueFilter === 'this_month') {
          const now = new Date();
          const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          const monthStr = `${MONTHS_FULL[now.getMonth()]} ${now.getFullYear()}`;
          feeQuery = feeQuery.eq('month', monthStr);
        }
        const { data: feeRows } = await feeQuery;
        const studentIds = [...new Set((feeRows ?? []).map((f: any) => f.student_id).filter(Boolean))];
        if (studentIds.length > 0) {
          const { data: studs } = await supabase
            .from('students')
            .select('phone')
            .in('id', studentIds)
            .not('phone', 'is', null);
          phones = (studs ?? []).map((s: any) => s.phone).filter(Boolean);
        }
      } else {
        let q = supabase.from('students').select('phone').eq('status', 'active').not('phone', 'is', null);
        if (recipientType === 'batch' && batchId) q = q.eq('batch_id', batchId);
        const { data } = await q;
        phones = (data ?? []).map((s: any) => s.phone).filter(Boolean);
      }

      setProgress(40);

      if (!phones.length) {
        toast.error('No recipients found');
        return;
      }

      const res = await sendSMS(phones, message, 'custom', settings.smsApiKey, settings.smsSenderId);
      setProgress(100);
      setResult(res);
      toast.success(`SMS ${res.sent > 0 ? 'sent' : 'queued'} to ${phones.length} numbers`);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      {/* Recipient selector */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-white text-sm">Recipients</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { id: 'all' as const, label: 'All Active' },
            { id: 'batch' as const, label: 'By Batch' },
            { id: 'due' as const, label: 'Due Fees' },
            { id: 'custom' as const, label: 'Custom' },
          ].map(r => (
            <button
              key={r.id}
              onClick={() => setRecipientType(r.id)}
              className={cn(
                'py-2 px-3 rounded-lg text-sm font-medium border transition-all',
                recipientType === r.id ? 'bg-sky-500/15 border-sky-400/40 text-sky-400' : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {recipientType === 'batch' && (
          <select value={batchId} onChange={e => setBatchId(e.target.value)} className="input-field">
            <option value="">Select batch</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {recipientType === 'due' && (
          <select value={dueFilter} onChange={e => setDueFilter(e.target.value as 'this_month' | 'overdue')} className="input-field">
            <option value="this_month">This Month Due</option>
            <option value="overdue">All Overdue</option>
          </select>
        )}
        {recipientType === 'custom' && (
          <textarea
            value={customNumbers}
            onChange={e => setCustomNumbers(e.target.value)}
            className="input-field font-mono text-sm"
            rows={4}
            placeholder="01XXXXXXXXX&#10;01XXXXXXXXX&#10;(one per line)"
          />
        )}

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          <span><span className="text-white font-medium">{recipientCount}</span> students selected</span>
        </div>
      </div>

      {/* Message composer */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-white text-sm">Message</h3>

        {/* Template selector */}
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Load Template</label>
          <select
            value={templateKey}
            onChange={e => {
              setTemplateKey(e.target.value);
              if (e.target.value && SMS_TEMPLATES[e.target.value]) setMessage(SMS_TEMPLATES[e.target.value].body);
            }}
            className="input-field"
          >
            <option value="">— Select template —</option>
            {Object.values(SMS_TEMPLATES).map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Variable tags */}
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Insert Variable</label>
          <div className="flex flex-wrap gap-1.5">
            {VARIABLE_TAGS.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => insertTag(tag)}
                className="px-2 py-1 rounded-md bg-violet-500/15 border border-violet-500/25 text-violet-300 text-xs hover:bg-violet-500/25 transition-colors font-mono"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Message textarea */}
        <div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            className="input-field font-hind"
            rows={4}
            placeholder="Type your message…"
          />
          <div className="flex items-center justify-between mt-1">
            <span className={cn('text-xs', charCount > 160 ? 'text-amber-400' : 'text-slate-500')}>
              {charCount} chars · {smsUnits} SMS unit{smsUnits > 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Live preview */}
        {message && (
          <div className="card p-3 border border-violet-400/15">
            <p className="text-slate-500 text-[10px] mb-1.5 uppercase tracking-wider">Preview (sample data)</p>
            <p className="text-white text-sm font-hind leading-relaxed">{preview}</p>
          </div>
        )}
      </div>

      <button
        onClick={() => setConfirmOpen(true)}
        disabled={!message.trim() || !recipientCount}
        className="btn-primary w-full justify-center"
      >
        <Send size={15} /> SMS পাঠান
      </button>

      {result && (
        <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} className="card p-4 border border-emerald-400/20 text-center">
          <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
          <p className="text-white font-semibold">{result.sent} সফল · {result.failed} ব্যর্থ</p>
        </motion.div>
      )}

      {/* Confirm modal */}
      <AnimatePresence>
        {confirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !sending && setConfirmOpen(false)} />
            <motion.div initial={{ opacity:0, scale:0.93 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0, scale:0.93 }} className="relative card-glass p-6 w-full max-w-sm z-10">
              {!sending && <button onClick={() => setConfirmOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X size={16} /></button>}
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-xl bg-sky-500/15"><Send size={20} className="text-sky-400" /></div>
                <div>
                  <p className="font-semibold text-white">নিশ্চিত করুন</p>
                  <p className="text-slate-400 text-sm">{recipientCount} নম্বরে SMS পাঠানো হবে।</p>
                </div>
              </div>
              {sending && (
                <div className="mb-4">
                  <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
                    <motion.div className="h-full bg-sky-400 rounded-full" animate={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
                  </div>
                  <p className="text-slate-400 text-xs text-center mt-2">Sending…</p>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setConfirmOpen(false)} disabled={sending} className="btn-outline flex-1 justify-center text-sm">Cancel</button>
                <button onClick={handleSend} disabled={sending} className="btn-primary flex-1 justify-center text-sm">
                  {sending ? <><Loader2 size={14} className="animate-spin" /> Sending</> : <><Send size={14} /> পাঠান</>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Templates Tab ─────────────────────────────────────────────────────────────
function TemplatesTab() {
  const { settings } = useSettingsStore();
  const [templates, setTemplates] = useState<Record<string, string>>(
    Object.fromEntries(Object.values(SMS_TEMPLATES).map(t => [t.key, t.body]))
  );
  const [saving, setSaving] = useState<string | null>(null);

  const save = async (key: string) => {
    setSaving(key);
    try {
      const { error } = await supabase.from('site_settings').upsert({ key: `sms_template_${key}`, value: templates[key] }, { onConflict: 'key' });
      if (error) { toast.error('Failed to save'); }
      else { toast.success('Template saved'); }
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      {Object.values(SMS_TEMPLATES).map(t => (
        <div key={t.key} className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-mono text-sky-400 text-xs">{t.key}</span>
              <p className="text-white text-sm font-medium">{t.label}</p>
            </div>
            <button onClick={() => save(t.key)} disabled={saving === t.key} className="btn-outline text-xs py-1.5 px-3">
              {saving === t.key ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save
            </button>
          </div>
          <textarea
            value={templates[t.key] ?? t.body}
            onChange={e => setTemplates(prev => ({ ...prev, [t.key]: e.target.value }))}
            className="input-field font-hind text-sm"
            rows={3}
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(templates[t.key] ?? '').match(/\{[^}]+\}/g)?.map((v, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-300 font-mono text-[10px]">{v}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── SMS Log Tab ───────────────────────────────────────────────────────────────
function SMSLogTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase.from('sms_logs').select('*').order('created_at', { ascending: false }).limit(100);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (typeFilter !== 'all') q = q.eq('type', typeFilter);
      const { data } = await q;
      setLogs(data ?? []);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-field py-1.5 text-sm max-w-[140px]">
          <option value="all">All Status</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input-field py-1.5 text-sm max-w-[160px]">
          <option value="all">All Types</option>
          {Object.keys(SMS_TEMPLATES).map(k => <option key={k} value={k}>{k}</option>)}
          <option value="custom">Custom</option>
        </select>
        <button onClick={load} className="btn-outline text-sm py-1.5 px-3"><RefreshCw size={13} /> Refresh</button>
        <span className="text-slate-500 text-xs ml-auto">{logs.length} records</span>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="divide-y divide-navy-700/30">
            {Array.from({length:5}).map((_,i) => <div key={i} className="h-10 mx-4 my-2 bg-navy-700 rounded animate-pulse" />)}
          </div>
        ) : logs.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-10">No SMS records found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700/50">
                  {['Phone','Message','Type','Status','Time'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium text-xs whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="border-b border-navy-700/30 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-sky-400 text-xs">{l.phone}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs max-w-[260px] truncate">{l.message}</td>
                    <td className="px-4 py-3"><span className="badge-blue text-xs">{l.type}</span></td>
                    <td className="px-4 py-3">
                      <span className={l.status === 'sent' ? 'badge-green text-xs' : l.status === 'pending' ? 'badge-yellow text-xs' : 'badge-red text-xs'}>{l.status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{l.created_at ? formatDate(l.created_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────
function SMSSettingsTab() {
  const { settings, updateSettings } = useSettingsStore();
  const [apiKey, setApiKey] = useState(settings.smsApiKey);
  const [senderId, setSenderId] = useState(settings.smsSenderId);
  const [showKey, setShowKey] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testing, setSending] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      updateSettings({ smsApiKey: apiKey, smsSenderId: senderId });
      const upserts = [
        { key: 'sms_api_key', value: apiKey },
        { key: 'sms_sender_id', value: senderId },
      ];
      const { error } = await supabase.from('site_settings').upsert(upserts, { onConflict: 'key' });
      if (error) { toast.error('Failed to save: ' + error.message); return; }
      toast.success('SMS settings saved');
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testPhone) { toast.error('Enter a phone number'); return; }
    setSending(true);
    try {
      const res = await sendSMS(testPhone, `Test SMS from ${settings.centerName} — ${new Date().toLocaleTimeString()}`, 'test', apiKey, senderId);
      if (res.sent > 0) toast.success('Test SMS sent!');
      else toast.error('SMS failed. Check API key.');
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-lg space-y-5">
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-white">MIMSMS Configuration</h3>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">API Key</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className="input-field pr-10 font-mono"
              placeholder="Your MIMSMS API key"
            />
            <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Sender ID</label>
          <input value={senderId} onChange={e => setSenderId(e.target.value)} className="input-field" placeholder="CoachMS" />
          <p className="text-slate-600 text-xs mt-1">Max 11 characters, letters only</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
          {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save Settings</>}
        </button>
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-white">Test SMS</h3>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Test Phone Number</label>
          <input value={testPhone} onChange={e => setTestPhone(e.target.value)} className="input-field" placeholder="01XXXXXXXXX" />
        </div>
        <div className="flex gap-3">
          <button onClick={handleTest} disabled={testing} className="btn-primary text-sm">
            {testing ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <><Send size={14} /> Send Test SMS</>}
          </button>
        </div>
        {!apiKey && (
          <div className="card p-3 border border-amber-400/20">
            <p className="text-amber-400 text-xs">⚠ No API key configured. SMS will be logged as "pending" without actual delivery.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SMSPage() {
  const [tab, setTab] = useState<Tab>('send');

  return (
    <AdminLayout title="SMS কেন্দ্র">
      <div className="flex border-b border-navy-700/50 mb-6 gap-1 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all',
              tab === t.id ? 'text-sky-400 border-sky-400' : 'text-slate-400 border-transparent hover:text-white'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'send' && <SendSMSTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'log' && <SMSLogTab />}
      {tab === 'settings' && <SMSSettingsTab />}
    </AdminLayout>
  );
}
