import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import { formatCurrency, cn, sanitize } from '@/lib/utils';
import { handleSupabaseError } from '@/utils/errorHandler';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import { Download, Trophy, BarChart2, Users, DollarSign } from 'lucide-react';

const CHART_TOOLTIP_STYLE = {
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 8,
  color: '#f8fafc',
  fontSize: 12,
};
const COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#f59e0b', '#ef4444', '#f472b6'];

type Tab = 'enrollment' | 'fees' | 'exams' | 'top';
const TABS: { id: Tab; label: string }[] = [
  { id: 'enrollment', label: 'Enrollment' },
  { id: 'fees', label: 'Fee Collection' },
  { id: 'exams', label: 'Exam Summary' },
  { id: 'top', label: 'Top Students' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Enrollment Tab ─────────────────────────────────────────────────────────
function EnrollmentTab() {
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [batchData, setBatchData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: students } = await supabase
          .from('students')
          .select('id,created_at,batch_id,batch:batches(name)')
          .eq('is_approved', true)
          .eq('status', 'active');
        const list = students ?? [];
        setTotal(list.length);

        // Monthly enrollment (last 6 months)
        const now = new Date();
        const months: Record<string, number> = {};
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months[`${MONTHS[d.getMonth()]} ${d.getFullYear()}`] = 0;
        }
        list.forEach((s) => {
          const d = new Date(s.created_at);
          const k = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
          if (k in months) {
            months[k]++;
          }
        });
        setMonthlyData(Object.entries(months).map(([month, students]) => ({ month, students })));

        // By batch
        const byBatch: Record<string, { name: string; students: number }> = {};
        list.forEach((s) => {
          const name = (s as any).batch?.name ?? 'No Batch';
          if (!byBatch[name]) {
            byBatch[name] = { name, students: 0 };
          }
          byBatch[name].students++;
        });
        setBatchData(
          Object.values(byBatch)
            .sort((a, b) => b.students - a.students)
            .slice(0, 8)
        );
      } catch (err) {
        handleSupabaseError(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-48 card animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4 text-center col-span-1 sm:col-span-3">
          <p className="text-slate-400 text-sm">Total Students</p>
          <p className="font-inter font-black text-4xl text-sky-400">{total}</p>
        </div>
      </div>
      <div className="card p-5">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart2 size={15} className="text-sky-400" /> Monthly Enrollment (last 6 months)
        </h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="month" stroke="#475569" tick={{ fontSize: 11 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              <Line
                type="monotone"
                dataKey="students"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={{ fill: '#38bdf8', r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {batchData.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Users size={15} className="text-violet-400" /> Enrollment by Batch
          </h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={batchData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  type="number"
                  stroke="#475569"
                  tick={{ fontSize: 11 }}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="#475569"
                  tick={{ fontSize: 11 }}
                  width={120}
                />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="students" radius={[0, 4, 4, 0]}>
                  {batchData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Fee Collection Tab ──────────────────────────────────────────────────────
function FeesTab() {
  const [donutData, setDonutData] = useState<any[]>([]);
  const [monthlyFees, setMonthlyFees] = useState<any[]>([]);
  const [batchFees, setBatchFees] = useState<any[]>([]);
  const [totals, setTotals] = useState({ collected: 0, pending: 0, overdue: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: fees } = await supabase
          .from('fees')
          .select('amount,status,month,note,batch_id,batch:batches(name)');
        const list = fees ?? [];

        const parseNote = (note?: string | null) => {
          try {
            return note ? JSON.parse(note) : {};
          } catch {
            return {};
          }
        };
        const collected = list
          .filter((f) => f.status === 'paid')
          .reduce((s, f) => {
            const n = parseNote((f as any).note);
            return s + (n.final_amount ?? f.amount ?? 0);
          }, 0);
        const pending = list
          .filter((f) => f.status === 'pending')
          .reduce((s, f) => s + (f.amount ?? 0), 0);
        const overdue = list
          .filter((f) => f.status === 'overdue')
          .reduce((s, f) => s + (f.amount ?? 0), 0);
        setTotals({ collected, pending, overdue });
        setDonutData(
          [
            { name: 'Collected', value: collected },
            { name: 'Pending', value: pending },
            { name: 'Overdue', value: overdue },
          ].filter((d) => d.value > 0)
        );

        // Monthly (last 6 months)
        const now = new Date();
        const months: Record<string, { month: string; collected: number; pending: number }> = {};
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const k = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
          months[k] = { month: MONTHS[d.getMonth()], collected: 0, pending: 0 };
        }
        list.forEach((f) => {
          if (f.month && months[f.month]) {
            if (f.status === 'paid') {
              const n = parseNote((f as any).note);
              months[f.month].collected += n.final_amount ?? f.amount ?? 0;
            } else {
              months[f.month].pending += f.amount ?? 0;
            }
          }
        });
        setMonthlyFees(Object.values(months));

        // By batch
        const byBatch: Record<string, { name: string; collected: number; pending: number }> = {};
        list.forEach((f) => {
          const name = (f as any).batch?.name ?? 'No Batch';
          if (!byBatch[name]) {
            byBatch[name] = { name, collected: 0, pending: 0 };
          }
          if (f.status === 'paid') {
            const n = parseNote((f as any).note);
            byBatch[name].collected += n.final_amount ?? f.amount ?? 0;
          } else {
            byBatch[name].pending += f.amount ?? 0;
          }
        });
        setBatchFees(Object.values(byBatch).sort((a, b) => b.collected - a.collected));
      } catch (err) {
        handleSupabaseError(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const exportCSV = () => {
    const rows = [
      ['Batch', 'Collected', 'Pending'],
      ...batchFees.map((b) => [b.name, String(b.collected), String(b.pending)]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'fee-report.csv';
    a.click();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-48 card animate-pulse" />
        ))}
      </div>
    );
  }

  const DONUT_COLORS = ['#34d399', '#f59e0b', '#ef4444'];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Collected', val: totals.collected, color: 'text-emerald-400' },
          { label: 'Pending', val: totals.pending, color: 'text-amber-400' },
          { label: 'Overdue', val: totals.overdue, color: 'text-red-400' },
        ].map((s) => (
          <div key={s.label} className="card p-4 text-center">
            <p className="text-slate-400 text-xs mb-1">{s.label}</p>
            <p className={cn('font-inter font-black text-lg', s.color)}>{formatCurrency(s.val)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <DollarSign size={15} className="text-emerald-400" /> Fee Distribution
          </h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="value"
                  paddingAngle={3}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(v) => formatCurrency(Number(v))}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart2 size={15} className="text-sky-400" /> Monthly (last 6 months)
          </h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyFees}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" stroke="#475569" tick={{ fontSize: 11 }} />
                <YAxis stroke="#475569" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="collected" fill="#34d399" radius={[4, 4, 0, 0]} name="Collected" />
                <Bar dataKey="pending" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Pending" />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {batchFees.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-navy-700/50">
            <h3 className="font-semibold text-white text-sm">Batch-wise Summary</h3>
            <button onClick={exportCSV} className="btn-outline text-xs py-1 px-3">
              <Download size={12} /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700/50">
                  {['Batch', 'Collected', 'Pending', 'Total'].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-slate-400 text-xs">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batchFees.map((b) => (
                  <tr key={b.name} className="border-b border-navy-700/20 hover:bg-white/[0.02]">
                    <td className="px-4 py-2 text-white text-sm">{b.name}</td>
                    <td className="px-4 py-2 text-emerald-400 font-medium">
                      {formatCurrency(b.collected)}
                    </td>
                    <td className="px-4 py-2 text-amber-400">{formatCurrency(b.pending)}</td>
                    <td className="px-4 py-2 text-slate-300">
                      {formatCurrency(b.collected + b.pending)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Exam Summary Tab ────────────────────────────────────────────────────────
function ExamSummaryTab() {
  const [exams, setExams] = useState<any[]>([]);
  const [examId, setExamId] = useState('');
  const [passData, setPassData] = useState<any[]>([]);
  const [gradeData, setGradeData] = useState<any[]>([]);
  const [top10, setTop10] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from('exams')
      .select('id,title,subject,total_marks,pass_marks')
      .order('created_at', { ascending: false })
      .then(
        ({ data }) =>
          setExams(
            (data ?? []).map((e: any) => ({
              ...e,
              title: sanitize(e.title ?? ''),
              subject: e.subject ?? '',
            }))
          ),
        (err: any) => {
          handleSupabaseError(err);
        }
      );
  }, []);

  useEffect(() => {
    if (!examId) {
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const exam = exams.find((e) => e.id === examId);
        const { data: subs } = await supabase
          .from('mcq_submissions')
          .select('*, student:students(name,student_id)')
          .eq('exam_id', examId)
          .order('score', { ascending: false });
        const list = subs ?? [];
        const total = exam?.total_marks ?? 100;
        const passM = exam?.pass_marks ?? 40;

        const passed = list.filter((s) => s.score >= passM).length;
        setPassData(
          [
            { name: 'Pass', value: passed },
            { name: 'Fail', value: list.length - passed },
          ].filter((d) => d.value > 0)
        );

        const grades = {
          'A+ (80-100%)': 0,
          'A (70-79%)': 0,
          'A- (60-69%)': 0,
          'B (50-59%)': 0,
          'C (40-49%)': 0,
          'D (33-39%)': 0,
          'F (<33%)': 0,
        };
        list.forEach((s) => {
          const pct = (s.score / total) * 100;
          if (pct >= 80) {
            grades['A+ (80-100%)']++;
          } else if (pct >= 70) {
            grades['A (70-79%)']++;
          } else if (pct >= 60) {
            grades['A- (60-69%)']++;
          } else if (pct >= 50) {
            grades['B (50-59%)']++;
          } else if (pct >= 40) {
            grades['C (40-49%)']++;
          } else if (pct >= 33) {
            grades['D (33-39%)']++;
          } else {
            grades['F (<33%)']++;
          }
        });
        setGradeData(Object.entries(grades).map(([grade, count]) => ({ grade, count })));
        setTop10(list.slice(0, 10));
      } catch (err) {
        handleSupabaseError(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [examId, exams]);

  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs text-slate-400 mb-1.5 block">Select Exam</label>
        <select
          value={examId}
          onChange={(e) => setExamId(e.target.value)}
          className="input-field max-w-sm"
        >
          <option value="">— Choose an exam —</option>
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} ({e.subject})
            </option>
          ))}
        </select>
      </div>

      {!examId ? (
        <div className="card p-12 text-center">
          <p className="text-slate-500">Select an exam to view summary</p>
        </div>
      ) : loading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-48 card animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card p-5">
              <h3 className="font-semibold text-white mb-4">Pass / Fail</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={passData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      dataKey="value"
                      paddingAngle={4}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      <Cell fill="#34d399" />
                      <Cell fill="#ef4444" />
                    </Pie>
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card p-5">
              <h3 className="font-semibold text-white mb-4">Grade Distribution</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gradeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="grade" stroke="#475569" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#475569" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {gradeData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {top10.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-navy-700/50 flex items-center gap-2">
                <Trophy size={15} className="text-amber-400" />
                <h3 className="font-semibold text-white text-sm">Top 10 Students</h3>
              </div>
              <div className="divide-y divide-navy-700/20">
                {top10.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="w-7 text-center text-sm">
                      {i < 3 ? (
                        ['🥇', '🥈', '🥉'][i]
                      ) : (
                        <span className="text-slate-500">#{i + 1}</span>
                      )}
                    </span>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">{s.student?.name ?? '—'}</p>
                      <p className="font-mono text-sky-400 text-xs">{s.student?.student_id}</p>
                    </div>
                    <span className="font-inter font-bold text-white">{s.score}</span>
                    <span className="text-slate-500 text-xs">
                      /{exams.find((e) => e.id === examId)?.total_marks}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Top Students Tab ────────────────────────────────────────────────────────
function TopStudentsTab() {
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: subs } = await supabase
          .from('mcq_submissions')
          .select(
            'student_id, score, exam:exams(total_marks), student:students(name,student_id,batch:batches(name))'
          );

        // Average score % per student
        const byStudent: Record<
          string,
          {
            name: string;
            studentId: string;
            batch: string;
            totalScore: number;
            totalMax: number;
            count: number;
          }
        > = {};
        (subs ?? []).forEach((s: any) => {
          if (!s.student) {
            return;
          }
          const key = s.student_id;
          if (!byStudent[key]) {
            byStudent[key] = {
              name: s.student.name,
              studentId: s.student.student_id,
              batch: s.student.batch?.name ?? '—',
              totalScore: 0,
              totalMax: 0,
              count: 0,
            };
          }
          byStudent[key].totalScore += s.score;
          byStudent[key].totalMax += s.exam?.total_marks ?? 100;
          byStudent[key].count++;
        });

        const ranked = Object.values(byStudent)
          .map((s) => ({
            ...s,
            avg: s.totalMax > 0 ? Math.round((s.totalScore / s.totalMax) * 100) : 0,
          }))
          .sort((a, b) => b.avg - a.avg);
        setStudents(ranked);
      } catch (err) {
        handleSupabaseError(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const exportCSV = () => {
    const rows = [
      ['Rank', 'Name', 'Student ID', 'Batch', 'Avg Score %', 'Exams'],
      ...students.map((s, i) => [
        String(i + 1),
        s.name,
        s.studentId,
        s.batch,
        String(s.avg) + '%',
        String(s.count),
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'top-students.csv';
    a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={exportCSV} className="btn-outline text-sm py-1.5 px-3">
          <Download size={13} /> Export CSV
        </button>
      </div>
      <div className="card overflow-hidden">
        {loading ? (
          <div className="divide-y divide-navy-700/20">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 mx-4 my-2 bg-navy-700 rounded animate-pulse" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <p className="text-center py-12 text-slate-500">No exam submissions yet</p>
        ) : (
          <div className="divide-y divide-navy-700/20">
            {students.map((s, i) => {
              const rank = i + 1;
              return (
                <div
                  key={s.studentId}
                  className={cn(
                    'flex items-center gap-3 px-5 py-3',
                    rank <= 3 && 'bg-amber-400/[0.03]'
                  )}
                >
                  <span className="w-8 text-center text-lg shrink-0">
                    {rank <= 3 ? (
                      ['🥇', '🥈', '🥉'][rank - 1]
                    ) : (
                      <span className="text-slate-500 text-sm font-mono">#{rank}</span>
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium text-sm truncate">{s.name}</p>
                    <p className="text-slate-500 text-xs">
                      {s.batch} · {s.count} exams
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-24 hidden sm:block">
                      <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-sky-400 rounded-full"
                          style={{ width: `${s.avg}%` }}
                        />
                      </div>
                    </div>
                    <span
                      className={cn(
                        'font-inter font-bold text-sm w-12 text-right',
                        s.avg >= 75
                          ? 'text-emerald-400'
                          : s.avg >= 50
                            ? 'text-amber-400'
                            : 'text-red-400'
                      )}
                    >
                      {s.avg}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('enrollment');
  return (
    <AdminLayout title="রিপোর্ট ও বিশ্লেষণ">
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
      {tab === 'enrollment' && <EnrollmentTab />}
      {tab === 'fees' && <FeesTab />}
      {tab === 'exams' && <ExamSummaryTab />}
      {tab === 'top' && <TopStudentsTab />}
    </AdminLayout>
  );
}
