import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Copy,
  Check,
  DollarSign,
  BookOpen,
  MessageSquare,
  User,
  ShieldOff,
  ShieldCheck,
  KeyRound,
  Save,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/utils/errorHandler';
import { Avatar } from '@/components/shared/Avatar';
import { SuspendModal } from './SuspendModal';
import { formatDate, formatCurrency, cn, sanitize } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Student {
  id: string;
  student_id?: string;
  name: string;
  email?: string;
  phone: string;
  guardian_name?: string;
  guardian_phone?: string;
  address?: string;
  class_level?: string;
  gender?: string;
  status: 'active' | 'inactive' | 'suspended';
  is_approved?: boolean;
  photo_url?: string;
  batch?: { id: string; name: string };
  created_at: string;
}

interface Props {
  student: Student | null;
  onClose: () => void;
  onStatusChange: () => void;
}

type Tab = 'profile' | 'fees' | 'exams' | 'sms';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Profile', icon: <User size={14} /> },
  { id: 'fees', label: 'Fees', icon: <DollarSign size={14} /> },
  { id: 'exams', label: 'Exams', icon: <BookOpen size={14} /> },
  { id: 'sms', label: 'SMS Log', icon: <MessageSquare size={14} /> },
];

const statusColors = {
  active: 'badge-green',
  inactive: 'badge-yellow',
  suspended: 'badge-red',
};

export function StudentDrawer({ student, onClose, onStatusChange }: Props) {
  const [tab, setTab] = useState<Tab>('profile');
  const [fees, setFees] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (student) {
      setTab('profile');
      setNewPw('');
      setShowPw(false);
    }
  }, [student?.id]);

  const { isLoading: feesLoading } = useQuery({
    queryKey: ['admin', 'student-fees', student?.id],
    enabled: !!student && tab === 'fees',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fees')
        .select('*, batch:batches(name)')
        .eq('student_id', student!.id)
        .order('due_date', { ascending: false });
      if (error) {
        handleSupabaseError(error);
        return null;
      }
      setFees(
        (data ?? []).map((f: any) => ({
          ...f,
          batch: f.batch ? { ...f.batch, name: sanitize(f.batch.name) } : f.batch,
        }))
      );
      return true;
    },
  });

  const { isLoading: examsLoading } = useQuery({
    queryKey: ['admin', 'student-exams', student?.id],
    enabled: !!student && tab === 'exams',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mcq_submissions')
        .select('*, exam:exams(title, exam_date, total_marks)')
        .eq('student_id', student!.id)
        .order('submitted_at', { ascending: false });
      if (error) {
        handleSupabaseError(error);
        return null;
      }
      setExams(
        (data ?? []).map((r: any) => ({
          ...r,
          exam: r.exam ? { ...r.exam, title: sanitize(r.exam.title) } : r.exam,
        }))
      );
      return true;
    },
  });

  const handleResetPassword = async () => {
    if (!student || !newPw.trim()) {
      return;
    }
    setSavingPw(true);
    try {
      await supabase.rpc('change_student_password', {
        p_student_id: student.id,
        p_new_password: newPw.trim(),
      });
      toast.success('Password updated! Student can now login with the new password.');
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSavingPw(false);
    }
    setNewPw('');
  };

  const copyId = () => {
    if (!student?.student_id) {
      return;
    }
    navigator.clipboard.writeText(student.student_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSuspend = async (reason: string) => {
    if (!student) {
      return;
    }
    setStatusLoading(true);
    try {
      const { error } = await supabase
        .from('students')
        .update({ status: 'suspended', suspension_reason: reason })
        .eq('id', student.id);
      if (error) {
        toast.error('Failed to suspend');
        return;
      }
      toast.success('Student suspended');
      setSuspendOpen(false);
      onStatusChange();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleActivate = async () => {
    if (!student) {
      return;
    }
    setStatusLoading(true);
    try {
      const { error } = await supabase
        .from('students')
        .update({ status: 'active' })
        .eq('id', student.id);
      if (error) {
        toast.error('Failed to activate');
        return;
      }
      toast.success('Student activated');
      onStatusChange();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setStatusLoading(false);
    }
  };

  const totalPaid = fees
    .filter((f) => f.status === 'paid')
    .reduce((s, f) => {
      try {
        const note = JSON.parse(f.note ?? '{}');
        return s + (note.final_amount ?? f.amount ?? 0);
      } catch {
        return s + (f.amount ?? 0);
      }
    }, 0);
  const totalDue = fees
    .filter((f) => f.status === 'pending')
    .reduce((s, f) => s + (f.amount ?? 0), 0);

  return (
    <>
      <AnimatePresence>
        {student ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full md:w-[480px] flex flex-col bg-navy-800 border-l border-navy-700/60 shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-navy-700/50 shrink-0">
                <div className="flex items-center gap-3">
                  <Avatar name={student.name} size="md" src={student.photo_url} />
                  <div>
                    <h2 className="font-inter font-bold text-white text-sm">{student.name}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      {student.student_id && (
                        <button
                          onClick={copyId}
                          className="flex items-center gap-1 font-mono text-sky-400 text-xs hover:text-sky-300 transition-colors"
                        >
                          {student.student_id}
                          {copied ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      )}
                      <span className={statusColors[student.status]}>{student.status}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-navy-700/50 shrink-0">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-3 text-xs font-medium transition-all border-b-2',
                      tab === t.id
                        ? 'text-sky-400 border-sky-400'
                        : 'text-slate-400 border-transparent hover:text-white'
                    )}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto">
                {/* Profile Tab */}
                {tab === 'profile' ? (
                  <div className="p-5 space-y-5">
                    {/* Large avatar */}
                    <div className="flex justify-center">
                      <div className="relative group">
                        <Avatar
                          name={student.name}
                          size="lg"
                          src={student.photo_url}
                          className="!w-20 !h-20 text-2xl cursor-pointer ring-2 ring-sky-400/20 ring-offset-2 ring-offset-navy-800"
                        />
                      </div>
                    </div>

                    {/* Info grid */}
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Phone', value: student.phone },
                        { label: 'Email', value: student.email || '—' },
                        { label: 'Guardian', value: student.guardian_name || '—' },
                        { label: 'Guardian Phone', value: student.guardian_phone || '—' },
                        { label: 'Class Level', value: student.class_level || '—' },
                        {
                          label: 'Gender',
                          value: student.gender
                            ? student.gender.charAt(0).toUpperCase() + student.gender.slice(1)
                            : '—',
                        },
                        { label: 'Joined', value: formatDate(student.created_at) },
                        { label: 'Approved', value: student.is_approved ? 'Yes' : 'No' },
                      ].map((item) => (
                        <div key={item.label} className="card p-3">
                          <p className="text-slate-500 text-[10px] mb-1">{item.label}</p>
                          <p className="text-white text-sm font-medium truncate">{item.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Address */}
                    {student.address && (
                      <div className="card p-3">
                        <p className="text-slate-500 text-[10px] mb-1">Address</p>
                        <p className="text-white text-sm">{student.address}</p>
                      </div>
                    )}

                    {/* Enrolled batch */}
                    {student.batch && (
                      <div>
                        <p className="text-slate-500 text-xs mb-2">Enrolled Batch</p>
                        <span className="badge-blue">{student.batch.name}</span>
                      </div>
                    )}

                    {/* Portal credentials */}
                    <div className="card p-4 border border-dashed border-sky-400/20 space-y-3">
                      <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5">
                        <KeyRound size={11} /> Portal Login Credentials
                      </p>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 text-xs">Phone (Login ID)</span>
                          <span className="font-mono text-sky-400 text-xs">{student.phone}</span>
                        </div>
                        {/* Reset password */}
                        <div className="border-t border-white/5 pt-3">
                          <p className="text-slate-600 text-[10px] mb-2">Reset portal password</p>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <input
                                type={showPw ? 'text' : 'password'}
                                value={newPw}
                                onChange={(e) => setNewPw(e.target.value)}
                                className="input-field w-full py-1.5 pr-8 text-xs font-mono"
                                placeholder="New password…"
                                onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
                              />
                              <button
                                type="button"
                                onClick={() => setShowPw((v) => !v)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                aria-label={showPw ? 'Hide password' : 'Show password'}
                              >
                                {showPw ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                            </div>
                            <button
                              onClick={handleResetPassword}
                              disabled={savingPw || !newPw.trim()}
                              className="btn-outline py-1.5 px-3 text-xs shrink-0"
                            >
                              {savingPw ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Save size={11} />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-3 pt-2">
                      {student.status !== 'active' ? (
                        <button
                          onClick={handleActivate}
                          disabled={statusLoading}
                          className="btn-outline flex-1 justify-center text-sm text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                        >
                          <ShieldCheck size={15} />{' '}
                          {statusLoading ? 'Activating…' : 'Activate Student'}
                        </button>
                      ) : (
                        <button
                          onClick={() => setSuspendOpen(true)}
                          className="btn-danger flex-1 justify-center text-sm"
                        >
                          <ShieldOff size={15} /> Suspend Student
                        </button>
                      )}
                    </div>
                    {student.status === 'suspended' && (
                      <p className="text-red-400/80 text-xs text-center">
                        Suspended -- no fees generated, portal login blocked
                      </p>
                    )}
                  </div>
                ) : null}

                {/* Fees Tab */}
                {tab === 'fees' ? (
                  <div className="p-5">
                    {/* Summary */}
                    <div className="grid grid-cols-2 gap-3 mb-5">
                      <div className="card p-3 text-center">
                        <p className="text-slate-500 text-xs mb-1">Total Paid</p>
                        <p className="font-inter font-bold text-emerald-400 text-lg">
                          {formatCurrency(totalPaid)}
                        </p>
                      </div>
                      <div className="card p-3 text-center">
                        <p className="text-slate-500 text-xs mb-1">Total Due</p>
                        <p className="font-inter font-bold text-red-400 text-lg">
                          {formatCurrency(totalDue)}
                        </p>
                      </div>
                    </div>
                    {feesLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <div key={i} className="h-12 bg-navy-700 rounded-lg animate-pulse" />
                        ))}
                      </div>
                    ) : fees.length === 0 ? (
                      <p className="text-slate-500 text-sm text-center py-8">
                        No fee records found
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {fees.map((f) => (
                          <div
                            key={f.id}
                            className="card p-3 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="text-white text-xs font-medium truncate">
                                {f.batch?.name || 'Unknown Batch'}
                              </p>
                              <p className="text-slate-500 text-[10px]">
                                {f.due_date ? formatDate(f.due_date) : '—'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono text-white text-xs">
                                {formatCurrency(f.amount ?? 0)}
                              </span>
                              <span
                                className={
                                  f.status === 'paid'
                                    ? 'badge-green'
                                    : f.status === 'waived'
                                      ? 'badge-violet'
                                      : 'badge-red'
                                }
                              >
                                {f.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Exams Tab */}
                {tab === 'exams' ? (
                  <div className="p-5">
                    {examsLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <div key={i} className="h-14 bg-navy-700 rounded-lg animate-pulse" />
                        ))}
                      </div>
                    ) : exams.length === 0 ? (
                      <p className="text-slate-500 text-sm text-center py-8">
                        No exam submissions found
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {exams.map((r) => (
                          <div key={r.id} className="card p-3">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-white text-xs font-medium truncate pr-2">
                                {r.exam?.title || 'Exam'}
                              </p>
                              <div className="flex items-center gap-2 shrink-0">
                                {r.score !== null && r.score !== undefined && (
                                  <span className="font-mono text-sky-400 text-xs">
                                    {r.score}/{r.total_marks ?? '—'}
                                  </span>
                                )}
                                {r.grade && (
                                  <span className="badge-blue text-[10px]">{r.grade}</span>
                                )}
                              </div>
                            </div>
                            <p className="text-slate-500 text-[10px]">
                              {r.exam?.exam_date ? formatDate(r.exam.exam_date) : '—'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* SMS Log Tab */}
                {tab === 'sms' ? (
                  <div className="p-5">
                    <div className="text-center py-12">
                      <div className="w-12 h-12 rounded-full bg-navy-700 flex items-center justify-center mx-auto mb-3">
                        <MessageSquare size={22} className="text-slate-500" />
                      </div>
                      <p className="text-slate-500 text-sm">SMS log will appear here</p>
                      <p className="text-slate-600 text-xs mt-1">
                        Configure SMS in Admin → Settings
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <SuspendModal
        open={suspendOpen}
        studentName={student?.name ?? ''}
        onConfirm={handleSuspend}
        onCancel={() => setSuspendOpen(false)}
      />
    </>
  );
}
