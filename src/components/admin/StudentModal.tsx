import { useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Save, Upload, User, AlertCircle, Check, X as XIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/utils/errorHandler';

const schema = z.object({
  name: z.string().min(2, 'Name required'),
  phone: z.string().regex(/^01[3-9]\d{8}$/, 'Valid BD phone required (01XXXXXXXXX)'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  guardian_name: z.string().optional(),
  guardian_phone: z.string().optional(),
  address: z.string().optional(),
  class_level: z.string().optional(),
  gender: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.enum(['male', 'female', 'other']).optional()),
  batch_id: z.string().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).default('active'),
  is_approved: z.boolean().default(true),
  password: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

interface Props {
  open: boolean;
  student?: Partial<FormData> & { id?: string; student_id?: string; photo_url?: string };
  batches?: { id: string; name: string }[];
  onSave: (data: FormData & { photo_url?: string; student_id?: string }) => Promise<void>;
  onClose: () => void;
}

const MAX_SIZE_KB = 300;

async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxDim = 400;
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height = Math.round((height / width) * maxDim);
        width = maxDim;
      } else if (height > maxDim) {
        width = Math.round((width / height) * maxDim);
        height = maxDim;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      let quality = 0.85;
      const attempt = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Compression failed'));
              return;
            }
            if (blob.size <= MAX_SIZE_KB * 1024 || quality <= 0.1) {
              resolve(blob);
            } else {
              quality -= 0.1;
              attempt();
            }
          },
          'image/jpeg',
          quality
        );
      };
      attempt();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

async function generateStudentId(): Promise<string> {
  const year = new Date().getFullYear().toString().slice(2);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const { data } = await supabase
        .from('students')
        .select('student_id')
        .like('student_id', `CF${year}%`)
        .order('student_id', { ascending: false })
        .limit(1);
      const last = data?.[0]?.student_id;
      const lastSeq = last ? parseInt(last.slice(4)) : 0;
      const candidate = `CF${year}${String(lastSeq + 1).padStart(4, '0')}`;
      const { data: existing } = await supabase
        .from('students')
        .select('id')
        .eq('student_id', candidate)
        .maybeSingle();
      if (!existing) {
        return candidate;
      }
    } catch (err) {
      handleSupabaseError(err);
    }
  }
  return `CF${year}${Date.now().toString().slice(-4)}`;
}

function Field({
  label,
  error,
  children,
  required,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-slate-400 mb-1.5 block">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
          <AlertCircle size={11} />
          {error}
        </p>
      )}
    </div>
  );
}

export function StudentModal({ open, student, batches = [], onSave, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { status: 'active', is_approved: true },
  });

  const guardianPhone = watch('guardian_phone');
  const phone = watch('phone');

  useEffect(() => {
    if (open) {
      reset({
        name: student?.name ?? '',
        phone: student?.phone ?? '',
        email: student?.email ?? '',
        guardian_name: student?.guardian_name ?? '',
        guardian_phone: student?.guardian_phone ?? '',
        address: student?.address ?? '',
        class_level: student?.class_level ?? '',
        gender: student?.gender,
        batch_id: student?.batch_id ?? '',
        status: (student?.status as 'active' | 'inactive' | 'suspended') ?? 'active',
        is_approved: student?.is_approved ?? true,
        password: '',
      });
      setPhotoFile(null);
      setPhotoPreview(student?.photo_url ?? null);
      setPhotoError('');
    }
  }, [open, student]);

  // Auto-fill portal password from guardian/student phone — only when adding a new student
  useEffect(() => {
    if (student) {
      return;
    } // don't overwrite manually set passwords on edit
    const pw = (guardianPhone || phone || '').slice(-6);
    if (pw) {
      setValue('password', pw);
    }
  }, [guardianPhone, phone, student]);

  const handlePhotoSelect = (file: File) => {
    setPhotoError('');
    if (file.size > MAX_SIZE_KB * 1024) {
      // Try to compress first, show error only if still too large
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    } else {
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const onSubmit = async (data: FormData) => {
    setUploading(true);
    let photo_url = student?.photo_url;

    // Photo upload
    if (photoFile) {
      try {
        const compressed = await compressImage(photoFile);
        if (compressed.size > MAX_SIZE_KB * 1024) {
          setPhotoError(`ছবির সাইজ ${MAX_SIZE_KB}KB এর বেশি হতে পারবে না`);
          setUploading(false);
          return;
        }
        const id = student?.id ?? crypto.randomUUID();
        const path = `student-photos/${id}.jpg`;
        const { error: storErr } = await supabase.storage
          .from('avatars')
          .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
        if (!storErr) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
          photo_url = `${urlData.publicUrl}?t=${Date.now()}`;
        }
      } catch (err) {
        handleSupabaseError(err);
        // Photo upload failed — continue without photo
      }
    }

    // Auto-generate student ID for new students
    let student_id = student?.student_id;
    if (!student_id) {
      student_id = await generateStudentId();
    }

    setUploading(false);
    await onSave({ ...data, photo_url, student_id });
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            className="relative card-glass w-full max-w-2xl max-h-[92vh] overflow-y-auto z-10"
          >
            {/* Header */}
            <div className="sticky top-0 bg-navy-800/95 backdrop-blur-sm flex items-center justify-between px-6 py-4 border-b border-white/5 z-10">
              <div>
                <h2 className="font-inter font-bold text-white">
                  {student?.id ? 'Edit Student' : 'নতুন ছাত্র যোগ করুন'}
                </h2>
                {!student?.id && (
                  <p className="text-slate-500 text-xs mt-0.5">Student ID will be auto-generated</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
              {/* Photo upload */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Student Photo</label>
                <div className="flex items-start gap-4">
                  <div
                    className={`w-20 h-20 rounded-xl border-2 border-dashed flex items-center justify-center shrink-0 cursor-pointer transition-all overflow-hidden
                      ${dragOver ? 'border-sky-400 bg-sky-400/10' : 'border-navy-600 hover:border-sky-400/50 hover:bg-white/3'}`}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const f = e.dataTransfer.files[0];
                      if (f?.type.startsWith('image/')) {
                        handlePhotoSelect(f);
                      }
                    }}
                  >
                    {photoPreview ? (
                      <img
                        src={photoPreview}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User size={24} className="text-slate-600" />
                    )}
                  </div>
                  <div className="flex-1">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="btn-outline text-sm py-2 mb-2"
                    >
                      <Upload size={14} /> {photoPreview ? 'Change Photo' : 'Upload Photo'}
                    </button>
                    <p className="text-slate-600 text-xs">
                      JPG/PNG, max {MAX_SIZE_KB}KB. Auto-compressed if larger.
                    </p>
                    {photoError && (
                      <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                        <AlertCircle size={11} />
                        {photoError}
                      </p>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        handlePhotoSelect(f);
                      }
                    }}
                  />
                </div>
              </div>

              {/* Personal info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Full Name" required error={errors.name?.message}>
                  <input
                    {...register('name')}
                    className="input-field"
                    placeholder="Student's full name"
                  />
                </Field>
                <Field label="Phone" required error={errors.phone?.message}>
                  <input {...register('phone')} className="input-field" placeholder="01XXXXXXXXX" />
                </Field>
                <Field label="Email" error={errors.email?.message}>
                  <input {...register('email')} className="input-field" placeholder="Optional" />
                </Field>
                <Field label="Class Level">
                  <select {...register('class_level')} className="input-field">
                    <option value="">Select class</option>
                    {[
                      'Class 6',
                      'Class 7',
                      'Class 8',
                      'JSC',
                      'Class 9',
                      'Class 10',
                      'SSC',
                      'Class 11',
                      'Class 12',
                      'HSC',
                      'IELTS',
                      'Admission Test',
                    ].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Gender">
                  <select {...register('gender')} className="input-field">
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Guardian Name">
                  <input
                    {...register('guardian_name')}
                    className="input-field"
                    placeholder="Parent / Guardian"
                  />
                </Field>
                <Field label="Guardian Phone">
                  <input
                    {...register('guardian_phone')}
                    className="input-field"
                    placeholder="01XXXXXXXXX"
                  />
                </Field>
                <Field label="Assign Batch">
                  <select {...register('batch_id')} className="input-field">
                    <option value="">No batch</option>
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Address">
                <textarea
                  {...register('address')}
                  className="input-field"
                  rows={2}
                  placeholder="Full address"
                />
              </Field>

              {/* Status & Approval */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Status">
                  <select {...register('status')} className="input-field">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </Field>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Portal Access</label>
                  <Controller
                    name="is_approved"
                    control={control}
                    render={({ field }) => (
                      <button
                        type="button"
                        onClick={() => field.onChange(!field.value)}
                        className={`w-full py-2.5 rounded-lg border text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                          field.value
                            ? 'bg-emerald-400/10 border-emerald-400/30 text-emerald-400'
                            : 'bg-white/5 border-white/10 text-slate-400'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          {field.value ? <Check size={14} /> : <XIcon size={14} />}
                          {field.value ? 'Approved' : 'Not Approved'}
                        </span>
                      </button>
                    )}
                  />
                </div>
              </div>

              {/* Portal password */}
              <div className="card p-4 border-dashed border-sky-400/20">
                <p className="text-slate-400 text-xs mb-2">
                  Portal Login Credentials (auto-generated)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-slate-600 text-[10px] mb-1">Email</p>
                    <p className="font-mono text-sky-400 text-xs">
                      {phone ? `${phone}@coaching.local` : '—'}
                    </p>
                  </div>
                  <Field label="Portal Password">
                    <input
                      {...register('password')}
                      className="input-field font-mono text-sm"
                      placeholder="Last 6 digits"
                    />
                  </Field>
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex gap-3 justify-end pt-2 border-t border-white/5">
                <button type="button" onClick={onClose} className="btn-outline text-sm">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || uploading}
                  className="btn-primary text-sm"
                >
                  <Save size={15} />
                  {isSubmitting || uploading
                    ? 'Saving…'
                    : student?.id
                      ? 'Update Student'
                      : 'Add Student'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
