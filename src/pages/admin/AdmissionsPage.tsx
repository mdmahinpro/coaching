import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import { generateStudentId } from '@/lib/studentId';
import toast from 'react-hot-toast';
import {
  CheckCircle,
  XCircle,
  Eye,
  X,
  Search,
  Loader2,
  Users,
  Clock,
  Check,
  Ban,
} from 'lucide-react';
import { formatDate, cn, sanitize } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '@/store/useSettingsStore';
import { sendSMS } from '@/lib/sms';
import { handleSupabaseError } from '@/utils/errorHandler';

interface Admission {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  guardian_name?: string;
  guardian_phone?: string;
  gender?: string;
  photo_url?: string;
  class_level?: string;
  batch_id?: string;
  address?: string;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  batch?: { name: string };
}

const FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;
type Filter = (typeof FILTERS)[number];

export default function AdmissionsPage() {
  const { settings } = useSettingsStore();
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('pending');
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<Admission | null>(null);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let admissionsList: Admission[] = [];
    try {
      let q = supabase
        .from('admission_requests')
        .select('*, batch:batches(name)')
        .order('created_at', { ascending: false });
      if (filter !== 'all') {
        q = q.eq('status', filter);
      }
      const { data } = await q;
      admissionsList = (data ?? []).map((a: any) => ({
        ...a,
        name: sanitize(a.name ?? ''),
        phone: sanitize(a.phone ?? ''),
        email: a.email ?? '',
        guardian_name: sanitize(a.guardian_name ?? ''),
        guardian_phone: sanitize(a.guardian_phone ?? ''),
        address: a.address ?? '',
        message: a.message ?? '',
        batch: { name: sanitize(a.batch?.name ?? '') },
      })) as Admission[];
      const filtered = search
        ? admissionsList.filter(
            (a) => a.name.toLowerCase().includes(search.toLowerCase()) || a.phone?.includes(search)
          )
        : admissionsList;
      setAdmissions(filtered);

      // Load stats separately (all)
      const { data: all } = await supabase.from('admission_requests').select('status');
      const s = { total: 0, pending: 0, approved: 0, rejected: 0 };
      (all ?? []).forEach((a: any) => {
        s.total++;
        if (a.status in s) {
          (s as any)[a.status]++;
        }
      });
      setStats(s);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (admission: Admission) => {
    setActing(admission.id);
    try {
      // Batch code feeds the ID scheme (ShortName+Code+Year+Seq); fall back
      // to no code when the admission references no batch or the code is unset.
      let batchCode = '';
      if (admission.batch_id) {
        const { data: batch } = await supabase
          .from('batches')
          .select('code')
          .eq('id', admission.batch_id)
          .maybeSingle();
        batchCode = (batch?.code as string | undefined) ?? '';
      }
      const studentId = await generateStudentId({
        shortName: settings.shortName,
        batchCode,
      });
      // Password = last 6 digits of phone, or random 6-char fallback
      const phone = (admission.phone ?? '').replace(/\D/g, '');
      const password = phone.length >= 6 ? phone.slice(-6) : Math.random().toString(36).slice(-6);

      // Create student record via RPC — password hashed server-side
      const { error: sErr } = await supabase.rpc('register_student', {
        p_name: admission.name,
        p_phone: admission.phone,
        p_student_id: studentId,
        p_password: password,
        p_email: admission.email ?? null,
        p_guardian_name: admission.guardian_name ?? null,
        p_guardian_phone: admission.guardian_phone ?? null,
        p_address: admission.address ?? null,
        p_class_level: admission.class_level ?? null,
        p_gender: admission.gender ?? null,
        p_batch_id: admission.batch_id ?? null,
        p_status: 'active',
        p_is_approved: true,
        p_photo_url: admission.photo_url ?? null,
      });

      if (sErr) {
        toast.error('Failed to create student: ' + sErr.message);
        setActing(null);
        return;
      }

      // Update batch enrolled count
      if (admission.batch_id) {
        await supabase.rpc('increment_enrolled', { batch_uuid: admission.batch_id });
      }

      // Update admission status
      const { error: statusErr } = await supabase
        .from('admission_requests')
        .update({ status: 'approved' })
        .eq('id', admission.id);
      if (statusErr) {
        toast.error(
          'Student created but admission status update failed. Please refresh and check.'
        );
        setActing(null);
        load();
        return;
      }
      toast.success(`Approved! Student ID: ${studentId} · Password: ${password}`);

      // Send SMS with correct password
      if (admission.phone) {
        const msg = `🎉 ${admission.name}, ভর্তি অনুমোদিত!\nStudent ID: ${studentId}\nPassword: ${password}\nপোর্টাল: /portal/login\n- ${settings.centerName}`;
        await sendSMS(admission.phone, msg, 'APPROVED');
      }

      setActing(null);
      setViewing(null);
      load();
    } catch (err) {
      handleSupabaseError(err);
      setActing(null);
    }
  };

  const handleReject = async (admission: Admission) => {
    setActing(admission.id);
    try {
      await supabase
        .from('admission_requests')
        .update({ status: 'rejected' })
        .eq('id', admission.id);
      toast.success('Application rejected');

      // Send SMS
      if (admission.phone) {
        const msg = `দুঃখিত ${admission.name}, আপনার ভর্তির আবেদন গ্রহণ করা হয়নি। বিস্তারিত জানতে ${settings.centerPhone} এ যোগাযোগ করুন। - ${settings.centerName}`;
        await sendSMS(admission.phone, msg, 'custom');
      }

      setActing(null);
      setViewing(null);
      load();
    } catch (err) {
      handleSupabaseError(err);
      setActing(null);
    }
  };

  const STAT_CARDS = [
    { label: 'Total', value: stats.total, icon: Users, color: 'text-sky-400', bg: 'bg-sky-400/10' },
    {
      label: 'Pending',
      value: stats.pending,
      icon: Clock,
      color: 'text-amber-400',
      bg: 'bg-amber-400/10',
    },
    {
      label: 'Approved',
      value: stats.approved,
      icon: Check,
      color: 'text-emerald-400',
      bg: 'bg-emerald-400/10',
    },
    {
      label: 'Rejected',
      value: stats.rejected,
      icon: Ban,
      color: 'text-red-400',
      bg: 'bg-red-400/10',
    },
  ];

  return (
    <AdminLayout title="ভর্তি আবেদন">
      <div className="space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {STAT_CARDS.map((s) => (
            <div key={s.label} className="card p-4 flex items-center gap-3">
              <div className={cn('p-2 rounded-lg', s.bg)}>
                <s.icon size={18} className={s.color} />
              </div>
              <div>
                <p className={cn('font-inter font-black text-xl', s.color)}>{s.value}</p>
                <p className="text-slate-500 text-xs">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filters + search */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-navy-800 rounded-lg p-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-all',
                  filter === f
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                    : 'text-slate-400 hover:text-white'
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-8 py-1.5 text-sm w-52"
              placeholder="Name or phone…"
            />
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="divide-y divide-navy-700/30">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 mx-4 my-2 bg-navy-700 rounded animate-pulse" />
              ))}
            </div>
          ) : admissions.length === 0 ? (
            <p className="text-center py-12 text-slate-500 text-sm">
              No applications for this filter
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-700/50">
                    {['Name', 'Class', 'Batch', 'Phone', 'Date', 'Status', ''].map((h) => (
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
                  {admissions.map((a) => (
                    <tr key={a.id} className="border-b border-navy-700/30 hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <p className="text-white font-medium">{a.name}</p>
                        {a.email && <p className="text-slate-500 text-xs">{a.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-sm">{a.class_level ?? '—'}</td>
                      <td className="px-4 py-3">
                        {a.batch?.name ? (
                          <span className="badge-blue text-xs">{a.batch.name}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-sm">{a.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {formatDate(a.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            a.status === 'approved'
                              ? 'badge-green text-xs'
                              : a.status === 'rejected'
                                ? 'badge-red text-xs'
                                : 'badge-yellow text-xs'
                          }
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setViewing(a)}
                            className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-400 hover:text-sky-400 transition-colors"
                            title="View"
                          >
                            <Eye size={13} />
                          </button>
                          {a.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleApprove(a)}
                                disabled={acting === a.id}
                                className="p-1.5 rounded-lg hover:bg-emerald-500/15 text-slate-400 hover:text-emerald-400 transition-colors disabled:opacity-50"
                                title="Approve"
                              >
                                {acting === a.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <CheckCircle size={13} />
                                )}
                              </button>
                              <button
                                onClick={() => handleReject(a)}
                                disabled={acting === a.id}
                                className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-400 transition-colors disabled:opacity-50"
                                title="Reject"
                              >
                                <XCircle size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* View Drawer */}
      <AnimatePresence>
        {viewing && (
          <div className="fixed inset-0 z-50 flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setViewing(null)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="relative ml-auto w-full max-w-md h-full bg-navy-900 border-l border-navy-700/50 overflow-y-auto z-10 flex flex-col"
            >
              <div className="flex items-center justify-between p-5 border-b border-navy-700/50 shrink-0">
                <h2 className="font-inter font-bold text-white">Application Details</h2>
                <button
                  onClick={() => setViewing(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 p-5 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 rounded-2xl bg-sky-500/15 flex items-center justify-center">
                    <span className="text-sky-400 font-bold text-lg">{viewing.name[0]}</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{viewing.name}</h3>
                    <span
                      className={
                        viewing.status === 'approved'
                          ? 'badge-green text-xs'
                          : viewing.status === 'rejected'
                            ? 'badge-red text-xs'
                            : 'badge-yellow text-xs'
                      }
                    >
                      {viewing.status}
                    </span>
                  </div>
                </div>

                <div className="card p-4 space-y-3">
                  {[
                    ['Email', viewing.email ?? '—'],
                    ['Phone', viewing.phone ?? '—'],
                    ['Guardian', viewing.guardian_name ?? '—'],
                    ['Class', viewing.class_level ?? '—'],
                    ['Batch', viewing.batch?.name ?? '—'],
                    ['Address', viewing.address ?? '—'],
                    ['Applied', formatDate(viewing.created_at)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-3 text-sm">
                      <span className="text-slate-500 w-20 shrink-0">{k}</span>
                      <span className="text-white">{v}</span>
                    </div>
                  ))}
                  {viewing.message && (
                    <div className="pt-2 border-t border-navy-700/50">
                      <p className="text-slate-500 text-xs mb-1">Message</p>
                      <p className="text-slate-300 text-sm font-hind leading-relaxed">
                        {viewing.message}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {viewing.status === 'pending' && (
                <div className="p-5 border-t border-navy-700/50 flex gap-3 shrink-0">
                  <button
                    onClick={() => handleReject(viewing)}
                    disabled={acting === viewing.id}
                    className="btn-danger flex-1 justify-center text-sm"
                  >
                    {acting === viewing.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <XCircle size={14} />
                    )}{' '}
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(viewing)}
                    disabled={acting === viewing.id}
                    className="btn-primary flex-1 justify-center text-sm"
                  >
                    {acting === viewing.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle size={14} />
                    )}{' '}
                    Approve
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AdminLayout>
  );
}
