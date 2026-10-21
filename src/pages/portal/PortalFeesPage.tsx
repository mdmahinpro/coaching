import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { fetchFees, fetchPaymentRequests, submitPaymentRequest } from '@/lib/portalApi';
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
  FileText,
  Hourglass,
  XCircle,
  Banknote,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { generateStudentReceipt } from '@/lib/pdf';
import { downloadPosReceipt } from '@/lib/posReceipt';

interface Fee {
  id: string;
  student_id: string;
  month: string;
  amount: number;
  status: 'paid' | 'pending' | 'overdue' | 'waived';
  payment_date?: string;
  note?: string;
}

interface PaymentRequest {
  id: string;
  fee_id: string;
  method: 'bkash' | 'nagad' | 'cash';
  digits: string;
  status: 'waiting' | 'approved' | 'rejected';
  created_at: string;
  month: string;
  amount: number;
}

/** Bangla label for a payment method. */
const methodLabel = (m: string) => (m === 'bkash' ? 'bKash' : m === 'nagad' ? 'Nagad' : 'ক্যাশ');

/** Mobile payment sheet: shows the bKash/Nagad number, asks which number
 *  (last 3 digits) was used, submits a waiting-for-confirmation request.
 *  Cash skips the digits step — it's confirmed by admin like any other. */
function PaymentSheet({
  fee,
  onClose,
  onSubmitted,
}: {
  fee: Fee;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { settings } = useSettingsStore();
  const [method, setMethod] = useState<'bkash' | 'nagad' | 'cash' | null>(null);
  const [digits, setDigits] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const chosen = method === 'bkash' ? settings.bkashNumber : settings.nagadNumber;

  const submit = async () => {
    if (!method || !/^[0-9]{3}$/.test(digits)) {
      toast.error('পেমেন্ট করা নাম্বারের শেষ ৩ ডিজিট লিখুন');
      return;
    }
    setSubmitting(true);
    try {
      await submitPaymentRequest(fee.id, method, digits);
      toast.success(
        'পেমেন্ট জানানো হয়েছে! অ্যাডমিন নিশ্চিত করা পর্যন্ত অপেক্ষা করুন।',
        { duration: 5000 }
      );
      onSubmitted();
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'জমা দেওয়া যায়নি, আবার চেষ্টা করুন');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        aria-label="close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        className={cn(
          'relative w-full sm:max-w-md card p-5 rounded-b-none sm:rounded-2xl',
          'rounded-t-2xl animate-slide-up max-h-[92vh] overflow-y-auto'
        )}
      >
        <h2 className="font-inter font-bold text-lg text-white font-hind mb-1">
          পেমেন্ট করুন — {fee.month}
        </h2>
        <p className="text-slate-400 text-sm font-hind mb-4">
          মোট: <span className="font-bold text-white">{formatCurrency(fee.amount)}</span>
        </p>

        {/* Step 1: choose method */}
        {!method && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {settings.bkashNumber && (
                <button
                  onClick={() => setMethod('bkash')}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-pink-500/10 border border-pink-500/30 text-pink-400 font-bold font-hind active:scale-95 transition-transform"
                >
                  <Smartphone size={22} /> bKash
                </button>
              )}
              {settings.nagadNumber && (
                <button
                  onClick={() => setMethod('nagad')}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-400 font-bold font-hind active:scale-95 transition-transform"
                >
                  <Smartphone size={22} /> Nagad
                </button>
              )}
            </div>
            <button
              onClick={() => setMethod('cash')}
              className="w-full flex items-center justify-center gap-2 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold font-hind active:scale-95 transition-transform"
            >
              <Banknote size={20} /> ক্যাশে দিয়েছি (অফিসে)
            </button>
          </div>
        )}

        {/* Step 2: send money + last 3 digits — cash skips both */}
        {method === 'cash' ? (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-sm text-emerald-300 font-hind leading-relaxed">
                অফিসে ক্যাশে পেমেন্ট করার জানানো হচ্ছে। অ্যাডমিন যাচাই করে নিশ্চিত করবেন —
                নিশ্চিত হলে এই মাসের বকেয়া কেটে যাবে।
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setMethod(null)} className="btn-outline flex-1 py-2.5 font-hind">
                পিছনে
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="btn-primary flex-[2] py-2.5 font-hind disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 size={16} className="animate-spin mx-auto" />
                ) : (
                  'জমা দিন'
                )}
              </button>
            </div>
          </div>
        ) : (
          method && (
        <div className="space-y-4">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-xs text-slate-400 font-hind mb-1">
                ধাপ ১ — নিচের নাম্বারে Send Money করুন:
              </p>
              <p className="font-inter font-bold text-lg text-white tracking-wide">
                {method === 'bkash' ? settings.bkashNumber : settings.nagadNumber}
              </p>
              <p className="text-xs text-slate-500 mt-1 font-hind">
                ব্যবহার করুন {method === 'bkash' ? 'bKash' : 'Nagad'} অ্যাপ বা USSD।
              </p>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-hind block mb-1.5">
                ধাপ ২ — যে নাম্বার দিয়ে পেমেন্ট করেছেন তার শেষ ৩ ডিজিট:
              </label>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                value={digits}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="যেমন: ৪৫৬ → 456"
                className="w-full text-center text-2xl font-inter font-black tracking-[0.5em] bg-white/5 border border-white/10 rounded-xl py-3 text-white placeholder:text-slate-600 placeholder:tracking-normal placeholder:text-sm placeholder:font-hind focus:outline-none focus:border-sky-400/50"
              />
            </div>

            <div className="flex gap-2">
              <button onClick={() => setMethod(null)} className="btn-outline flex-1 py-2.5 font-hind">
                পিছনে
              </button>
              <button
                onClick={submit}
                disabled={submitting || digits.length !== 3}
                className="btn-primary flex-[2] py-2.5 font-hind disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 size={16} className="animate-spin mx-auto" />
                ) : (
                  'জমা দিন'
                )}
              </button>
            </div>
        </div>
          )
        )}

        <p className="text-xs text-slate-500 text-center font-hind">
          জমা দিলে পেমেন্টটি "অপেক্ষমাণ" থাকবে — অ্যাডমিন যাচাই করে নিশ্চিত করবেন।
        </p>

        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-500 hover:text-white p-1"
          aria-label="বন্ধ করুন"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function PortalFeesPage() {
  const { student } = useStudentStore();
  const { settings } = useSettingsStore();
  const queryClient = useQueryClient();
  const [fees, setFees] = useState<Fee[]>([]);
  const [payReqs, setPayReqs] = useState<PaymentRequest[]>([]);
  const [downloadReceiptLoading, setDownloadReceiptLoading] = useState(false);
  const [payFee, setPayFee] = useState<Fee | null>(null);

  const { isLoading: loading } = useQuery({
    queryKey: ['portal', 'fees', student?.id],
    enabled: !!student,
    queryFn: async () => {
      try {
        const [data, reqs] = await Promise.all([fetchFees(), fetchPaymentRequests()]);
        setFees((data ?? []) as Fee[]);
        setPayReqs((reqs ?? []) as PaymentRequest[]);
        return true;
      } catch (err) {
        handleSupabaseError(err);
        return null;
      }
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['portal', 'fees', student?.id] });
  };

  // Latest non-rejected request per fee → drives the "waiting" chip on cards.
  const openReqByFee = new Map<string, PaymentRequest>();
  for (const r of payReqs) {
    if (r.status !== 'rejected' && !openReqByFee.has(r.fee_id)) openReqByFee.set(r.fee_id, r);
  }

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
      });
    } catch (err) {
      console.error('[PDF Error]', err);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const posData = (fee: Fee, kind: 'receipt' | 'invoice') => {
    const note = parseNote(fee.note);
    return {
      kind,
      receiptNo: note.receipt_no ?? fee.id.slice(-8).toUpperCase(),
      date: formatDate(fee.payment_date ?? new Date().toISOString()),
      studentName: student?.name ?? '',
      studentId: student?.student_id,
      month: fee.month,
      feeAmount: fee.amount,
      discount: note.discount ?? 0,
      finalAmount: note.final_amount ?? fee.amount,
      paymentMethod: note.payment_method ?? 'Cash',
      transactionId: note.transaction_id,
      dueDate: fee.month ? `${fee.month} 10` : formatDate(new Date().toISOString()),
      instituteName: settings.centerName,
      instituteAddress: settings.centerAddress,
      institutePhone: settings.centerPhone,
    };
  };

  const downloadInvoice = async (fee: Fee) => {
    try {
      await downloadPosReceipt(posData(fee, 'invoice'));
    } catch (err) {
      console.error('[PDF Error]', err);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const FeeCard = ({ fee }: { fee: Fee }) => {
    const note = parseNote(fee.note);
    const isPaid = fee.status === 'paid';
    const isOverdue = fee.status === 'overdue';
    const isWaived = fee.status === 'waived';
    const openReq = openReqByFee.get(fee.id);

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
              {!isPaid && !isWaived && (
                <div className="mt-3 space-y-2">
                  {openReq ? (
                    <div
                      className={cn(
                        'flex items-center gap-2 text-xs font-hind px-3 py-2 rounded-lg border',
                        openReq.status === 'approved'
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                      )}
                    >
                      {openReq.status === 'approved' ? (
                        <CheckCircle2 size={13} className="shrink-0" />
                      ) : (
                        <Hourglass size={13} className="shrink-0 animate-pulse" />
                      )}
                      {openReq.status === 'approved'
                        ? `পেমেন্ট নিশ্চিত হয়েছে (${methodLabel(openReq.method)}${openReq.digits ? ` •••${openReq.digits}` : ''})`
                        : `পেমেন্ট যাচাইয়ের অপেক্ষায় — ${methodLabel(openReq.method)}${openReq.digits ? ` •••${openReq.digits}` : ''}`}
                    </div>
                  ) : (
                    <>
                      <p className="text-slate-400 text-xs font-semibold font-hind">
                        পেমেন্ট করতে:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {settings.bkashNumber && (
                          <button
                            onClick={() => setPayFee(fee)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-pink-500/15 border border-pink-500/20 text-pink-400 text-xs font-bold hover:bg-pink-500/25 transition-all active:scale-95 min-h-[36px]"
                          >
                            <Smartphone size={13} /> bKash এ পেমেন্ট করুন
                          </button>
                        )}
                        {settings.nagadNumber && (
                          <button
                            onClick={() => setPayFee(fee)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-500/15 border border-orange-500/20 text-orange-400 text-xs font-bold hover:bg-orange-500/25 transition-all active:scale-95 min-h-[36px]"
                          >
                            <Smartphone size={13} /> Nagad এ পেমেন্ট করুন
                          </button>
                        )}
                        {settings.centerWhatsapp && (
                          <a
                            href={`https://wa.me/${settings.centerWhatsapp.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 text-xs hover:bg-emerald-500/25 transition-all min-h-[36px]"
                          >
                            WhatsApp <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          {!isPaid && !isWaived && (
            <button
              onClick={async () => {
                setDownloadReceiptLoading(true);
                await downloadInvoice(fee);
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
                  <FileText size={12} /> Invoice
                </>
              )}
            </button>
          )}
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

      {payFee && (
        <PaymentSheet fee={payFee} onClose={() => setPayFee(null)} onSubmitted={refresh} />
      )}
    </PortalLayout>
  );
}
