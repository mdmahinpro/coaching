import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Save, Users, Clock, DollarSign, Loader2, ChevronRight, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrency, cn, sanitize } from '@/lib/utils';
import { handleSupabaseError } from '@/utils/errorHandler';

interface Batch {
  id: string;
  name: string;
  subject?: string;
  class_level?: string;
  teacher_id?: string;
  teacher?: { id: string; name: string };
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
const EMPTY: Partial<Batch> = { is_active: true, capacity: 30, monthly_fee: 1500, schedule_days: [] };

export default function BatchesPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Batch>>(EMPTY);
  const [saving, setSaving] = useState(false);
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
        supabase.from('batches').select('*, teacher:teachers(id,name)').order('created_at', { ascending: false }),
        supabase.from('students').select('batch_id').eq('status', 'active').not('batch_id', 'is', null),
      ]);
      const countMap: Record<string, number> = {};
      (studentCounts ?? []).forEach((s: any) => {
        if (s.batch_id) countMap[s.batch_id] = (countMap[s.batch_id] ?? 0) + 1;
      });
      const cleaned = ((data ?? []) as any[]).map(b => ({
        ...b,
        name: sanitize(b.name),
        subject: b.subject ? sanitize(b.subject) : b.subject,
        description: b.description ? sanitize(b.description) : b.description,
        teacher: b.teacher ? { ...b.teacher, name: sanitize(b.teacher.name) } : b.teacher,
      }));
      setBatches(cleaned.map((b: any) => ({ ...b, enrolled_count: countMap[b.id] ?? 0 })));
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.from('teachers').select('id,name').eq('is_active', true).then(({ data }) => {
      const cleaned = (data ?? []).map((t: any) => ({ ...t, name: sanitize(t.name) }));
      setTeachers(cleaned);
    },(err: any) => { handleSupabaseError(err); });
  }, []);

  const openDetail = async (b: Batch) => {
    setDetailBatch(b);
    setDetailLoading(true);
    try {
      const [{ data: students }, { data: exams }] = await Promise.all([
        supabase.from('students').select('id,name,student_id,status').eq('batch_id', b.id).order('name'),
        supabase.from('exams').select('id,title,subject,status,exam_date').eq('batch_id', b.id).order('exam_date', { ascending: false }),
      ]);
      setDetailStudents(students ?? []);
      setDetailExams(exams ?? []);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setDetailLoading(false);
    }
  };

  const openModal = (b?: Batch) => {
    setEditing(b ? {
      ...b,
      schedule_days: Array.isArray(b.schedule_days) ? b.schedule_days : (b.schedule_days ? (b.schedule_days as unknown as string).split(',') : []),
    } : EMPTY);
    setModalOpen(true);
  };

  const toggleDay = (day: string) => {
    setEditing(p => {
      const days = p.schedule_days ?? [];
      return { ...p, schedule_days: days.includes(day) ? days.filter(d => d !== day) : [...days, day] };
    });
  };

  const handleSave = async () => {
    if (!editing.name) { toast.error('Batch name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: editing.name,
        subject: editing.subject ?? null,
        class_level: editing.class_level ?? null,
        teacher_id: editing.teacher_id ?? null,
        schedule_days: editing.schedule_days ?? [],
        schedule_time: editing.schedule_time ?? null,
        capacity: editing.capacity ?? 30,
        monthly_fee: editing.monthly_fee ?? 1500,
        fee: editing.monthly_fee ?? 1500,
        description: editing.description ?? null,
        is_active: editing.is_active ?? true,
      };

      let error;
      if (editing.id) {
        ({ error } = await supabase.from('batches').update(payload).eq('id', editing.id));
        if (!error) toast.success('Batch updated');
      } else {
        ({ error } = await supabase.from('batches').insert([payload]));
        if (!error) toast.success('Batch created');
      }
      if (error) { toast.error(error.message); return; }
      setModalOpen(false);
      load();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Null out batch_id on students and exams in this batch first to avoid orphaned references
      await supabase.from('students').update({ batch_id: null }).eq('batch_id', deleteTarget.id);
      await supabase.from('exams').update({ batch_id: null }).eq('batch_id', deleteTarget.id);
      const { error } = await supabase.from('batches').delete().eq('id', deleteTarget.id);
      if (error) { toast.error(error.message); return; }
      toast.success('Batch deleted');
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

  const getCapColor = (pct: number) => pct >= 90 ? 'bg-red-400' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-400';

  return (
    <AdminLayout title="ব্যাচ ব্যবস্থাপনা">
      <div className="space-y-4">
        <div className="flex justify-end">
          <button onClick={() => openModal()} className="btn-primary text-sm"><Plus size={15} /> New Batch</button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-44 card animate-pulse" />)}
          </div>
        ) : batches.length === 0 ? (
          <div className="card p-16 text-center"><p className="text-slate-400">No batches yet. Create your first batch!</p></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {batches.map(b => {
              const pct = getCapPct(b);
              const days = Array.isArray(b.schedule_days) ? b.schedule_days : [];
              return (
                <motion.div key={b.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white truncate">{b.name}</h3>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {b.subject && <span className="badge-blue text-xs">{b.subject}</span>}
                        {b.class_level && <span className="badge-violet text-xs">{b.class_level}</span>}
                        <span className={cn('text-xs', b.is_active !== false ? 'badge-green' : 'badge-red')}>
                          {b.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => openModal(b)} className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-500 hover:text-sky-400"><Pencil size={12} /></button>
                      <button onClick={() => setDeleteTarget(b)} className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-500 hover:text-red-400"><Trash2 size={12} /></button>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs text-slate-400 mb-3">
                    {b.teacher?.name && (
                      <div className="flex items-center gap-1.5"><BookOpen size={11} className="text-violet-400" />{b.teacher.name}</div>
                    )}
                    {(days.length > 0 || b.schedule_time) && (
                      <div className="flex items-center gap-1.5"><Clock size={11} className="text-sky-400" />
                        {days.length > 0 ? days.join('/') : ''}{b.schedule_time ? ` · ${b.schedule_time}` : ''}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5"><DollarSign size={11} className="text-emerald-400" />{formatCurrency(b.monthly_fee ?? b.fee ?? 0)}/month</div>
                  </div>

                  {/* Capacity bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span><Users size={10} className="inline mr-1" />{b.enrolled_count ?? 0}/{b.capacity} enrolled</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', getCapColor(pct))} style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <button onClick={() => openDetail(b)} className="w-full flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-sky-400 transition-colors py-1">
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative card-glass w-full max-w-lg z-10 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-white/5">
                <h2 className="font-inter font-bold text-white">{editing.id ? 'Edit Batch' : 'New Batch'}</h2>
                <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Batch Name *</label>
                    <input value={editing.name ?? ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} className="input-field" placeholder="e.g. SSC English Morning" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Subject</label>
                    <input value={editing.subject ?? ''} onChange={e => setEditing(p => ({ ...p, subject: e.target.value }))} className="input-field" placeholder="e.g. English" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Class Level</label>
                    <input value={editing.class_level ?? ''} onChange={e => setEditing(p => ({ ...p, class_level: e.target.value }))} className="input-field" placeholder="e.g. SSC / Class 10" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Teacher</label>
                    <select value={editing.teacher_id ?? ''} onChange={e => setEditing(p => ({ ...p, teacher_id: e.target.value || undefined }))} className="input-field">
                      <option value="">No teacher assigned</option>
                      {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-2 block">Schedule Days</label>
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map(d => (
                        <button key={d} type="button" onClick={() => toggleDay(d)}
                          className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                            (editing.schedule_days ?? []).includes(d) ? 'bg-sky-500/20 border-sky-400/40 text-sky-400' : 'border-white/10 text-slate-400 hover:border-white/20')}>
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Start Time</label>
                    <input type="time" value={editing.schedule_time ?? ''} onChange={e => setEditing(p => ({ ...p, schedule_time: e.target.value }))} className="input-field" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Max Seats</label>
                    <input type="number" min={1} value={editing.capacity ?? 30} onChange={e => setEditing(p => ({ ...p, capacity: Number(e.target.value) }))} className="input-field" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Monthly Fee (৳)</label>
                    <input type="number" min={0} value={editing.monthly_fee ?? 1500} onChange={e => setEditing(p => ({ ...p, monthly_fee: Number(e.target.value) }))} className="input-field" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Description</label>
                    <textarea value={editing.description ?? ''} onChange={e => setEditing(p => ({ ...p, description: e.target.value }))} className="input-field" rows={2} placeholder="Optional description…" />
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editing.is_active !== false} onChange={e => setEditing(p => ({ ...p, is_active: e.target.checked }))} className="rounded accent-sky-400 w-4 h-4" />
                      <span className="text-slate-300 text-sm">Active batch</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setModalOpen(false)} className="btn-outline flex-1 justify-center text-sm">Cancel</button>
                  <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 justify-center text-sm">
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDetailBatch(null)} />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="relative ml-auto w-full max-w-md h-full bg-navy-900 border-l border-navy-700/50 overflow-y-auto z-10">
              <div className="flex items-center justify-between p-5 border-b border-navy-700/50">
                <div>
                  <h2 className="font-inter font-bold text-white">{detailBatch.name}</h2>
                  <p className="text-slate-400 text-xs mt-0.5">{detailStudents.length} students · {detailExams.length} exams</p>
                </div>
                <button onClick={() => setDetailBatch(null)} className="text-slate-400 hover:text-white"><X size={18} /></button>
              </div>
              <div className="p-5 space-y-5">
                {detailLoading ? (
                  <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 card animate-pulse" />)}</div>
                ) : (<>
                  <div>
                    <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Enrolled Students ({detailStudents.length})</h3>
                    {detailStudents.length === 0 ? <p className="text-slate-600 text-sm">No students enrolled</p> : (
                      <div className="space-y-1.5">
                        {detailStudents.map(s => (
                          <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-navy-800/50">
                            <div>
                              <p className="text-white text-sm">{s.name}</p>
                              <p className="font-mono text-sky-400 text-xs">{s.student_id}</p>
                            </div>
                            <span className={s.status === 'active' ? 'badge-green text-xs' : 'badge-yellow text-xs'}>{s.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {detailExams.length > 0 && (
                    <div>
                      <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Exams ({detailExams.length})</h3>
                      <div className="space-y-1.5">
                        {detailExams.map(e => (
                          <div key={e.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-navy-800/50">
                            <div>
                              <p className="text-white text-sm">{e.title}</p>
                              <p className="text-slate-500 text-xs">{e.subject}</p>
                            </div>
                            <span className={e.status === 'active' ? 'badge-green text-xs' : e.status === 'ended' ? 'badge-red text-xs' : 'badge-yellow text-xs'}>
                              {e.status ?? 'draft'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>)}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.93 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.93 }} className="relative card-glass p-6 w-full max-w-sm z-10 text-center">
              <Trash2 size={28} className="text-red-400 mx-auto mb-3" />
              <p className="font-semibold text-white mb-1">Delete "{deleteTarget.name}"?</p>
              <p className="text-slate-400 text-sm mb-5">This may affect enrolled students.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTarget(null)} className="btn-outline flex-1 justify-center text-sm">Cancel</button>
                <button onClick={handleDelete} disabled={deleting} className="btn-danger flex-1 justify-center text-sm">
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AdminLayout>
  );
}
