import { useState, useRef, useEffect } from 'react';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { updatePhoto, changePassword, updateEmail } from '@/lib/portalApi';
import { resolveAvatarUrl } from '@/lib/avatarRetrieval';
import { env } from '@/lib/env';
import { handleSupabaseError } from '@/utils/errorHandler';
import { useStudentStore } from '@/store/useStudentStore';
import { Camera, Save, Lock, Loader2, User, Phone, Mail, BookOpen, Hash } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function PortalProfilePage() {
  const { student, setStudent } = useStudentStore();
  const [uploading, setUploading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(student?.photo_url ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    // Full public URLs (including the stored upload result) display directly;
    // the validated original reference resolves against the configured project.
    if (student?.photo_url && student.token) {
      resolveAvatarUrl(student.photo_url, student.token, {
        supabaseUrl: env.VITE_SUPABASE_URL,
      }).then((u) => {
        if (active && u) setPhotoPreview(u);
      });
    }
    return () => {
      active = false;
    };
  }, [student?.photo_url, student?.token]);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [email, setEmail] = useState(student?.email ?? '');
  const [savingEmail, setSavingEmail] = useState(false);

  const handleEmailSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEmail(true);
    try {
      const saved = await updateEmail(email.trim());
      setStudent({ ...(student as any), email: saved });
      toast.success('ইমেইল সংরক্ষণ হয়েছে');
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSavingEmail(false);
    }
  };

  const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
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
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !student) {
      return;
    }
    if (!file.type.match(/^image\/(png|jpe?g|webp)$/i)) {
      toast.error('অসমর্থিত ছবি। JPG, PNG অথবা WebP ব্যবহার করুন।');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('ছবির মূল ফাইল ৫MB-এর কম হতে হবে।');
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const blob = await compressImage(file);
      if (blob.size > 5 * 1024 * 1024) {
        toast.error('ছবির সাইজ ৫MB এর বেশি হওয়া যাবে না');
        return;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const data = `base64,${btoa(binary)}`;
      const response = await fetch('/api/upload-avatar', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${student.token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'image/jpeg', data }),
      });
      if (!response.ok) {
        toast.error('আপলোড ব্যর্থ হয়েছে');
        return;
      }
      const payload = (await response.json()) as { path?: string; publicUrl?: string };
      // Original public-bucket flow: persist the project-bound public URL of
      // the uploaded object. `path` is kept as a fallback for old responses.
      const publicUrl = payload?.publicUrl;
      if (!publicUrl) {
        toast.error('আপলোড ব্যর্থ হয়েছে');
        return;
      }
      try {
        await updatePhoto(publicUrl);
      } catch {
        toast.error('আপডেট ব্যর্থ হয়েছে');
        return;
      }
      // The stored value is a full public URL, so it displays directly.
      setPhotoPreview(publicUrl);
      setStudent({ ...student, photo_url: publicUrl });
      toast.success('ছবি আপডেট হয়েছে');
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setUploading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) {
      return;
    }
    if (newPw.length < 6) {
      toast.error('নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষর হতে হবে');
      return;
    }
    if (newPw !== confirmPw) {
      toast.error('পাসওয়ার্ড মিলছে না');
      return;
    }
    setSavingPw(true);
    try {
      await changePassword(currentPw, newPw);
      toast.success('পাসওয়ার্ড সফলভাবে পরিবর্তিত হয়েছে');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err: any) {
      toast.error(err?.message || 'পাসওয়ার্ড পরিবর্তন ব্যর্থ');
    } finally {
      setSavingPw(false);
    }
  };

  if (!student) {
    return null;
  }

  const INFO = [
    {
      icon: Hash,
      label: 'Student ID',
      value: student.student_id,
      mono: true,
      color: 'text-sky-400',
    },
    { icon: Phone, label: 'ফোন', value: student.phone },
    { icon: Mail, label: 'ইমেইল', value: student.email ?? '—' },
    { icon: BookOpen, label: 'শ্রেণী', value: student.class_level ?? '—' },
    { icon: BookOpen, label: 'ব্যাচ', value: student.batch_name ?? '—' },
  ];

  return (
    <PortalLayout>
      <h1 className="font-inter font-bold text-xl text-white mb-5 font-hind flex items-center gap-2">
        <User size={20} className="text-sky-400" /> আমার প্রোফাইল
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Profile card */}
        <div className="lg:col-span-1">
          <div className="card p-6 text-center">
            {/* Photo */}
            <div className="relative inline-block mb-4">
              <button onClick={() => fileRef.current?.click()} className="relative group">
                <div className="w-24 h-24 rounded-2xl overflow-hidden bg-navy-700 border-2 border-white/10 group-hover:border-sky-400/40 transition-colors mx-auto">
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt={student.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-3xl font-bold text-sky-400">{student.name[0]}</span>
                    </div>
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-sky-500 flex items-center justify-center shadow-lg">
                  {uploading ? (
                    <Loader2 size={12} className="animate-spin text-white" />
                  ) : (
                    <Camera size={12} className="text-white" />
                  )}
                </div>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>
            <p className="text-slate-500 text-xs mb-4">
              JPG/PNG/WebP · মূল ফাইল সর্বোচ্চ ৫MB · ৪০০×৪০০-এ রিসাইজ হয়
            </p>

            <h2 className="font-inter font-bold text-white text-lg">{student.name}</h2>
            <p className="font-mono text-sky-400 text-sm">{student.student_id}</p>
            {student.batch_name && (
              <span className="badge-blue text-xs mt-2 inline-block">{student.batch_name}</span>
            )}

            <div className="mt-5 space-y-2">
              {INFO.map((info) => (
                <div key={info.label} className="flex items-center gap-2.5 text-sm px-2">
                  <info.icon size={13} className="text-slate-500 shrink-0" />
                  <span className="text-slate-500 text-xs w-16 shrink-0">{info.label}</span>
                  <span
                    className={cn(
                      'font-hind truncate',
                      info.mono ? 'font-mono text-sky-400 text-xs' : 'text-slate-300 text-xs',
                      info.color
                    )}
                  >
                    {info.value}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-white/5">
              <span
                className={cn(
                  'text-xs',
                  student.status === 'active' ? 'badge-green' : 'badge-yellow'
                )}
              >
                {student.status === 'active' ? '✓ Active' : student.status}
              </span>
            </div>
          </div>
          <form onSubmit={handleEmailSave} className="card p-5 mt-4 text-left space-y-3">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Mail size={15} className="text-sky-400" /> ইমেইল ঠিকানা
            </h3>
            <p className="text-xs text-slate-500">
              ফি রিমাইন্ডার ও গুরুত্বপূর্ণ নোটিশ ইমেইলে পেতে আপনার ইমেইল দিন।
            </p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="student@example.com"
            />
            <button
              type="submit"
              disabled={savingEmail}
              className="btn-outline w-full justify-center text-sm"
            >
              {savingEmail ? 'সংরক্ষণ হচ্ছে…' : 'ইমেইল সংরক্ষণ করুন'}
            </button>
          </form>
        </div>

        {/* Change password */}
        <div className="lg:col-span-2">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="card p-6"
          >
            <h3 className="font-inter font-bold text-white mb-5 flex items-center gap-2">
              <Lock size={16} className="text-violet-400" /> পাসওয়ার্ড পরিবর্তন
            </h3>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">বর্তমান পাসওয়ার্ড</label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="input-field"
                  placeholder="••••••••"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">নতুন পাসওয়ার্ড</label>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="input-field"
                  placeholder="কমপক্ষে ৬ অক্ষর"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">
                  নতুন পাসওয়ার্ড নিশ্চিত করুন
                </label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className="input-field"
                  placeholder="আবার টাইপ করুন"
                  required
                />
              </div>
              <button type="submit" disabled={savingPw} className="btn-primary text-sm">
                {savingPw ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                পাসওয়ার্ড পরিবর্তন করুন
              </button>
            </form>
          </motion.div>
        </div>
      </div>
    </PortalLayout>
  );
}
