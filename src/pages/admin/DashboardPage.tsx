import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { StatsCard } from '@/components/admin/StatsCard';
import { supabase } from '@/lib/supabase';
import { Link } from 'react-router-dom';
import {
  Users,
  TrendingUp,
  AlertCircle,
  BookOpen,
  ClipboardList,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { formatCurrency, formatDate, sanitize } from '@/lib/utils';
import { AnimatedSection } from '@/components/shared/AnimatedSection';
import { Avatar } from '@/components/shared/Avatar';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { motion } from 'framer-motion';
import { handleSupabaseError } from '@/utils/errorHandler';
import { logWarning } from '@/utils/logger';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PIE_COLORS = { collected: '#38bdf8', pending: '#ef4444', waived: '#34d399' };

function SkeletonCard() {
  return (
    <div className="card p-5 animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-xl bg-navy-700" />
        <div className="w-16 h-5 rounded-full bg-navy-700" />
      </div>
      <div className="h-3 w-24 bg-navy-700 rounded mb-2" />
      <div className="h-8 w-20 bg-navy-700 rounded" />
    </div>
  );
}

function SkeletonBlock({ h = 'h-40' }: { h?: string }) {
  return <div className={`card ${h} animate-pulse bg-navy-800`} />;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    activeStudents: 0,
    monthCollected: 0,
    pendingFees: 0,
    activeExams: 0,
  });
  const [enrollmentData, setEnrollmentData] = useState<{ month: string; students: number }[]>([]);
  const [feeDonut, setFeeDonut] = useState<{ name: string; value: number }[]>([]);
  const [recentAdmissions, setRecentAdmissions] = useState<any[]>([]);
  const [activeExams, setActiveExams] = useState<any[]>([]);
  const [feeDues, setFeeDues] = useState<any[]>([]);
  const [dbHealthy, setDbHealthy] = useState<boolean | null>(null);
  const [checkingDb, setCheckingDb] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

      const [
        studentCountRes,
        studentChartRes,
        monthPaidRes,
        pendingRes,
        activeExamRes,
        admissionsRes,
        examsRes,
        allFeesRes,
      ] = await Promise.all([
         supabase
           .from('students')
           .select('id', { count: 'exact', head: true })
           .eq('is_approved', true)
           .eq('status', 'active'),
         supabase
           .from('students')
           .select('id,created_at')
           .eq('is_approved', true)
           .eq('status', 'active')
           .gte('created_at', sixMonthsAgo),
        supabase
          .from('fees')
          .select('amount,note')
          .eq('status', 'paid')
          .gte('payment_date', monthStart)
          .lte('payment_date', monthEnd),
        supabase.from('fees').select('amount').eq('status', 'pending'),
        supabase.from('exams').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase
          .from('admission_requests')
          .select('id,name,guardian_name,created_at,batch_id')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('exams')
          .select('id,title,batch_id,exam_date,status')
          .eq('status', 'active')
          .limit(5),
        supabase.from('fees').select('status,amount,note'),
      ]);

      const parseNote = (n: any) => {
        try {
          return n ? JSON.parse(n) : {};
        } catch {
          return {};
        }
      };
      const monthCollected = (monthPaidRes.data ?? []).reduce((s: number, r: any) => {
        const meta = parseNote(r.note);
        return s + (meta.final_amount ?? r.amount ?? 0);
      }, 0);
      const pendingFees = (pendingRes.data ?? []).reduce(
        (s: number, r: any) => s + (r.amount ?? 0),
        0
      );
      setStats({
        activeStudents: studentCountRes.count ?? 0,
        monthCollected,
        pendingFees,
        activeExams: activeExamRes.count ?? 0,
      });

      const students = studentChartRes.data ?? [];
      const monthCounts: Record<string, number> = {};
      students.forEach((s: any) => {
        const d = new Date(s.created_at);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        monthCounts[key] = (monthCounts[key] ?? 0) + 1;
      });
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        trend.push({ month: MONTHS[d.getMonth()], students: monthCounts[key] ?? 0 });
      }
      setEnrollmentData(trend);

      const fees = allFeesRes.data ?? [];
      const collected = fees
        .filter((f: any) => f.status === 'paid')
        .reduce((s: number, f: any) => {
          const meta = parseNote(f.note);
          return s + (meta.final_amount ?? f.amount ?? 0);
        }, 0);
      const pending = fees
        .filter((f: any) => f.status === 'pending')
        .reduce((s: number, f: any) => s + (f.amount ?? 0), 0);
      const waived = fees
        .filter((f: any) => f.status === 'waived')
        .reduce((s: number, f: any) => s + (f.amount ?? 0), 0);
      setFeeDonut(
        [
          { name: 'Collected', value: collected },
          { name: 'Pending', value: pending },
          { name: 'Waived', value: waived },
        ].filter((d) => d.value > 0)
      );

      setRecentAdmissions(admissionsRes.data ?? []);
      setActiveExams(examsRes.data ?? []);

      const { data: dueFeesData } = await supabase
        .from('fees')
        .select('student_id, amount, due_date')
        .eq('status', 'pending');
      const dueFees = dueFeesData ?? [];
      const studentDues: Record<string, { count: number; total: number }> = {};
      dueFees.forEach((f: any) => {
        if (!studentDues[f.student_id]) {
          studentDues[f.student_id] = { count: 0, total: 0 };
        }
        studentDues[f.student_id].count++;
        studentDues[f.student_id].total += f.amount ?? 0;
      });
      const overdueIds = Object.entries(studentDues)
        .filter(([, v]) => v.count >= 2)
        .slice(0, 5)
        .map(([id, v]) => ({ id, ...v }));

      // Fetch names only for the specific overdue students (avoids the old limit(50) which missed most students)
      const studentMap: Record<string, string> = {};
      if (overdueIds.length > 0) {
        const { data: overdueStudents } = await supabase
          .from('students')
          .select('id,name')
          .in(
            'id',
            overdueIds.map((d) => d.id)
          );
        (overdueStudents ?? []).forEach((s: any) => {
          studentMap[s.id] = sanitize(s.name);
        });
      }
      setFeeDues(overdueIds.map((d) => ({ ...d, name: sanitize(studentMap[d.id] ?? 'Unknown') })));
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ── Database health check ─────────────────────────────────────────
  const checkDbHealth = async () => {
    setCheckingDb(true);
    try {
      // Lightweight HEAD query — minimal data transfer, confirms connectivity
      const { error } = await supabase
        .from('students')
        .select('id', { count: 'exact', head: true });
      if (error) {
        logWarning('Database health check failed', {
          source: 'DashboardPage',
          meta: { message: error.message, code: error.code },
        });
      }
      setDbHealthy(!error);
    } catch (err) {
      logWarning('Database health check threw', {
        source: 'DashboardPage',
        meta: { message: err instanceof Error ? err.message : String(err) },
      });
      setDbHealthy(false);
    } finally {
      setCheckingDb(false);
    }
  };

  useEffect(() => {
    checkDbHealth();
    // Re-check every 60 seconds
    const interval = setInterval(checkDbHealth, 60_000);
    return () => clearInterval(interval);
  }, []);

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) {
      return null;
    }
    return (
      <div className="card-glass px-3 py-2 text-xs border border-navy-600">
        <p className="text-slate-400 mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
            {p.name}:{' '}
            {typeof p.value === 'number' && p.value > 1000 ? formatCurrency(p.value) : p.value}
          </p>
        ))}
      </div>
    );
  };

  return (
    <AdminLayout title="Dashboard">
      <div className="space-y-5">
        {/* System Health Indicator */}
        <div className="flex items-center gap-3">
          <button
            onClick={checkDbHealth}
            disabled={checkingDb}
            className="flex items-center gap-2 card px-3 py-2 hover:bg-navy-700/50 transition-colors cursor-pointer"
            title={
              dbHealthy === null
                ? 'Checking database connection…'
                : dbHealthy
                  ? 'Database connected'
                  : 'Database unreachable'
            }
          >
            <div
              className={`w-2.5 h-2.5 rounded-full ${dbHealthy === true ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : dbHealthy === false ? 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-slate-500 animate-pulse'}`}
            />
            <span className="text-xs text-slate-400 font-inter">
              {checkingDb
                ? 'Checking…'
                : dbHealthy
                  ? 'System Online'
                  : dbHealthy === false
                    ? 'System Offline'
                    : 'Connecting'}
            </span>
            {checkingDb && <Loader2 size={12} className="animate-spin text-slate-500" />}
          </button>
          <span className="text-[10px] text-slate-500">
            Supabase:{' '}
            {dbHealthy === true ? 'Connected' : dbHealthy === false ? 'Unreachable' : 'Checking…'}
          </span>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <StatsCard
                title="Active Students"
                value={stats.activeStudents}
                icon={Users}
                color="sky"
                index={0}
                trend={{ value: 12, label: 'this month' }}
              />
              <StatsCard
                title="Month Collected"
                value={formatCurrency(stats.monthCollected)}
                icon={TrendingUp}
                color="emerald"
                index={1}
                trend={{ value: 8, label: 'vs last month' }}
              />
              <StatsCard
                title="Pending Fees"
                value={formatCurrency(stats.pendingFees)}
                icon={AlertCircle}
                color="red"
                index={2}
              />
              <StatsCard
                title="Active Exams"
                value={stats.activeExams}
                icon={BookOpen}
                color="violet"
                index={3}
              />
            </>
          )}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <AnimatedSection className="lg:col-span-3 card p-5">
            <h2 className="font-inter font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <TrendingUp size={15} className="text-sky-400" /> Enrollment Trend (Last 6 Months)
            </h2>
            {loading ? (
              <SkeletonBlock h="h-52" />
            ) : (
              <div className="h-48 md:h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={enrollmentData}
                    margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
                  >
                    <defs>
                      <linearGradient id="lineGlow" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#38bdf8" />
                        <stop offset="100%" stopColor="#a78bfa" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis
                      dataKey="month"
                      stroke="#334155"
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#334155"
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={customTooltip} />
                    <Line
                      type="monotone"
                      dataKey="students"
                      name="Students"
                      stroke="url(#lineGlow)"
                      strokeWidth={2.5}
                      dot={{ fill: '#38bdf8', r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 6, fill: '#38bdf8', strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </AnimatedSection>

          <AnimatedSection delay={80} className="lg:col-span-2 card p-5">
            <h2 className="font-inter font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <AlertCircle size={15} className="text-violet-400" /> Fee Status
            </h2>
            {loading ? (
              <SkeletonBlock h="h-52" />
            ) : feeDonut.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-slate-500 text-sm">
                No fee data
              </div>
            ) : (
              <div className="h-48 md:h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={feeDonut}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {feeDonut.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={
                            entry.name === 'Collected'
                              ? PIE_COLORS.collected
                              : entry.name === 'Pending'
                                ? PIE_COLORS.pending
                                : PIE_COLORS.waived
                          }
                          opacity={0.9}
                        />
                      ))}
                    </Pie>
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={(v) => <span className="text-slate-400 text-xs">{v}</span>}
                    />
                    <Tooltip content={customTooltip} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </AnimatedSection>
        </div>

        {/* Bottom 3-col row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Recent Admissions */}
          <AnimatedSection className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-inter font-semibold text-white text-sm flex items-center gap-2">
                <ClipboardList size={15} className="text-sky-400" /> Recent Admissions
              </h2>
              <Link
                to="/admin/admissions"
                className="text-sky-400 text-xs hover:underline flex items-center gap-1"
              >
                View all <ChevronRight size={12} />
              </Link>
            </div>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-3 animate-pulse">
                    <div className="w-8 h-8 rounded-full bg-navy-700 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-navy-700 rounded w-3/4" />
                      <div className="h-2.5 bg-navy-700 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentAdmissions.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-6">No pending admissions</p>
            ) : (
              <div className="space-y-3">
                {recentAdmissions.map((a, i) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={a.name} size="sm" />
                      <div className="min-w-0">
                        <p className="text-white text-xs font-medium truncate font-hind">
                          {a.name}
                        </p>
                        <p className="text-slate-500 text-[10px]">{formatDate(a.created_at)}</p>
                      </div>
                    </div>
                    <Link
                      to="/admin/admissions"
                      className="shrink-0 text-sky-400 text-[10px] border border-sky-400/30 rounded px-2 py-0.5 hover:bg-sky-400/10 transition-colors"
                    >
                      Review
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatedSection>

          {/* Active Exams */}
          <AnimatedSection delay={80} className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-inter font-semibold text-white text-sm flex items-center gap-2">
                <BookOpen size={15} className="text-violet-400" /> Active Exams
              </h2>
              <Link
                to="/admin/exams"
                className="text-sky-400 text-xs hover:underline flex items-center gap-1"
              >
                View all <ChevronRight size={12} />
              </Link>
            </div>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="animate-pulse space-y-1.5">
                    <div className="h-3 bg-navy-700 rounded w-3/4" />
                    <div className="h-2.5 bg-navy-700 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : activeExams.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-6">No active exams</p>
            ) : (
              <div className="space-y-3">
                {activeExams.map((e, i) => (
                  <motion.div
                    key={e.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-white text-xs font-medium truncate font-hind">{e.title}</p>
                      <p className="text-slate-500 text-[10px]">
                        {e.exam_date ? formatDate(e.exam_date) : '—'}
                      </p>
                    </div>
                    <Link
                      to="/admin/exams"
                      className="shrink-0 text-violet-400 text-[10px] border border-violet-400/30 rounded px-2 py-0.5 hover:bg-violet-400/10 transition-colors"
                    >
                      Manage
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatedSection>

          {/* Fee Dues */}
          <AnimatedSection delay={160} className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-inter font-semibold text-white text-sm flex items-center gap-2">
                <AlertCircle size={15} className="text-red-400" /> Fee Dues Alert
              </h2>
              <Link
                to="/admin/fees"
                className="text-sky-400 text-xs hover:underline flex items-center gap-1"
              >
                View all <ChevronRight size={12} />
              </Link>
            </div>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-3 animate-pulse">
                    <div className="w-8 h-8 rounded-full bg-navy-700 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-navy-700 rounded w-3/4" />
                      <div className="h-2.5 bg-navy-700 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : feeDues.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-10 h-10 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mx-auto mb-2">
                  <TrendingUp size={18} className="text-emerald-400" />
                </div>
                <p className="text-emerald-400 text-xs font-medium">All fees up to date!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {feeDues.map((d, i) => (
                  <motion.div
                    key={d.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar name={d.name} size="sm" />
                      <p className="text-white text-xs font-medium truncate font-hind">{d.name}</p>
                    </div>
                    <span className="badge-red text-[10px] shrink-0">{d.count} months</span>
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatedSection>
        </div>
      </div>
    </AdminLayout>
  );
}
