import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { cn, formatDate, sanitize } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Save, Loader2, CheckCircle2, X, RefreshCw } from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { sendSMS, fillTemplate, SMS_TEMPLATES } from '@/lib/sms';
import { sendEmail, emailTemplate, EMAIL_TEMPLATES } from '@/lib/email';
import {
  dedupeRecipients,
  formatMessagingResult,
  hasUnresolvedTemplate,
  messagingIdempotencyKey,
  processMessageQueue,
  type MessagingResponse,
} from '@/lib/messaging';
import { MessagingProviderSettings } from '@/components/admin/MessagingProviderSettings';
import { handleSupabaseError } from '@/utils/errorHandler';
import {
  campaignLimitState,
  messagingResultTone,
  savedSmsTemplates,
  summarizeMessageJob,
  type MessageJobRow,
} from '@/lib/messagingUi';

type Tab = 'send' | 'email' | 'templates' | 'log' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'send', label: 'Send SMS' },
  { id: 'email', label: 'Send Email' },
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

function notifyMessagingResult(result: MessagingResponse) {
  const summary = formatMessagingResult(result);
  const tone = messagingResultTone(result);
  if (tone === 'error') {
    toast.error(summary);
  } else if (tone === 'success') {
    toast.success(summary);
  } else {
    toast(summary);
  }
}

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

// ── Send SMS Tab ──────────────────────────────────────────────────────────────
function SendSMSTab({
  templates,
  initialTemplateKey,
}: {
  templates: Record<string, string>;
  initialTemplateKey?: string;
}) {
  const [batches, setBatches] = useState<any[]>([]);
  const [recipientType, setRecipientType] = useState<'all' | 'batch' | 'due' | 'custom'>('all');
  const [batchId, setBatchId] = useState('');
  const [dueFilter, setDueFilter] = useState<'this_month' | 'overdue'>('this_month');
  const [customNumbers, setCustomNumbers] = useState('');
  const [recipientCount, setRecipientCount] = useState(0);
  const [message, setMessage] = useState(() =>
    initialTemplateKey ? (templates[initialTemplateKey] ?? '') : ''
  );
  const [templateKey, setTemplateKey] = useState(initialTemplateKey ?? '');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<MessagingResponse | null>(null);
  useEffect(() => {
    supabase
      .from('batches')
      .select('id,name')
      .eq('is_active', true)
      .then(
        ({ data }) => {
          const cleaned = (data ?? []).map((b: any) => ({ ...b, name: sanitize(b.name) }));
          setBatches(cleaned);
        },
        (err: any) => {
          handleSupabaseError(err);
        }
      );
  }, []);

  // Count recipients
  const countRecipients = useCallback(async () => {
    let count = 0;
    try {
      if (recipientType === 'custom') {
        const nums = customNumbers
          .split('\n')
          .map((n) => n.trim())
          .filter(Boolean);
        count = dedupeRecipients('sms', nums).length;
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
        .eq('status', 'active')
        .not('phone', 'is', null);
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

  useEffect(() => {
    countRecipients();
  }, [countRecipients]);

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
  const campaignState = campaignLimitState(recipientCount, smsUnits);

  const preview = fillTemplate(message, SAMPLE_VARS);

  const handleSend = async () => {
    setSending(true);
    setProgress(10);
    setResult(null);

    let phones: string[] = [];
    try {
      // Fetch phone numbers
      if (recipientType === 'custom') {
        phones = customNumbers
          .split('\n')
          .map((n) => n.trim())
          .filter(Boolean);
      } else if (recipientType === 'due') {
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
        const studentIds = [
          ...new Set((feeRows ?? []).map((f: any) => f.student_id).filter(Boolean)),
        ];
        if (studentIds.length > 0) {
          const { data: studs } = await supabase
            .from('students')
            .select('phone')
            .in('id', studentIds)
            .not('phone', 'is', null);
          phones = (studs ?? []).map((s: any) => s.phone).filter(Boolean);
        }
      } else {
        let q = supabase
          .from('students')
          .select('phone')
          .eq('status', 'active')
          .not('phone', 'is', null);
        if (recipientType === 'batch' && batchId) {
          q = q.eq('batch_id', batchId);
        }
        const { data } = await q;
        phones = (data ?? []).map((s: any) => s.phone).filter(Boolean);
      }

      setProgress(40);

      if (!phones.length) {
        toast.error('No recipients found');
        return;
      }

      if (hasUnresolvedTemplate(message)) {
        toast.error('Resolve all template variables before sending');
        return;
      }
      const uniquePhones = dedupeRecipients('sms', phones);
      const sendLimit = campaignLimitState(uniquePhones.length, smsUnits);
      if (sendLimit.overLimit) {
        toast.error(sendLimit.message);
        return;
      }
      const res = await sendSMS(uniquePhones, message, 'custom', {
        idempotencyKey: messagingIdempotencyKey(
          'sms-compose',
          `${recipientType}|${batchId}|${uniquePhones.join('|')}|${message}`
        ),
      });
      setProgress(100);
      setResult(res);
      notifyMessagingResult(res);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  };

  const resultTone = result ? messagingResultTone(result) : 'neutral';

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
        <p
          className={cn('text-xs', campaignState.overLimit ? 'text-red-300' : 'text-amber-300')}
          role={campaignState.overLimit ? 'alert' : undefined}
        >
          {campaignState.message}
        </p>
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
              if (e.target.value && templates[e.target.value]) {
                setMessage(templates[e.target.value]);
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
              {charCount} chars · {smsUnits} SMS unit{smsUnits > 1 ? 's' : ''}
            </span>
          </div>
          {hasUnresolvedTemplate(message) && (
            <p className="mt-2 text-xs text-amber-300" role="alert">
              Campaigns send one shared message. Replace every {'{placeholder}'} with final text
              before sending.
            </p>
          )}
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
        disabled={
          !message.trim() ||
          !recipientCount ||
          campaignState.overLimit ||
          hasUnresolvedTemplate(message)
        }
        className="btn-primary w-full justify-center"
      >
        <Send size={15} /> SMS পাঠান
      </button>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'card p-4 border text-center',
            resultTone === 'error' && 'border-red-400/30 bg-red-500/5',
            resultTone === 'warning' && 'border-amber-400/30 bg-amber-500/5',
            resultTone === 'success' && 'border-emerald-400/30 bg-emerald-500/5',
            resultTone === 'neutral' && 'border-slate-400/20'
          )}
        >
          <CheckCircle2
            size={28}
            className={cn(
              'mx-auto mb-2',
              resultTone === 'error'
                ? 'text-red-400'
                : resultTone === 'warning'
                  ? 'text-amber-400'
                  : resultTone === 'success'
                    ? 'text-emerald-400'
                    : 'text-slate-400'
            )}
          />
          <p
            className={cn(
              'font-semibold',
              resultTone === 'warning'
                ? 'text-amber-200'
                : resultTone === 'error'
                  ? 'text-red-200'
                  : resultTone === 'success'
                    ? 'text-emerald-200'
                    : 'text-white'
            )}
          >
            {formatMessagingResult(result)}
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
                  <p className="text-amber-300 text-xs mt-1">
                    Estimated cost: {campaignState.estimatedUnits.toLocaleString()} SMS units.
                    Multi-recipient sends are queued.
                  </p>
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
function TemplatesTab({
  templates,
  setTemplates,
  applyTemplate,
}: {
  templates: Record<string, string>;
  setTemplates: (update: (current: Record<string, string>) => Record<string, string>) => void;
  applyTemplate: (key: string) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

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
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => applyTemplate(t.key)}
                className="btn-outline text-xs py-1.5 px-3"
              >
                Apply Template
              </button>
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
  const [logs, setLogs] = useState<MessageJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [processingQueue, setProcessingQueue] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('message_jobs')
        .select(
          'id,channel,status,source_type,content,recipient_count,accepted_count,delivered_count,failed_count,bounced_count,unknown_count,created_at,message_deliveries(status)'
        )
        .eq('channel', 'sms')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        throw error;
      }
      setLogs((data ?? []) as MessageJobRow[]);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const processQueue = async () => {
    setProcessingQueue(true);
    try {
      const result = await processMessageQueue();
      if (result.processed > 0) {
        toast.success(`Queue processed: ${result.processed} deliveries`);
      } else {
        toast(`Queue check completed: no deliveries were processed`, { icon: '!' });
      }
      await load();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setProcessingQueue(false);
    }
  };

  const visibleLogs = logs.filter(
    (log) => statusFilter === 'all' || summarizeMessageJob(log).status === statusFilter
  );
  const badgeClass = (status: string) =>
    status === 'delivered' || status === 'accepted'
      ? 'badge-green text-xs'
      : status === 'queued' ||
          status === 'processing' ||
          status === 'partial' ||
          status === 'requires_review'
        ? 'badge-yellow text-xs'
        : 'badge-red text-xs';

  return (
    <div className="space-y-4">
      <div
        className="flex flex-col sm:flex-row gap-2 sm:items-center"
        data-testid="messaging-log-controls"
      >
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field py-1.5 text-sm sm:max-w-[160px]"
        >
          <option value="all">All Status</option>
          {[
            'queued',
            'processing',
            'accepted',
            'delivered',
            'partial',
            'requires_review',
            'failed',
          ].map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button onClick={() => void load()} className="btn-outline text-sm py-1.5 px-3">
          <RefreshCw size={13} /> Refresh
        </button>
        <button
          onClick={() => void processQueue()}
          disabled={processingQueue}
          className="btn-primary text-sm py-1.5 px-3"
        >
          {processingQueue ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}{' '}
          Process queue
        </button>
        <span className="text-slate-500 text-xs sm:ml-auto">{visibleLogs.length} jobs</span>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="divide-y divide-navy-700/30">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 mx-4 my-2 bg-navy-700 rounded animate-pulse" />
            ))}
          </div>
        ) : visibleLogs.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-10">No SMS jobs found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700/50">
                  {['Message', 'Source', 'Status', 'Actual counts', 'Time'].map((heading) => (
                    <th
                      key={heading}
                      className="text-left px-4 py-3 text-slate-400 font-medium text-xs whitespace-nowrap"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((log) => {
                  const summary = summarizeMessageJob(log);
                  return (
                    <tr key={log.id} className="border-b border-navy-700/30 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-slate-300 text-xs max-w-[280px] truncate">
                        {log.content?.body ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge-blue text-xs">{log.source_type}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={badgeClass(summary.status)}>{summary.status}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">
                        {summary.total} total · {summary.queued} queued · {summary.processing}{' '}
                        processing · {summary.accepted} accepted · {summary.delivered} delivered ·{' '}
                        {summary.failed} failed · {summary.unknown} unknown
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {log.created_at ? formatDate(log.created_at) : '—'}
                      </td>
                    </tr>
                  );
                })}
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
  return <MessagingProviderSettings />;
}

function EmailTab() {
  const { settings } = useSettingsStore();
  const [recipientType, setRecipientType] = useState<'all' | 'batch' | 'student' | 'custom'>('all');
  const [batchId, setBatchId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [batches, setBatches] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [customEmails, setCustomEmails] = useState('');
  const [recipientCount, setRecipientCount] = useState(0);
  const [subject, setSubject] = useState<string>(EMAIL_TEMPLATES.FEE_REMINDER.subject);
  const [body, setBody] = useState<string>(EMAIL_TEMPLATES.FEE_REMINDER.body);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<MessagingResponse | null>(null);
  useEffect(() => {
    Promise.all([
      supabase.from('batches').select('id,name').eq('is_active', true).order('name'),
      supabase
        .from('students')
        .select('id,name,email,batch_id')
        .eq('status', 'active')
        .eq('is_approved', true)
        .not('email', 'is', null)
        .order('name'),
    ]).then(([batchResult, studentResult]) => {
      setBatches(batchResult.data ?? []);
      setStudents(studentResult.data ?? []);
    });
  }, []);
  useEffect(() => {
    if (recipientType === 'custom') {
      setRecipientCount(
        dedupeRecipients(
          'email',
          customEmails
            .split(/\r?\n|,/)
            .map((x) => x.trim())
            .filter(Boolean)
        ).length
      );
      return;
    }
    if (recipientType === 'student') {
      setRecipientCount(studentId ? 1 : 0);
      return;
    }
    let query = supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .eq('is_approved', true)
      .not('email', 'is', null);
    if (recipientType === 'batch' && batchId) {
      query = query.eq('batch_id', batchId);
    }
    void query.then(({ count, error }) => {
      if (error) {
        handleSupabaseError(error);
        return;
      }
      setRecipientCount(count ?? 0);
    });
  }, [recipientType, batchId, studentId, customEmails]);
  const campaignState = campaignLimitState(recipientCount);
  const send = async () => {
    const list =
      recipientType === 'custom'
        ? customEmails
            .split(/\r?\n|,/)
            .map((v) => v.trim())
            .filter(Boolean)
        : recipientType === 'student'
          ? students.filter((s) => s.id === studentId).map((s) => s.email)
          : students
              .filter((s) => recipientType === 'all' || !batchId || s.batch_id === batchId)
              .map((s) => s.email);
    const uniqueEmails = dedupeRecipients('email', list);
    if (!uniqueEmails.length || !subject.trim() || !body.trim()) {
      toast.error('Recipients, subject and message are required');
      return;
    }
    const sendLimit = campaignLimitState(uniqueEmails.length);
    if (sendLimit.overLimit) {
      toast.error(sendLimit.message);
      return;
    }
    if (hasUnresolvedTemplate(subject) || hasUnresolvedTemplate(body)) {
      toast.error('Resolve all template variables before sending');
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const response = await sendEmail(
        uniqueEmails,
        subject,
        emailTemplate(subject, body, settings.centerName),
        'custom',
        {
          idempotencyKey: messagingIdempotencyKey(
            'email-compose',
            `${recipientType}|${batchId}|${uniqueEmails.join('|')}|${subject}|${body}`
          ),
        }
      );
      setResult(response);
      notifyMessagingResult(response);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSending(false);
    }
  };
  const resultTone = result ? messagingResultTone(result) : 'neutral';
  return (
    <div className="max-w-2xl card p-5 space-y-4">
      <h3 className="font-semibold text-white">Send Email</h3>
      <p className="text-xs text-slate-500">
        Email costs less than SMS. Choose recipients from live student data.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(
          [
            ['all', 'All with email'],
            ['batch', 'By batch'],
            ['student', 'One student'],
            ['custom', 'Custom'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setRecipientType(id)}
            className={cn(
              'btn-outline text-xs px-2 py-2',
              recipientType === id && 'border-sky-400 text-sky-400'
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {recipientType === 'batch' && (
        <select
          className="input-field"
          value={batchId}
          onChange={(e) => setBatchId(e.target.value)}
        >
          <option value="">All batches</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      {recipientType === 'student' && (
        <select
          className="input-field"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
        >
          <option value="">Select student</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.email}
            </option>
          ))}
        </select>
      )}
      {recipientType === 'custom' && (
        <textarea
          className="input-field"
          rows={3}
          placeholder="student@example.com"
          value={customEmails}
          onChange={(e) => setCustomEmails(e.target.value)}
        />
      )}
      <p className="text-xs text-sky-400">Recipients found: {recipientCount}</p>
      <p
        className={cn('text-xs', campaignState.overLimit ? 'text-red-300' : 'text-amber-300')}
        role={campaignState.overLimit ? 'alert' : undefined}
      >
        {campaignState.message}. Multi-recipient sends are queued.
      </p>
      <select
        className="input-field"
        onChange={(e) => {
          const t = EMAIL_TEMPLATES[e.target.value as keyof typeof EMAIL_TEMPLATES];
          if (t) {
            setSubject(t.subject);
            setBody(t.body);
          }
        }}
      >
        {Object.entries(EMAIL_TEMPLATES).map(([key, t]) => (
          <option key={key} value={key}>
            {t.label}
          </option>
        ))}
      </select>
      <input
        className="input-field"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
      />
      <textarea
        className="input-field font-hind"
        rows={8}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Email message"
      />
      {(hasUnresolvedTemplate(subject) || hasUnresolvedTemplate(body)) && (
        <p className="text-xs text-amber-300" role="alert">
          Campaigns send one shared email. Replace every {'{placeholder}'} with final text before
          sending.
        </p>
      )}
      <button
        className="btn-primary"
        disabled={
          sending ||
          campaignState.overLimit ||
          hasUnresolvedTemplate(subject) ||
          hasUnresolvedTemplate(body)
        }
        onClick={send}
      >
        {sending ? 'Sending…' : 'Send Email'}
      </button>
      {result && (
        <div
          className={cn(
            'rounded-lg border p-3 text-sm',
            resultTone === 'error'
              ? 'border-red-400/30 bg-red-500/5 text-red-200'
              : resultTone === 'warning'
                ? 'border-amber-400/30 bg-amber-500/5 text-amber-200'
                : resultTone === 'success'
                  ? 'border-emerald-400/30 bg-emerald-500/5 text-emerald-200'
                  : 'border-slate-400/20 text-slate-300'
          )}
          role="status"
        >
          {formatMessagingResult(result)}
        </div>
      )}
      <p className="text-xs text-slate-500">
        Configure `RESEND_API_KEY` and `RESEND_FROM` on hosting. The key never goes to the browser.
      </p>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SMSPage() {
  const [tab, setTab] = useState<Tab>('send');
  const [templates, setTemplates] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.values(SMS_TEMPLATES).map((template) => [template.key, template.body])
    )
  );
  const [appliedTemplateKey, setAppliedTemplateKey] = useState<string>();

  useEffect(() => {
    supabase
      .from('site_settings')
      .select('key,value')
      .like('key', 'sms_template_%')
      .then(({ data, error }) => {
        if (error) {
          handleSupabaseError(error);
          return;
        }
        setTemplates((current) => ({ ...current, ...savedSmsTemplates(data ?? []) }));
      }, handleSupabaseError);
  }, []);

  const applyTemplate = (key: string) => {
    setAppliedTemplateKey(key);
    setTab('send');
    toast.success('Template applied to the SMS composer');
  };

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

      {tab === 'send' && (
        <SendSMSTab
          key={appliedTemplateKey ?? 'composer'}
          templates={templates}
          initialTemplateKey={appliedTemplateKey}
        />
      )}
      {tab === 'email' && <EmailTab />}
      {tab === 'templates' && (
        <TemplatesTab
          templates={templates}
          setTemplates={setTemplates}
          applyTemplate={applyTemplate}
        />
      )}
      {tab === 'log' && <SMSLogTab />}
      {tab === 'settings' && <SMSSettingsTab />}
    </AdminLayout>
  );
}
