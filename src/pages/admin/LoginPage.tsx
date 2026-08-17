import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Lock, Mail, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import toast from 'react-hot-toast';

const schema = z.object({
  email: z.string().email('সঠিক ইমেইল দিন'),
  password: z.string().min(6, 'পাসওয়ার্ড দিন'),
});
type F = z.infer<typeof schema>;

export default function AdminLoginPage() {
  const [showPw, setShowPw] = useState(false);
  const [shake, setShake] = useState(false);
  const { signIn } = useAuthStore();
  const { settings } = useSettingsStore();
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<F>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: F) => {
    const { error } = await signIn(data.email, data.password);
    if (error) {
      setShake(true);
      setTimeout(() => setShake(false), 600);
      toast.error('ইমেইল বা পাসওয়ার্ড সঠিক নয়।');
      return;
    }
    toast.success('স্বাগতম!');
    navigate('/admin/dashboard');
  };

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(56,189,248,0.10) 0%, transparent 70%)' }} className="absolute inset-0" />
        <div className="hero-grid absolute inset-0 opacity-30" />
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-sky-500/6 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/3 w-96 h-96 bg-violet-500/6 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative">
        {/* Back link */}
        <Link to="/" className="flex items-center gap-2 text-slate-500 hover:text-slate-300 text-sm mb-6 transition-colors w-fit">
          <ArrowLeft size={14} /> Back to site
        </Link>

        <motion.div
          animate={shake ? { x: [0, -10, 10, -8, 8, -4, 4, 0] } : { x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="card-glass p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-violet-500 flex items-center justify-center mx-auto mb-4 glow-blue">
                <GraduationCap size={28} className="text-white" />
              </div>
              <h1 className="font-inter font-black text-2xl text-white mb-1">Admin Panel</h1>
              <p className="text-slate-500 text-sm">{settings.centerName}</p>
              <span className="badge-blue mt-2 inline-block">লগইন</span>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Email */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Email Address</label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    {...register('email')}
                    className="input-field pl-9"
                    placeholder="admin@example.com"
                    autoComplete="email"
                  />
                </div>
                {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
              </div>

              {/* Password */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    {...register('password')}
                    type={showPw ? 'text' : 'password'}
                    className="input-field pl-9 pr-10"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password.message}</p>}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary w-full justify-center py-3 mt-2 text-base"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Signing in…
                  </span>
                ) : 'লগইন করুন'}
              </button>
            </form>
          </div>
        </motion.div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Admin access only · Student portal{' '}
          <Link to="/portal/login" className="text-sky-500 hover:underline">here</Link>
        </p>
      </div>
    </div>
  );
}
