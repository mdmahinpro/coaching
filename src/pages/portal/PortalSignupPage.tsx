import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/utils/errorHandler';
import { useSettingsStore, classLevelList } from '@/store/useSettingsStore';
import { Logo } from '@/components/shared/Logo';
import { toast } from 'react-hot-toast';
import { sanitize } from '@/lib/utils';
import { generateReferenceNo } from '@/lib/studentId';

export default function PortalSignupPage() {
  const { settings } = useSettingsStore();
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [refNo, setRefNo] = useState('');
  const [form, setForm] = useState({
    name: '',
    guardian_name: '',
    guardian_phone: '',
    phone: '',
    email: '',
    address: '',
    class_level: '',
    gender: '',
    batch_id: '',
  });

  useEffect(() => {
    supabase
      .from('batches')
      .select('id,name,subject')
      .eq('is_active', true)
      .then(
        ({ data }) => {
          const cleaned = (data ?? []).map((b: any) => ({
            ...b,
            name: sanitize(b.name),
            subject: b.subject ? sanitize(b.subject) : b.subject,
          }));
          setBatches(cleaned);
        },
        (err: any) => {
          handleSupabaseError(err);
        }
      );
  }, []);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone) {
      toast.error('নাম ও ফোন নম্বর আবশ্যক');
      return;
    }
    setLoading(true);
    try {
      // Reference number becomes the student's default portal password on
      // approval — generate it here and persist it so approval can use it.
      const reference = generateReferenceNo();
      const { error } = await supabase.from('admission_requests').insert([
        {
          name: form.name,
          guardian_name: form.guardian_name || null,
          guardian_phone: form.guardian_phone || null,
          phone: form.phone,
          email: form.email || null,
          address: form.address || null,
          class_level: form.class_level || null,
          gender: form.gender || null,
          batch_id: form.batch_id || null,
          reference_no: reference,
          status: 'pending',
        },
      ]);
      if (error) {
        toast.error('আবেদন করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
        return;
      }
      setRefNo(reference);
      setDone(true);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.93 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card-glass p-10 max-w-sm w-full text-center"
        >
          <CheckCircle2 size={48} className="text-emerald-400 mx-auto mb-4" />
          <h2 className="font-inter font-black text-xl text-white mb-3">আবেদন সফল!</h2>
          <div className="bg-navy-700/60 rounded-xl px-6 py-4 mb-4">
            <p className="text-slate-500 text-xs mb-1">আপনার রেফারেন্স নম্বর</p>
            <p className="font-inter font-bold text-sky-400 text-xl tracking-widest">{refNo}</p>
          </div>
          <p className="text-slate-400 text-sm font-hind leading-relaxed mb-6">
            অনুমোদনের পর এই রেফারেন্স নম্বর দিয়েই পোর্টালে লগইন করতে পারবেন (ফোন নম্বর + রেফারেন্স
            নম্বর)।
          </p>
          <Link to="/portal/login" className="btn-primary w-full justify-center">
            লগইন পেজে যান
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-sky-500/6 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative"
      >
        <div className="card-glass p-7">
          <div className="text-center mb-6">
            <Logo className="w-12 h-12 rounded-xl mx-auto mb-3" />
            <h1 className="font-inter font-black text-xl text-white">ভর্তি আবেদন</h1>
            <p className="text-slate-400 text-sm">{settings.centerName}</p>
          </div>

          {/* Info note */}
          <div className="card p-3 mb-5 border border-amber-400/15">
            <p className="text-amber-400 text-xs font-hind leading-relaxed">
              ⚠️ শুধুমাত্র অনুমোদিত ছাত্ররা পোর্টালে লগইন করতে এবং পরীক্ষায় অংশ নিতে পারবে।
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1.5 block">পূর্ণ নাম *</label>
                <input
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  className="input-field"
                  placeholder="আপনার নাম"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">অভিভাবকের নাম</label>
                <input
                  value={form.guardian_name}
                  onChange={(e) => set('guardian_name', e.target.value)}
                  className="input-field"
                  placeholder="অভিভাবকের নাম"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">অভিভাবকের ফোন</label>
                <input
                  value={form.guardian_phone}
                  onChange={(e) => set('guardian_phone', e.target.value)}
                  className="input-field"
                  placeholder="01XXXXXXXXX"
                  type="tel"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">ফোন নম্বর *</label>
                <input
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  className="input-field"
                  placeholder="01XXXXXXXXX"
                  type="tel"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">শ্রেণী</label>
                <select
                  value={form.class_level}
                  onChange={(e) => set('class_level', e.target.value)}
                  className="input-field"
                >
                  <option value="">শ্রেণী বাছাই করুন…</option>
                  {classLevelList(settings.classLevels).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">লিঙ্গ</label>
                <select
                  value={form.gender}
                  onChange={(e) => set('gender', e.target.value)}
                  className="input-field"
                >
                  <option value="">লিঙ্গ বাছাই করুন…</option>
                  <option value="male">পুরুষ</option>
                  <option value="female">মহিলা</option>
                  <option value="other">অন্যান্য</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1.5 block">ইমেইল (ঐচ্ছিক)</label>
                <input
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  className="input-field"
                  placeholder="email@example.com"
                  type="email"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1.5 block">ব্যাচ বাছাই করুন</label>
                <select
                  value={form.batch_id}
                  onChange={(e) => set('batch_id', e.target.value)}
                  className="input-field"
                >
                  <option value="">ব্যাচ বাছাই করুন…</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} — {b.subject}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1.5 block">ঠিকানা</label>
                <textarea
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  className="input-field"
                  rows={2}
                  placeholder="বাসার ঠিকানা"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-3 font-hind"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'আবেদন জমা দিন'}
            </button>
          </form>

          <p className="text-center text-slate-500 text-xs mt-5">
            ইতিমধ্যে অ্যাকাউন্ট আছে?{' '}
            <Link to="/portal/login" className="text-sky-400 hover:underline">
              লগইন করুন
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
