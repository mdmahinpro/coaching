import { useEffect, useState } from 'react';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { fetchExams, fetchSubmissions } from '@/lib/portalApi';
import { handleSupabaseError } from '@/utils/errorHandler';
import { useStudentStore } from '@/store/useStudentStore';
import { formatDate, cn, sanitize, isExamForBatch } from '@/lib/utils';
import {
  ClipboardList,
  Clock,
  Trophy,
  PlayCircle,
  Loader2,
  ChevronRight,
  PauseCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

interface Exam {
  id: string;
  title: string;
  subject: string;
  exam_date: string;
  duration_minutes: number;
  total_marks: number;
  pass_marks: number;
  status: 'draft' | 'active' | 'paused' | 'ended';
  batch_id?: string;
  batch_ids?: string[];
  start_time?: string;
  end_time?: string;
  type?: string;
}

/**
 * Wall-clock exam state, mirroring the server gate (exam_get_meta / _exam_gate):
 * a scheduled exam is "active" only while now ∈ [start_time, end_time). The
 * stored `status` column alone is unreliable here (it is not advanced by a cron),
 * so the banner must agree with what exam_submit/exam_join will enforce.
 */
function effectiveState(e: Exam): 'draft' | 'active' | 'paused' | 'ended' {
  const now = Date.now();
  const start = e.start_time ? new Date(e.start_time).getTime() : null;
  const end = e.end_time ? new Date(e.end_time).getTime() : null;
  if (start !== null && now < start) {
    return 'draft'; // not yet open (banner: আসছে)
  }
  if (end !== null && now >= end) {
    return 'ended';
  }
  return e.status === 'paused' ? 'paused' : 'active';
}

/** Client-side batch scoping (defense-in-depth): only show this student's exams. */
const isForStudent = (e: Exam, batchId?: string): boolean => isExamForBatch(e, batchId);

function useCountdown(target?: string) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    if (!target) {
      return;
    }
    const calc = () => {
      const diff = new Date(target).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('');
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`);
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [target]);
  return remaining;
}

function ExamCard({ exam, myResult }: { exam: Exam; myResult?: any }) {
  const state = effectiveState(exam);
  const countdown = useCountdown(exam.start_time && state === 'draft' ? exam.start_time : undefined);
  const isActive = state === 'active';
  const isEnded = state === 'ended';
  const notStarted = state === 'draft';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'card p-4 border-l-4 transition-all',
        isActive
          ? 'border-l-emerald-400 bg-emerald-400/[0.02]'
          : isEnded
            ? 'border-l-slate-600'
            : 'border-l-sky-400/30'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3
              className={cn(
                'font-semibold font-hind',
                isEnded && !myResult ? 'text-slate-400' : 'text-white'
              )}
            >
              {exam.title}
            </h3>
            <span
              className={cn(
                'text-xs',
                isActive
                  ? 'badge-green'
                  : isEnded
                    ? 'badge-red'
                    : state === 'paused'
                      ? 'badge-yellow'
                      : 'badge-blue'
              )}
            >
              {isActive ? 'চলছে' : isEnded ? 'শেষ' : state === 'paused' ? 'বিরতি' : 'আসছে'}
            </span>
          </div>
          <p className="text-slate-400 text-xs mb-2 font-hind">
            {exam.subject} · {exam.duration_minutes} মিনিট · {exam.total_marks} নম্বর
          </p>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Clock size={11} /> {formatDate(exam.exam_date)}
            </span>
            {countdown && <span className="text-sky-400 font-medium">শুরু: {countdown} পরে</span>}
          </div>

          {myResult && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-emerald-400 text-xs font-medium">
                {myResult.score}/{exam.total_marks}
              </span>
              <span className="text-slate-500 text-xs">
                ({Math.round((myResult.score / exam.total_marks) * 100)}%)
              </span>
              {myResult.rank && <span className="badge-violet text-xs">#{myResult.rank}</span>}
            </div>
          )}
        </div>

        <div className="shrink-0 flex flex-col gap-2 items-end">
          {isActive && (
            <Link
              to={`/exam/${exam.id}`}
              className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 animate-pulse-slow"
            >
              <PlayCircle size={13} /> পরীক্ষা দিন
            </Link>
          )}
          {isEnded && myResult && (
            <Link
              to="/portal/results"
              className="btn-outline text-xs py-1.5 px-3 flex items-center gap-1"
            >
              ফলাফল <ChevronRight size={12} />
            </Link>
          )}
          {isEnded && !myResult && (
            <span className="text-slate-500 text-xs font-hind">অংশগ্রহণ করেননি</span>
          )}
          {notStarted && <span className="text-slate-600 text-xs font-hind">শুরু হয়নি</span>}
        </div>
      </div>
    </motion.div>
  );
}

export default function PortalExamsPage() {
  const { student } = useStudentStore();
  const [exams, setExams] = useState<Exam[]>([]);
  const [myResults, setMyResults] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!student) {
      return;
    }
    const load = async () => {
      try {
        const examData = await fetchExams();
        setExams(
          (examData ?? []).map((e: any) => ({
            ...e,
            title: sanitize(e.title ?? ''),
            subject: sanitize(e.subject ?? ''),
          })) as Exam[]
        );

        const subs = await fetchSubmissions();
        const map: Record<string, any> = {};
        (subs ?? []).forEach((s: any) => {
          map[s.exam_id] = s;
        });
        setMyResults(map);
      } catch (err) {
        handleSupabaseError(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [student?.id, student?.token, student?.batch_id]);

  // Only this student's own exams (batch-scoped), with wall-clock state.
  const mine = exams.filter((e) => isForStudent(e, student?.batch_id));
  const active = mine.filter((e) => effectiveState(e) === 'active');
  const paused = mine.filter((e) => effectiveState(e) === 'paused');
  const upcoming = mine.filter((e) => effectiveState(e) === 'draft');
  const ended = mine.filter((e) => effectiveState(e) === 'ended');

  return (
    <PortalLayout>
      <h1 className="font-inter font-bold text-xl text-white mb-5 font-hind flex items-center gap-2">
        <ClipboardList size={20} className="text-sky-400" /> পরীক্ষা
      </h1>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-sky-400" />
        </div>
      ) : exams.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-slate-500 font-hind">কোনো পরীক্ষা নির্ধারিত নেই</p>
        </div>
      ) : (
        <div className="space-y-8">
          {active.length > 0 && (
            <section>
              <h2 className="text-emerald-400 text-sm font-semibold mb-4 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> এখন চলছে
              </h2>
              <div className="space-y-4">
                {active.map((e) => (
                  <ExamCard key={e.id} exam={e} myResult={myResults[e.id]} />
                ))}
              </div>
            </section>
          )}
          {paused.length > 0 && (
            <section>
              <h2 className="text-amber-400 text-sm font-semibold mb-4 flex items-center gap-2">
                <PauseCircle size={13} /> সাময়িক বিরতি
              </h2>
              <div className="space-y-4">
                {paused.map((e) => (
                  <ExamCard key={e.id} exam={e} myResult={myResults[e.id]} />
                ))}
              </div>
            </section>
          )}
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sky-400 text-sm font-semibold mb-4 flex items-center gap-2">
                <Clock size={13} /> আসন্ন পরীক্ষা
              </h2>
              <div className="space-y-4">
                {upcoming.map((e) => (
                  <ExamCard key={e.id} exam={e} myResult={myResults[e.id]} />
                ))}
              </div>
            </section>
          )}
          {ended.length > 0 && (
            <section>
              <h2 className="text-slate-400 text-sm font-semibold mb-4 flex items-center gap-2">
                <Trophy size={13} /> সমাপ্ত পরীক্ষা
              </h2>
              <div className="space-y-4">
                {ended.map((e) => (
                  <ExamCard key={e.id} exam={e} myResult={myResults[e.id]} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </PortalLayout>
  );
}
