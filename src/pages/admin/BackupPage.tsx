import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import {
  Download,
  Database,
  Upload,
  Info,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { handleSupabaseError } from '@/utils/errorHandler';

const BACKUP_KEY = 'coaching-backup-history';
const TABLES = [
  { key: 'students', label: 'Students' },
  { key: 'teachers', label: 'Teachers' },
  { key: 'batches', label: 'Batches' },
  { key: 'fees', label: 'Fee Records' },
  { key: 'exams', label: 'Exams' },
  { key: 'mcq_questions', label: 'MCQ Questions' },
  { key: 'mcq_submissions', label: 'MCQ Submissions' },
  { key: 'notices', label: 'Notices' },
  { key: 'sms_logs', label: 'SMS Logs' },
  { key: 'admission_requests', label: 'Admission Requests' },
  { key: 'site_settings', label: 'Site Settings' },
] as const;

type StepState = 'pending' | 'running' | 'done' | 'skip';

interface Step {
  label: string;
  state: StepState;
}

const fmtFileName = (institute: string) => {
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  const time = `${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
  const safe = (institute || 'Backup').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  return `backup_${safe}_${date}_${time}.json`;
};

export default function BackupPage() {
  const [backing, setBacking] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [autoBackups, setAutoBackups] = useState<
    Array<{
      id: string;
      backup_date: string;
      institute_name: string;
      record_count: number;
      triggered_by: string;
    }>
  >([]);
  const [loadingAuto, setLoadingAuto] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<Record<string, number> | null>(null);
  const [restoreData, setRestoreData] = useState<any | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(BACKUP_KEY);
    if (stored) {
      try {
        setHistory(JSON.parse(stored));
      } catch {
        /* ignore */
      }
    }
    loadAutoBackups();
  }, []);

  // Load automated backups from database
  const loadAutoBackups = async () => {
    setLoadingAuto(true);
    try {
      const { data, error } = await supabase
        .from('backups')
        .select('id, backup_date, institute_name, record_count, triggered_by')
        .order('backup_date', { ascending: false })
        .limit(10);
      if (!error && data) {
        setAutoBackups(data);
      }
    } catch {
      /* silently fail — automated backups may not be set up yet */
    } finally {
      setLoadingAuto(false);
    }
  };

  // Download an automated backup as JSON
  const downloadAutoBackup = async (id: string) => {
    const { data, error } = await supabase
      .from('backups')
      .select('tables, institute_name, backup_date')
      .eq('id', id)
      .single();
    if (error || !data) {
      toast.error('Failed to load backup');
      return;
    }
    const payload = {
      backup_version: '1.0',
      backup_date: data.backup_date,
      institute: data.institute_name,
      tables: data.tables,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_${data.institute_name || 'auto'}_${new Date(data.backup_date).toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup downloaded');
  };

  const saveHistory = (date: string) => {
    const next = [date, ...history].slice(0, 5);
    setHistory(next);
    localStorage.setItem(BACKUP_KEY, JSON.stringify(next));
  };

  const setStep = (idx: number, state: StepState) =>
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, state } : s)));

  const handleBackup = async () => {
    setBacking(true);
    const initSteps: Step[] = [
      ...TABLES.map((t) => ({ label: `Fetching ${t.label}…`, state: 'pending' as StepState })),
      { label: 'Preparing backup file…', state: 'pending' },
    ];
    setSteps(initSteps);

    const backup: Record<string, unknown[]> = {};
    let totalRecords = 0;

    try {
      for (let i = 0; i < TABLES.length; i++) {
        setStep(i, 'running');
        await new Promise((r) => setTimeout(r, 80)); // visual delay
        const { data, error } = await supabase.from(TABLES[i].key).select('*');
        if (error) {
          setStep(i, 'skip'); // table might not exist yet
        } else {
          backup[TABLES[i].key] = data ?? [];
          totalRecords += (data ?? []).length;
          setStep(i, 'done');
        }
      }

      // Finalize
      const lastIdx = TABLES.length;
      setStep(lastIdx, 'running');
      await new Promise((r) => setTimeout(r, 100));

      const { data: settings } = await supabase
        .from('site_settings')
        .select('key,value')
        .eq('key', 'institute_name')
        .single();
      const instituteName = settings?.value ?? 'CoachingCenter';

      const payload = {
        backup_version: '1.0',
        backup_date: new Date().toISOString(),
        institute: instituteName,
        tables: backup,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fmtFileName(instituteName);
      a.click();
      URL.revokeObjectURL(url);

      setStep(lastIdx, 'done');
      const dateStr = new Date().toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      saveHistory(dateStr);
      toast.success(`✅ ব্যাকআপ সফল! ${totalRecords} records saved`);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setBacking(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    setRestoreFile(file);
    setRestoreSummary(null);
    setRestoreData(null);
    setConfirmStep(0);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.backup_version || !parsed.tables) {
        toast.error('Invalid backup file format');
        return;
      }
      setRestoreData(parsed);
      const summary: Record<string, number> = {};
      for (const [key, rows] of Object.entries(parsed.tables)) {
        if (Array.isArray(rows)) {
          summary[key] = rows.length;
        }
      }
      setRestoreSummary(summary);
    } catch {
      toast.error('Could not parse backup file');
    }
  };

  const handleRestore = async () => {
    if (!restoreData?.tables) {
      return;
    }
    setRestoring(true);
    let totalRestored = 0;
    // Process in FK-safe order: parents before children
    const RESTORE_ORDER = [
      'site_settings',
      'batches',
      'teachers',
      'students',
      'fees',
      'notices',
      'exams',
      'mcq_questions',
      'mcq_submissions',
      'sms_logs',
      'admission_requests',
    ];
    const processed = new Set<string>();
    try {
      for (const tableName of RESTORE_ORDER) {
        const rows = (restoreData.tables as any)[tableName];
        if (!Array.isArray(rows) || rows.length === 0) {
          processed.add(tableName);
          continue;
        }
        const { error } = await supabase
          .from(tableName as any)
          .upsert(rows as any[], { onConflict: 'id', ignoreDuplicates: false });
        if (!error) {
          totalRestored += rows.length;
        }
        processed.add(tableName);
      }
      // Handle any extra tables not in the known order
      for (const [table, rows] of Object.entries(restoreData.tables)) {
        if (processed.has(table)) {
          continue;
        }
        if (!Array.isArray(rows) || rows.length === 0) {
          continue;
        }
        const { error } = await supabase
          .from(table as any)
          .upsert(rows as any[], { onConflict: 'id', ignoreDuplicates: false });
        if (!error) {
          totalRestored += (rows as any[]).length;
        }
      }
      toast.success(`✅ Restore complete! ${totalRestored} records restored`);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setRestoring(false);
      setConfirmStep(0);
      setRestoreFile(null);
      setRestoreSummary(null);
      setRestoreData(null);
    }
  };

  const stepIcon = (state: StepState) => {
    if (state === 'done') {
      return <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />;
    }
    if (state === 'running') {
      return <Loader2 size={14} className="text-sky-400 animate-spin shrink-0" />;
    }
    if (state === 'skip') {
      return <span className="text-slate-500 text-xs shrink-0">—</span>;
    }
    return <div className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" />;
  };

  return (
    <AdminLayout title="ব্যাকআপ ও রিস্টোর">
      <div className="max-w-2xl space-y-6">
        {/* ── Main Backup Button ── */}
        <div className="card p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-sky-500/15 border border-sky-500/20 flex items-center justify-center mx-auto mb-4">
            <Database size={28} className="text-sky-400" />
          </div>
          <h2 className="font-inter font-black text-2xl text-white mb-2">সম্পূর্ণ ডেটা ব্যাকআপ</h2>
          <p className="text-slate-400 text-sm mb-6">
            সকল টেবিল থেকে ডেটা সংগ্রহ করে একটি JSON ফাইলে সংরক্ষণ করুন।
          </p>
          <button
            onClick={handleBackup}
            disabled={backing}
            className="btn-primary text-base px-8 py-3 mx-auto"
          >
            {backing ? (
              <>
                <Loader2 size={16} className="animate-spin" /> ব্যাকআপ চলছে…
              </>
            ) : (
              <>
                <Download size={16} /> সম্পূর্ণ ডেটা ব্যাকআপ করুন
              </>
            )}
          </button>

          {/* Progress steps */}
          <AnimatePresence>
            {steps.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-6 text-left space-y-1.5 overflow-hidden"
              >
                {steps.map((s, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-2 text-sm transition-colors',
                      s.state === 'done'
                        ? 'text-emerald-400'
                        : s.state === 'running'
                          ? 'text-sky-400'
                          : s.state === 'skip'
                            ? 'text-slate-600'
                            : 'text-slate-600'
                    )}
                  >
                    {stepIcon(s.state)}
                    <span>
                      {s.state === 'done'
                        ? s.label.replace('Fetching', 'Fetched').replace('Preparing', 'Prepared')
                        : s.label}
                    </span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Backup History ── */}
        {(history.length > 0 || autoBackups.length > 0) && (
          <div className="card p-5">
            <h3 className="font-semibold text-white text-sm flex items-center gap-2 mb-3">
              <Clock size={15} className="text-slate-400" /> Backup History
            </h3>
            <div className="space-y-2">
              {history.map((d, i) => (
                <div key={`manual-${i}`} className="flex items-center gap-2 text-sm text-slate-400">
                  <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                  <span className="flex-1">Manual: {d}</span>
                </div>
              ))}
              {autoBackups.map((b) => (
                <div key={b.id} className="flex items-center gap-2 text-sm text-slate-400">
                  <CheckCircle2 size={13} className="text-sky-400 shrink-0" />
                  <span className="flex-1">
                    Auto ({b.triggered_by}):{' '}
                    {new Date(b.backup_date).toLocaleString('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    <span className="text-slate-500 ml-1">({b.record_count} records)</span>
                  </span>
                  <button
                    onClick={() => downloadAutoBackup(b.id)}
                    className="text-sky-400 hover:text-sky-300 shrink-0"
                    title="Download backup"
                  >
                    <Download size={13} />
                  </button>
                </div>
              ))}
            </div>
            {autoBackups.length > 0 && (
              <button
                onClick={loadAutoBackups}
                disabled={loadingAuto}
                className="text-xs text-slate-500 hover:text-slate-300 mt-3 flex items-center gap-1"
              >
                <RefreshCw size={11} className={loadingAuto ? 'animate-spin' : ''} /> Refresh
              </button>
            )}
          </div>
        )}

        {/* ── Restore Section ── */}
        <div className="card p-6 space-y-4">
          <h3 className="font-inter font-bold text-white flex items-center gap-2">
            <Upload size={16} className="text-violet-400" /> রিস্টোর
          </h3>
          <p className="text-slate-400 text-sm">
            একটি পূর্ববর্তী ব্যাকআপ ফাইল আপলোড করুন এবং ডেটা পুনরুদ্ধার করুন।
          </p>

          <button
            onClick={() => fileRef.current?.click()}
            className="btn-outline text-sm w-full justify-center"
          >
            <Upload size={14} /> {restoreFile ? restoreFile.name : 'backup.json ফাইল বাছাই করুন'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Summary */}
          <AnimatePresence>
            {restoreSummary && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="card p-4 space-y-2"
              >
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                  Backup Contents
                </p>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {Object.entries(restoreSummary)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between text-slate-300">
                        <span className="capitalize">{k.replace(/_/g, ' ')}</span>
                        <span className="text-sky-400 font-medium">{v}</span>
                      </div>
                    ))}
                </div>
                <p className="text-slate-500 text-xs pt-1">
                  Backup date:{' '}
                  {restoreData?.backup_date
                    ? new Date(restoreData.backup_date).toLocaleString()
                    : '—'}
                </p>

                {/* Double confirmation */}
                {confirmStep === 0 && (
                  <button
                    onClick={() => setConfirmStep(1)}
                    className="btn-danger w-full justify-center text-sm mt-2"
                  >
                    Restore Data
                  </button>
                )}
                {confirmStep === 1 && (
                  <div className="card p-3 border border-amber-400/20 space-y-2">
                    <p className="text-amber-400 text-sm font-semibold">
                      ⚠ এটি বর্তমান ডেটা মুছে ফেলবে। নিশ্চিত?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmStep(0)}
                        className="btn-outline text-sm flex-1 justify-center py-1.5"
                      >
                        বাতিল
                      </button>
                      <button
                        onClick={() => setConfirmStep(2)}
                        className="btn-danger text-sm flex-1 justify-center py-1.5"
                      >
                        হ্যাঁ, নিশ্চিত
                      </button>
                    </div>
                  </div>
                )}
                {confirmStep === 2 && (
                  <div className="card p-3 border border-red-400/30 space-y-2">
                    <p className="text-red-400 text-sm font-semibold">
                      আবার নিশ্চিত করুন — এই কাজ পূর্বাবস্থায় ফেরানো যাবে না
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmStep(0)}
                        className="btn-outline text-sm flex-1 justify-center py-1.5"
                      >
                        বাতিল
                      </button>
                      <button
                        onClick={handleRestore}
                        disabled={restoring}
                        className="btn-danger text-sm flex-1 justify-center py-1.5"
                      >
                        {restoring ? (
                          <>
                            <Loader2 size={13} className="animate-spin" /> Restoring…
                          </>
                        ) : (
                          'Restore করুন'
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Future-proof note ── */}
        <div className="card-glass p-4 border border-sky-400/10 flex items-start gap-3">
          <Info size={16} className="text-sky-400 shrink-0 mt-0.5" />
          <p className="text-slate-400 text-sm leading-relaxed font-hind">
            ℹ️ এই ব্যাকআপ ফাইলটি ভবিষ্যতে নতুন ফিচার যোগ হলেও কাজ করবে। নতুন ফিচারের ডেটা পুরোনো
            ব্যাকআপে থাকবে না, তবে পুরোনো ডেটা নিরাপদ থাকবে।
          </p>
        </div>

        {/* ── Automated backup note ── */}
        <div className="card-glass p-4 border border-emerald-400/10 flex items-start gap-3">
          <Database size={16} className="text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-slate-400 text-sm leading-relaxed font-hind">
            🤖 স্বয়ংক্রিয় ব্যাকআপ প্রতিদিন মdzনায় চলবে (pg_cron via Supabase)। স্বয়ংক্রিয়
            ব্যাকআপগুলো ইতিহাসে দেখুন এবং ডাউনলোড করুন। প্রথম ব্যাকআপ আগামীকাল (মdzনা ০০:০০) পাওয়া
            যাবে।
          </p>
        </div>
      </div>
    </AdminLayout>
  );
}
