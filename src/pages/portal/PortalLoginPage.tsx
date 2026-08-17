import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { GraduationCap, Phone, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useStudentStore } from '@/store/useStudentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import toast from 'react-hot-toast';

export default function PortalLoginPage() {
  const navigate = useNavigate();
  const { login } = useStudentStore();
  const { settings } = useSettingsStore();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !password) { setErrMsg('ফোন নম্বর ও পাসওয়ার্ড দিন'); return; }
    setLoading(true);
    setErrMsg('');

    try {
      await login(phone, password);
      toast.success(`স্বাগতম!`);
      navigate('/portal/dashboard');
    } catch (err: any) {
      const msg = err?.message || 'ফোন নম্বর বা পাসওয়ার্ড ভুল।';
      setErrMsg(msg);
      if (msg.includes('Too many failed attempts')) {
        toast.error(msg, { duration: 5000 });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 right-1/4 w-80 h-80 bg-violet-500/6 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-sky-500/6 rounded-full blur-3xl" />
      </div>

      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm relative">
        <div className="card-glass p-8">
          <div className="text-center mb-7">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-500/25">
              <GraduationCap size={26} className="text-white" />
            </div>
            <h1 className="font-inter font-black text-xl text-white mb-1">ছাত্র পোর্টাল</h1>
            <p className="text-slate-400 text-sm">{settings.centerName}</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">ফোন নম্বর</label>
              <div className="relative">
                <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input value={phone} onChange={e => setPhone(e.target.value)} className="input-field pl-9"
                  placeholder="01XXXXXXXXX" type="tel" autoComplete="tel" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">পাসওয়ার্ড</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input value={password} onChange={e => setPassword(e.target.value)} type={showPw ? 'text' : 'password'}
                  className="input-field pl-9 pr-10" placeholder="••••••••" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {errMsg && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm font-hind leading-relaxed">
                {errMsg}
              </motion.div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 mt-1 text-base font-hind">
              {loading ? <Loader2 size={17} className="animate-spin" /> : 'লগইন করুন'}
            </button>
          </form>

          <div className="mt-6 space-y-2 text-center">
            <p className="text-slate-500 text-xs">
              নতুন ভর্তি হতে চান?{' '}
              <Link to="/portal/signup" className="text-sky-400 hover:underline">আবেদন করুন</Link>
            </p>
            <p className="text-slate-600 text-xs">
              Admin?{' '}
              <Link to="/admin/login" className="text-slate-400 hover:text-white">Admin Panel</Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
