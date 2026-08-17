import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { StudentModal } from '@/components/admin/StudentModal';
import { StudentDrawer } from '@/components/admin/StudentDrawer';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Avatar } from '@/components/shared/Avatar';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { handleSupabaseError } from '@/utils/errorHandler';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Download,
  Eye,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDate, cn, sanitize } from '@/lib/utils';
import { motion } from 'framer-motion';

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
  gender?: 'male' | 'female' | 'other';
  status: 'active' | 'inactive' | 'suspended';
  is_approved?: boolean;
  password?: string;
  photo_url?: string;
  batch_id?: string;
  batch?: { id: string; name: string };
  created_at: string;
}

type StatusFilter = 'all' | 'active' | 'inactive' | 'suspended';
const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'suspended', label: 'Suspended' },
];

const PAGE_SIZE = 20;

const statusBadge = (s: string) => {
  if (s === 'active') {
    return <span className="badge-green">Active</span>;
  }
  if (s === 'inactive') {
    return <span className="badge-yellow">Inactive</span>;
  }
  return <span className="badge-red">Suspended</span>;
};

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [drawerStudent, setDrawerStudent] = useState<Student | null>(null);
  const q = useDebounce(search, 300);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('students')
        .select('*, batch:batches(id,name)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (q) {
        query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,student_id.ilike.%${q}%`);
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (batchFilter !== 'all') {
        query = query.eq('batch_id', batchFilter);
      }

      const { data, count } = await query;
      const cleaned = (data ?? []).map((s: any) => ({
        ...s,
        name: sanitize(s.name),
        batch: s.batch ? { ...s.batch, name: sanitize(s.batch.name) } : s.batch,
      }));
      setStudents(cleaned);
      setTotal(count ?? 0);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, batchFilter, page]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    supabase
      .from('batches')
      .select('id,name')
      .eq('is_active', true)
      .then(
        ({ data }) => {
          const cleaned = (data ?? []).map((b: any) => ({ ...b, name: sanitize(b.name) }));
          setBatches(cleaned);
        },
        (err: any) => {
          handleSupabaseError(err);
        }
      );
  }, []);

  // Reset to page 1 on filter change
  useEffect(() => {
    setPage(1);
  }, [q, statusFilter, batchFilter]);

  const handleSave = async (data: any) => {
    try {
      if (editing?.id) {
        // Separate password from other fields for update
        const { password, ...updateFields } = data;
        const { error } = await supabase.from('students').update(updateFields).eq('id', editing.id);
        if (error) {
          toast.error('Update failed');
          return;
        }
        // If password was provided, hash it via RPC
        if (password && password.trim()) {
          await supabase.rpc('change_student_password', {
            p_student_id: editing.id,
            p_new_password: password.trim(),
          });
        }
        // Update enrolled counts when batch changes
        if (editing.batch_id !== data.batch_id) {
          if (editing.batch_id) {
            await supabase.rpc('decrement_enrolled', { batch_uuid: editing.batch_id });
          }
          if (data.batch_id) {
            await supabase.rpc('increment_enrolled', { batch_uuid: data.batch_id });
          }
        }
        toast.success('Student updated');
      } else {
        // New student — use RPC to hash password server-side
        const { error } = await supabase.rpc('register_student', {
          p_name: data.name,
          p_phone: data.phone,
          p_student_id: data.student_id,
          p_password: data.password || '',
          p_email: data.email ?? null,
          p_guardian_name: data.guardian_name ?? null,
          p_guardian_phone: data.guardian_phone ?? null,
          p_address: data.address ?? null,
          p_class_level: data.class_level ?? null,
          p_gender: data.gender ?? null,
          p_batch_id: data.batch_id ?? null,
          p_status: data.status ?? 'active',
          p_is_approved: data.is_approved ?? true,
          p_photo_url: data.photo_url ?? null,
        });
        if (error) {
          toast.error('Failed to add student: ' + error.message);
          return;
        }
        // Update batch enrolled count
        if (data.batch_id) {
          await supabase.rpc('increment_enrolled', { batch_uuid: data.batch_id });
        }
        toast.success(`Student added! ID: ${data.student_id}`);
      }
      setModalOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      handleSupabaseError(err);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      // Remove related records before deleting the student to avoid orphaned rows
      await supabase.from('mcq_submissions').delete().eq('student_id', deleteTarget.id);
      await supabase.from('fees').delete().eq('student_id', deleteTarget.id);
      const { error } = await supabase.from('students').delete().eq('id', deleteTarget.id);
      if (error) {
        toast.error('Delete failed');
        return;
      }
      // Decrement enrolled count for the student's batch
      if (deleteTarget.batch_id) {
        await supabase.rpc('decrement_enrolled', { batch_uuid: deleteTarget.batch_id });
      }
      toast.success('Student deleted');
      setDeleteTarget(null);
      load();
    } catch (err) {
      handleSupabaseError(err);
    }
  };

  const csvExport = () => {
    const headers = [
      'Student ID',
      'Name',
      'Guardian',
      'Phone',
      'Email',
      'Class',
      'Batch',
      'Status',
      'Joined',
    ];
    const rows = students.map((s) => [
      s.student_id ?? '',
      s.name,
      s.guardian_name ?? '',
      s.phone,
      s.email ?? '',
      s.class_level ?? '',
      s.batch?.name ?? '',
      s.status,
      formatDate(s.created_at),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const a = document.createElement('a');
    const csvUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.href = csvUrl;
    a.download = `students_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(csvUrl);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminLayout title="ছাত্র ব্যবস্থাপনা">
      <div className="space-y-4">
        {/* Top bar */}
        <div className="flex flex-col gap-3">
          {/* Row 1: search + actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-between">
            <div className="relative max-w-xs w-full">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field pl-9 py-2 text-sm"
                placeholder="Name, ID or phone…"
              />
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={csvExport} className="btn-outline text-sm py-2">
                <Download size={14} /> CSV Export
              </button>
              <button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
                className="btn-primary text-sm py-2"
              >
                <Plus size={15} /> নতুন ছাত্র
              </button>
            </div>
          </div>

          {/* Row 2: filters */}
          <div className="flex flex-wrap gap-2 items-center">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`filter-pill ${statusFilter === f.id ? 'active' : ''}`}
              >
                {f.label}
              </button>
            ))}
            <select
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
              className="input-field py-1.5 text-sm max-w-[180px]"
            >
              <option value="all">All Batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {total > 0 && <span className="text-slate-500 text-xs ml-auto">{total} students</span>}
          </div>
        </div>

        {/* Desktop Table */}
        <div className="card overflow-hidden hidden md:block">
          {loading ? (
            <div className="divide-y divide-navy-700/50">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
                  <div className="w-4 h-4 rounded bg-navy-700" />
                  <div className="w-8 h-8 rounded-full bg-navy-700" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-navy-700 rounded w-32" />
                    <div className="h-2.5 bg-navy-700 rounded w-20" />
                  </div>
                  <div className="h-3 bg-navy-700 rounded w-24" />
                  <div className="h-5 bg-navy-700 rounded-full w-16" />
                </div>
              ))}
            </div>
          ) : students.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-slate-500 text-sm">No students found.</p>
              <button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
                className="btn-primary mt-4 text-sm"
              >
                <Plus size={14} /> Add First Student
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  <th className="text-left px-4 py-3 text-slate-400 font-medium w-8">
                    <input
                      type="checkbox"
                      className="rounded accent-sky-400"
                      checked={students.length > 0 && students.every((s) => selectedIds.has(s.id))}
                      onChange={(e) =>
                        setSelectedIds(
                          e.target.checked ? new Set(students.map((s) => s.id)) : new Set()
                        )
                      }
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Student</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">ID</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Class</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Batch</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => (
                  <motion.tr
                    key={s.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-navy-700/40 hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="rounded accent-sky-400"
                        checked={selectedIds.has(s.id)}
                        onChange={(e) =>
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) {
                              next.add(s.id);
                            } else {
                              next.delete(s.id);
                            }
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={s.name} size="sm" src={s.photo_url} />
                        <div>
                          <p className="font-medium text-white text-sm">{s.name}</p>
                          <p className="text-slate-500 text-xs truncate max-w-[140px]">
                            {s.email || s.guardian_name || '—'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-sky-400 text-xs">{s.student_id || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-sm">{s.class_level || '—'}</td>
                    <td className="px-4 py-3 text-slate-300 text-sm">{s.phone}</td>
                    <td className="px-4 py-3">
                      {s.batch?.name ? (
                        <span className="badge-blue text-xs">{s.batch.name}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{statusBadge(s.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setDrawerStudent(s)}
                          className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-400 hover:text-sky-400 transition-colors"
                          title="View"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => {
                            setEditing(s);
                            setModalOpen(true);
                          }}
                          className="p-1.5 rounded-lg hover:bg-violet-500/15 text-slate-400 hover:text-violet-400 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(s)}
                          className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Mobile Card List */}
        <div className="md:hidden space-y-3">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card p-4 animate-pulse flex gap-3">
                <div className="w-10 h-10 rounded-full bg-navy-700 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-navy-700 rounded w-3/4" />
                  <div className="h-2.5 bg-navy-700 rounded w-1/2" />
                </div>
              </div>
            ))
          ) : students.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-slate-500 text-sm">No students found.</p>
            </div>
          ) : (
            students.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="card p-4"
              >
                <div className="flex items-start gap-3 mb-3">
                  <Avatar name={s.name} size="md" src={s.photo_url} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-white truncate">{s.name}</p>
                      {statusBadge(s.status)}
                    </div>
                    {s.student_id && (
                      <p className="font-mono text-sky-400 text-xs">{s.student_id}</p>
                    )}
                    <p className="text-slate-500 text-xs">
                      {s.phone} · {s.class_level || '—'}
                    </p>
                    {s.batch?.name && (
                      <span className="badge-blue text-xs mt-1 inline-block">{s.batch.name}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 border-t border-white/5 pt-3">
                  <button
                    onClick={() => setDrawerStudent(s)}
                    className="btn-outline flex-1 justify-center text-xs py-1.5"
                  >
                    <Eye size={13} /> View
                  </button>
                  <button
                    onClick={() => {
                      setEditing(s);
                      setModalOpen(true);
                    }}
                    className="btn-outline flex-1 justify-center text-xs py-1.5"
                  >
                    <Pencil size={13} /> Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(s)}
                    className="btn-danger flex-none py-1.5 px-3 text-xs"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-slate-500 text-sm">
              Page {page} of {totalPages} · {total} total
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-navy-700 text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={15} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={cn(
                      'w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-colors',
                      page === p
                        ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                        : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                    )}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-navy-700 text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Student Detail Drawer */}
      <StudentDrawer
        student={drawerStudent}
        onClose={() => setDrawerStudent(null)}
        onStatusChange={() => {
          load();
          setDrawerStudent(null);
        }}
      />

      {/* Add/Edit Modal */}
      <StudentModal
        open={modalOpen}
        student={editing ? { ...editing } : undefined}
        batches={batches}
        onSave={handleSave}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Student"
        message={`Delete ${deleteTarget?.name}? This cannot be undone and will remove all their records.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        danger
      />
    </AdminLayout>
  );
}
