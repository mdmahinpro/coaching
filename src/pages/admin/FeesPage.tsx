import { useEffect, useState, useCallback, useRef } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/shared/Avatar';
import toast from 'react-hot-toast';
import { formatDate, formatCurrency, cn, sanitize } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  FileText,
  Send,
  Search,
  Printer,
  RefreshCw,
  CheckCircle2,
  Loader2,
  History,
  Eye,
  User,
  ChevronDown,
  ChevronUp,
  SkipForward,
  Ban,
  Banknote,
  CircleDot,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { useSettingsStore } from '@/store/useSettingsStore';
import { sendSMS } from '@/lib/sms';
import { generateReceipt } from '@/lib/pdf';
import { handleSupabaseError } from '@/utils/errorHandler';
import { calculateFinalAmount, daysOverdue } from '@/utils/money';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const now = new Date();

type Tab = 'overview' | 'generate' | 'record' | 'due' | 'audit';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'generate', label: 'Generate Fees' },
  { id: 'record', label: 'Record Payment' },
  { id: 'due', label: 'Due Report' },
  { id: 'audit', label: 'Audit Log' },
];

const generateReceiptNo = () => {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `RCT-${d}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
};

async function logFeeAudit(params: {
  fee_id?: string | null;
  action: string;
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
  student_name?: string;
  student_code?: string;
  month?: string;
}) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from('fee_audit_logs').insert({
      fee_id: params.fee_id ?? null,
      action: params.action,
      admin_email: user?.email ?? 'unknown',
      student_name: params.student_name ?? null,
      student_code: params.student_code ?? null,
      month: params.month ?? null,
      old_data: params.old_data ?? null,
      new_data: params.new_data ?? null,
    });
  } catch {
    // Audit failures must never break the main payment flow
  }
}

// ── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab() {
  const { settings } = useSettingsStore();
  const [payments, setPayments] = useState<any[]>([]); // display table (recent 20)
  const [feeStats, setFeeStats] = useState({ due: 0, collected: 0, pending: 0, overdue: 0 });
  const [genReceiptLoading, setGenReceiptLoading] = useState(false);

  const { isLoading: loading } = useQuery({
    queryKey: ['admin', 'fees', 'payments'],
    queryFn: async () => {
      const [display, stats] = await Promise.all([
        // Display table — joined, limited to 20 most recent
        supabase
          .from('fees')
          .select('*, student:students(name, student_id, photo_url), batch:batches(name)')
          .order('payment_date', { ascending: false })
          .limit(20),
        // Stats — all records, include note so we can use final_amount for collected
        supabase.from('fees').select('amount, status, month, note'),
      ]);
      const err = display.error ?? stats.error;
      if (err) {
        handleSupabaseError(err);
        return null;
      }
      setPayments(
        (display.data ?? []).map((p: any) => ({
          ...p,
          student: p.student ? { ...p.student, name: sanitize(p.student.name) } : p.student,
          batch: p.batch ? { ...p.batch, name: sanitize(p.batch.name) } : p.batch,
        }))
      );
      const all = stats.data ?? [];
      const parseNote = (n: string | null) => {
        try {
          return JSON.parse(n || '{}');
        } catch {
          return {};
        }
      };
      const nowLocal = new Date();
      const thisMonth = `${MONTHS[nowLocal.getMonth()]} ${nowLocal.getFullYear()}`;
      setFeeStats({
        due: all.filter((p) => p.month === thisMonth).reduce((a, p) => a + (p.amount ?? 0), 0),
        collected: all
          .filter((p) => p.status === 'paid')
          .reduce((a, p) => {
            const meta = parseNote(p.note);
            return a + (meta.final_amount ?? p.amount ?? 0);
          }, 0),
        pending: all
          .filter((p) => p.status === 'pending')
          .reduce((a, p) => a + (p.amount ?? 0), 0),
        overdue: all.filter((p) => p.status === 'overdue').length,
      });
      return true;
    },
  });

  const paid = payments.filter((p) => p.status === 'paid');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: 'This Month Due',
            value: formatCurrency(feeStats.due),
            color: 'text-sky-400',
            icon: DollarSign,
          },
          {
            label: 'Collected',
            value: formatCurrency(feeStats.collected),
            color: 'text-emerald-400',
            icon: TrendingUp,
          },
          {
            label: 'Pending',
            value: formatCurrency(feeStats.pending),
            color: 'text-amber-400',
            icon: RefreshCw,
          },
          { label: 'Overdue', value: feeStats.overdue, color: 'text-red-400', icon: AlertTriangle },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <s.icon size={16} className={s.color} />
              <span className="text-slate-500 text-xs">{s.label}</span>
            </div>
            <p className={`font-inter font-bold text-xl ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-navy-700/50">
          <h3 className="font-semibold text-white text-sm">Recent Payments</h3>
        </div>
        {loading ? (
          <div className="divide-y divide-navy-700/30">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 mx-4 my-2 bg-navy-700 rounded animate-pulse" />
            ))}
          </div>
        ) : paid.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-10">No payments recorded yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700/50">
                  {['Receipt #', 'Student', 'Month', 'Amount', 'Method', 'Date', ''].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap text-xs"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paid.slice(0, 20).map((p) => {
                  const meta = (() => {
                    try {
                      return JSON.parse(p.note || '{}');
                    } catch {
                      return {};
                    }
                  })();
                  return (
                    <tr key={p.id} className="border-b border-navy-700/30 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-sky-400 text-xs">
                        {meta.receipt_no || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar
                            name={p.student?.name || '?'}
                            size="sm"
                            src={p.student?.photo_url}
                          />
                          <span className="text-white text-sm">{p.student?.name || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-sm">{p.month}</td>
                      <td className="px-4 py-3 font-medium text-emerald-400">
                        {formatCurrency(meta.final_amount ?? p.amount ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-sm capitalize">
                        {meta.payment_method || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {p.payment_date ? formatDate(p.payment_date) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {meta.receipt_no && (
                          <button
                            onClick={async () => {
                              setGenReceiptLoading(true);
                              try {
                                await generateReceipt({
                                  receiptNo: meta.receipt_no,
                                  date: p.payment_date
                                    ? formatDate(p.payment_date)
                                    : formatDate(new Date().toISOString()),
                                  studentName: p.student?.name || '',
                                  studentId: p.student?.student_id,
                                  batchName: p.batch?.name,
                                  month: p.month,
                                  feeAmount: p.amount,
                                  discount: meta.discount ?? 0,
                                  finalAmount: meta.final_amount ?? p.amount,
                                  paymentMethod: meta.payment_method || 'Cash',
                                  transactionId: meta.transaction_id,
                                  instituteName: settings.centerName,
                                });
                              } catch (err) {
                                console.error('[PDF Error]', err);
                                toast.error('Failed to generate PDF. Please try again.');
                              } finally {
                                setGenReceiptLoading(false);
                              }
                            }}
                            disabled={genReceiptLoading}
                            className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-400 hover:text-sky-400 transition-colors disabled:opacity-50"
                            title="Print Receipt"
                          >
                            {genReceiptLoading ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Printer size={13} />
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Generate Fees Tab ─────────────────────────────────────────────────────────
function GenerateTab({ batches }: { batches: any[] }) {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(MONTHS[now.getMonth()]);
  const [year, setYear] = useState(String(now.getFullYear()));
  const [batchId, setBatchId] = useState('all');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    skippedExisting: number;
    skippedSuspended: number;
  } | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setResult(null);
    let q = supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    if (batchId !== 'all') {
      q = q.eq('batch_id', batchId);
    }
    const { count } = await q;
    setPreviewCount(count ?? 0);
    setLoading(false);
  }, [batchId]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const handleGenerate = async () => {
    const monthStr = `${month} ${year}`;
    setGenerating(true);
    setResult(null);

    try {
      // Fetch students
      let sq = supabase.from('students').select('id, name, batch_id, status');
      if (batchId !== 'all') {
        sq = sq.eq('batch_id', batchId);
      }
      const { data: allStudents } = await sq;

      const suspended = (allStudents ?? []).filter((s) => s.status === 'suspended');
      const active = (allStudents ?? []).filter((s) => s.status === 'active');

      // Fetch existing fee records for this month — filter by student_id only, not batch_id,
      // so students who changed batches don't get duplicate fees generated.
      const { data: existing } = await supabase
        .from('fees')
        .select('student_id')
        .eq('month', monthStr);
      const existingIds = new Set((existing ?? []).map((e) => e.student_id));

      const toCreate = active.filter((s) => !existingIds.has(s.id));

      // Get batch fee amounts — per-batch when generating for all batches
      const batchFeeMap: Record<string, number> = {};
      if (batchId !== 'all') {
        const { data: bd } = await supabase
          .from('batches')
          .select('monthly_fee')
          .eq('id', batchId)
          .single();
        batchFeeMap[batchId] = bd?.monthly_fee ?? 1500;
      } else {
        const { data: batchData } = await supabase.from('batches').select('id, monthly_fee');
        (batchData ?? []).forEach((b) => {
          batchFeeMap[b.id] = b.monthly_fee ?? 1500;
        });
      }

      let created = 0;
      if (toCreate.length > 0) {
        const due = new Date(`${monthStr} 01`);
        due.setDate(10); // due on 10th
        const { error } = await supabase.from('fees').insert(
          toCreate.map((s) => ({
            student_id: s.id,
            batch_id: s.batch_id ?? null,
            amount: s.batch_id ? (batchFeeMap[s.batch_id] ?? 1500) : 1500,
            month: monthStr,
            status: 'pending',
            due_date: due.toISOString().slice(0, 10),
          }))
        );
        if (!error) {
          created = toCreate.length;
          // Audit log — one summary entry for the bulk generation
          logFeeAudit({
            action: 'fee_generated',
            month: monthStr,
            new_data: {
              count: created,
              month: monthStr,
              batch: batchId,
            },
          });
        } else {
          toast.error('Error creating fees: ' + error.message);
          setGenerating(false);
          return;
        }
      }

      setResult({
        created,
        skippedExisting: active.length - toCreate.length,
        skippedSuspended: suspended.length,
      });
      setGenerating(false);
      // Dashboard totals, due lists and audit trail must reflect the new rows.
      queryClient.invalidateQueries({ queryKey: ['admin', 'fees'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'fee-audit-logs'] });
      toast.success(`Generated ${created} fee records!`);
    } catch (err) {
      handleSupabaseError(err);
      setGenerating(false);
    }
  };

  const years = Array.from({ length: 4 }, (_, i) => String(now.getFullYear() - 1 + i));

  return (
    <div className="max-w-lg space-y-5">
      <div className="card p-5 space-y-4">
        <h3 className="font-inter font-semibold text-white">Fee Generation Settings</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="input-field"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Year</label>
            <select value={year} onChange={(e) => setYear(e.target.value)} className="input-field">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Batch</label>
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="input-field"
          >
            <option value="all">All Batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preview */}
      <div className="card p-4 border border-sky-400/15">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 size={15} className="animate-spin" /> Loading preview…
          </div>
        ) : (
          <div>
            <p className="text-white font-medium text-sm">
              <span className="text-sky-400 font-bold text-lg">{previewCount}</span> active students
              will get fee records
            </p>
            <p className="text-slate-500 text-xs mt-1">
              for{' '}
              <span className="text-white">
                {month} {year}
              </span>
            </p>
            <p className="text-amber-400/80 text-xs mt-2">
              <AlertTriangle size={13} className="inline shrink-0" /> Suspended students are automatically skipped
            </p>
          </div>
        )}
      </div>

      <button
        onClick={handleGenerate}
        disabled={generating || loading}
        className="btn-primary w-full justify-center"
      >
        {generating ? (
          <>
            <Loader2 size={15} className="animate-spin" /> Generating…
          </>
        ) : (
          <>
            <FileText size={15} /> Generate Fees for {month} {year}
          </>
        )}
      </button>

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="card p-4 border border-emerald-400/20"
          >
            <p className="font-semibold text-white mb-3">Generation Complete</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-400" /> Fee records created
                </span>
                <span className="text-emerald-400 font-bold">{result.created}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <SkipForward size={14} className="text-amber-400" /> Skipped (already exist)
                </span>
                <span className="text-amber-400 font-bold">{result.skippedExisting}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Ban size={14} className="text-red-400" /> Skipped (suspended)
                </span>
                <span className="text-red-400 font-bold">{result.skippedSuspended}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Record Payment Tab ────────────────────────────────────────────────────────
function RecordPaymentTab() {
  const queryClient = useQueryClient();
  const { settings } = useSettingsStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [unpaidFees, setUnpaidFees] = useState<any[]>([]);
  const [selectedFee, setSelectedFee] = useState<any | null>(null);
  const [discount, setDiscount] = useState(0);
  const [discountReason, setDiscountReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bkash' | 'nagad'>('cash');
  const [transactionId, setTransactionId] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [sendSMSFlag, setSendSMSFlag] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printReceiptLoading, setPrintReceiptLoading] = useState(false);
  const [savedReceipt, setSavedReceipt] = useState<string | null>(null);
  const [savedData, setSavedData] = useState<any | null>(null);
  const dq = useDebounce(query, 250);
  const dropRef = useRef<HTMLDivElement>(null);

  useQuery({
    queryKey: ['admin', 'fees', 'student-search', dq],
    enabled: !!dq,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('id, name, student_id, phone, photo_url, batch:batches(id,name)')
        .or(`name.ilike.%${dq}%,student_id.ilike.%${dq}%`)
        .eq('status', 'active')
        .limit(8);
      if (error) {
        handleSupabaseError(error);
        return null;
      }
      setResults(
        (data ?? []).map((x: any) => ({
          ...x,
          name: sanitize(x.name),
          batch: x.batch ? { ...x.batch, name: sanitize(x.batch.name) } : x.batch,
        }))
      );
      setShowDropdown(true);
      return true;
    },
  });

  // Clear the dropdown when the search box is emptied.
  useEffect(() => {
    if (!dq) {
      setResults([]);
      setShowDropdown(false);
    }
  }, [dq]);

  useQuery({
    queryKey: ['admin', 'fees', 'unpaid', selectedStudent?.id],
    enabled: !!selectedStudent,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fees')
        .select('*, batch:batches(name)')
        .eq('student_id', selectedStudent.id)
        .neq('status', 'paid')
        .order('due_date', { ascending: true });
      if (error) {
        handleSupabaseError(error);
        return null;
      }
      setUnpaidFees(
        (data ?? []).map((f: any) => ({ ...f, batch: { name: sanitize(f.batch?.name ?? '') } }))
      );
      return true;
    },
  });

  const finalAmount = calculateFinalAmount(selectedFee?.amount ?? 0, discount);

  const handleSave = async () => {
    if (!selectedFee || !selectedStudent) {
      return;
    }
    setSaving(true);
    const receiptNo = generateReceiptNo();
    const meta = {
      receipt_no: receiptNo,
      payment_method: paymentMethod,
      transaction_id: transactionId,
      discount,
      discount_reason: discountReason,
      final_amount: finalAmount,
      received_by: receivedBy,
      notes,
    };

    const { error } = await supabase
      .from('fees')
      .update({
        status: 'paid',
        payment_date: new Date().toISOString(),
        note: JSON.stringify(meta),
      })
      .eq('id', selectedFee.id);

    if (error) {
      toast.error('Payment failed: ' + error.message);
      setSaving(false);
      return;
    }

    // Audit log — fire-and-forget, never blocks payment flow
    logFeeAudit({
      fee_id: selectedFee.id,
      action: 'payment_recorded',
      old_data: {
        status: selectedFee.status,
        note: selectedFee.note ?? null,
        amount: selectedFee.amount,
      },
      new_data: {
        status: 'paid',
        amount: selectedFee.amount,
        ...meta,
      },
      student_name: selectedStudent.name,
      student_code: selectedStudent.student_id,
      month: selectedFee.month,
    });

    // SMS
    if (sendSMSFlag && selectedStudent.phone) {
      try {
        const msg = `প্রিয় ${selectedStudent.name}, ৳${finalAmount} ফি গ্রহণ করা হয়েছে। রশিদ: ${receiptNo}। ধন্যবাদ - ${settings.centerName}`;
        await sendSMS(selectedStudent.phone, msg, 'FEE_PAID');
      } catch (err) {
        handleSupabaseError(err);
      }
    }

    setSavedReceipt(receiptNo);
    setSavedData({
      ...meta,
      studentName: selectedStudent.name,
      studentId: selectedStudent.student_id,
      batchName: selectedFee.batch?.name,
      month: selectedFee.month,
      feeAmount: selectedFee.amount,
    });
    toast.success(`Payment recorded! Receipt: ${receiptNo}`);
    setSaving(false);

    // Paid amounts, due lists, audit log and dashboard must update immediately.
    queryClient.invalidateQueries({ queryKey: ['admin', 'fees'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'fee-audit-logs'] });
    queryClient.invalidateQueries({ queryKey: ['portal', 'fees'] });
    queryClient.invalidateQueries({ queryKey: ['portal', 'dashboard'] });

    // POS behaviour: the receipt prints the moment the payment is taken.
    // Never blocks the payment flow if PDF generation fails.
    try {
      await generateReceipt({
        receiptNo,
        date: formatDate(new Date().toISOString()),
        studentName: selectedStudent.name,
        studentId: selectedStudent.student_id,
        batchName: selectedFee.batch?.name,
        month: selectedFee.month,
        feeAmount: selectedFee.amount,
        discount,
        finalAmount,
        paymentMethod,
        transactionId: transactionId || undefined,
        receivedBy: receivedBy || undefined,
        instituteName: settings.centerName,
        instituteAddress: settings.centerAddress,
        institutePhone: settings.centerPhone,
      });
    } catch (err) {
      console.error('[POS receipt]', err);
    }

    // Reset for next payment
    setUnpaidFees((prev) => prev.filter((f) => f.id !== selectedFee.id));
    setSelectedFee(null);
    setDiscount(0);
    setDiscountReason('');
    setTransactionId('');
    setNotes('');
  };

  const printReceipt = async () => {
    if (!savedData) {
      return;
    }
    try {
      await generateReceipt({
        receiptNo: savedReceipt!,
        date: formatDate(new Date().toISOString()),
        studentName: savedData.studentName,
        studentId: savedData.studentId,
        batchName: savedData.batchName,
        month: savedData.month,
        feeAmount: savedData.feeAmount,
        discount: savedData.discount,
        finalAmount: savedData.final_amount,
        paymentMethod: savedData.payment_method,
        transactionId: savedData.transaction_id,
        instituteName: settings.centerName,
        instituteAddress: settings.centerAddress,
        institutePhone: settings.centerPhone,
      });
    } catch (err) {
      console.error('[PDF Error]', err);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const PAYMENT_METHODS: {
    id: 'cash' | 'bkash' | 'nagad';
    label: string;
    icon: LucideIcon;
    sub?: string;
  }[] = [
    { id: 'cash', label: 'Cash', icon: Banknote },
    { id: 'bkash', label: 'bKash', icon: Smartphone, sub: '01XXXXXXXXX' },
    { id: 'nagad', label: 'Nagad', icon: CircleDot, sub: '01XXXXXXXXX' },
  ];

  return (
    <div className="max-w-xl space-y-5">
      {/* Student search */}
      <div>
        <label className="text-xs text-slate-400 mb-1.5 block">Search Student</label>
        <div className="relative" ref={dropRef}>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedStudent(null);
              setSelectedFee(null);
              setSavedReceipt(null);
            }}
            className="input-field pl-9"
            placeholder="Name or Student ID…"
          />
          <AnimatePresence>
            {showDropdown && results.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute top-full left-0 right-0 mt-1 card-glass border border-navy-600 z-20 max-h-52 overflow-y-auto"
              >
                {results.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedStudent(s);
                      setQuery(s.name);
                      setShowDropdown(false);
                      setSavedReceipt(null);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                  >
                    <Avatar name={s.name} size="sm" src={s.photo_url} />
                    <div>
                      <p className="text-white text-sm font-medium">{s.name}</p>
                      <p className="font-mono text-sky-400 text-xs">{s.student_id}</p>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {selectedStudent && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Student card */}
            <div className="card p-4 flex items-center gap-4">
              <Avatar name={selectedStudent.name} size="md" src={selectedStudent.photo_url} />
              <div>
                <p className="font-semibold text-white">{selectedStudent.name}</p>
                <p className="font-mono text-sky-400 text-xs">{selectedStudent.student_id}</p>
                <p className="text-slate-400 text-xs">{selectedStudent.batch?.name}</p>
              </div>
            </div>

            {/* Unpaid fee selector */}
            {unpaidFees.length === 0 ? (
              <div className="card p-4 text-center">
                <CheckCircle2 size={24} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">No pending fees for this student</p>
              </div>
            ) : (
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Select Fee Record</label>
                <div className="space-y-2">
                  {unpaidFees.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSelectedFee(f)}
                      className={cn(
                        'w-full card p-3 flex items-center justify-between border-2 transition-all text-left',
                        selectedFee?.id === f.id
                          ? 'border-sky-400/60 bg-sky-400/5'
                          : 'border-transparent hover:border-white/10'
                      )}
                    >
                      <div>
                        <p className="text-white text-sm font-medium">{f.month}</p>
                        <p className="text-slate-500 text-xs">{f.batch?.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-inter font-bold text-white">
                          {formatCurrency(f.amount)}
                        </p>
                        <span
                          className={
                            f.status === 'overdue' ? 'badge-red text-xs' : 'badge-yellow text-xs'
                          }
                        >
                          {f.status}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Payment form */}
            {selectedFee && (
              <div className="space-y-4">
                {/* Discount */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Discount ৳</label>
                    <input
                      type="number"
                      min={0}
                      max={selectedFee.amount}
                      value={discount}
                      onChange={(e) => setDiscount(Number(e.target.value))}
                      className="input-field"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Reason</label>
                    <input
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      className="input-field"
                      placeholder="Optional"
                    />
                  </div>
                </div>

                {/* Final amount preview */}
                <div className="card p-3 flex items-center justify-between">
                  <span className="text-slate-400 text-sm">Final Amount</span>
                  <span className="font-inter font-black text-emerald-400 text-xl">
                    {formatCurrency(finalAmount)}
                  </span>
                </div>

                {/* Payment method */}
                <div>
                  <label className="text-xs text-slate-400 mb-2 block">Payment Method</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPaymentMethod(m.id)}
                        className={cn(
                          'card p-3 flex flex-col items-center gap-1 border-2 transition-all',
                          paymentMethod === m.id
                            ? 'border-sky-400/60 bg-sky-400/5'
                            : 'border-transparent hover:border-white/10'
                        )}
                      >
                        <m.icon size={20} className="text-sky-400" />
                        <span className="text-xs font-medium text-white">{m.label}</span>
                        {m.sub && <span className="text-[10px] text-slate-500">{m.sub}</span>}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Transaction ID (bKash/Nagad) */}
                {paymentMethod !== 'cash' && (
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Transaction ID</label>
                    <input
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value)}
                      className="input-field font-mono"
                      placeholder="TRXXXXXXXXXXXXXXXID"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Received By</label>
                    <input
                      value={receivedBy}
                      onChange={(e) => setReceivedBy(e.target.value)}
                      className="input-field"
                      placeholder="Staff name"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Notes</label>
                    <input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="input-field"
                      placeholder="Optional"
                    />
                  </div>
                </div>

                {/* SMS checkbox */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendSMSFlag}
                    onChange={(e) => setSendSMSFlag(e.target.checked)}
                    className="rounded accent-sky-400 w-4 h-4"
                  />
                  <span className="text-slate-400 text-sm">Send payment confirmation SMS</span>
                </label>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary w-full justify-center"
                >
                  {saving ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={15} /> Record Payment
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Receipt success */}
            {savedReceipt && savedData && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card p-4 border border-emerald-400/20 text-center"
              >
                <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-white font-semibold mb-1">Payment Recorded!</p>
                <p className="font-mono text-sky-400 text-sm mb-3">{savedReceipt}</p>
                <button
                  onClick={async () => {
                    setPrintReceiptLoading(true);
                    await printReceipt();
                    setPrintReceiptLoading(false);
                  }}
                  disabled={printReceiptLoading}
                  className="btn-outline justify-center w-full"
                >
                  {printReceiptLoading ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Generating…
                    </>
                  ) : (
                    <>
                      <Printer size={15} /> Print Receipt (PDF)
                    </>
                  )}
                </button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Due Report Tab ────────────────────────────────────────────────────────────
function DueReportTab({ batches }: { batches: any[] }) {
  const { settings } = useSettingsStore();
  type DueFilter = 'this_month' | 'last_month' | 'overdue_2' | string;
  const [filter, setFilter] = useState<DueFilter>('this_month');
  const [batchFilter, setBatchFilter] = useState('all');
  const [dues, setDues] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);

  const { isLoading: loading, refetch: load } = useQuery({
    queryKey: ['admin', 'fees', 'due-list', filter, batchFilter],
    queryFn: async () => {
      const nowLoad = new Date();
      const thisMonthLoad = `${MONTHS[nowLoad.getMonth()]} ${nowLoad.getFullYear()}`;
      const lastMonthLoad = `${MONTHS[nowLoad.getMonth() === 0 ? 11 : nowLoad.getMonth() - 1]} ${nowLoad.getMonth() === 0 ? nowLoad.getFullYear() - 1 : nowLoad.getFullYear()}`;
      let q = supabase
        .from('fees')
        .select('*, student:students(id, name, student_id, phone, photo_url), batch:batches(name)')
        .neq('status', 'paid')
        .order('due_date', { ascending: true });

      if (filter === 'this_month') {
        q = q.eq('month', thisMonthLoad);
      } else if (filter === 'last_month') {
        q = q.eq('month', lastMonthLoad);
      } else if (filter === 'overdue_2') {
        // months older than 2 months
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 2);
        q = q.lt('due_date', cutoff.toISOString().slice(0, 10));
      }
      if (batchFilter !== 'all') {
        q = q.eq('batch_id', batchFilter);
      }

      const { data, error } = await q.limit(100);
      if (error) {
        handleSupabaseError(error);
        return null;
      }
      setDues(
        (data ?? []).map((f: any) => ({
          ...f,
          student: f.student ? { ...f.student, name: sanitize(f.student.name ?? '') } : f.student,
          batch: f.batch ? { ...f.batch, name: sanitize(f.batch.name ?? '') } : f.batch,
        }))
      );
      return true;
    },
  });

  const sendReminder = async (fee: any) => {
    if (!fee.student?.phone) {
      toast.error('No phone number');
      return;
    }
    setSending(fee.id);
    const msg = `প্রিয় ${fee.student.name}, ${fee.month} মাসের ৳${fee.amount} ফি বাকি আছে। দয়া করে পরিশোধ করুন। - ${settings.centerName}`;
    const res = await sendSMS(fee.student.phone, msg, 'FEE_REMINDER');
    toast.success(`SMS ${res.sent > 0 ? 'sent' : 'queued'} to ${fee.student.name}`);
    setSending(null);
  };

  const sendBulkSMS = async () => {
    const targets = dues.filter((f) => selected.has(f.id) && f.student?.phone);
    if (!targets.length) {
      return;
    }
    setBulkSending(true);
    for (const fee of targets) {
      const msg = `প্রিয় ${fee.student.name}, ${fee.month} মাসের ৳${fee.amount} ফি বাকি আছে। দয়া করে পরিশোধ করুন। - ${settings.centerName}`;
      await sendSMS(fee.student.phone, msg, 'FEE_REMINDER');
    }
    toast.success(`SMS sent to ${targets.length} students`);
    setBulkSending(false);
    setSelected(new Set());
  };

  const toggleAll = () => {
    if (selected.size === dues.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(dues.map((f) => f.id)));
    }
  };

  const DUE_FILTERS: { id: DueFilter; label: string }[] = [
    { id: 'this_month', label: 'This Month' },
    { id: 'last_month', label: 'Last Month' },
    { id: 'overdue_2', label: '2+ Months Overdue' },
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {DUE_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`filter-pill ${filter === f.id ? 'active' : ''}`}
          >
            {f.label}
          </button>
        ))}
        <select
          value={batchFilter}
          onChange={(e) => setBatchFilter(e.target.value)}
          className="input-field py-1.5 text-sm max-w-[160px]"
        >
          <option value="all">All Batches</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {selected.size > 0 && (
          <button
            onClick={sendBulkSMS}
            disabled={bulkSending}
            className="btn-primary text-sm py-1.5 ml-auto"
          >
            {bulkSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send SMS to {selected.size} selected
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="divide-y divide-navy-700/30">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 mx-4 my-2 bg-navy-700 rounded animate-pulse" />
            ))}
          </div>
        ) : dues.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-10">No dues found for this filter</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700/50">
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      className="rounded accent-sky-400"
                      onChange={toggleAll}
                      checked={selected.size === dues.length && dues.length > 0}
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium text-xs">
                    Student ID
                  </th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium text-xs">Name</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium text-xs">Batch</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium text-xs">Month</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium text-xs">Amount</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium text-xs">
                    Days Overdue
                  </th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium text-xs">Phone</th>
                  <th className="px-4 py-3 text-slate-400 font-medium text-xs">SMS</th>
                </tr>
              </thead>
              <tbody>
                {dues.map((f) => {
                  const days = daysOverdue(f.month);
                  return (
                    <tr key={f.id} className="border-b border-navy-700/30 hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="rounded accent-sky-400"
                          checked={selected.has(f.id)}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const n = new Set(prev);
                              e.target.checked ? n.add(f.id) : n.delete(f.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-sky-400 text-xs">
                        {f.student?.student_id || '—'}
                      </td>
                      <td className="px-4 py-3 text-white text-sm">{f.student?.name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="badge-blue text-xs">{f.batch?.name || '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-sm">{f.month}</td>
                      <td className="px-4 py-3 font-medium text-red-400">
                        {formatCurrency(f.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'font-medium text-sm',
                            days > 30
                              ? 'text-red-400'
                              : days > 10
                                ? 'text-amber-400'
                                : 'text-slate-400'
                          )}
                        >
                          {days}d
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-sm">
                        {f.student?.phone || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => sendReminder(f)}
                          disabled={sending === f.id || !f.student?.phone}
                          className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-400 hover:text-sky-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Send SMS Reminder"
                        >
                          {sending === f.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Send size={13} />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Audit Log Tab ─────────────────────────────────────────────────────────────
const ACTION_META: Record<string, { label: string; color: string; bg: string }> = {
  payment_recorded: {
    label: 'Payment Recorded',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
  },
  fee_generated: { label: 'Fees Generated', color: 'text-sky-400', bg: 'bg-sky-400/10' },
  fee_deleted: { label: 'Fee Deleted', color: 'text-red-400', bg: 'bg-red-400/10' },
};

function AuditLogTab() {
  const [filter, setFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const PER_PAGE = 50;

  const { data: logPages, isLoading: loading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['admin', 'fee-audit-logs', filter],
      initialPageParam: 0,
      queryFn: async ({ pageParam }) => {
        let q = supabase
          .from('fee_audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .range(pageParam * PER_PAGE, (pageParam + 1) * PER_PAGE - 1);
        if (filter !== 'all') {
          q = q.eq('action', filter);
        }
        const { data, error } = await q;
        if (error) {
          handleSupabaseError(error);
          return [];
        }
        return data ?? [];
      },
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length === PER_PAGE ? allPages.length : undefined,
    });

  const logs = (logPages?.pages ?? []).flat();
  const hasMore = !!hasNextPage;

  const load = () => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  };

  const formatDetail = (log: any): string => {
    if (log.action === 'payment_recorded' && log.new_data) {
      const d = log.new_data as any;
      const parts: string[] = [`৳${d.final_amount ?? '?'}`];
      if ((d.discount ?? 0) > 0) {
        parts.push(`(৳${d.discount} discount)`);
      }
      if (d.payment_method) {
        parts.push(`via ${d.payment_method}`);
      }
      if (d.receipt_no) {
        parts.push(`• ${d.receipt_no}`);
      }
      return parts.join(' ');
    }
    if (log.action === 'fee_generated' && log.new_data) {
      const d = log.new_data as any;
      const batchPart = d.batch && d.batch !== 'all' ? ' (single batch)' : '';
      return `${d.count} record${d.count !== 1 ? 's' : ''} created for ${d.month}${batchPart}`;
    }
    return '—';
  };

  const FILTER_OPTIONS = [
    { id: 'all', label: 'All Activity' },
    { id: 'payment_recorded', label: 'Payments Only' },
    { id: 'fee_generated', label: 'Generation Only' },
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`filter-pill ${filter === f.id ? 'active' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-slate-500 text-xs">
          All fee changes by admins are recorded here permanently
        </span>
      </div>

      <div className="card overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="divide-y divide-navy-700/30">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 mx-4 my-2 bg-navy-700 rounded animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16">
            <History size={32} className="text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500 text-sm font-medium">No audit entries yet</p>
            <p className="text-slate-600 text-xs mt-1">
              Every payment recorded or fee generated will appear here
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-700/50">
                    {['Date & Time', 'Action', 'Admin', 'Student', 'Month', 'Summary', ''].map(
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
                  {logs.map((log) => {
                    const meta = ACTION_META[log.action] ?? {
                      label: log.action,
                      color: 'text-slate-400',
                      bg: 'bg-slate-400/10',
                    };
                    const isExp = expanded === log.id;
                    const dt = new Date(log.created_at);
                    return (
                      <>
                        <tr
                          key={log.id}
                          className="border-b border-navy-700/30 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="text-slate-300 text-xs">
                              {dt.toLocaleDateString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </p>
                            <p className="text-slate-600 text-xs">
                              {dt.toLocaleTimeString('en-GB', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                'text-xs font-medium px-2.5 py-1 rounded-full',
                                meta.color,
                                meta.bg
                              )}
                            >
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {log.admin_email ? (
                              <span className="flex items-center gap-1.5 text-slate-300 text-xs">
                                <User size={11} className="text-slate-500 shrink-0" />
                                {log.admin_email}
                              </span>
                            ) : (
                              <span className="text-slate-600 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {log.student_name ? (
                              <div>
                                <p className="text-white text-sm font-medium">{log.student_name}</p>
                                {log.student_code && (
                                  <p className="font-mono text-sky-400 text-xs">
                                    {log.student_code}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-600 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-300 text-sm whitespace-nowrap">
                            {log.month || '—'}
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs max-w-xs">
                            {formatDetail(log)}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setExpanded(isExp ? null : log.id)}
                              className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1 text-xs"
                              title="View raw before/after data"
                            >
                              <Eye size={12} />
                              {isExp ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                          </td>
                        </tr>
                        {isExp && (
                          <tr key={`${log.id}-exp`} className="border-b border-navy-700/30">
                            <td colSpan={7} className="px-6 py-4 bg-navy-900/50">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <p className="text-slate-500 text-xs font-medium mb-2 uppercase tracking-wide">
                                    Before
                                  </p>
                                  <pre className="text-slate-400 text-xs bg-navy-800/70 border border-navy-700/50 rounded-lg p-3 overflow-x-auto font-mono leading-relaxed">
                                    {log.old_data
                                      ? JSON.stringify(log.old_data, null, 2)
                                      : 'null  (new record — no prior state)'}
                                  </pre>
                                </div>
                                <div>
                                  <p className="text-slate-500 text-xs font-medium mb-2 uppercase tracking-wide">
                                    After
                                  </p>
                                  <pre className="text-slate-400 text-xs bg-navy-800/70 border border-navy-700/50 rounded-lg p-3 overflow-x-auto font-mono leading-relaxed">
                                    {log.new_data ? JSON.stringify(log.new_data, null, 2) : 'null'}
                                  </pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="p-4 text-center border-t border-navy-700/50">
                <button
                  onClick={() => load()}
                  disabled={loading || isFetchingNextPage}
                  className="btn-outline text-sm"
                >
                  {loading || isFetchingNextPage ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    'Load More'
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FeesPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [batches, setBatches] = useState<any[]>([]);

  useQuery({
    queryKey: ['admin', 'fees', 'batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('id,name,monthly_fee')
        .eq('is_active', true)
        .order('name');
      if (error) {
        handleSupabaseError(error);
        return null;
      }
      setBatches(data ?? []);
      return true;
    },
  });

  return (
    <AdminLayout title="ফি ব্যবস্থাপনা">
      {/* Tabs */}
      <div className="flex border-b border-navy-700/50 mb-6 gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              'px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all ' +
              (tab === t.id
                ? 'text-sky-400 border-sky-400'
                : 'text-slate-400 border-transparent hover:text-white')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'generate' && <GenerateTab batches={batches} />}
      {tab === 'record' && <RecordPaymentTab />}
      {tab === 'due' && <DueReportTab batches={batches} />}
      {tab === 'audit' && <AuditLogTab />}
    </AdminLayout>
  );
}
