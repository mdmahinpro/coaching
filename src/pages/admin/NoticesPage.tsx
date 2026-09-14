import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { handleSupabaseError } from '@/utils/errorHandler';
import { Pin, Bell, Pencil, Trash2, Save, Send, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDate, cn, sanitize } from '@/lib/utils';
import { useSettingsStore } from '@/store/useSettingsStore';
import { sendSMS } from '@/lib/sms';
import { formatMessagingResult, messagingIdempotencyKey } from '@/lib/messaging';

interface Notice {
  id: string;
  title: string;
  content: string;
  type: string;
  category?: string;
  target: 'all' | 'batch';
  batch_id?: string;
  is_published: boolean;
  is_pinned: boolean;
  created_at: string;
  batch?: { name: string };
}

const NOTICE_TYPES = ['general', 'exam', 'fees', 'holiday', 'result', 'urgent', 'event'];
const TYPE_COLORS: Record<string, string> = {
  exam: 'badge-violet',
  holiday: 'badge-green',
  fees: 'badge-yellow',
  result: 'badge-blue',
  urgent: 'badge-red',
  event: 'badge-violet',
  general: 'badge-blue',
};

const NOTICE_TYPE_LABELS: Record<string, string> = {
  general: 'General',
  exam: 'Exam',
  fees: 'Fees',
  holiday: 'Holiday',
  result: 'Result',
  urgent: 'Urgent',
  event: 'Event',
};

const EMPTY: Partial<Notice> = {
  type: 'general',
  target: 'all',
  is_published: true,
  is_pinned: false,
};

export default function NoticesPage() {
  const { settings } = useSettingsStore();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Notice>>(EMPTY);
  const [isEdit, setIsEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendSMSFlag, setSendSMSFlag] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resultExams, setResultExams] = useState<any[]>([]);
  const [resultExamId, setResultExamId] = useState('');
  const [loadingResultExams, setLoadingResultExams] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('notices')
        .select('*, batch:batches(name)')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });
      const cleaned = (data ?? []).map((n: any) => ({
        ...n,
        title: sanitize(n.title),
        content: sanitize(n.content),
      }));
      setNotices(cleaned as Notice[]);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
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

  useEffect(() => {
    if (editing.type !== 'result') {
      return;
    }
    setLoadingResultExams(true);
    supabase
      .from('exams')
      .select('id,title,total_marks,status')
      .in('status', ['active', 'ended'])
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (!error) {setResultExams(data ?? []);}
        setLoadingResultExams(false);
      });
  }, [editing.type]);

  const generateResultNotice = async () => {
    if (!resultExamId) {
      toast.error('Select an exam first');
      return;
    }
    const exam = resultExams.find((e) => e.id === resultExamId);
    if (!exam) {return;}
    const { data: top } = await supabase
      .from('mcq_submissions')
      .select('score,student:students(name)')
      .eq('exam_id', resultExamId)
      .order('score', { ascending: false })
      .limit(1)
      .maybeSingle();
    const topName = (top as any)?.student?.name ?? 'সর্বোচ্চ স্কোরধারী শিক্ষার্থী';
    const score = top?.score ?? 0;
    const total = exam.total_marks ?? 0;
    setEditing((p) => ({
      ...p,
      title: `${exam.title} এর ফলাফল প্রকাশিত হয়েছে`,
      content: `${exam.title} এর ফলাফল প্রকাশিত হয়েছে। সর্বোচ্চ স্কোর: ${score}/${total} (${topName})। পোর্টালে লগইন করে ফলাফল দেখুন।`,
    }));
  };

  const resetForm = () => {
    setEditing(EMPTY);
    setIsEdit(false);
    setSendSMSFlag(false);
  };

  const openEdit = (n: Notice) => {
    setEditing({ ...n });
    setIsEdit(true);
  };

  const handleSave = async () => {
    if (!editing.title || !editing.content) {
      toast.error('Title and content are required');
      return;
    }
    if (editing.target === 'batch' && !editing.batch_id) {
      toast.error('Please select a batch for batch-targeted notices');
      return;
    }
    setSaving(true);
    const payload = {
      title: editing.title,
      content: editing.content,
        // `type` is the current column; older deployments may expose the same
        // value as `category`. Keep the saved vocabulary aligned with the
        // public Notice Board filters.
        type: editing.type ?? editing.category ?? 'general',
      target: editing.target ?? 'all',
      batch_id: editing.target === 'batch' ? (editing.batch_id ?? null) : null,
      is_published: editing.is_published ?? true,
      is_pinned: editing.is_pinned ?? false,
    };

    let error;
    if (isEdit && editing.id) {
      ({ error } = await supabase.from('notices').update(payload).eq('id', editing.id));
      if (!error) {
        toast.success('Notice updated');
      }
    } else {
      ({ error } = await supabase.from('notices').insert([payload]));
      if (!error) {
        toast.success('Notice published');
      }
    }
    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }

    // Send SMS
    if (sendSMSFlag && payload.is_published) {
      try {
        const preview =
          (editing.content ?? '').slice(0, 60) + ((editing.content?.length ?? 0) > 60 ? '…' : '');
        const msg = `📢 ${settings.centerName}: ${editing.title} — ${preview}`;
        let phones: string[] = [];
        if (payload.target === 'batch' && payload.batch_id) {
          const { data: students } = await supabase
            .from('students')
            .select('phone')
            .eq('batch_id', payload.batch_id)
            .eq('status', 'active')
            .not('phone', 'is', null);
          phones = (students ?? []).map((s) => s.phone).filter(Boolean);
        } else {
          const { data: students } = await supabase
            .from('students')
            .select('phone')
            .eq('status', 'active')
            .not('phone', 'is', null);
          phones = (students ?? []).map((s) => s.phone).filter(Boolean);
        }
        if (phones.length) {
          const delivery = await sendSMS(phones, msg, 'NOTICE', {
            idempotencyKey: messagingIdempotencyKey('notice', editing.id || `${editing.title}|${editing.content}`),
          });
          toast(`Notice SMS: ${formatMessagingResult(delivery)}`);
        }
      } catch (err) {
        handleSupabaseError(err);
      }
    }

    setSaving(false);
    resetForm();
    load();
  };

  const handleDelete = async () => {
    if (!deleteId) {
      return;
    }
    try {
      const { error } = await supabase.from('notices').delete().eq('id', deleteId);
      if (error) {
        toast.error('Delete failed');
        return;
      }
      toast.success('Notice deleted');
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setDeleteId(null);
      setDeleting(false);
      load();
    }
  };

  return (
    <AdminLayout title="নোটিশ বোর্ড">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Left: Create/Edit Form ───────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="card p-5 space-y-4 lg:sticky lg:top-20">
            <h3 className="font-inter font-bold text-white text-sm flex items-center gap-2">
              <Bell size={15} className="text-sky-400" />
              {isEdit ? 'Edit Notice' : 'New Notice'}
            </h3>

            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Title *</label>
              <input
                value={editing.title ?? ''}
                onChange={(e) => setEditing((p) => ({ ...p, title: e.target.value }))}
                className="input-field"
                placeholder="Notice title…"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Body *</label>
              <textarea
                value={editing.content ?? ''}
                onChange={(e) => setEditing((p) => ({ ...p, content: e.target.value }))}
                className="input-field"
                rows={5}
                placeholder="Notice content…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Type</label>
                <select
                  value={editing.type ?? 'general'}
                  onChange={(e) => setEditing((p) => ({ ...p, type: e.target.value }))}
                  className="input-field capitalize"
                >
                  {NOTICE_TYPES.map((t) => (
                    <option key={t} value={t} className="capitalize">
                      {NOTICE_TYPE_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Target</label>
                <select
                  value={editing.target ?? 'all'}
                  onChange={(e) =>
                    setEditing((p) => ({ ...p, target: e.target.value as 'all' | 'batch' }))
                  }
                  className="input-field"
                >
                  <option value="all">All Students</option>
                  <option value="batch">Specific Batch</option>
                </select>
              </div>
            </div>

            {editing.target === 'batch' && (
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Batch</label>
                <select
                  value={editing.batch_id ?? ''}
                  onChange={(e) => setEditing((p) => ({ ...p, batch_id: e.target.value }))}
                  className="input-field"
                >
                  <option value="">Select batch…</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {editing.type === 'result' && (
              <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 p-3 space-y-2">
                <label className="text-xs text-slate-400 block">Generate from exam result</label>
                <div className="flex gap-2">
                  <select
                    value={resultExamId}
                    onChange={(e) => setResultExamId(e.target.value)}
                    className="input-field text-sm flex-1"
                    disabled={loadingResultExams}
                  >
                    <option value="">Select published exam…</option>
                    {resultExams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                  </select>
                  <button type="button" onClick={generateResultNotice} className="btn-outline text-xs px-3">
                    Generate
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">Uses the highest real submission from the database.</p>
              </div>
            )}

            <div className="space-y-2">
              {[
                { key: 'is_published', label: 'Publish immediately' },
                { key: 'is_pinned', label: 'Pin to top' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!(editing as any)[key]}
                    onChange={(e) => setEditing((p) => ({ ...p, [key]: e.target.checked }))}
                    className="rounded accent-sky-400 w-4 h-4"
                  />
                  <span className="text-slate-300 text-sm">{label}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendSMSFlag}
                  onChange={(e) => setSendSMSFlag(e.target.checked)}
                  className="rounded accent-violet-400 w-4 h-4"
                />
                <span className="text-slate-300 text-sm flex items-center gap-1">
                  <Send size={12} className="text-violet-400" /> SMS students on publish
                </span>
              </label>
            </div>

            <div className="flex gap-2">
              {isEdit && (
                <button onClick={resetForm} className="btn-outline text-sm py-2 px-3">
                  <X size={13} />
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary text-sm flex-1 justify-center"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {isEdit ? 'Update' : 'Publish Notice'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Right: Notices list ──────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 card animate-pulse" />
            ))
          ) : notices.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-slate-500">No notices yet</p>
            </div>
          ) : (
            notices.map((n) => (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'card p-4 border-l-2',
                  n.is_pinned ? 'border-l-sky-400' : 'border-l-transparent'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className={cn(
                        'p-1.5 rounded-lg shrink-0 mt-0.5',
                        n.is_pinned ? 'bg-sky-400/15' : 'bg-white/5'
                      )}
                    >
                      {n.is_pinned ? (
                        <Pin size={13} className="text-sky-400" />
                      ) : (
                        <Bell size={13} className="text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <h3 className="font-semibold text-white text-sm">{n.title}</h3>
                        <span
                          className={cn(TYPE_COLORS[n.type] ?? 'badge-blue', 'text-xs capitalize')}
                        >
                          {n.type}
                        </span>
                        {n.is_pinned && <span className="badge-blue text-xs">Pinned</span>}
                        {!n.is_published && <span className="badge-yellow text-xs">Draft</span>}
                        <span className="text-slate-600 text-xs">
                          {n.target === 'batch' && n.batch?.name ? n.batch.name : 'All'}
                        </span>
                      </div>
                      <p className="text-slate-400 text-sm line-clamp-2 font-hind">{n.content}</p>
                      <p className="text-slate-600 text-xs mt-1">{formatDate(n.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(n)}
                      className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-500 hover:text-sky-400 transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeleteId(n.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setDeleteId(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.93 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.93 }}
              className="relative card-glass p-6 w-full max-w-sm z-10 text-center"
            >
              <Trash2 size={28} className="text-red-400 mx-auto mb-3" />
              <p className="font-semibold text-white mb-4">Delete this notice?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteId(null)}
                  className="btn-outline flex-1 justify-center text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="btn-danger flex-1 justify-center text-sm"
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}{' '}
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AdminLayout>
  );
}
