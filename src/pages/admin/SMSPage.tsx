import { useEffect, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { cn, formatDate, sanitize } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Save,
  Loader2,
  CheckCircle2,
  X,
  RefreshCw,
  Smartphone,
  Mail,
} from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { sendSMS, fillTemplate, hasPlaceholders, SMS_TEMPLATES } from '@/lib/sms';
import type { SMSResult } from '@/lib/sms';
import { handleSupabaseError } from '@/utils/errorHandler';

type Tab = 'send' | 'templates' | 'log' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'send', label: 'Send SMS' },
  { id: 'templates', label: 'Templates' },
  { id: 'log', label: 'SMS Log' },
  { id: 'settings', label: 'Settings' },
];

const VARIABLE_TAGS = [
  '{নাম}',
  '{পরিমাণ}',
  '{মাস}',
  '{ব্যাচ}',
  '{ইনস্টিটিউট}',
  '{তারিখ}',
  '{রশিদ_নং}',
  '{আইডি}',
  '{শিরোনাম}',
  '{বার্তা}',
];

const SAMPLE_VARS: Record<string, string> = {
  নাম: 'রাহেলা বেগম',
  পরিমাণ: '১৫০০',
  মাস: 'জানুয়ারি ২০২৬',
  ব্যাচ: 'SSC English Morning',
  ইনস্টিটিউট: 'Coaching Center',
  তারিখ: new Date().toLocaleDateString('bn-BD'),
  রশিদ_নং: 'RCT-20260502-1234',
  আইডি: 'CF250001',
  শিরোনাম: 'পরীক্ষার বিজ্ঞপ্তি',
  বার্তা: 'পরীক্ষা আগামীকাল অনুষ্ঠিত হবে',
};

const TEMPLATE_SETTING_PREFIX = 'sms_template_';

/**
 * Template bodies as stored by the centre, not the hard-coded defaults.
 * The Templates tab writes `site_settings.sms_template_<KEY>`; this reads them
 * back and only falls back to the built-in text for keys never saved.
 */
async function loadTemplateBodies(): Promise<Record<string, string>> {
  const merged: Record<string, string> = Object.fromEntries(
    Object.values(SMS_TEMPLATES).map((t) => [t.key, t.body])
  );
  try {
    const { data } = await supabase
      .from('site_settings')
      .select('key, value')
      .like('key', `${TEMPLATE_SETTING_PREFIX}%`);
    for (const row of (data ?? []) as Array<{ key: string; value: string | null }>) {
      const key = row.key.slice(TEMPLATE_SETTING_PREFIX.length);
      if (key && typeof row.value === 'string' && row.value.trim()) {
        merged[key] = row.value;
      }
    }
  } catch (err) {
    handleSupabaseError(err);
  }
  return merged;
}

// ── Send SMS Tab ──────────────────────────────────────────────────────────────
function SendSMSTab() {
  const { settings } = useSettingsStore();
  const [batches, setBatches] = useState<any[]>([]);
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [emailSubject, setEmailSubject] = useState('');
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
  const [templateBodies, setTemplateBodies] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.values(SMS_TEMPLATES).map((t) => [t.key, t.body]))
  );
  useQuery({
    queryKey: ['admin', 'sms', 'templates', 'send'],
    queryFn: async () => {
      setTemplateBodies(await loadTemplateBodies());
      return true;
    },
  });
  useQuery({
    queryKey: ['admin', 'sms', 'batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id,name')
        .eq('is_active', true);
      if (error) {
        handleSupabaseError(error);
        return null;
      }
      setBatches((data ?? []).map((b: any) => ({ ...b, name: sanitize(b.name) })));
      return true;
    },
  });

  // Count recipients
  const countRecipients = useCallback(async () => {
    let count = 0;
    try {
      if (recipientType === 'custom') {
        const nums = customNumbers
          .split('\n')
          .map((n) => n.trim())
          .filter(Boolean);
        count = nums.length;
        return;
      }
      if (recipientType === 'due') {
        let feeQuery = supabase
          .from('fees')
          .select('student_id')
          .eq('status', dueFilter === 'overdue' ? 'overdue' : 'pending');
        if (dueFilter === 'this_month') {
          const now = new Date();
          const MONTHS_FULL = [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December',
          ];
          const monthStr = `${MONTHS_FULL[now.getMonth()]} ${now.getFullYear()}`;
          feeQuery = feeQuery.eq('month', monthStr);
        }
        const { data: feeRows } = await feeQuery;
        const uniqueIds = new Set((feeRows ?? []).map((f: any) => f.student_id).filter(Boolean));
        count = uniqueIds.size;
        return;
      }
      let q = supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      if (recipientType === 'batch' && batchId) {
        q = q.eq('batch_id', batchId);
      }
      const { count: c } = await q;
      count = c ?? 0;
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setRecipientCount(count);
    }
  }, [recipientType, batchId, customNumbers, dueFilter]);

  useQuery({
    queryKey: ['admin', 'sms', 'recipients', recipientType, batchId, customNumbers, dueFilter],
    queryFn: async () => {
      await countRecipients();
      return true;
    },
  });

  const insertTag = (tag: string) => {
    setMessage((prev) => prev + tag);
  };

  const charCount = message.length;
  // Non-GSM (Unicode) chars force 70-char SMS units. The \x00-\x7F range is
  // intentional here — matching outside the ASCII range detects them.
  // eslint-disable-next-line no-control-regex
  const hasNonGSM = /[^\x00-\x7F]/.test(message);
  const charsPerUnit = hasNonGSM ? 70 : 160;
  const smsUnits = Math.ceil(charCount / charsPerUnit) || 1;

  const preview = fillTemplate(message, SAMPLE_VARS);

  const handleSend = async () => {
    setSending(true);
    setProgress(10);
    setResult(null);

    type Target = { value: string; vars: Record<string, string> };
    const emailField = channel === 'email' ? 'email' : 'phone';
    const centreVars: Record<string, string> = {
      ইনস্টিটিউট: settings.centerName ?? 'Coaching Center',
      তারিখ: new Date().toLocaleDateString('bn-BD'),
    };
    let targets: Target[] = [];
    try {
      // Resolve recipients (and, for students, their DB row so {নাম}/{আইডি}
      // and the fee fields are real values rather than sample text).
      if (recipientType === 'custom') {
        targets = customNumbers
          .split('\n')
          .map((n) => n.trim())
          .filter(Boolean)
          .map((value) => ({ value, vars: { ...centreVars } }));
      } else if (recipientType === 'due') {
        let feeQuery = supabase
          .from('fees')
          .select('student_id, month, amount')
          .eq('status', dueFilter === 'overdue' ? 'overdue' : 'pending');
        if (dueFilter === 'this_month') {
          const now = new Date();
          const MONTHS_FULL = [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December',
          ];
          const monthStr = `${MONTHS_FULL[now.getMonth()]} ${now.getFullYear()}`;
          feeQuery = feeQuery.eq('month', monthStr);
        }
        const { data: feeRows } = await feeQuery;
        const feeByStudent = new Map<string, { month?: string; amount?: number }>();
        for (const f of (feeRows ?? []) as Array<{
          student_id: string;
          month?: string;
          amount?: number;
        }>) {
          if (f.student_id && !feeByStudent.has(f.student_id)) {
            feeByStudent.set(f.student_id, { month: f.month, amount: f.amount });
          }
        }
        const studentIds = [...feeByStudent.keys()];
        if (studentIds.length > 0) {
          const { data: studs } = await supabase
            .from('students')
            .select(`id, name, student_id, ${emailField}`)
            .in('id', studentIds)
            .not(emailField, 'is', null);
          targets = (studs ?? [])
            .map((s: any) => {
              const fee = feeByStudent.get(s.id);
              const vars: Record<string, string> = {
                ...centreVars,
                নাম: s.name ?? '',
                আইডি: s.student_id ?? '',
              };
              // Only claim a month/amount we actually have; otherwise the
              // placeholder stays visible and the toast names it.
              if (fee?.month) vars['মাস'] = fee.month;
              if (fee?.amount != null) vars['পরিমাণ'] = String(fee.amount);
              return {
                value: String(s[emailField] ?? '').trim(),
                vars,
              };
            })
            .filter((t) => t.value);
        }
      } else {
        let q = supabase
          .from('students')
          .select(`id, name, student_id, ${emailField}`)
          .eq('status', 'active')
          .not(emailField, 'is', null);
        if (recipientType === 'batch' && batchId) {
          q = q.eq('batch_id', batchId);
        }
        const { data } = await q;
        targets = ((data ?? []) as any[])
          .map((s) => ({
            value: String(s[emailField] ?? '').trim(),
            vars: {
              ...centreVars,
              নাম: s.name ?? '',
              আইডি: s.student_id ?? '',
            },
          }))
          .filter((t) => t.value);
      }

      setProgress(40);

      if (!targets.length) {
        toast.error('No recipients found');
        return;
      }

      // A message with no {placeholders} is identical for everyone → one call.
      // With placeholders each recipient needs their own DB-resolved text.
      const usesVars = hasPlaceholders(message);
      let res: SMSResult;
      if (!usesVars) {
        res = await sendSMS(
          targets.map((t) => t.value),
          message,
          'custom',
          { channel, subject: emailSubject }
        );
      } else {
        let sent = 0;
        let failed = 0;
        let pending = 0;
        let hint: string | undefined;
        const unfilled = new Set<string>();
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          const text = fillTemplate(message, t.vars);
          for (const m of text.matchAll(/\{([^}]+)\}/g)) unfilled.add(m[1]);
          const one = await sendSMS(t.value, text, 'custom', {
            channel,
            subject: emailSubject,
          });
          sent += one.sent;
          failed += one.failed;
          if (one.status === 'pending') pending++;
          if (one.hint) hint = one.hint;
          setProgress(40 + Math.round(((i + 1) / targets.length) * 60));
        }
        if (unfilled.size > 0) {
          // Nothing in the DB could fill these — say so instead of silently
          // shipping literal braces to the recipient.
          toast.error(`No data for: ${[...unfilled].map((k) => `{${k}}`).join(', ')}`);
        }
        res = {
          sent,
          failed,
          status: pending === targets.length ? 'pending' : sent > 0 ? 'sent' : 'failed',
          hint:
            hint ??
            (failed > 0 ? `${failed} of ${targets.length} recipients rejected` : undefined),
        };
      }
      setProgress(100);
      setResult(res);
      if (res.status === 'sent' && res.failed === 0) {
        toast.success(
          channel === 'email'
            ? `Email sent to ${res.sent} recipient${res.sent > 1 ? 's' : ''}`
            : `SMS sent to ${res.sent} number${res.sent > 1 ? 's' : ''}`
        );
      } else if (res.status === 'sent') {
        // Some numbers went through, some were rejected — never call that a clean success.
        toast.error(
          `${res.sent} sent, ${res.failed} failed — ${res.hint ?? 'gateway rejected the rest'}`
        );
      } else if (res.status === 'pending') {
        toast.error(`Not sent — ${res.hint ?? 'no provider key on the server'}`);
      } else {
        toast.error(`Send failed — ${res.hint ?? 'unknown error'}`);
      }
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      {/* Channel selector — SMS or Email */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-white text-sm">Channel</h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setChannel('sms')}
            className={`p-3 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors ${
              channel === 'sms'
                ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                : 'border-navy-700 text-slate-400 hover:border-navy-600'
            }`}
          >
            <Smartphone className="h-4 w-4" /> SMS <span className="text-xs text-slate-500">(ZenSMS)</span>
          </button>
          <button
            onClick={() => setChannel('email')}
            className={`p-3 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors ${
              channel === 'email'
                ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                : 'border-navy-700 text-slate-400 hover:border-navy-600'
            }`}
          >
            <Mail className="h-4 w-4" /> Email <span className="text-xs text-slate-500">(Brevo)</span>
          </button>
        </div>
        {channel === 'email' && (
          <div>
            <label className="text-xs text-slate-400 block mb-1">Subject line</label>
            <input
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="e.g. Fee reminder / Exam notice"
              className="input-field text-sm"
            />
            <p className="text-xs text-slate-500 mt-1">
              Uses students&apos; email field. Without a Brevo key on the server, emails are
              logged as pending.
            </p>
          </div>
        )}
        {channel === 'sms' && (
          <p className="text-xs text-slate-500">
            Uses students&apos; phone field via the ZenSMS gateway.
          </p>
        )}
      </div>

      {/* Recipient selector */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-white text-sm">Recipients</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { id: 'all' as const, label: 'All Active' },
            { id: 'batch' as const, label: 'By Batch' },
            { id: 'due' as const, label: 'Due Fees' },
            { id: 'custom' as const, label: 'Custom' },
          ].map((r) => (
            <button
              key={r.id}
              onClick={() => setRecipientType(r.id)}
              className={cn(
                'py-2 px-3 rounded-lg text-sm font-medium border transition-all',
                recipientType === r.id
                  ? 'bg-sky-500/15 border-sky-400/40 text-sky-400'
                  : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {recipientType === 'batch' && (
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="input-field"
          >
            <option value="">Select batch</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {recipientType === 'due' && (
          <select
            value={dueFilter}
            onChange={(e) => setDueFilter(e.target.value as 'this_month' | 'overdue')}
            className="input-field"
          >
            <option value="this_month">This Month Due</option>
            <option value="overdue">All Overdue</option>
          </select>
        )}
        {recipientType === 'custom' && (
          <textarea
            value={customNumbers}
            onChange={(e) => setCustomNumbers(e.target.value)}
            className="input-field font-mono text-sm"
            rows={4}
            placeholder="01XXXXXXXXX&#10;01XXXXXXXXX&#10;(one per line)"
          />
        )}

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          <span>
            <span className="text-white font-medium">{recipientCount}</span> students selected
          </span>
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
            onChange={(e) => {
              setTemplateKey(e.target.value);
              if (e.target.value && templateBodies[e.target.value]) {
                setMessage(templateBodies[e.target.value]);
              }
            }}
            className="input-field"
          >
            <option value="">— Select template —</option>
            {Object.values(SMS_TEMPLATES).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Variable tags */}
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Insert Variable</label>
          <div className="flex flex-wrap gap-1.5">
            {VARIABLE_TAGS.map((tag) => (
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
            onChange={(e) => setMessage(e.target.value)}
            className="input-field font-hind"
            rows={4}
            placeholder="Type your message…"
          />
          <div className="flex items-center justify-between mt-1">
            <span className={cn('text-xs', charCount > 160 ? 'text-amber-400' : 'text-slate-500')}>
              {channel === 'email'
                ? `${charCount} chars`
                : `${charCount} chars · ${smsUnits} SMS unit${smsUnits > 1 ? 's' : ''}`}
            </span>
          </div>
        </div>

        {/* Live preview */}
        {message && (
          <div className="card p-3 border border-violet-400/15">
            <p className="text-slate-500 text-[10px] mb-1.5 uppercase tracking-wider">
              Preview (sample data)
            </p>
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
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-4 border border-emerald-400/20 text-center"
        >
          <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
          <p className="text-white font-semibold">
            {result.sent} সফল · {result.failed} ব্যর্থ
          </p>
        </motion.div>
      )}

      {/* Confirm modal */}
      <AnimatePresence>
        {confirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => !sending && setConfirmOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.93 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.93 }}
              className="relative card-glass p-6 w-full max-w-sm z-10"
            >
              {!sending && (
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="absolute top-4 right-4 text-slate-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              )}
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-xl bg-sky-500/15">
                  <Send size={20} className="text-sky-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">নিশ্চিত করুন</p>
                  <p className="text-slate-400 text-sm">{recipientCount} নম্বরে SMS পাঠানো হবে।</p>
                </div>
              </div>
              {sending && (
                <div className="mb-4">
                  <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-sky-400 rounded-full"
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                  <p className="text-slate-400 text-xs text-center mt-2">Sending…</p>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmOpen(false)}
                  disabled={sending}
                  className="btn-outline flex-1 justify-center text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="btn-primary flex-1 justify-center text-sm"
                >
                  {sending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Sending
                    </>
                  ) : (
                    <>
                      <Send size={14} /> পাঠান
                    </>
                  )}
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
  const [templates, setTemplates] = useState<Record<string, string>>(
    Object.fromEntries(Object.values(SMS_TEMPLATES).map((t) => [t.key, t.body]))
  );
  const [saving, setSaving] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Show what is actually saved in the DB, not just the built-in defaults.
  useQuery({
    queryKey: ['admin', 'sms', 'templates', 'edit'],
    queryFn: async () => {
      setTemplates(await loadTemplateBodies());
      return true;
    },
  });

  const save = async (key: string) => {
    setSaving(key);
    try {
      const { error } = await supabase
        .from('site_settings')
        .upsert({ key: `sms_template_${key}`, value: templates[key] }, { onConflict: 'key' });
      if (error) {
        toast.error('Failed to save');
      } else {
        toast.success('Template saved');
        // Send tab must pick the new body up without a page reload.
        void queryClient.invalidateQueries({ queryKey: ['admin', 'sms', 'templates', 'send'] });
      }
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      {Object.values(SMS_TEMPLATES).map((t) => (
        <div key={t.key} className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-mono text-sky-400 text-xs">{t.key}</span>
              <p className="text-white text-sm font-medium">{t.label}</p>
            </div>
            <button
              onClick={() => save(t.key)}
              disabled={saving === t.key}
              className="btn-outline text-xs py-1.5 px-3"
            >
              {saving === t.key ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Save size={12} />
              )}
              Save
            </button>
          </div>
          <textarea
            value={templates[t.key] ?? t.body}
            onChange={(e) => setTemplates((prev) => ({ ...prev, [t.key]: e.target.value }))}
            className="input-field font-hind text-sm"
            rows={3}
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(templates[t.key] ?? '').match(/\{[^}]+\}/g)?.map((v, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-300 font-mono text-[10px]"
              >
                {v}
              </span>
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
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const { isLoading: loading, refetch: reloadLogs } = useQuery({
    queryKey: ['admin', 'sms', 'logs', statusFilter, typeFilter],
    queryFn: async () => {
      let q = supabase
        .from('sms_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (statusFilter !== 'all') {
        q = q.eq('status', statusFilter);
      }
      if (typeFilter !== 'all') {
        q = q.eq('type', typeFilter);
      }
      const { data, error } = await q;
      if (error) {
        handleSupabaseError(error);
        return null;
      }
      setLogs(data ?? []);
      return true;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field py-1.5 text-sm max-w-[140px]"
        >
          <option value="all">All Status</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="input-field py-1.5 text-sm max-w-[160px]"
        >
          <option value="all">All Types</option>
          {Object.keys(SMS_TEMPLATES).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        <button onClick={() => reloadLogs()} className="btn-outline text-sm py-1.5 px-3">
          <RefreshCw size={13} /> Refresh
        </button>
        <span className="text-slate-500 text-xs ml-auto">{logs.length} records</span>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="divide-y divide-navy-700/30">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 mx-4 my-2 bg-navy-700 rounded animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-10">No SMS records found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700/50">
                  {['Phone', 'Message', 'Type', 'Status', 'Time'].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-slate-400 font-medium text-xs whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-navy-700/30 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-sky-400 text-xs">{l.phone}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs max-w-[260px] truncate">
                      {l.message}
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge-blue text-xs">{l.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          l.status === 'sent'
                            ? 'badge-green text-xs'
                            : l.status === 'pending'
                              ? 'badge-yellow text-xs'
                              : 'badge-red text-xs'
                        }
                      >
                        {l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {l.created_at ? formatDate(l.created_at) : '—'}
                    </td>
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
  const { settings } = useSettingsStore();
  const [testPhone, setTestPhone] = useState('');
  const [testing, setSending] = useState(false);

  const handleTest = async () => {
    if (!testPhone) {
      toast.error('Enter a phone number');
      return;
    }
    setSending(true);
    try {
      const res = await sendSMS(
        testPhone,
        `Test SMS from ${settings.centerName} — ${new Date().toLocaleTimeString()}`,
        'test'
      );
      if (res.status === 'sent') {
        toast.success('Test SMS sent! Check SMS Log for the gateway response.');
      } else if (res.status === 'pending') {
        toast.error(`Not sent: ${res.hint ?? 'SMS_API_KEY is missing on the server'}`);
      } else {
        toast.error(
          `Send failed: ${res.hint ?? JSON.stringify(res.raw).slice(0, 140) ?? 'see SMS Log'}`
        );
      }
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-lg space-y-5">
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-white">ZenSMS Configuration</h3>
        <div className="card p-3 border border-sky-400/20">
          <p className="text-slate-300 text-xs leading-relaxed">
            The SMS API key is stored securely on the server and is never exposed to the browser.
            Set the <span className="font-mono text-sky-400">SMS_API_KEY</span> and{' '}
            <span className="font-mono text-sky-400">SMS_SENDER_ID</span> environment variables in
            your hosting platform (Render env, or Supabase Edge Function secrets) to enable
            delivery. Gateway: <span className="font-mono text-sky-400">api.zendsms.com</span>.
          </p>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-white">Test SMS</h3>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Test Phone Number</label>
          <input
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            className="input-field"
            placeholder="01XXXXXXXXX"
          />
        </div>
        <div className="flex gap-3">
          <button onClick={handleTest} disabled={testing} className="btn-primary text-sm">
            {testing ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Send size={14} /> Send Test SMS
              </>
            )}
          </button>
        </div>
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
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all',
              tab === t.id
                ? 'text-sky-400 border-sky-400'
                : 'text-slate-400 border-transparent hover:text-white'
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
