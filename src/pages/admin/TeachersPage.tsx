import { useEffect, useState, useCallback, useRef } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Avatar } from '@/components/shared/Avatar';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Camera,
  Phone,
  Mail,
  Loader2,
  GraduationCap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, sanitize } from '@/lib/utils';
import { handleSupabaseError } from '@/utils/errorHandler';

interface Teacher {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  subject?: string;
  qualification?: string;
  bio?: string;
  salary?: number;
  photo_url?: string;
  is_active?: boolean;
}

const EMPTY: Partial<Teacher> = { is_active: true };

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Teacher>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('teachers')
        .select('*')
        .order('created_at', { ascending: false });
      const cleaned = (data ?? []).map((t: any) => ({
        ...t,
        name: sanitize(t.name),
        bio: t.bio ? sanitize(t.bio) : t.bio,
        subject: t.subject ? sanitize(t.subject) : t.subject,
        qualification: t.qualification ? sanitize(t.qualification) : t.qualification,
      }));
      setTeachers(cleaned);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revokeBlobPreview = (url: string | null) => {
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  };

  const openModal = (t?: Teacher) => {
    setEditing(t ? { ...t } : EMPTY);
    setPhotoFile(null);
    setPhotoPreview((prev) => {
      revokeBlobPreview(prev);
      return t?.photo_url ?? null;
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setPhotoPreview((prev) => {
      revokeBlobPreview(prev);
      return null;
    });
    setModalOpen(false);
  };

  const compressImage = (file: File): Promise<Blob> =>
    new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const MAX = 400;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) {
            height = Math.round((height * MAX) / width);
            width = MAX;
          } else {
            width = Math.round((width * MAX) / height);
            height = MAX;
          }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.75);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      };
      img.src = objectUrl;
    });

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Photo must be under 5 MB');
      return;
    }
    setPhotoPreview((prev) => {
      revokeBlobPreview(prev);
      return URL.createObjectURL(file);
    });
    setPhotoFile(file);
  };

  const uploadPhoto = async (): Promise<string | null> => {
    if (!photoFile) {
      return editing.photo_url ?? null;
    }
    setUploading(true);
    const blob = await compressImage(photoFile);
    const path = `teachers/${editing.id ?? Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    setUploading(false);
    if (error) {
      toast.error('Photo upload failed');
      return null;
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSave = async () => {
    if (!editing.name) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const photoUrl = await uploadPhoto();
      const payload = {
        name: editing.name,
        email: editing.email ?? null,
        phone: editing.phone ?? null,
        subject: editing.subject ?? null,
        qualification: editing.qualification ?? null,
        bio: editing.bio ?? null,
        salary: editing.salary ?? null,
        photo_url: photoUrl,
        is_active: editing.is_active ?? true,
      };

      let error;
      if (editing.id) {
        ({ error } = await supabase.from('teachers').update(payload).eq('id', editing.id));
        if (!error) {
          toast.success('Teacher updated');
        }
      } else {
        ({ error } = await supabase.from('teachers').insert([payload]));
        if (!error) {
          toast.success('Teacher added');
        }
      }
      if (error) {
        toast.error(error.message);
        return;
      }
      closeModal();
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
      const { error } = await supabase.from('teachers').delete().eq('id', deleteTarget.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success('Teacher removed');
      setDeleteTarget(null);
      load();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminLayout title="শিক্ষক ব্যবস্থাপনা">
      <div className="space-y-4">
        <div className="flex justify-end">
          <button onClick={() => openModal()} className="btn-primary text-sm">
            <Plus size={15} /> Add Teacher
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 card animate-pulse" />
            ))}
          </div>
        ) : teachers.length === 0 ? (
          <div className="card p-16 text-center">
            <p className="text-slate-400">No teachers yet. Add your first teacher!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teachers.map((t) => (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card p-5"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={t.name} size="md" src={t.photo_url} seed={t.id} />
                    <div>
                      <h3 className="font-semibold text-white text-sm">{t.name}</h3>
                      {t.subject && <span className="badge-violet text-xs">{t.subject}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openModal(t)}
                      className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-500 hover:text-sky-400 transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(t)}
                      className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-slate-400">
                  {t.qualification && (
                    <div className="flex items-center gap-2">
                      <GraduationCap size={12} className="shrink-0 text-sky-400" />
                      <span>{t.qualification}</span>
                    </div>
                  )}
                  {t.phone && (
                    <div className="flex items-center gap-2">
                      <Phone size={12} className="shrink-0 text-emerald-400" />
                      <span>{t.phone}</span>
                    </div>
                  )}
                  {t.email && (
                    <div className="flex items-center gap-2">
                      <Mail size={12} className="shrink-0 text-violet-400" />
                      <span className="truncate">{t.email}</span>
                    </div>
                  )}
                  {t.bio && (
                    <p className="text-slate-500 line-clamp-2 mt-2 leading-relaxed">{t.bio}</p>
                  )}
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                  {t.salary ? (
                    <span className="text-emerald-400 text-xs font-medium">
                      ৳{t.salary.toLocaleString()}/mo
                    </span>
                  ) : (
                    <span />
                  )}
                  <span
                    className={cn('text-xs', t.is_active !== false ? 'badge-green' : 'badge-red')}
                  >
                    {t.is_active !== false ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={closeModal}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative card-glass w-full max-w-lg z-10 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between p-5 border-b border-white/5">
                <h2 className="font-inter font-bold text-white">
                  {editing.id ? 'Edit Teacher' : 'Add Teacher'}
                </h2>
                <button onClick={closeModal} className="text-slate-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                {/* Photo upload */}
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="relative group"
                  >
                    <div className="w-20 h-20 rounded-2xl overflow-hidden bg-navy-700 border-2 border-white/10 group-hover:border-sky-400/40 transition-colors">
                      {photoPreview ? (
                        <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Camera size={20} className="text-slate-500" />
                        </div>
                      )}
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-sky-500 flex items-center justify-center">
                      {uploading ? (
                        <Loader2 size={11} className="animate-spin text-white" />
                      ) : (
                        <Camera size={11} className="text-white" />
                      )}
                    </div>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhoto}
                  />
                </div>
                <p className="text-center text-slate-600 text-xs">
                  Max 5MB · Auto-compressed · JPG/PNG
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Full Name *</label>
                    <input
                      value={editing.name ?? ''}
                      onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                      className="input-field"
                      placeholder="Teacher name"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Subject</label>
                    <input
                      value={editing.subject ?? ''}
                      onChange={(e) => setEditing((p) => ({ ...p, subject: e.target.value }))}
                      className="input-field"
                      placeholder="e.g. Mathematics"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Qualification</label>
                    <input
                      value={editing.qualification ?? ''}
                      onChange={(e) => setEditing((p) => ({ ...p, qualification: e.target.value }))}
                      className="input-field"
                      placeholder="e.g. M.Sc"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Phone</label>
                    <input
                      value={editing.phone ?? ''}
                      onChange={(e) => setEditing((p) => ({ ...p, phone: e.target.value }))}
                      className="input-field"
                      placeholder="01XXXXXXXXX"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Salary (৳)</label>
                    <input
                      type="number"
                      value={editing.salary ?? ''}
                      onChange={(e) =>
                        setEditing((p) => ({ ...p, salary: Number(e.target.value) || undefined }))
                      }
                      className="input-field"
                      placeholder="25000"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Email</label>
                    <input
                      type="email"
                      value={editing.email ?? ''}
                      onChange={(e) => setEditing((p) => ({ ...p, email: e.target.value }))}
                      className="input-field"
                      placeholder="teacher@example.com"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Bio</label>
                    <textarea
                      value={editing.bio ?? ''}
                      onChange={(e) => setEditing((p) => ({ ...p, bio: e.target.value }))}
                      className="input-field"
                      rows={3}
                      placeholder="Short bio or description…"
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
                      <span className="text-slate-300 text-sm">Active teacher</span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={closeModal}
                    className="btn-outline flex-1 justify-center text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || uploading}
                    className="btn-primary flex-1 justify-center text-sm"
                  >
                    {saving || uploading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Save size={14} />
                    )}
                    {editing.id ? 'Update' : 'Add Teacher'}
                  </button>
                </div>
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
              <p className="font-semibold text-white mb-1">Remove {deleteTarget.name}?</p>
              <p className="text-slate-400 text-sm mb-5">This will remove them from the system.</p>
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
                  Remove
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AdminLayout>
  );
}
