import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Users,
  Clock,
  DollarSign,
  Loader2,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrency, cn, sanitize } from '@/lib/utils';
import { handleSupabaseError } from '@/utils/errorHandler';

interface Batch {
  id: string;
  name: string;
  subject?: string;
  class_level?: string;
  teacher_id?: string;
  // teacher is a text column (teacher name string), not a relation object
  teacher?: string;
  // code is the short ID token used in student IDs (e.g. 'Q' -> TLYQ26001)
  code?: string;
  schedule_days?: string[];
  schedule_time?: string;
  capacity: number;
  enrolled_count?: number;
  monthly_fee?: number;
  fee?: number;
  description?: string;
  is_active?: boolean;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY: Partial<Batch> = {
  is_active: true,
  capacity: 30,
  monthly_fee: 1500,
  schedule_days: [],
};

export default function BatchesPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Batch>>(EMPTY);
  const [saving, setSaving] = useState(false);
  // Multi-select draft state for subjects/teachers (submit joins into text cols).
  const [subjectInput, setSubjectInput] = useState('');
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Batch | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailBatch, setDetailBatch] = useState<Batch | null>(null);
  const [detailStudents, setDetailStudents] = useState<any[]>([]);
  const [detailExams, setDetailExams] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, { data: studentCounts }] = await Promise.all([
        supabase
          .from('batches')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('students')
          .select('batch_id')
          .eq('status', 'active')
          .eq('is_approved', true)
          .not('batch_id', 'is', null),
      ]);
      const countMap: Record<string, number> = {};
      (studentCounts ?? []).forEach((s: any) => {
        if (s.batch_id) {
          countMap[s.batch_id] = (countMap[s.batch_id] ?? 0) + 1;
        }
      });
      const cleaned = ((data ?? []) as any[]).map((b) => ({
        ...b,
        name: sanitize(b.name),
        subject: b.subject ? sanitize(b.subject) : b.subject,
        description: b.description ? sanitize(b.description) : b.description,
        teacher: b.teacher ? sanitize(String(b.teacher)) : b.teacher,
      }));
      setBatches(cleaned.map((b: any) => ({ ...b, enrolled_count: countMap[b.id] ?? 0 })));
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    supabase
      .from('teachers')
      .select('id,name')
      .eq('is_active', true)
      .then(
        ({ data }) => {
          const cleaned = (data ?? []).map((t: any) => ({ ...t, name: sanitize(t.name) }));
          setTeachers(cleaned);
        },
        (err: any) => {
          handleSupabaseError(err);
        }
      );
  }, []);

  const openDetail = async (b: Batch) => {
    setDetailBatch(b);
    setDetailLoading(true);
    try {
      const [{ data: students }, { data: exams }] = await Promise.all([
        supabase
          .from('students')
          .select('id,name,student_id,status')
          .eq('batch_id', b.id)
          .order('name'),
        supabase
          .from('exams')
          .select('id,title,subject,status,exam_date')
          .eq('batch_id', b.id)
          .order('exam_date', { ascending: false }),
      ]);
      setDetailStudents(students ?? []);
      setDetailExams(exams ?? []);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setDetailLoading(false);
    }
  };

  const subjectTokens = (s?: string) =>
    (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

  const openModal = (b?: Batch) => {
    setSubjectInput('');
    if (b) {
      // Rehydrate the multi-teacher selection: prefer the comma `teacher`
      // text (source of truth for multi-select), fall back to teacher_id.
      const names = subjectTokens(b.teacher);
      const ids = names
        .map((n) => teachers.find((t) => t.name === n)?.id)
        .filter((x): x is string => !!x);
      if (ids.length === 0 && b.teacher_id) {
        ids.push(b.teacher_id);
      }
      setSelectedTeacherIds(ids);
      setEditing({
        ...b,
        schedule_days: Array.isArray(b.schedule_days)
          ? b.schedule_days
          : b.schedule_days
            ? (b.schedule_days as unknown as string).split(',')
            : [],
      });
    } else {
      setSelectedTeacherIds([]);
      setEditing(EMPTY);
    }
    setModalOpen(true);
  };

  const toggleDay = (day: string) => {
    setEditing((p) => {
      const days = p.schedule_days ?? [];
      return {
        ...p,
        schedule_days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
      };
    });
  };

  const handleSave = async () => {
    if (!editing.name) {
      toast.error('Batch name is required');
      return;
    }
    setSaving(true);
    try {
      // NOTE: batch column is `start_time`, NOT `schedule_time`. Sending a
      // phantom `schedule_time` key made PostgREST fail the whole update with
      // `Could not find the 'schedule time' column of 'batches'`.
      const selectedTeachers = selectedTeacherIds
        .map((id) => teachers.find((t) => t.id === id))
        .filter((t): t is (typeof teachers)[number] => !!t);
      const payload = {
        name: editing.name,
        subject: subjectTokens(editing.subject).join(', ') || null,
        class_level: editing.class_level ?? null,
        // teacher_id keeps the FIRST selected teacher for the FK/join; the
        // comma-separated `teacher` text holds all names for display.
        teacher_id: selectedTeachers[0]?.id ?? null,
        teacher: selectedTeachers.map((t) => t.name).join(', ') || null,
        code: editing.code ? editing.code.trim().toUpperCase().slice(0, 6) : null,
        schedule_days: editing.schedule_days ?? [],
        start_time: editing.schedule_time ?? null,
        capacity: editing.capacity ?? 30,
        max_seats: editing.capacity ?? 30,
        monthly_fee: editing.monthly_fee ?? 1500,
        fee: editing.monthly_fee ?? 1500,
        description: editing.description ?? null,
        is_active: editing.is_active ?? true,
      };

      let error;
      if (editing.id) {
        ({ error } = await supabase.from('batches').update(payload).eq('id', editing.id));
        if (!error) {
          toast.success('Batch updated');
        }
      } else {
        ({ error } = await supabase.from('batches').insert([payload]));
        if (!error) {
          toast.success('Batch created');
        }
      }
      if (error) {
        toast.error(error.message);
        return;
      }
      setModalOpen(false);
      load();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      // Soft-disable: batches is referenced by students, fees and exams, so a
      // hard delete trips fees_batch_id_fkey. Setting is_active=false hides it
      // from public/student views while preserving fee and enrolment history.
      const { error } = await supabase
        .from('batches')
        .update({ is_active: false })
        .eq('id', deleteTarget.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success('Batch disabled');
      setDeleteTarget(null);
      load();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setDeleting(false);
    }
  };

  const getCapPct = (b: Batch) => {
    const enrolled = b.enrolled_count ?? 0;
    const cap = b.capacity ?? 1;
    return Math.min(100, Math.round((enrolled / cap) * 100));
  };

  const getCapColor = (pct: number) =>
    pct >= 90 ? 'bg-red-400' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-400';

  return (
    <AdminLayout title="ব্যাচ ব্যবস্থাপনা">
      <div className="space-y-4">
        <div className="flex justify-end">
          <button onClick={() => openModal()} className="btn-primary text-sm">
            <Plus size={15} /> New Batch
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 card animate-pulse" />
            ))}
          </div>
        ) : batches.length === 0 ? (
          <div className="card p-16 text-center">
            <p className="text-slate-400">No batches yet. Create your first batch!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {batches.map((b) => {
              const pct = getCapPct(b);
              const days = Array.isArray(b.schedule_days) ? b.schedule_days : [];
              return (
                <motion.div
                  key={b.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="card p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white truncate">{b.name}</h3>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {subjectTokens(b.subject).map((s) => (
                          <span key={s} className="badge-blue text-xs">
                            {s}
                          </span>
                        ))}
                        {b.class_level && (
                          <span className="badge-violet text-xs">{b.class_level}</span>
                        )}
                        {b.code && <span className="badge-yellow text-xs">Code: {b.code}</span>}
                        <span
                          className={cn(
                            'text-xs',
                            b.is_active !== false ? 'badge-green' : 'badge-red'
                          )}
                        >
                          {b.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button
                        onClick={() => openModal(b)}
                        className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-500 hover:text-sky-400"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(b)}
                        className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs text-slate-400 mb-3">
                    {b.teacher && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <BookOpen size={11} className="text-violet-400" />
                        {subjectTokens(b.teacher).map((t) => (
                          <span key={t} className="badge-violet text-xs">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {(days.length > 0 || b.schedule_time) && (
                      <div className="flex items-center gap-1.5">
                        <Clock size={11} className="text-sky-400" />
                        {days.length > 0 ? days.join('/') : ''}
                        {b.schedule_time ? ` · ${b.schedule_time}` : ''}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <DollarSign size={11} className="text-emerald-400" />
                      {formatCurrency(b.monthly_fee ?? b.fee ?? 0)}/month
                    </div>
                  </div>

                  {/* Capacity bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>
                        <Users size={10} className="inline mr-1" />
                        {b.enrolled_count ?? 0}/{b.capacity} enrolled
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', getCapColor(pct))}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => openDetail(b)}
                    className="w-full flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-sky-400 transition-colors py-1"
                  >
                    View Details <ChevronRight size={12} />
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative card-glass w-full max-w-lg z-10 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between p-5 border-b border-white/5">
                <h2 className="font-inter font-bold text-white">
                  {editing.id ? 'Edit Batch' : 'New Batch'}
                </h2>
                <button
                  onClick={() => setModalOpen(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Batch Name *</label>
                    <input
                      value={editing.name ?? ''}
                      onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                      className="input-field"
                      placeholder="e.g. SSC English Morning"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Subjects</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {subjectTokens(editing.subject).map((s) => (
                        <span
                          key={s}
                          className="badge-blue text-xs flex items-center gap-1 px-2 py-1"
                        >
                          {s}
                          <button
                            type="button"
                            onClick={() =>
                              setEditing((p) => ({
                                ...p,
                                subject: subjectTokens(p.subject)
                                  .filter((x) => x !== s)
                                  .join(', '),
                              }))
                            }
                            className="hover:text-white opacity-70"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={subjectInput}
                        onChange={(e) => setSubjectInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const t = subjectInput.trim();
                            if (t && !subjectTokens(editing.subject).includes(t)) {
                              setEditing((p) => ({
                                ...p,
                                subject: [...subjectTokens(p.subject), t].join(', '),
                              }));
                            }
                            setSubjectInput('');
                          }
                        }}
                        className="input-field flex-1"
                        placeholder="Type a subject and press Enter"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const t = subjectInput.trim();
                          if (t && !subjectTokens(editing.subject).includes(t)) {
                            setEditing((p) => ({
                              ...p,
                              subject: [...subjectTokens(p.subject), t].join(', '),
                            }));
                          }
                          setSubjectInput('');
                        }}
                        className="btn-outline text-xs px-3"
                      >
                        <Plus size={12} /> Add
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Class Level</label>
                    <input
                      value={editing.class_level ?? ''}
                      onChange={(e) => setEditing((p) => ({ ...p, class_level: e.target.value }))}
                      className="input-field"
                      placeholder="e.g. SSC / Class 10"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Batch Code</label>
                    <input
                      value={editing.code ?? ''}
                      onChange={(e) =>
                        setEditing((p) => ({
                          ...p,
                          code: e.target.value.trim().toUpperCase().slice(0, 6),
                        }))
                      }
                      className="input-field font-mono"
                      placeholder="Q"
                    />
                    <p className="text-slate-600 text-[10px] mt-1">
                      Used in student IDs (e.g. TLYQ26001)
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-2 block">
                      Teachers <span className="text-slate-600">(pick one or more)</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {teachers.map((t) => {
                        const on = selectedTeacherIds.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() =>
                              setSelectedTeacherIds((prev) =>
                                on ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                              )
                            }
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                              on
                                ? 'bg-violet-500/20 border-violet-400/40 text-violet-300'
                                : 'border-white/10 text-slate-400 hover:border-white/20'
                            )}
                          >
                            {on && <span className="mr-1">✓</span>}
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-slate-600 text-xs mt-1.5">
                      {selectedTeacherIds.length === 0
                        ? 'No teacher assigned'
                        : `${selectedTeacherIds.length} selected`}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-2 block">Schedule Days</label>
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleDay(d)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                            (editing.schedule_days ?? []).includes(d)
                              ? 'bg-sky-500/20 border-sky-400/40 text-sky-400'
                              : 'border-white/10 text-slate-400 hover:border-white/20'
                          )}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Start Time</label>
                    <input
                      type="time"
                      value={editing.schedule_time ?? ''}
                      onChange={(e) => setEditing((p) => ({ ...p, schedule_time: e.target.value }))}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Max Seats</label>
                    <input
                      type="number"
                      min={1}
                      value={editing.capacity ?? 30}
                      onChange={(e) =>
                        setEditing((p) => ({ ...p, capacity: Number(e.target.value) }))
                      }
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Monthly Fee (৳)</label>
                    <input
                      type="number"
                      min={0}
                      value={editing.monthly_fee ?? 1500}
                      onChange={(e) =>
                        setEditing((p) => ({ ...p, monthly_fee: Number(e.target.value) }))
                      }
                      className="input-field"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Description</label>
                    <textarea
                      value={editing.description ?? ''}
                      onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))}
                      className="input-field"
                      rows={2}
                      placeholder="Optional description…"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editing.is_active !== false}
                        onChange={(e) => setEditing((p) => ({ ...p, is_active: e.target.checked }))}
                        className="rounded accent-sky-400 w-4 h-4"
                      />
                      <span className="text-slate-300 text-sm">Active batch</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setModalOpen(false)}
                    className="btn-outline flex-1 justify-center text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="btn-primary flex-1 justify-center text-sm"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {editing.id ? 'Update' : 'Create Batch'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Drawer */}
      <AnimatePresence>
        {detailBatch && (
          <div className="fixed inset-0 z-50 flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setDetailBatch(null)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="relative ml-auto w-full max-w-md h-full bg-navy-900 border-l border-navy-700/50 overflow-y-auto z-10"
            >
              <div className="flex items-center justify-between p-5 border-b border-navy-700/50">
                <div>
                  <h2 className="font-inter font-bold text-white">{detailBatch.name}</h2>
                  <p className="text-slate-400 text-xs mt-0.5">
                    {detailStudents.length} students · {detailExams.length} exams
                  </p>
                </div>
                <button
                  onClick={() => setDetailBatch(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-5">
                {detailLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-10 card animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <>
                    <div>
                      <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                        Enrolled Students ({detailStudents.length})
                      </h3>
                      {detailStudents.length === 0 ? (
                        <p className="text-slate-600 text-sm">No students enrolled</p>
                      ) : (
                        <div className="space-y-1.5">
                          {detailStudents.map((s) => (
                            <div
                              key={s.id}
                              className="flex items-center justify-between px-3 py-2 rounded-lg bg-navy-800/50"
                            >
                              <div>
                                <p className="text-white text-sm">{s.name}</p>
                                <p className="font-mono text-sky-400 text-xs">{s.student_id}</p>
                              </div>
                              <span
                                className={
                                  s.status === 'active'
                                    ? 'badge-green text-xs'
                                    : 'badge-yellow text-xs'
                                }
                              >
                                {s.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {detailExams.length > 0 && (
                      <div>
                        <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                          Exams ({detailExams.length})
                        </h3>
                        <div className="space-y-1.5">
                          {detailExams.map((e) => (
                            <div
                              key={e.id}
                              className="flex items-center justify-between px-3 py-2 rounded-lg bg-navy-800/50"
                            >
                              <div>
                                <p className="text-white text-sm">{e.title}</p>
                                <p className="text-slate-500 text-xs">{e.subject}</p>
                              </div>
                              <span
                                className={
                                  e.status === 'active'
                                    ? 'badge-green text-xs'
                                    : e.status === 'ended'
                                      ? 'badge-red text-xs'
                                      : 'badge-yellow text-xs'
                                }
                              >
                                {e.status ?? 'draft'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setDeleteTarget(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.93 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.93 }}
              className="relative card-glass p-6 w-full max-w-sm z-10 text-center"
            >
              <Trash2 size={28} className="text-red-400 mx-auto mb-3" />
              <p className="font-semibold text-white mb-1">
                Disable &quot;{deleteTarget.name}&quot;?
              </p>
              <p className="text-slate-400 text-sm mb-5">
                The batch will be hidden from public and student views. Its students, fees and
                history are kept and can be re-enabled from the edit modal.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="btn-outline flex-1 justify-center text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="btn-danger flex-1 justify-center text-sm"
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}{' '}
                  Disable
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AdminLayout>
  );
}
