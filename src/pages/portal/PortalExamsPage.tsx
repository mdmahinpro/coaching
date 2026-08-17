import { useEffect, useState } from 'react';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/utils/errorHandler';
import { useStudentStore } from '@/store/useStudentStore';
import { formatDate, cn, sanitize } from '@/lib/utils';
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
  start_time?: string;
  end_time?: string;
  type?: string;
}

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
  const countdown = useCountdown(
    exam.start_time && exam.status === 'draft' ? exam.start_time : undefined
  );
  const isActive = exam.status === 'active';
  const isEnded = exam.status === 'ended';
  const notStarted = exam.status === 'draft';

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
                    : exam.status === 'paused'
                      ? 'badge-yellow'
                      : 'badge-blue'
              )}
            >
              {isActive ? 'চলছে' : isEnded ? 'শেষ' : exam.status === 'paused' ? 'বিরতি' : 'আসছে'}
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
        let q = supabase.from('exams').select('*').order('exam_date', { ascending: false });
        if (student.batch_id) {
          q = q.or(`batch_id.eq.${student.batch_id},batch_id.is.null`);
        } else {
          q = q.is('batch_id', null);
        }
        const { data: examData } = await q;
        setExams(
          (examData ?? []).map((e: any) => ({
            ...e,
            title: sanitize(e.title ?? ''),
            subject: sanitize(e.subject ?? ''),
          })) as Exam[]
        );

        const { data: subs } = await supabase
          .from('mcq_submissions')
          .select('exam_id,score,rank')
          .eq('student_id', student.id);
        const map: Record<string, any> = {};
        (subs ?? []).forEach((s) => {
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
  }, [student]);

  const active = exams.filter((e) => e.status === 'active');
  const paused = exams.filter((e) => e.status === 'paused');
  const upcoming = exams.filter((e) => e.status === 'draft');
  const ended = exams.filter((e) => e.status === 'ended');

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
        <div className="space-y-6">
          {active.length > 0 && (
            <section>
              <h2 className="text-emerald-400 text-sm font-semibold mb-3 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> এখন চলছে
              </h2>
              <div className="space-y-3">
                {active.map((e) => (
                  <ExamCard key={e.id} exam={e} myResult={myResults[e.id]} />
                ))}
              </div>
            </section>
          )}
          {paused.length > 0 && (
            <section>
              <h2 className="text-amber-400 text-sm font-semibold mb-3 flex items-center gap-2">
                <PauseCircle size={13} /> সাময়িক বিরতি
              </h2>
              <div className="space-y-3">
                {paused.map((e) => (
                  <ExamCard key={e.id} exam={e} myResult={myResults[e.id]} />
                ))}
              </div>
            </section>
          )}
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sky-400 text-sm font-semibold mb-3 flex items-center gap-2">
                <Clock size={13} /> আসন্ন পরীক্ষা
              </h2>
              <div className="space-y-3">
                {upcoming.map((e) => (
                  <ExamCard key={e.id} exam={e} myResult={myResults[e.id]} />
                ))}
              </div>
            </section>
          )}
          {ended.length > 0 && (
            <section>
              <h2 className="text-slate-400 text-sm font-semibold mb-3 flex items-center gap-2">
                <Trophy size={13} /> সমাপ্ত পরীক্ষা
              </h2>
              <div className="space-y-3">
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
