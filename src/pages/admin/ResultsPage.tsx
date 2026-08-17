import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/shared/Avatar';
import { formatDate, cn, sanitize } from '@/lib/utils';
import { Trophy, Download, BarChart2, X, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { handleSupabaseError } from '@/utils/errorHandler';

interface Submission {
  id: string;
  student_id: string;
  exam_id: string;
  score: number;
  correct_count: number;
  wrong_count: number;
  time_taken: number;
  rank?: number;
  submitted_at: string;
  answers?: string;
  student?: { name: string; student_id: string; photo_url?: string };
  exam?: { title: string; total_marks: number; pass_marks: number; subject: string };
}

function calcGrade(score: number, total: number): string {
  const pct = total > 0 ? (score / total) * 100 : 0;
  if (pct >= 90) {
    return 'A+';
  }
  if (pct >= 80) {
    return 'A';
  }
  if (pct >= 70) {
    return 'B';
  }
  if (pct >= 60) {
    return 'C';
  }
  if (pct >= 50) {
    return 'D';
  }
  return 'F';
}

export default function ResultsPage() {
  const [exams, setExams] = useState<any[]>([]);
  const [examId, setExamId] = useState('');
  const [subs, setSubs] = useState<Submission[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [breakdown, setBreakdown] = useState<Submission | null>(null);

  useEffect(() => {
    supabase
      .from('exams')
      .select('id,title,subject,total_marks,pass_marks,status')
      .order('created_at', { ascending: false })
      .then(
        ({ data }) => {
          const cleaned = (data ?? []).map((e: any) => ({
            ...e,
            title: sanitize(e.title),
            subject: e.subject ? sanitize(e.subject) : e.subject,
          }));
          setExams(cleaned);
        },
        (err: any) => {
          handleSupabaseError(err);
        }
      );
  }, []);

  const load = useCallback(async (eid: string) => {
    if (!eid) {
      setSubs([]);
      setQuestions([]);
      return;
    }
    setLoading(true);
    try {
      const [{ data: s }, { data: q }] = await Promise.all([
        supabase
          .from('mcq_submissions')
          .select(
            '*, student:students(name,student_id,photo_url), exam:exams(title,total_marks,pass_marks,subject)'
          )
          .eq('exam_id', eid)
          .order('score', { ascending: false })
          .order('time_taken', { ascending: true }),
        supabase.from('mcq_questions').select('*').eq('exam_id', eid).order('order_num'),
      ]);
      const cleaned = (s ?? []).map((sub: any) => ({
        ...sub,
        student: sub.student ? { ...sub.student, name: sanitize(sub.student.name) } : sub.student,
        exam: sub.exam ? { ...sub.exam, title: sanitize(sub.exam.title) } : sub.exam,
      }));
      setSubs(cleaned as Submission[]);
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
    if (!subs.length) {
      return;
    }
    try {
      const sorted = [...subs].sort((a, b) => b.score - a.score || a.time_taken - b.time_taken);
      await Promise.all(
        sorted.map((s, i) =>
          supabase
            .from('mcq_submissions')
            .update({ rank: i + 1 })
            .eq('id', s.id)
        )
      );
      toast.success('Ranks recalculated');
      load(examId);
    } catch (err) {
      handleSupabaseError(err);
    }
  };

  const exportCSV = () => {
    const rows = [
      [
        'Rank',
        'Student ID',
        'Name',
        'Score',
        'Total',
        'Grade',
        'Correct',
        'Wrong',
        'Time (s)',
        'Status',
        'Submitted',
      ],
    ];
    subs.forEach((s, i) => {
      const total = s.exam?.total_marks ?? 0;
      const grade = calcGrade(s.score, total);
      const pass = s.score >= (s.exam?.pass_marks ?? 0) ? 'Pass' : 'Fail';
      rows.push([
        String(s.rank ?? i + 1),
        s.student?.student_id ?? '',
        s.student?.name ?? '',
        String(s.score),
        String(total),
        grade,
        String(s.correct_count ?? ''),
        String(s.wrong_count ?? ''),
        String(s.time_taken ?? ''),
        pass,
        s.submitted_at ?? '',
      ]);
    });
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `results-${examId}.csv`;
    a.click();
  };

  const selectedExam = exams.find((e) => e.id === examId);
  const RANK_ICONS: Record<number, { icon: string; cls: string }> = {
    1: { icon: '🥇', cls: 'text-amber-400' },
    2: { icon: '🥈', cls: 'text-slate-300' },
    3: { icon: '🥉', cls: 'text-amber-700' },
  };

  return (
    <AdminLayout title="পরীক্ষার ফলাফল">
      <div className="space-y-5">
        {/* Exam selector + actions */}
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            className="input-field max-w-xs"
          >
            <option value="">— পরীক্ষা বেছে নিন —</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} ({e.subject})
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
          <div className="card p-16 text-center">
            <Trophy size={32} className="text-amber-400/40 mx-auto mb-3" />
            <p className="text-slate-400">একটি পরীক্ষা বেছে নিন ফলাফল দেখতে</p>
          </div>
        ) : loading ? (
          <div className="card p-12 flex items-center justify-center gap-3">
            <Loader2 size={20} className="animate-spin text-sky-400" />
            <span className="text-slate-400">লোড হচ্ছে…</span>
          </div>
        ) : subs.length === 0 ? (
          <div className="card p-16 text-center">
            <p className="text-slate-400">এই পরীক্ষায় এখনো কোনো সাবমিশন নেই</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-navy-700/50 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white text-sm">
                  {selectedExam?.title} — লিডারবোর্ড
                </h3>
                <p className="text-slate-500 text-xs mt-0.5">
                  {subs.length} submissions · {selectedExam?.total_marks} marks · Pass:{' '}
                  {selectedExam?.pass_marks}
                </p>
              </div>
              <Trophy size={16} className="text-amber-400" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-700/50">
                    {[
                      'Rank',
                      'Student',
                      'ID',
                      'Score',
                      'Grade',
                      'Correct',
                      'Wrong',
                      'Time',
                      'Status',
                      '',
                    ].map((h) => (
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
                  {subs.map((s, i) => {
                    const rank = s.rank ?? i + 1;
                    const ri = RANK_ICONS[rank];
                    const total = s.exam?.total_marks ?? selectedExam?.total_marks ?? 0;
                    const pct = total > 0 ? Math.round((s.score / total) * 100) : 0;
                    const grade = calcGrade(s.score, total);
                    const passed = s.score >= (s.exam?.pass_marks ?? selectedExam?.pass_marks ?? 0);
                    const mins = Math.floor((s.time_taken ?? 0) / 60);
                    const secs = (s.time_taken ?? 0) % 60;
                    return (
                      <tr
                        key={s.id}
                        className={cn(
                          'border-b border-navy-700/30 hover:bg-white/[0.02] cursor-pointer transition-colors',
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
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar
                              name={s.student?.name ?? '?'}
                              size="sm"
                              src={s.student?.photo_url}
                            />
                            <span className="text-white font-medium whitespace-nowrap">
                              {s.student?.name ?? '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-sky-400 text-xs">
                          {s.student?.student_id ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-inter font-bold text-white">
                            {s.score}/{total}
                          </span>
                          <span className="text-slate-500 text-xs ml-1">({pct}%)</span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              grade === 'F'
                                ? 'badge-red'
                                : grade.startsWith('A')
                                  ? 'badge-green'
                                  : 'badge-yellow'
                            )}
                          >
                            {grade}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-emerald-400 font-medium">
                          {s.correct_count ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-red-400 font-medium">
                          {s.wrong_count ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                          {mins}m {secs}s
                        </td>
                        <td className="px-4 py-3">
                          <span className={passed ? 'badge-green' : 'badge-red'}>
                            {passed ? 'Pass' : 'Fail'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setBreakdown(s);
                            }}
                            className="text-xs text-sky-400 hover:underline whitespace-nowrap"
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
      </div>

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
                <div>
                  <h3 className="font-inter font-bold text-white">
                    {breakdown.student?.name} — উত্তর বিশ্লেষণ
                  </h3>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Score: {breakdown.score} · Correct: {breakdown.correct_count} · Wrong:{' '}
                    {breakdown.wrong_count}
                  </p>
                </div>
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
                      <p className="text-slate-400 text-xs mb-1">
                        Q{i + 1} · {q.marks} marks
                      </p>
                      <p className="text-white text-sm mb-2 font-hind">{q.question_text}</p>
                      <div className="flex items-center gap-3 text-xs flex-wrap">
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
                        {!isRight && correct && (
                          <span className="text-emerald-400">
                            Correct: <strong>{correct}</strong>
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
    </AdminLayout>
  );
}
