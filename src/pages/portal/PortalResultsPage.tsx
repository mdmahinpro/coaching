import { useEffect, useState } from 'react';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { fetchSubmissions, fetchReview } from '@/lib/portalApi';
import { handleSupabaseError } from '@/utils/errorHandler';
import { useStudentStore } from '@/store/useStudentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatDate, cn, sanitize } from '@/lib/utils';
import {
  Trophy,
  Award,
  BarChart2,
  X,
  Loader2,
  Download,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { generateResultCard } from '@/lib/pdf';
import { logError } from '@/utils/logger';

interface Submission {
  id: string;
  exam_id: string;
  score: number;
  correct_count: number;
  wrong_count: number;
  time_taken?: number;
  rank?: number;
  submitted_at: string;
  answers?: Record<string, string>;
  exam?: { title: string; subject: string; total_marks: number; pass_marks: number };
}

interface Question {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  marks: number;
  order_num: number;
}

const GRADE = (pct: number) =>
  pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 40 ? 'D' : 'F';
const fmtTime = (s?: number) => (!s ? '—' : `${Math.floor(s / 60)}m ${s % 60}s`);

const parseAnswers = (raw: unknown): Record<string, string> => {
  if (!raw) {
    return {};
  }
  if (typeof raw === 'object') {
    return raw as Record<string, string>;
  }
  try {
    return JSON.parse(raw as string);
  } catch {
    return {};
  }
};

export default function PortalResultsPage() {
  const { student } = useStudentStore();
  const { settings } = useSettingsStore();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [breakdown, setBreakdown] = useState<{ sub: Submission; questions: Question[] } | null>(
    null
  );
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [downloadResultCardLoading, setDownloadResultCardLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!student) {
      return;
    }
    fetchSubmissions().then(
      (data) => {
        const mapped = (data ?? []).map((r: any) => ({
          ...r,
          exam: {
            title: r.exam_title,
            subject: r.exam_subject,
            total_marks: r.total_marks,
            pass_marks: r.pass_marks,
          },
        }));
        setSubmissions(mapped as Submission[]);
        setLoading(false);
      },
      (err: any) => {
        handleSupabaseError(err);
        setLoading(false);
      }
    );
  }, [student]);

  const openBreakdown = async (sub: Submission) => {
    try {
      setBreakdownLoading(true);
      const qs = await fetchReview(sub.exam_id);
      const cleaned = (qs ?? []).map((q: any) => ({
        id: q.question_id,
        correct_option: q.correct_option,
        marks: q.marks,
        order_num: q.order_num,
        question_text: sanitize(q.question_text),
        option_a: sanitize(q.option_a),
        option_b: sanitize(q.option_b),
        option_c: sanitize(q.option_c),
        option_d: sanitize(q.option_d),
      }));
      setBreakdown({ sub, questions: cleaned as Question[] });
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setBreakdownLoading(false);
    }
  };

  const downloadResultCard = async (sub: Submission) => {
    try {
      await generateResultCard({
        studentName: student?.name ?? '',
        studentId: student?.student_id,
        examTitle: sub.exam?.title ?? '',
        subject: sub.exam?.subject ?? '',
        score: sub.score,
        totalMarks: sub.exam?.total_marks ?? 100,
        passMarks: sub.exam?.pass_marks ?? 0,
        correctCount: sub.correct_count ?? 0,
        wrongCount: sub.wrong_count ?? 0,
        timeTaken: sub.time_taken,
        rank: sub.rank,
        submittedAt: formatDate(sub.submitted_at),
        instituteName: settings.centerName,
      });
    } catch (err) {
      logError('Result card PDF generation failed', {
        source: 'PortalResultsPage',
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const totalExams = submissions.length;
  const passed = submissions.filter((s) => s.score >= (s.exam?.pass_marks ?? 0)).length;
  const avgPct =
    totalExams > 0
      ? Math.round(
          submissions.reduce((a, s) => a + (s.score / (s.exam?.total_marks ?? 100)) * 100, 0) /
            totalExams
        )
      : 0;

  return (
    <PortalLayout>
      <h1 className="font-inter font-bold text-xl text-white mb-5 font-hind flex items-center gap-2">
        <Trophy size={20} className="text-violet-400" /> আমার ফলাফল
      </h1>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          {
            label: 'মোট পরীক্ষা',
            value: totalExams,
            icon: BarChart2,
            color: 'text-sky-400',
            bg: 'bg-sky-400/10',
          },
          {
            label: 'পাস',
            value: passed,
            icon: Award,
            color: 'text-emerald-400',
            bg: 'bg-emerald-400/10',
          },
          {
            label: 'গড় স্কোর',
            value: `${avgPct}%`,
            icon: Trophy,
            color: 'text-violet-400',
            bg: 'bg-violet-400/10',
          },
        ].map((s) => (
          <div key={s.label} className="card p-3 flex items-center gap-2">
            <div className={cn('p-2 rounded-xl shrink-0', s.bg)}>
              <s.icon size={15} className={s.color} />
            </div>
            <div className="min-w-0">
              <p className={cn('font-inter font-bold', s.color)}>{s.value}</p>
              <p className="text-slate-500 text-xs font-hind truncate">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-sky-400" />
        </div>
      ) : submissions.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-slate-500 font-hind">কোনো পরীক্ষার ফলাফল নেই</p>
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map((s) => {
            const total = s.exam?.total_marks ?? 100;
            const pct = Math.round((s.score / total) * 100);
            const pass = s.score >= (s.exam?.pass_marks ?? 0);
            const grade = GRADE(pct);
            const isExpanded = expandedId === s.id;

            return (
              <div key={s.id} className="card overflow-hidden">
                <div className="p-4 flex items-start gap-3">
                  <div
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-inter font-bold',
                      pass ? 'bg-emerald-400/15 text-emerald-400' : 'bg-red-400/15 text-red-400'
                    )}
                  >
                    {grade}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white text-sm font-hind">{s.exam?.title}</h3>
                    <p className="text-slate-400 text-xs">
                      {s.exam?.subject} · {formatDate(s.submitted_at)}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      <span
                        className={cn(
                          'font-inter font-bold text-sm',
                          pass ? 'text-emerald-400' : 'text-red-400'
                        )}
                      >
                        {s.score}/{total}
                        <span className="text-xs text-slate-500 font-normal ml-1">({pct}%)</span>
                      </span>
                      {s.rank && (
                        <span className="font-mono text-violet-400 text-xs">#{s.rank}</span>
                      )}
                      <span className="text-slate-500 text-xs flex items-center gap-1">
                        ⏱ {fmtTime(s.time_taken)}
                      </span>
                      <span className="text-emerald-400 text-xs">
                        {s.correct_count ?? '?'} correct
                      </span>
                      <span className="text-red-400 text-xs">{s.wrong_count ?? '?'} wrong</span>
                    </div>
                    {/* Score bar */}
                    <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden mt-2">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          pass ? 'bg-gradient-to-r from-emerald-500 to-sky-500' : 'bg-red-500'
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={async () => {
                        setDownloadResultCardLoading(true);
                        await downloadResultCard(s);
                        setDownloadResultCardLoading(false);
                      }}
                      disabled={downloadResultCardLoading}
                      className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-400 hover:text-sky-400 transition-colors disabled:opacity-50"
                      title="Download"
                    >
                      {downloadResultCardLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        if (expandedId === s.id) {
                          setExpandedId(null);
                          setBreakdown(null);
                          return;
                        }
                        setExpandedId(s.id);
                        openBreakdown(s);
                      }}
                      className="p-1.5 rounded-lg hover:bg-violet-500/15 text-slate-400 hover:text-violet-400 transition-colors"
                      title="Breakdown"
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Breakdown Modal */}
      <AnimatePresence>
        {(breakdown || breakdownLoading) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => {
                setBreakdown(null);
                setExpandedId(null);
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative card-glass w-full max-w-lg z-10 max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between p-5 border-b border-white/5 shrink-0">
                <h2 className="font-inter font-bold text-white text-sm">উত্তর বিশ্লেষণ</h2>
                <button
                  onClick={() => {
                    setBreakdown(null);
                    setExpandedId(null);
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-5 space-y-3">
                {breakdownLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-sky-400" />
                  </div>
                ) : breakdown ? (
                  breakdown.questions.map((q, i) => {
                    // Normalise both to uppercase for comparison (DB stores lowercase, UI stores uppercase)
                    // answers may be a raw JSON string (TEXT column) or already-parsed object (JSONB) — handle both
                    const parsedAnswers = parseAnswers(breakdown.sub.answers as unknown);
                    const studentAns = parsedAnswers[q.id]?.toUpperCase();
                    const correctOpt = q.correct_option.toUpperCase();
                    const isCorrect = !!studentAns && studentAns === correctOpt;
                    const opts: Record<string, string> = {
                      A: q.option_a,
                      B: q.option_b,
                      C: q.option_c,
                      D: q.option_d,
                    };
                    return (
                      <div
                        key={q.id}
                        className={cn(
                          'rounded-xl p-3 border',
                          isCorrect
                            ? 'bg-emerald-400/5 border-emerald-400/20'
                            : 'bg-red-400/5 border-red-400/20'
                        )}
                      >
                        <p className="text-white text-sm font-medium mb-2 font-hind">
                          <span className="text-slate-500 mr-2">Q{i + 1}.</span>
                          {q.question_text}
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {Object.entries(opts)
                            .filter(([, v]) => v)
                            .map(([k, v]) => {
                              const isStudentChoice = studentAns === k;
                              const isCorrectChoice = correctOpt === k;
                              return (
                                <div
                                  key={k}
                                  className={cn(
                                    'rounded-lg px-2.5 py-1.5 text-xs flex items-center gap-1.5',
                                    isCorrectChoice
                                      ? 'bg-emerald-400/20 text-emerald-400 border border-emerald-400/30'
                                      : isStudentChoice && !isCorrect
                                        ? 'bg-red-400/20 text-red-400 border border-red-400/30'
                                        : 'bg-white/5 text-slate-500'
                                  )}
                                >
                                  <span className="uppercase font-bold shrink-0">{k}</span>
                                  <span className="truncate font-hind">{v}</span>
                                  {isStudentChoice && (
                                    <span className="ml-auto shrink-0">
                                      {isCorrect ? '✓' : '✗'}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                        {!studentAns && (
                          <p className="text-slate-500 text-xs mt-1 font-hind">উত্তর দেননি</p>
                        )}
                      </div>
                    );
                  })
                ) : null}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </PortalLayout>
  );
}
