import { useEffect, useState } from 'react';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { fetchFees, fetchExams, fetchSubmissions, fetchNotices } from '@/lib/portalApi';
import { handleSupabaseError } from '@/utils/errorHandler';
import { useStudentStore } from '@/store/useStudentStore';
import { formatDate, formatCurrency, cn, sanitize } from '@/lib/utils';
import { DollarSign, Bell, Zap, Trophy, ArrowRight, Pin } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';

export default function PortalDashboardPage() {
  const { student } = useStudentStore();
  const [feeStatus, setFeeStatus] = useState<{ pending: number; total: number }>({
    pending: 0,
    total: 0,
  });
  const [examCount, setExamCount] = useState(0);
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [unreadNotices, setUnreadNotices] = useState(0);
  const [activeExams, setActiveExams] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [recentResults, setRecentResults] = useState<any[]>([]);

  const [readNotices, setReadNotices] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem('portal-read-notices') ?? '[]')
  );

  useEffect(() => {
    if (!student) {
      return;
    }
    const load = async () => {
      try {
        const [fees, exams, subs, notices] = await Promise.all([
          fetchFees(),
          fetchExams(),
          fetchSubmissions(),
          fetchNotices(),
        ]);

        const pending = (fees ?? [])
          .filter((f: any) => f.status === 'pending' || f.status === 'overdue')
          .reduce((s: number, f: any) => s + (f.amount ?? 0), 0);
        setFeeStatus({ pending, total: (fees ?? []).length });

        const examList = (exams ?? []).map((e: any) => ({
          ...e,
          title: sanitize(e.title ?? ''),
          subject: e.subject ?? '',
        }));
        setExamCount(examList.length);
        setActiveExams(examList.filter((e: any) => e.status === 'active'));

        const allSubs = subs ?? [];
        const recentSubs = allSubs.slice(0, 3).map((s: any) => ({
          score: s.score,
          rank: s.rank,
          exam: {
            title: sanitize(s.exam_title ?? ''),
            total_marks: s.total_marks ?? 100,
            subject: s.exam_subject ?? '',
          },
        }));
        setRecentResults(recentSubs);

        if (allSubs.length > 0) {
          const best = Math.max(
            ...allSubs.map((s: any) => {
              const total = s.total_marks ?? 100;
              return Math.round((s.score / total) * 100);
            })
          );
          setBestScore(best);
        }

        const noticeList = (notices ?? []).slice(0, 3).map((n: any) => ({
          ...n,
          title: sanitize(n.title ?? ''),
          content: n.content ?? '',
        }));
        setNotices(noticeList);
        const freshRead: string[] = JSON.parse(localStorage.getItem('portal-read-notices') ?? '[]');
        setReadNotices(freshRead);
        setUnreadNotices(noticeList.filter((n: any) => !freshRead.includes(n.id)).length);
      } catch (err) {
        handleSupabaseError(err);
      }
    };
    load();
  }, [student]);

  const STATS = [
    {
      label: 'বকেয়া ফি',
      value: feeStatus.pending > 0 ? formatCurrency(feeStatus.pending) : 'পরিশোধিত',
      icon: DollarSign,
      color: feeStatus.pending > 0 ? 'text-amber-400' : 'text-emerald-400',
      bg: feeStatus.pending > 0 ? 'bg-amber-400/10' : 'bg-emerald-400/10',
      to: '/portal/fees',
    },
    {
      label: 'পরীক্ষা',
      value: examCount,
      icon: Zap,
      color: 'text-sky-400',
      bg: 'bg-sky-400/10',
      to: '/portal/exams',
    },
    {
      label: 'সেরা স্কোর',
      value: bestScore !== null ? `${bestScore}%` : '—',
      icon: Trophy,
      color: 'text-violet-400',
      bg: 'bg-violet-400/10',
      to: '/portal/results',
    },
    {
      label: 'অপঠিত নোটিশ',
      value: unreadNotices,
      icon: Bell,
      color: unreadNotices > 0 ? 'text-sky-400' : 'text-slate-400',
      bg: unreadNotices > 0 ? 'bg-sky-400/10' : 'bg-white/5',
      to: '/portal/notices',
    },
  ];

  return (
    <PortalLayout>
      {/* Welcome card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-glass p-5 mb-5"
      >
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="font-inter font-black text-xl text-white mb-1 font-hind">
              স্বাগতম, <span className="text-gradient">{student?.name}</span>! 👋
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="font-mono text-sky-400 text-xs bg-sky-400/10 px-2.5 py-1 rounded-lg">
                {student?.student_id}
              </span>
              {student?.class_level && (
                <span className="badge-violet text-xs">{student.class_level}</span>
              )}
              {student?.batch_name && (
                <span className="badge-blue text-xs">{student.batch_name}</span>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Active exam alert */}
      <AnimatePresence>
        {activeExams.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="mb-5"
          >
            {activeExams.map((exam) => (
              <Link
                key={exam.id}
                to={`/exam/${exam.id}`}
                className="flex items-center justify-between p-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/5 hover:bg-emerald-400/10 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-3 h-3 rounded-full bg-emerald-400" />
                    <div className="absolute inset-0 w-3 h-3 rounded-full bg-emerald-400 animate-ping opacity-60" />
                  </div>
                  <div>
                    <p className="font-semibold text-white text-sm">{exam.title}</p>
                    <p className="text-emerald-400 text-xs font-hind">এখন চলছে! অংশ নিন</p>
                  </div>
                </div>
                <ArrowRight
                  size={16}
                  className="text-emerald-400 group-hover:translate-x-1 transition-transform"
                />
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {STATS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <Link
              to={s.to}
              className="card p-4 flex items-center gap-3 hover:border-white/10 transition-colors"
            >
              <div
                className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', s.bg)}
              >
                <s.icon size={17} className={s.color} />
              </div>
              <div className="min-w-0">
                <p className={cn('font-inter font-bold truncate', s.color)}>{s.value}</p>
                <p className="text-slate-500 text-xs font-hind truncate">{s.label}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent notices */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white text-sm flex items-center gap-2">
              <Bell size={14} className="text-sky-400" /> সাম্প্রতিক নোটিশ
            </h2>
            <Link to="/portal/notices" className="text-xs text-sky-400 hover:underline">
              সব দেখুন
            </Link>
          </div>
          {notices.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">কোনো নোটিশ নেই</p>
          ) : (
            <div className="space-y-2">
              {notices.map((n) => {
                const isUnread = !readNotices.includes(n.id);
                return (
                  <Link
                    key={n.id}
                    to="/portal/notices"
                    className="flex items-start gap-2.5 p-3 rounded-xl bg-navy-800/50 hover:bg-navy-700/50 transition-colors"
                  >
                    {n.is_pinned ? (
                      <Pin size={12} className="text-sky-400 mt-0.5 shrink-0" />
                    ) : (
                      <Bell size={12} className="text-slate-500 mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isUnread && (
                          <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                        )}
                        <p
                          className={cn(
                            'text-sm line-clamp-1 font-hind',
                            isUnread ? 'text-white font-semibold' : 'text-slate-300'
                          )}
                        >
                          {n.title}
                        </p>
                      </div>
                      <p className="text-slate-500 text-xs mt-0.5">{formatDate(n.created_at)}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent results */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white text-sm flex items-center gap-2">
              <Trophy size={14} className="text-violet-400" /> সাম্প্রতিক ফলাফল
            </h2>
            <Link to="/portal/results" className="text-xs text-sky-400 hover:underline">
              সব দেখুন
            </Link>
          </div>
          {recentResults.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">কোনো ফলাফল নেই</p>
          ) : (
            <div className="space-y-2">
              {recentResults.map((r, i) => {
                const total = (r as any).exam?.total_marks ?? 100;
                const pct = Math.round((r.score / total) * 100);
                return (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-navy-800/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium line-clamp-1 font-hind">
                        {(r as any).exam?.title}
                      </p>
                      <p className="text-slate-500 text-xs">{(r as any).exam?.subject}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={cn(
                          'font-inter font-bold text-sm',
                          pct >= 60 ? 'text-emerald-400' : 'text-red-400'
                        )}
                      >
                        {pct}%
                      </p>
                      {r.rank && <p className="text-slate-500 text-xs">#{r.rank}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
