import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { handleSupabaseError } from '@/utils/errorHandler';
import { cn, formatDate, sanitize } from '@/lib/utils';
import { parseBulkQuestions } from '@/lib/bulkQuestionParser';
import { useSettingsStore } from '@/store/useSettingsStore';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  Plus,
  Trash2,
  X,
  Save,
  Play,
  Pause,
  Square,
  Clock,
  Share2,
  Trophy,
  Download,
  GripVertical,
  Upload,
  Eye,
  Loader2,
  CheckCircle2,
  XCircle,
  BarChart2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Exam {
  id: string;
  title: string;
  subject: string;
  batch_id?: string;
  batch?: { name: string };
  exam_date: string;
  duration_minutes: number;
  total_marks: number;
  pass_marks: number;
  type: string;
  instructions?: string;
  status?: 'draft' | 'upcoming' | 'active' | 'paused' | 'ended';
  start_time?: string;
  end_time?: string;
  timer_enabled?: boolean;
  paused_remaining_seconds?: number;
}

interface Question {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: 'A' | 'B' | 'C' | 'D';
  marks: number;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string; dot?: boolean }> = {
  draft: { label: 'Draft', cls: 'badge-yellow' },
  active: { label: 'চলছে', cls: 'badge-green', dot: true },
  paused: { label: 'বিরতি', cls: 'badge-yellow' },
  ended: { label: 'শেষ', cls: 'badge-red' },
};

const TABS = ['all', 'create', 'results'] as const;
type Tab = (typeof TABS)[number];

const mkId = () => Math.random().toString(36).slice(2, 10);
const fmtTime = (s: number) => {
  const m = Math.floor(Math.abs(s) / 60)
    .toString()
    .padStart(2, '0');
  const ss = (Math.abs(s) % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
};

// ── Timer Modal ───────────────────────────────────────────────────────────────
function TimerModal({
  exam,
  onClose,
  onUpdate,
}: {
  exam: Exam;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [status, setStatus] = useState(exam.status ?? 'draft');
  const [remaining, setRemaining] = useState(0);
  const [subCount, setSubCount] = useState(0);
  const [customMin, setCustomMin] = useState(String(exam.duration_minutes));
  const [loading, setLoading] = useState<string | null>(null);

  // Compute remaining
  useEffect(() => {
    const calc = () => {
      if (status === 'active' && exam.end_time) {
        setRemaining(
          Math.max(0, Math.floor((new Date(exam.end_time).getTime() - Date.now()) / 1000))
        );
      } else if (status === 'paused') {
        setRemaining(exam.paused_remaining_seconds ?? exam.duration_minutes * 60);
      } else {
        setRemaining(exam.duration_minutes * 60);
      }
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [status, exam]);

  // Submission count
  useEffect(() => {
    supabase
      .from('mcq_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('exam_id', exam.id)
      .then(
        ({ count }) => setSubCount(count ?? 0),
        (err: any) => {
          handleSupabaseError(err);
        }
      );
    const ch = supabase
      .channel(`timer-subs-${exam.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'mcq_submissions',
          filter: `exam_id=eq.${exam.id}`,
        },
        () => setSubCount((p) => p + 1)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [exam.id]);

  const doUpdate = async (patch: Record<string, unknown>, newStatus: string) => {
    setLoading(newStatus);
    try {
      const { error } = await supabase.from('exams').update(patch).eq('id', exam.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      setStatus(newStatus as NonNullable<Exam['status']>);
      onUpdate();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(null);
    }
  };

  const handleStart = () => {
    const mins = Number(customMin);
    const duration = mins && mins >= 1 ? mins : exam.duration_minutes;
    doUpdate(
      {
        status: 'active',
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + duration * 60000).toISOString(),
        ...(duration !== exam.duration_minutes && { duration_minutes: duration }),
      },
      'active'
    );
  };

  const handlePause = () =>
    doUpdate(
      {
        status: 'paused',
        paused_remaining_seconds: remaining,
      },
      'paused'
    );

  const handleResume = () =>
    doUpdate(
      {
        status: 'active',
        end_time: new Date(Date.now() + remaining * 1000).toISOString(),
      },
      'active'
    );

  const handleEnd = () => doUpdate({ status: 'ended' }, 'ended');

  const handleApplyTime = () => {
    const mins = Number(customMin);
    if (!mins || mins < 1) {
      toast.error('Enter valid minutes');
      return;
    }
    const patch: Record<string, unknown> = { duration_minutes: mins };
    if (status === 'active') {
      patch.end_time = new Date(Date.now() + mins * 60000).toISOString();
    }
    doUpdate(patch, status);
  };

  const examLink = `${window.location.origin}/exam/${exam.id}`;
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93 }}
        className="relative card-glass w-full max-w-md z-10 p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-inter font-bold text-white">{exam.title}</h2>
            <span className={cn(cfg.cls, 'text-xs inline-flex items-center gap-1')}>
              {cfg.dot && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              {cfg.label}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Timer display */}
        <div className="text-center py-4">
          {status === 'draft' ? (
            <p className="text-slate-400 text-2xl font-medium">Not Started</p>
          ) : status === 'ended' ? (
            <p className="text-red-400 text-3xl font-inter font-black">Ended</p>
          ) : (
            <p
              className={cn(
                'font-inter font-black text-6xl tabular-nums tracking-tight transition-colors',
                remaining < 60
                  ? 'text-red-400 animate-pulse'
                  : remaining < 300
                    ? 'text-amber-400'
                    : 'text-sky-400'
              )}
            >
              {fmtTime(remaining)}
            </p>
          )}
          <p className="text-slate-500 text-xs mt-2">{subCount} students submitted</p>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-2 gap-2">
          {status === 'draft' && (
            <button
              onClick={handleStart}
              disabled={!!loading}
              className="btn-primary col-span-2 justify-center text-sm"
            >
              {loading === 'active' ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Play size={15} />
              )}{' '}
              Start Exam
            </button>
          )}
          {status === 'active' && (
            <>
              <button
                onClick={handlePause}
                disabled={!!loading}
                className="btn-outline justify-center text-sm"
              >
                {loading === 'paused' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Pause size={14} />
                )}{' '}
                Pause
              </button>
              <button
                onClick={handleEnd}
                disabled={!!loading}
                className="btn-danger justify-center text-sm"
              >
                {loading === 'ended' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Square size={14} />
                )}{' '}
                End Exam
              </button>
            </>
          )}
          {status === 'paused' && (
            <>
              <button
                onClick={handleResume}
                disabled={!!loading}
                className="btn-primary justify-center text-sm"
              >
                {loading === 'active' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}{' '}
                Resume
              </button>
              <button
                onClick={handleEnd}
                disabled={!!loading}
                className="btn-danger justify-center text-sm"
              >
                <Square size={14} /> End Exam
              </button>
            </>
          )}
          {status === 'ended' && (
            <p className="col-span-2 text-center text-slate-400 text-sm py-2">
              Exam has ended. No more submissions.
            </p>
          )}
        </div>

        {/* Custom time */}
        {status !== 'ended' && (
          <div className="flex gap-2 items-center">
            <Clock size={14} className="text-slate-500 shrink-0" />
            <input
              type="number"
              value={customMin}
              onChange={(e) => setCustomMin(e.target.value)}
              className="input-field py-1.5 text-sm"
              placeholder="Minutes"
            />
            <button
              onClick={handleApplyTime}
              disabled={!!loading}
              className="btn-outline text-sm py-1.5 px-3 whitespace-nowrap"
            >
              Apply
            </button>
          </div>
        )}

        {/* Share link */}
        <div className="card p-3 space-y-2">
          <p className="text-xs text-slate-500">Exam Link</p>
          <p className="font-mono text-sky-400 text-xs truncate">{examLink}</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(examLink);
                toast.success('Copied!');
              }}
              className="btn-outline text-xs py-1.5 flex-1 justify-center"
            >
              Copy Link
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`পরীক্ষার লিংক: ${examLink}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline text-xs py-1.5 flex-1 justify-center text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
            >
              <Share2 size={12} /> WhatsApp
            </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Bulk Import Modal ─────────────────────────────────────────────────────────
function BulkImportModal({
  onImport,
  onClose,
}: {
  onImport: (qs: Question[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Question[]>([]);

  // #6: shared pure parser — blank lines AND `---` separate questions, with
  // keyed-field association so a trailing MARKS after a blank line stays with
  // its question. Unit-tested in src/lib/bulkQuestionParser.test.ts.
  const parse = () => {
    const parsed = parseBulkQuestions(text, { nextId: mkId });
    setPreview(parsed as Question[]);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.93 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative card-glass w-full max-w-xl z-10 p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-inter font-bold text-white">Bulk Import Questions</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="card p-3 mb-3 text-xs text-slate-400 font-mono leading-relaxed">
          Q: প্রশ্নের টেক্সট
          <br />
          A: অপশন এ<br />
          B: অপশন বি
          <br />
          C: অপশন সি
          <br />
          D: অপশন ডি
          <br />
          ANS: B<br />
          MARKS: 1<br />
          ---
          <br />
          (next question)
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="input-field font-mono text-xs"
          rows={10}
          placeholder="Paste questions here…"
        />
        <div className="flex gap-3 mt-4">
          <button onClick={parse} className="btn-outline flex-1 justify-center text-sm">
            <Eye size={14} /> Preview ({preview.length})
          </button>
          {preview.length > 0 && (
            <button
              onClick={() => {
                onImport(preview);
                onClose();
              }}
              className="btn-primary flex-1 justify-center text-sm"
            >
              <Upload size={14} /> Import {preview.length} Questions
            </button>
          )}
        </div>
        {preview.length > 0 && (
          <div className="mt-4 space-y-2">
            {preview.map((q, i) => (
              <div key={q.id} className="card p-3">
                <p className="text-sky-400 text-xs mb-1">
                  Q{i + 1} · {q.marks} marks
                </p>
                <p className="text-white text-sm">{q.question_text}</p>
                <div className="grid grid-cols-2 gap-1 mt-2">
                  {(['a', 'b', 'c', 'd'] as const).map((o) => (
                    <p
                      key={o}
                      className={cn(
                        'text-xs px-2 py-1 rounded',
                        q.correct_option === o.toUpperCase()
                          ? 'bg-emerald-400/15 text-emerald-400'
                          : 'text-slate-400'
                      )}
                    >
                      {o.toUpperCase()}: {q[`option_${o}` as keyof Question] as string}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── All Exams Tab ─────────────────────────────────────────────────────────────
function AllExamsTab({ onTabChange }: { onTabChange: (t: Tab) => void }) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [timerExam, setTimerExam] = useState<Exam | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Exam | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('exams')
        .select('*, batch:batches(name)')
        .order('created_at', { ascending: false });
      setExams((data ?? []) as Exam[]);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      const { error: e1 } = await supabase
        .from('mcq_submissions')
        .delete()
        .eq('exam_id', deleteTarget.id);
      if (e1) {
        toast.error('Failed to delete submissions: ' + e1.message);
        setDeleting(false);
        return;
      }
      const { error: e2 } = await supabase
        .from('mcq_questions')
        .delete()
        .eq('exam_id', deleteTarget.id);
      if (e2) {
        toast.error('Failed to delete questions: ' + e2.message);
        setDeleting(false);
        return;
      }
      const { error: e3 } = await supabase.from('exams').delete().eq('id', deleteTarget.id);
      if (e3) {
        toast.error('Failed to delete exam: ' + e3.message);
        setDeleting(false);
        return;
      }
      toast.success('Exam deleted');
      setDeleteTarget(null);
      load();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setDeleting(false);
    }
  };

  // Start a not-started exam directly from the list: flip to 'active' and open
  // the timer window from now. Mirrors TimerModal's own Start button so drafts
  // are findable and startable at a glance.
  const handleStart = async (exam: Exam) => {
    const duration = (exam.duration_minutes ?? 30) * 60000;
    const { error } = await supabase
      .from('exams')
      .update({
        status: 'active',
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + duration).toISOString(),
      })
      .eq('id', exam.id);
    if (error) {
      toast.error('Failed to start exam: ' + error.message);
      return;
    }
    toast.success(`"${exam.title}" started`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => onTabChange('create')} className="btn-primary text-sm">
          <Plus size={15} /> Create Exam
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 card animate-pulse" />
          ))}
        </div>
      ) : exams.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-slate-400">No exams yet. Create your first exam!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {exams.map((exam) => {
            const st = exam.status ?? 'draft';
            const cfg = STATUS_CONFIG[st] ?? STATUS_CONFIG.draft;
            const examLink = `${window.location.origin}/exam/${exam.id}`;
            return (
              <div key={exam.id} className="card p-4 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-white truncate">{exam.title}</h3>
                    <span className={cn(cfg.cls, 'text-xs inline-flex items-center gap-1')}>
                      {cfg.dot && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      )}
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="badge-blue text-xs">{exam.subject}</span>
                    {exam.batch?.name && (
                      <span className="text-slate-500 text-xs">{exam.batch.name}</span>
                    )}
                    <span className="text-slate-500 text-xs">
                      {exam.duration_minutes}m · {exam.total_marks} marks
                    </span>
                    <span className="text-slate-600 text-xs">{formatDate(exam.exam_date)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {(st === 'draft' || st === 'upcoming') && (
                    <button
                      onClick={() => handleStart(exam)}
                      title="Start Exam"
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors text-xs font-medium flex items-center gap-1"
                    >
                      <Play size={12} /> Start
                    </button>
                  )}
                  <button
                    onClick={() => setTimerExam(exam)}
                    title="Manage Timer"
                    className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-400 hover:text-sky-400 transition-colors"
                  >
                    <Clock size={14} />
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(examLink);
                      toast.success('Link copied!');
                    }}
                    title="Copy Link"
                    className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-400 hover:text-sky-400 transition-colors"
                  >
                    <Share2 size={14} />
                  </button>
                  {(st === 'draft' || !st) && (
                    <button
                      onClick={() => setDeleteTarget(exam)}
                      title="Delete"
                      className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Timer Modal */}
      <AnimatePresence>
        {timerExam && (
          <TimerModal
            exam={timerExam}
            onClose={() => setTimerExam(null)}
            onUpdate={() => {
              load();
              supabase
                .from('exams')
                .select('*, batch:batches(name)')
                .eq('id', timerExam.id)
                .single()
                .then(
                  ({ data }) => data && setTimerExam(data as Exam),
                  (err: any) => {
                    handleSupabaseError(err);
                  }
                );
            }}
          />
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setDeleteTarget(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.93 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.93 }}
              className="relative card-glass w-full max-w-sm z-10 p-6 text-center"
            >
              <Trash2 size={28} className="text-red-400 mx-auto mb-3" />
              <p className="font-semibold text-white mb-1">Delete Exam?</p>
              <p className="text-slate-400 text-sm mb-5">
                &quot;{deleteTarget.title}&quot; and all its questions will be permanently deleted.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="btn-outline flex-1 justify-center text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="btn-danger flex-1 justify-center text-sm"
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}{' '}
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Question Card ─────────────────────────────────────────────────────────────
const OPTS = ['A', 'B', 'C', 'D'] as const;
const OPT_COLORS: Record<string, string> = { A: 'sky', B: 'violet', C: 'emerald', D: 'amber' };

function QuestionCard({
  q,
  idx,
  onChange,
  onDelete,
}: {
  q: Question;
  idx: number;
  onChange: (id: string, field: keyof Question, value: unknown) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Reorder.Item key={q.id} value={q} className="card p-4 space-y-3 cursor-default select-none">
      <div className="flex items-start gap-3">
        <div className="p-1 text-slate-600 cursor-grab active:cursor-grabbing mt-0.5">
          <GripVertical size={16} />
        </div>
        <span className="shrink-0 w-6 h-6 rounded-full bg-sky-400/15 text-sky-400 text-xs font-bold flex items-center justify-center">
          {idx + 1}
        </span>
        <textarea
          value={q.question_text}
          onChange={(e) => onChange(q.id, 'question_text', e.target.value)}
          className="input-field flex-1 text-sm"
          rows={2}
          placeholder={`Question ${idx + 1} text…`}
        />
        <button
          type="button"
          onClick={() => onDelete(q.id)}
          className="p-1 text-slate-600 hover:text-red-400 mt-1 shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 ml-9">
        {OPTS.map((o) => {
          const key = `option_${o.toLowerCase()}` as keyof Question;
          const c = OPT_COLORS[o];
          return (
            <div key={o} className="flex items-center gap-2">
              <span
                className={`w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0 bg-${c}-400/10 text-${c}-400`}
              >
                {o}
              </span>
              <input
                type="text"
                value={q[key] as string}
                onChange={(e) => onChange(q.id, key, e.target.value)}
                className="input-field text-sm py-1.5 flex-1"
                placeholder={`Option ${o}`}
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between ml-9">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500 text-xs mr-1">Correct:</span>
          {OPTS.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onChange(q.id, 'correct_option', o)}
              className={cn(
                'w-8 h-7 rounded-md text-xs font-bold border transition-all',
                q.correct_option === o
                  ? 'bg-sky-400 border-sky-400 text-navy-900'
                  : 'border-white/20 text-slate-400 hover:border-sky-400/50 hover:text-white'
              )}
            >
              {o}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 text-xs">Marks:</span>
          <input
            type="number"
            min={1}
            value={q.marks}
            onChange={(e) => onChange(q.id, 'marks', Number(e.target.value))}
            className="input-field w-16 py-1 text-sm text-center"
          />
        </div>
      </div>
    </Reorder.Item>
  );
}

// ── Create Exam Tab ───────────────────────────────────────────────────────────
function CreateExamTab({ batches, onDone }: { batches: any[]; onDone: () => void }) {
  const { settings } = useSettingsStore();
  const [step, setStep] = useState(1);
  // Pre-fill default duration/strict-mode from site settings (read once — do
  // NOT re-sync here or the form would fight the admin while they type).
  const [info, setInfo] = useState({
    title: '',
    subject: '',
    // Multi-batch targeting: array of batch ids; empty = All Batches.
    batch_ids: [] as string[],
    exam_date: '',
    exam_time: '09:00',
    duration_minutes: settings.defaultExamDuration,
    timer_enabled: true,
    // Strict Mode: enables red-card (tab-minimize) penalties. Default OFF.
    strict_mode: settings.defaultStrictMode,
    pass_marks: 10,
    instructions: '',
  });
  const [questions, setQuestions] = useState<Question[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedExam, setSavedExam] = useState<{
    id: string;
    title: string;
    published?: boolean;
  } | null>(null);

  const addQuestion = () =>
    setQuestions((prev) => [
      ...prev,
      {
        id: mkId(),
        question_text: '',
        option_a: '',
        option_b: '',
        option_c: '',
        option_d: '',
        correct_option: 'A',
        marks: 1,
      },
    ]);

  const updateQ = (id: string, field: keyof Question, value: unknown) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, [field]: value } : q)));

  const deleteQ = (id: string) => setQuestions((prev) => prev.filter((q) => q.id !== id));

  const totalMarks = questions.reduce((s, q) => s + q.marks, 0);

  const handleSave = async (publish = false) => {
    if (!info.title || !info.subject || !info.exam_date) {
      toast.error('Fill in all required fields');
      return;
    }
    setSaving(true);
    const now = new Date();
    // #10a auto-start: an exam becomes joinable when its wall-clock start_time
    // arrives (enforced server-side in _exam_gate). Publish = start now;
    // "Save as Draft" with a real date/time = schedule for that datetime
    // (status 'upcoming'); active/paused/ended existing exams keep working.
    const durationMs = info.duration_minutes * 60000;
    const examineeStart = new Date(`${info.exam_date}T${info.exam_time}:00`);
    const examStatus = publish
      ? 'active'
      : examineeStart > now
        ? 'upcoming'
        : 'draft';
    const startTime = publish ? now.toISOString() : examineeStart.toISOString();
    const endTime = publish
      ? new Date(now.getTime() + durationMs).toISOString()
      : new Date(examineeStart.getTime() + durationMs).toISOString();
    const { data: exam, error: eErr } = await supabase
      .from('exams')
      .insert([
        {
          title: info.title,
          subject: info.subject,
          // batch_ids holds the full assignment ([] -> NULL = all batches);
          // batch_id keeps the first selection for back-compat joins.
          batch_ids: info.batch_ids.length > 0 ? info.batch_ids : null,
          batch_id: info.batch_ids[0] ?? null,
          exam_date: `${info.exam_date}T${info.exam_time}:00`,
          duration_minutes: info.duration_minutes,
          timer_enabled: info.timer_enabled,
          // Strict Mode gates the red-card penalty; default OFF.
          strict_mode: info.strict_mode,
          pass_marks: info.pass_marks,
          total_marks: totalMarks,
          instructions: info.instructions,
          status: examStatus,
          start_time: startTime,
          end_time: endTime,
          type: 'mcq',
        },
      ])
      .select()
      .single();
    if (eErr || !exam) {
      toast.error(eErr?.message ?? 'Save failed');
      setSaving(false);
      return;
    }

    if (questions.length > 0) {
      const { error: qErr } = await supabase.from('mcq_questions').insert(
        questions.map((q, i) => ({
          exam_id: exam.id,
          question_text: q.question_text,
          option_a: q.option_a,
          option_b: q.option_b,
          option_c: q.option_c,
          option_d: q.option_d,
          correct_option: q.correct_option.toLowerCase(),
          marks: q.marks,
          order_num: i + 1,
        }))
      );
      if (qErr) {
        toast.error('Failed to save questions: ' + qErr.message);
        setSaving(false);
        return;
      }
    }

    setSavedExam({ id: exam.id, title: exam.title, published: publish });
    toast.success(publish ? 'Exam published and now live!' : 'Exam saved as draft!');
    setSaving(false);
  };

  if (savedExam) {
    const link = `${window.location.origin}/exam/${savedExam.id}`;
    return (
      <div className="max-w-md mx-auto mt-10 card p-8 text-center space-y-4">
        <CheckCircle2 size={40} className="text-emerald-400 mx-auto" />
        <h3 className="font-inter font-bold text-xl text-white">{savedExam.title}</h3>
        <p className="text-slate-400 text-sm">
          {savedExam.published
            ? 'Exam is now live — students can join immediately.'
            : 'Exam saved as Draft. Use the Timer from All Exams tab to activate it.'}
        </p>
        <div className="card p-3 text-left">
          <p className="text-xs text-slate-500 mb-1">Share Link</p>
          <p className="font-mono text-sky-400 text-xs break-all">{link}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              navigator.clipboard.writeText(link);
              toast.success('Copied!');
            }}
            className="btn-outline flex-1 justify-center text-sm"
          >
            Copy Link
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`পরীক্ষার লিংক: ${link}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline flex-1 justify-center text-sm text-emerald-400 border-emerald-400/30"
          >
            <Share2 size={13} /> WhatsApp
          </a>
        </div>
        <button
          onClick={() => {
            setSavedExam(null);
            setStep(1);
            setInfo({
              title: '',
              subject: '',
              batch_ids: [],
              exam_date: '',
              exam_time: '09:00',
              duration_minutes: 30,
              timer_enabled: true,
              strict_mode: false,
              pass_marks: 10,
              instructions: '',
            });
            setQuestions([]);
            onDone();
          }}
          className="text-slate-400 text-sm hover:text-white"
        >
          ← Back to All Exams
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Step dots */}
      <div className="flex items-center gap-2 mb-8">
        {['Exam Info', 'Questions', 'Preview & Save'].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => (i + 1 < step || step > 1 ? setStep(i + 1) : undefined)}
              className={cn(
                'w-8 h-8 rounded-full text-sm font-bold border-2 transition-all',
                step === i + 1
                  ? 'bg-sky-400 border-sky-400 text-navy-900'
                  : step > i + 1
                    ? 'bg-sky-400/20 border-sky-400/40 text-sky-400'
                    : 'bg-transparent border-white/20 text-slate-500'
              )}
            >
              {step > i + 1 ? '✓' : i + 1}
            </button>
            <span
              className={cn(
                'text-sm hidden sm:block',
                step === i + 1 ? 'text-white' : 'text-slate-500'
              )}
            >
              {s}
            </span>
            {i < 2 && (
              <div
                className={cn(
                  'h-px w-8 transition-colors',
                  step > i + 1 ? 'bg-sky-400/40' : 'bg-white/10'
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1 — Info */}
      {step === 1 && (
        <div className="card p-6 space-y-4">
          <h3 className="font-semibold text-white">Exam Information</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-slate-400 mb-1.5 block">Exam Title *</label>
              <input
                value={info.title}
                onChange={(e) => setInfo((p) => ({ ...p, title: e.target.value }))}
                className="input-field"
                placeholder="e.g. Monthly MCQ Test"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Subject *</label>
              <input
                value={info.subject}
                onChange={(e) => setInfo((p) => ({ ...p, subject: e.target.value }))}
                className="input-field"
                placeholder="Mathematics"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-2 block">
                Batches <span className="text-slate-600">(pick one or more)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setInfo((p) => ({
                      ...p,
                      // Strictly requires the exam to appear for a batch; empty
                      // selection = unassigned = hidden from ALL students, so
                      // "All Batches" expands to every active batch's ID.
                      batch_ids: batches.map((b) => b.id),
                    }))
                  }
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                    batches.length > 0 && info.batch_ids.length === batches.length
                      ? 'bg-sky-500/20 border-sky-400/40 text-sky-400'
                      : 'border-white/10 text-slate-400 hover:border-white/20'
                  )}
                >
                  All Batches
                </button>
                {batches.map((b) => {
                  const on = info.batch_ids.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() =>
                        setInfo((p) => ({
                          ...p,
                          batch_ids: on
                            ? p.batch_ids.filter((id) => id !== b.id)
                            : [...p.batch_ids, b.id],
                        }))
                      }
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                        on
                          ? 'bg-violet-500/20 border-violet-400/40 text-violet-300'
                          : 'border-white/10 text-slate-400 hover:border-white/20'
                      )}
                    >
                      {on && <span className="mr-1">✓</span>}
                      {b.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-slate-600 text-xs mt-1.5">
                {info.batch_ids.length === 0
                  ? '⚠ No batch selected — students will NOT see this exam'
                  : `Only ${info.batch_ids.length} batch(es) will see this exam`}
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Exam Date *</label>
              <input
                type="date"
                value={info.exam_date}
                onChange={(e) => setInfo((p) => ({ ...p, exam_date: e.target.value }))}
                className="input-field"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Time</label>
              <input
                type="time"
                value={info.exam_time}
                onChange={(e) => setInfo((p) => ({ ...p, exam_time: e.target.value }))}
                className="input-field"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Duration (minutes)</label>
              <input
                type="number"
                min={1}
                value={info.duration_minutes}
                onChange={(e) =>
                  setInfo((p) => ({ ...p, duration_minutes: Number(e.target.value) }))
                }
                className="input-field"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Pass Marks</label>
              <input
                type="number"
                min={0}
                value={info.pass_marks}
                onChange={(e) => setInfo((p) => ({ ...p, pass_marks: Number(e.target.value) }))}
                className="input-field"
              />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={info.timer_enabled}
                  onChange={(e) => setInfo((p) => ({ ...p, timer_enabled: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-navy-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500" />
              </label>
              <span className="text-sm text-slate-300">
                Timer Enabled (countdown visible to students)
              </span>
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={info.strict_mode}
                  onChange={(e) => setInfo((p) => ({ ...p, strict_mode: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-navy-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500" />
              </label>
              <span className="text-sm text-slate-300">
                Strict Mode (deduct 10% of total marks per tab-minimize red card)
              </span>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-400 mb-1.5 block">Instructions</label>
              <textarea
                value={info.instructions}
                onChange={(e) => setInfo((p) => ({ ...p, instructions: e.target.value }))}
                className="input-field"
                rows={3}
                placeholder="Exam rules and instructions…"
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={() => {
                if (!info.title || !info.subject || !info.exam_date) {
                  toast.error('Fill required fields');
                  return;
                }
                setStep(2);
              }}
              className="btn-primary"
            >
              Next: Add Questions →
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Questions */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white">Questions</h3>
              <p className="text-slate-500 text-xs">
                Total Marks: <span className="text-sky-400 font-bold">{totalMarks}</span> ·{' '}
                {questions.length} questions
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setBulkOpen(true)} className="btn-outline text-sm py-1.5 px-3">
                <Upload size={13} /> Bulk Import
              </button>
              <button onClick={addQuestion} className="btn-primary text-sm py-1.5 px-3">
                <Plus size={13} /> প্রশ্ন যোগ করুন
              </button>
            </div>
          </div>

          {questions.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-slate-400 mb-4">
                No questions yet. Add questions or use bulk import.
              </p>
              <button onClick={addQuestion} className="btn-primary mx-auto">
                <Plus size={15} /> Add First Question
              </button>
            </div>
          ) : (
            <Reorder.Group
              values={questions}
              onReorder={setQuestions}
              axis="y"
              className="space-y-3"
            >
              {questions.map((q, i) => (
                <QuestionCard key={q.id} q={q} idx={i} onChange={updateQ} onDelete={deleteQ} />
              ))}
            </Reorder.Group>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(1)} className="btn-outline text-sm">
              ← Back
            </button>
            <button onClick={() => setStep(3)} className="btn-primary text-sm ml-auto">
              Next: Preview →
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Preview */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="font-inter font-bold text-white text-xl mb-1">{info.title}</h2>
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="badge-blue">{info.subject}</span>
              {info.batch_ids.length > 0 ? (
                info.batch_ids.map((bid) => (
                  <span key={bid} className="badge-violet">
                    {batches.find((b) => b.id === bid)?.name}
                  </span>
                ))
              ) : (
                <span className="badge-violet">All Batches</span>
              )}
              <span className="badge-yellow">{info.duration_minutes} min</span>
              <span className="text-slate-500 text-xs">
                {totalMarks} marks · Pass: {info.pass_marks}
              </span>
            </div>
            {info.instructions && <p className="text-slate-400 text-sm">{info.instructions}</p>}
          </div>

          <div className="space-y-3">
            {questions.map((q, i) => (
              <div key={q.id} className="card p-4">
                <div className="flex items-start gap-3 mb-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-sky-400/15 text-sky-400 text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <p className="text-white font-hind">
                    {q.question_text || (
                      <span className="text-slate-500 italic">No question text</span>
                    )}
                  </p>
                  <span className="ml-auto text-sky-400 text-xs shrink-0">{q.marks}m</span>
                </div>
                <div className="grid grid-cols-2 gap-2 ml-9">
                  {OPTS.map((o) => (
                    <div
                      key={o}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm',
                        q.correct_option === o
                          ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
                          : 'border-white/10 text-slate-400'
                      )}
                    >
                      <span className="font-bold w-4">{o}.</span>
                      {(q[`option_${o.toLowerCase()}` as keyof Question] as string) || '—'}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(2)} className="btn-outline text-sm">
              ← Back
            </button>
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="btn-outline text-sm ml-auto"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save as
              Draft
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="btn-primary text-sm"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}{' '}
              Save & Publish
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {bulkOpen && (
          <BulkImportModal
            onImport={(qs) => setQuestions((prev) => [...prev, ...qs])}
            onClose={() => setBulkOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Results Tab ───────────────────────────────────────────────────────────────
function ResultsTab({ exams }: { exams: Exam[] }) {
  const [examId, setExamId] = useState('');
  const [subs, setSubs] = useState<any[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [breakdown, setBreakdown] = useState<any | null>(null);

  const load = useCallback(async (eid: string) => {
    if (!eid) {
      return;
    }
    setLoading(true);
    try {
      const [{ data: s }, { data: q }] = await Promise.all([
        supabase
          .from('mcq_submissions')
          .select('*, student:students(name, student_id, photo_url)')
          .eq('exam_id', eid)
          .order('score', { ascending: false })
          .order('time_taken', { ascending: true }),
        supabase.from('mcq_questions').select('*').eq('exam_id', eid).order('order_num'),
      ]);
      setSubs(s ?? []);
      setQuestions(q ?? []);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(examId);
  }, [examId, load]);

  const recalcRanks = async () => {
    try {
      const sorted = [...subs].sort((a, b) => b.score - a.score || a.time_taken - b.time_taken);
      for (let i = 0; i < sorted.length; i++) {
        await supabase
          .from('mcq_submissions')
          .update({ rank: i + 1 })
          .eq('id', sorted[i].id);
      }
      toast.success('Ranks recalculated');
      load(examId);
    } catch (err) {
      handleSupabaseError(err);
    }
  };

  const exportCSV = () => {
    const rows = [['Rank', 'Student ID', 'Name', 'Score', 'Correct', 'Wrong', 'Time (s)', 'Date']];
    subs.forEach((s, i) => {
      rows.push([
        String(s.rank ?? i + 1),
        s.student?.student_id ?? '',
        s.student?.name ?? '',
        String(s.score),
        String(s.correct_count),
        String(s.wrong_count),
        String(s.time_taken),
        s.submitted_at ?? '',
      ]);
    });
    const csv = rows.map((r) => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `results-${examId}.csv`;
    a.click();
  };

  const RANK_ICONS: Record<number, { icon: string; cls: string }> = {
    1: { icon: '🥇', cls: 'text-amber-400' },
    2: { icon: '🥈', cls: 'text-slate-300' },
    3: { icon: '🥉', cls: 'text-amber-700' },
  };

  const selectedExam = exams.find((e) => e.id === examId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={examId}
          onChange={(e) => setExamId(e.target.value)}
          className="input-field max-w-xs"
        >
          <option value="">— Select Exam —</option>
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
        {subs.length > 0 && (
          <>
            <button onClick={recalcRanks} className="btn-outline text-sm py-1.5 px-3">
              <BarChart2 size={13} /> Recalculate Ranks
            </button>
            <button onClick={exportCSV} className="btn-outline text-sm py-1.5 px-3">
              <Download size={13} /> Export CSV
            </button>
          </>
        )}
      </div>

      {!examId ? (
        <div className="card p-12 text-center">
          <p className="text-slate-400">Select an exam to view results</p>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 card animate-pulse" />
          ))}
        </div>
      ) : subs.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-slate-400">No submissions yet</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-navy-700/50 flex items-center justify-between">
            <h3 className="font-semibold text-white text-sm">
              Leaderboard · {subs.length} submissions
            </h3>
            <Trophy size={16} className="text-amber-400" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700/50">
                  {['Rank', 'Student', 'Student ID', 'Score', 'Correct', 'Wrong', 'Time', ''].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 text-slate-400 font-medium text-xs whitespace-nowrap"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {subs.map((s, i) => {
                  const rank = s.rank ?? i + 1;
                  const ri = RANK_ICONS[rank];
                  const total =
                    selectedExam?.total_marks ?? questions.reduce((sum, q) => sum + q.marks, 0);
                  const pct = total > 0 ? Math.round((s.score / total) * 100) : 0;
                  const mins = Math.floor((s.time_taken ?? 0) / 60);
                  const secs = (s.time_taken ?? 0) % 60;
                  return (
                    <tr
                      key={s.id}
                      className={cn(
                        'border-b border-navy-700/30 hover:bg-white/[0.02] cursor-pointer',
                        rank === 1
                          ? 'bg-amber-400/5'
                          : rank === 2
                            ? 'bg-slate-400/5'
                            : rank === 3
                              ? 'bg-amber-700/5'
                              : ''
                      )}
                      onClick={() => setBreakdown(s)}
                    >
                      <td className="px-4 py-3">
                        {ri ? (
                          <span className={cn('text-lg', ri.cls)}>{ri.icon}</span>
                        ) : (
                          <span className="text-slate-400 font-mono text-sm">#{rank}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white font-medium">{s.student?.name ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-sky-400 text-xs">
                        {s.student?.student_id ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-inter font-bold text-white">
                          {s.score}/{total}
                        </span>
                        <span className="text-slate-500 text-xs ml-1">({pct}%)</span>
                      </td>
                      <td className="px-4 py-3 text-emerald-400 font-medium">
                        {s.correct_count ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-red-400 font-medium">{s.wrong_count ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {mins}m {secs}s
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setBreakdown(s);
                          }}
                          className="text-xs text-sky-400 hover:underline"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Answer Breakdown Modal */}
      <AnimatePresence>
        {breakdown && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setBreakdown(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.93 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.93 }}
              className="relative card-glass w-full max-w-xl z-10 p-6 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-inter font-bold text-white">
                  {breakdown.student?.name} — Answer Breakdown
                </h3>
                <button
                  onClick={() => setBreakdown(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3">
                {questions.map((q, i) => {
                  const raw = breakdown.answers;
                  const answers: Record<string, string> = !raw
                    ? {}
                    : typeof raw === 'object'
                      ? (raw as Record<string, string>)
                      : (() => {
                          try {
                            return JSON.parse(raw);
                          } catch {
                            return {};
                          }
                        })();
                  const studentAns = answers[q.id] ?? answers[String(i)] ?? null;
                  const correct = q.correct_option?.toUpperCase();
                  const isRight = (studentAns?.toUpperCase() ?? '') === correct;
                  return (
                    <div
                      key={q.id}
                      className={cn(
                        'card p-3 border',
                        isRight
                          ? 'border-emerald-400/20'
                          : studentAns
                            ? 'border-red-400/20'
                            : 'border-white/5'
                      )}
                    >
                      <p className="text-slate-400 text-xs mb-1">Q{i + 1}</p>
                      <p className="text-white text-sm mb-2 font-hind">{q.question_text}</p>
                      <div className="flex items-center gap-3 text-xs">
                        {studentAns ? (
                          <span
                            className={cn(
                              'flex items-center gap-1',
                              isRight ? 'text-emerald-400' : 'text-red-400'
                            )}
                          >
                            {isRight ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                            Selected: <strong>{studentAns}</strong>
                          </span>
                        ) : (
                          <span className="text-slate-500">Unanswered</span>
                        )}
                        {!isRight && (
                          <span className="text-emerald-400">
                            Correct: <strong>{correct ?? q.correct_option}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ExamsPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [batches, setBatches] = useState<any[]>([]);
  const [allExams, setAllExams] = useState<Exam[]>([]);

  useEffect(() => {
    supabase
      .from('batches')
      .select('id,name')
      .eq('is_active', true)
      .then(
        ({ data }) =>
          setBatches((data ?? []).map((b: any) => ({ ...b, name: sanitize(b.name ?? '') }))),
        (err: any) => {
          handleSupabaseError(err);
        }
      );
    supabase
      .from('exams')
      .select('*, batch:batches(name)')
      .order('created_at', { ascending: false })
      .then(
        ({ data }) =>
          setAllExams(
            (data ?? []).map((e: any) => ({
              ...e,
              title: sanitize(e.title ?? ''),
              batch: { name: sanitize(e.batch?.name ?? '') },
            })) as Exam[]
          ),
        (err: any) => {
          handleSupabaseError(err);
        }
      );
  }, [tab]);

  const TAB_LABELS: Record<Tab, string> = {
    all: 'All Exams',
    create: 'Create Exam',
    results: 'Results',
  };

  return (
    <AdminLayout title="পরীক্ষা ব্যবস্থাপনা">
      <div className="flex border-b border-navy-700/50 mb-6 gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all',
              tab === t
                ? 'text-sky-400 border-sky-400'
                : 'text-slate-400 border-transparent hover:text-white'
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'all' && <AllExamsTab onTabChange={setTab} />}
      {tab === 'create' && <CreateExamTab batches={batches} onDone={() => setTab('all')} />}
      {tab === 'results' && <ResultsTab exams={allExams} />}
    </AdminLayout>
  );
}
