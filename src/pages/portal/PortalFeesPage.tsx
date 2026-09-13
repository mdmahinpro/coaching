import { useEffect, useState, useCallback } from 'react';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { fetchFees, submitPaymentApproval, fetchMyPaymentApprovals } from '@/lib/portalApi';
import { handleSupabaseError } from '@/utils/errorHandler';
import { useStudentStore } from '@/store/useStudentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Receipt,
  Smartphone,
  ExternalLink,
  DollarSign,
  Loader2,
  X,
  Send,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { generateStudentReceipt } from '@/lib/pdf';
import { logError } from '@/utils/logger';

interface Fee {
  id: string;
  student_id: string;
  month: string;
  amount: number;
  status: 'paid' | 'pending' | 'overdue' | 'waived';
  payment_date?: string;
  note?: string;
}

interface Approval {
  id: string;
  fee_id: string;
  month: string;
  amount: number;
  method: string;
  transaction_id: string;
  status: string;
}

export default function PortalFeesPage() {
  const { student } = useStudentStore();
  const { settings } = useSettingsStore();
  const [fees, setFees] = useState<Fee[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadReceiptLoading, setDownloadReceiptLoading] = useState(false);
  // Fee payment submission modal state.
  const [submitFor, setSubmitFor] = useState<Fee | null>(null);
  const [trxMethod, setTrxMethod] = useState('bkash');
  const [trxId, setTrxId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    if (!student) {
      return;
    }
    Promise.all([fetchFees(), fetchMyPaymentApprovals()])
      .then(
        ([feeData, approvalData]) => {
          setFees((feeData ?? []) as Fee[]);
          setApprovals((approvalData ?? []) as Approval[]);
          setLoading(false);
        },
        (err: any) => {
          handleSupabaseError(err);
          setLoading(false);
        }
      )
      .catch(() => setLoading(false));
  }, [student?.id, student?.token]);

  useEffect(() => {
    load();
  }, [load]);

  const openSubmit = (fee: Fee, method: string) => {
    setTrxMethod(method);
    setTrxId('');
    setSubmitFor(fee);
  };

  const handleSubmitPayment = async () => {
    if (!submitFor || trxId.trim().length < 4) {
      toast.error('সঠিক ট্রানজেকশন আইডি লিখুন');
      return;
    }
    setSubmitting(true);
    try {
      await submitPaymentApproval({
        feeId: submitFor.id,
        method: trxMethod,
        transactionId: trxId.trim(),
      });
      toast.success('ট্রানজেকশন আইডি জমা হয়েছে। অনুমোদনের অপেক্ষায়…');
      setSubmitFor(null);
      load(); // refresh approvals + fees
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('PENDING_APPROVAL_EXISTS')) {
        toast.error('এই ফির জন্য ইতিমধ্যে অনুমোদনের অপেক্ষায় আছে');
      } else if (msg.includes('FEE_ALREADY_PAID')) {
        toast.success('ফি ইতিমধ্যে পরিশোধিত');
      } else if (msg.includes('TRANSACTION_ID_REQUIRED')) {
        toast.error('ট্রানজেকশন আইডি প্রয়োজন');
      } else {
        handleSupabaseError(err);
      }
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const parseNote = (note?: string) => {
    if (!note) {
      return {} as Record<string, any>;
    }
    try {
      return JSON.parse(note) as Record<string, any>;
    } catch {
      return {} as Record<string, any>;
    }
  };

  const paid = fees.filter((f) => f.status === 'paid');
  const pending = fees.filter((f) => f.status === 'pending' || f.status === 'overdue');
  const totalPaid = paid.reduce((s, f) => {
    const n = parseNote(f.note);
    return s + (n.final_amount ?? f.amount);
  }, 0);
  const totalPending = pending.reduce((s, f) => s + f.amount, 0);

  const downloadReceipt = async (fee: Fee) => {
    const note = parseNote(fee.note);
    try {
      await generateStudentReceipt({
        receiptNo: note.receipt_no ?? fee.id.slice(-8).toUpperCase(),
        date: fee.payment_date
          ? formatDate(fee.payment_date)
          : formatDate(new Date().toISOString()),
        studentName: student?.name ?? '',
        studentId: student?.student_id,
        month: fee.month,
        feeAmount: fee.amount,
        discount: note.discount ?? 0,
        finalAmount: note.final_amount ?? fee.amount,
        paymentMethod: note.payment_method ?? 'Cash',
        transactionId: note.transaction_id,
        instituteName: settings.centerName,
        instituteAddress: settings.centerAddress,
        institutePhone: settings.centerPhone,
        receiptFooter: settings.receiptFooter,
      });
    } catch (err) {
      logError('Student receipt PDF generation failed', {
        source: 'PortalFeesPage',
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const FeeCard = ({ fee }: { fee: Fee }) => {
    const note = parseNote(fee.note);
    const isPaid = fee.status === 'paid';
    const isOverdue = fee.status === 'overdue';
    const isWaived = fee.status === 'waived';
    // Is there a pending (or just-approved) submission for this fee?
    const myApproval = approvals.find((a) => a.fee_id === fee.id);
    const hasPendingApproval = !!myApproval && myApproval.status === 'pending';

    return (
      <div
        className={cn(
          'card p-4 border-l-4 transition-all',
          isPaid
            ? 'border-l-emerald-400'
            : isOverdue
              ? 'border-l-red-400'
              : isWaived
                ? 'border-l-slate-500'
                : 'border-l-amber-400'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div
              className={cn(
                'p-2 rounded-xl shrink-0 mt-0.5',
                isPaid
                  ? 'bg-emerald-400/10'
                  : isOverdue
                    ? 'bg-red-400/10'
                    : isWaived
                      ? 'bg-white/5'
                      : 'bg-amber-400/10'
              )}
            >
              {isPaid ? (
                <CheckCircle2 size={16} className="text-emerald-400" />
              ) : isOverdue ? (
                <AlertCircle size={16} className="text-red-400" />
              ) : isWaived ? (
                <DollarSign size={16} className="text-slate-500" />
              ) : (
                <Clock size={16} className="text-amber-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="font-semibold text-white font-hind">{fee.month}</h3>
                <span
                  className={cn(
                    'text-xs',
                    isPaid
                      ? 'badge-green'
                      : isOverdue
                        ? 'badge-red'
                        : isWaived
                          ? 'text-slate-400 bg-white/5 px-2 py-0.5 rounded-full'
                          : 'badge-yellow'
                  )}
                >
                  {isPaid ? 'পরিশোধিত' : isOverdue ? 'বকেয়া' : isWaived ? 'মওকুফ' : 'অপরিশোধিত'}
                </span>
              </div>
              <p className="font-inter font-bold text-white">
                {formatCurrency(note.final_amount ?? fee.amount)}
              </p>
              {isPaid && fee.payment_date && (
                <p className="text-slate-500 text-xs mt-0.5 font-hind">
                  পরিশোধ: {formatDate(fee.payment_date)}
                </p>
              )}
              {hasPendingApproval && (
                <div className="mt-3 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 flex items-center gap-2">
                  <Clock size={14} className="text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sky-300 text-xs font-medium">অনুমোদনের অপেক্ষায়</p>
                    <p className="text-slate-400 text-[11px] truncate font-mono">
                      {myApproval?.method} · {myApproval?.transaction_id}
                    </p>
                  </div>
                </div>
              )}
              {!isPaid && !isWaived && (
                <div className="mt-3 space-y-2">
                  <p className="text-slate-400 text-xs font-semibold">
                    {hasPendingApproval ? 'আরও পেমেন্ট করতে:' : 'পেমেন্ট করতে:'}
                  </p>
                  {settings.paymentInstructions && (
                    <p className="text-slate-400 text-xs font-hind leading-relaxed">
                      {settings.paymentInstructions}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {settings.bkashEnabled && settings.bkashNumber && (
                      <button
                        type="button"
                        onClick={() => openSubmit(fee, 'bkash')}
                        disabled={hasPendingApproval}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-500/15 border border-pink-500/20 text-pink-400 text-xs hover:bg-pink-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Smartphone size={11} /> bKash: {settings.bkashNumber}
                      </button>
                    )}
                    {settings.nagadEnabled && settings.nagadNumber && (
                      <button
                        type="button"
                        onClick={() => openSubmit(fee, 'nagad')}
                        disabled={hasPendingApproval}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/15 border border-orange-500/20 text-orange-400 text-xs hover:bg-orange-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Smartphone size={11} /> Nagad: {settings.nagadNumber}
                      </button>
                    )}
                    {settings.centerWhatsapp && (
                      <a
                        href={`https://wa.me/${settings.centerWhatsapp.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 text-xs hover:bg-emerald-500/25 transition-all"
                      >
                        WhatsApp <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          {isPaid && (
            <button
              onClick={async () => {
                setDownloadReceiptLoading(true);
                await downloadReceipt(fee);
                setDownloadReceiptLoading(false);
              }}
              disabled={downloadReceiptLoading}
              className="btn-outline text-xs py-1.5 px-3 shrink-0"
            >
              {downloadReceiptLoading ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Receipt size={12} /> Receipt
                </>
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <PortalLayout>
      <h1 className="font-inter font-bold text-xl text-white mb-5 font-hind">ফি রেকর্ড</h1>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          {
            label: 'মোট পরিশোধ',
            value: formatCurrency(totalPaid),
            color: 'text-emerald-400',
            bg: 'bg-emerald-400/10',
          },
          {
            label: 'বকেয়া',
            value: formatCurrency(totalPending),
            color: 'text-amber-400',
            bg: 'bg-amber-400/10',
          },
          { label: 'মোট', value: fees.length, color: 'text-sky-400', bg: 'bg-sky-400/10' },
        ].map((s) => (
          <div key={s.label} className="card p-3 text-center">
            <p className={cn('font-inter font-bold text-lg', s.color)}>{s.value}</p>
            <p className="text-slate-500 text-xs font-hind">{s.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-sky-400" />
        </div>
      ) : fees.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-slate-500 font-hind">কোনো ফি রেকর্ড নেই</p>
        </div>
      ) : (
        <div className="space-y-3">
          {fees.map((f) => (
            <FeeCard key={f.id} fee={f} />
          ))}
        </div>
      )}

      {/* Submit payment transaction modal */}
      <AnimatePresence>
        {submitFor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setSubmitFor(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="relative card z-10 w-full max-w-md p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-inter font-bold text-white">
                    {trxMethod === 'bkash' ? 'bKash' : 'Nagad'} পেমেন্ট জমা দিন
                  </h3>
                  <p className="text-slate-400 text-xs mt-1 font-hind">
                    {submitFor.month} · {formatCurrency(submitFor.amount)}
                  </p>
                </div>
                <button
                  onClick={() => setSubmitFor(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-3 text-xs text-slate-300 space-y-1 font-hind">
                  <p className="flex items-center gap-2">
                    <Smartphone size={13} className="text-sky-400" />
                    {submitFor.month} মাসের ফি
                    <span className="text-sky-400 font-semibold">
                      {formatCurrency(submitFor.amount)}
                    </span>{' '}
                    পাঠান:
                  </p>
                  <p className="font-mono text-lg text-white font-bold">
                    {trxMethod === 'bkash' ? settings.bkashNumber : settings.nagadNumber}
                  </p>
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">ট্রানজেকশন আইডি *</label>
                  <input
                    value={trxId}
                    onChange={(e) => setTrxId(e.target.value)}
                    className="input-field font-mono"
                    placeholder={trxMethod === 'bkash' ? 'TRX1234567890' : 'Transaction ID'}
                  />
                  <p className="text-slate-500 text-[11px] mt-1.5 font-hind">
                    পেমেন্ট করার পর যে ট্রানজেকশন আইডি দেখবেন সেটি এখানে লিখুন। অ্যাডমিন যাচাই করে
                    অনুমোদন দিবেন।
                  </p>
                </div>

                <button
                  onClick={handleSubmitPayment}
                  disabled={submitting || trxId.trim().length < 4}
                  className="btn-primary w-full justify-center"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> জমা হচ্ছে…
                    </>
                  ) : (
                    <>
                      <Send size={15} /> ট্রানজেকশন আইডি জমা দিন
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </PortalLayout>
  );
}
