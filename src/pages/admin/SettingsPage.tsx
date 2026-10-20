import { AdminLayout } from '@/components/admin/AdminLayout';
import { useSettingsStore } from '@/store/useSettingsStore';
import { supabase } from '@/lib/supabase';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Save,
  Smartphone,
  BarChart2,
  Share2,
  Palette,
  Users,
  Building,
  CreditCard,
  Send,
  Loader2,
  Eye,
  EyeOff,
  Lock as LockIcon,
  CalendarClock,
  Info,
  CheckCircle2,
  PauseCircle,
 RefreshCw,} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sendSMS } from '@/lib/sms';
import { handleSupabaseError } from '@/utils/errorHandler';

type Tab = 'institute' | 'payment' | 'sms' | 'fees' | 'stats' | 'social' | 'appearance' | 'admins';
const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'institute', label: 'Institute', icon: Building },
  { id: 'payment', label: 'Payment', icon: CreditCard },
  { id: 'fees', label: 'Fee Automation', icon: CalendarClock },
  { id: 'sms', label: 'SMS', icon: Send },
  { id: 'stats', label: 'Stats', icon: BarChart2 },
  { id: 'social', label: 'Social', icon: Share2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'admins', label: 'Admins', icon: Users },
];

export default function SettingsPage() {
  const { settings, updateSettings, saveToDB } = useSettingsStore();
  const [tab, setTab] = useState<Tab>('institute');
  const [form, setForm] = useState({ ...settings });
  const [saving, setSaving] = useState(false);

  // SMS test
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  // Stats auto-load
  const [loadingStats, setLoadingStats] = useState(false);

  // Admin password change
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPw, setNewAdminPw] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    setForm({ ...settings });
  }, [settings]);
  useQuery({
    queryKey: ['admin', 'current-user'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        handleSupabaseError(error);
        return null;
      }
      if (data.user?.email) {
        setAdminEmail(data.user.email);
      }
      return true;
    },
  });

  // Live color preview
  useEffect(() => {
    document.documentElement.style.setProperty('--primary', form.primaryColor);
  }, [form.primaryColor]);

  const loadStatsFromDb = async () => {
    setLoadingStats(true);
    try {
      const [s, t, b] = await Promise.all([
        supabase.from('students').select('id', { count: 'exact', head: true }),
        supabase.from('teachers').select('id', { count: 'exact', head: true }),
        supabase.from('batches').select('id', { count: 'exact', head: true }).eq('is_active', true),
      ]);
      if (s.error) {
        throw s.error;
      }
      if (t.error) {
        throw t.error;
      }
      if (b.error) {
        throw b.error;
      }
      setForm((p) => ({
        ...p,
        statStudents: s.count ?? 0,
        statTeachers: t.count ?? 0,
        statBatches: b.count ?? 0,
      }));
      toast.success('Stats loaded from database');
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoadingStats(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    updateSettings(form);
    try {
      await saveToDB(form);
      toast.success('সেটিংস সংরক্ষিত হয়েছে');
    } catch (err: any) {
      toast.error('সংরক্ষণ ব্যর্থ: ' + (err?.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleTestSMS = async () => {
    if (!testPhone) {
      toast.error('Test phone number required');
      return;
    }
    setSendingTest(true);
    try {
      await sendSMS(
        testPhone,
        `Test SMS from ${form.centerName}. MIMSMS API is working!`,
        'custom'
      );
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSendingTest(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!curPw) {
      toast.error('Current password is required');
      return;
    }
    if (newPw !== confPw) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPw.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setSavingPw(true);
    try {
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: adminEmail,
        password: curPw,
      });
      if (verifyErr) {
        toast.error('Current password is incorrect');
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success('Password updated!');
        setCurPw('');
        setNewPw('');
        setConfPw('');
      }
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSavingPw(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminEmail || !newAdminPw) {
      return;
    }
    setAddingAdmin(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: newAdminEmail,
        password: newAdminPw,
        options: { data: { role: 'admin', name: 'Admin' } },
      });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success('Admin account created! They need to verify email.');
        setNewAdminEmail('');
        setNewAdminPw('');
      }
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setAddingAdmin(false);
    }
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="text-xs text-slate-400 mb-1.5 block">{label}</label>
      {children}
    </div>
  );

  return (
    <AdminLayout title="সেটিংস">
      <div className="max-w-2xl">
        {/* Tab bar */}
        <div className="flex border-b border-navy-700/50 mb-6 gap-0 overflow-x-auto -mx-1 px-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-all shrink-0',
                tab === t.id
                  ? 'text-sky-400 border-sky-400'
                  : 'text-slate-400 border-transparent hover:text-white'
              )}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-5">
          {/* ── Institute ── */}
          {tab === 'institute' && (
            <>
              <div className="card p-5 space-y-4">
                <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                  <Building size={15} className="text-sky-400" /> Center Info
                </h3>
                <Field label="Center Name *">
                  <input
                    value={form.centerName}
                    onChange={(e) => set('centerName', e.target.value)}
                    className="input-field"
                    placeholder="My Coaching Center"
                  />
                </Field>
                <Field label="Tagline">
                  <input
                    value={form.centerTagline}
                    onChange={(e) => set('centerTagline', e.target.value)}
                    className="input-field"
                    placeholder="শিক্ষায় আলোকিত হোক ভবিষ্যৎ"
                  />
                </Field>
                <Field label="Address">
                  <textarea
                    value={form.centerAddress}
                    onChange={(e) => set('centerAddress', e.target.value)}
                    className="input-field"
                    rows={2}
                    placeholder="Full address"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Phone">
                    <input
                      value={form.centerPhone}
                      onChange={(e) => set('centerPhone', e.target.value)}
                      className="input-field"
                      placeholder="01XXXXXXXXX"
                    />
                  </Field>
                  <Field label="WhatsApp">
                    <input
                      value={form.centerWhatsapp}
                      onChange={(e) => set('centerWhatsapp', e.target.value)}
                      className="input-field"
                      placeholder="880XXXXXXXXX"
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      value={form.centerEmail}
                      onChange={(e) => set('centerEmail', e.target.value)}
                      className="input-field"
                      placeholder="info@center.com"
                      type="email"
                    />
                  </Field>
                  <Field label="Currency">
                    <select
                      value={form.currency}
                      onChange={(e) => set('currency', e.target.value)}
                      className="input-field"
                    >
                      <option value="BDT">BDT (৳)</option>
                      <option value="USD">USD ($)</option>
                      <option value="INR">INR (₹)</option>
                    </select>
                  </Field>
                </div>
              </div>
              <div className="card p-5 space-y-4">
                <h3 className="font-semibold text-white text-sm">Homepage Content</h3>
                <Field label="Hero Title">
                  <input
                    value={form.heroTitle}
                    onChange={(e) => set('heroTitle', e.target.value)}
                    className="input-field"
                    placeholder="সেরা শিক্ষার সুযোগ"
                  />
                </Field>
                <Field label="Hero Subtitle">
                  <input
                    value={form.heroSubtitle}
                    onChange={(e) => set('heroSubtitle', e.target.value)}
                    className="input-field"
                    placeholder="দক্ষ শিক্ষক, আধুনিক পদ্ধতি"
                  />
                </Field>
                <Field label="Logo URL">
                  <input
                    value={form.logoUrl}
                    onChange={(e) => set('logoUrl', e.target.value)}
                    className="input-field"
                    placeholder="https://…"
                  />
                </Field>
                <Field label="Banner URL">
                  <input
                    value={form.bannerUrl}
                    onChange={(e) => set('bannerUrl', e.target.value)}
                    className="input-field"
                    placeholder="https://…"
                  />
                </Field>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    onClick={() => set('admissionOpen', !form.admissionOpen)}
                    className={cn(
                      'w-10 h-6 rounded-full transition-colors relative',
                      form.admissionOpen ? 'bg-sky-500' : 'bg-white/10'
                    )}
                  >
                    <div
                      className={cn(
                        'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                        form.admissionOpen ? 'left-5' : 'left-1'
                      )}
                    />
                  </div>
                  <div>
                    <p className="text-sm text-white">Admission Open</p>
                    <p className="text-xs text-slate-400">
                      {form.admissionOpen
                        ? 'Admission form visible on site'
                        : 'Admission form hidden'}
                    </p>
                  </div>
                </label>
              </div>
            </>
          )}

          {/* ── Payment ── */}
          {tab === 'payment' && (
            <div className="card p-5 space-y-4">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <CreditCard size={15} className="text-emerald-400" /> Payment Settings
              </h3>
              <Field label="bKash Number">
                <input
                  value={form.bkashNumber}
                  onChange={(e) => set('bkashNumber', e.target.value)}
                  className="input-field"
                  placeholder="01XXXXXXXXX"
                />
              </Field>
              <Field label="Nagad Number">
                <input
                  value={form.nagadNumber}
                  onChange={(e) => set('nagadNumber', e.target.value)}
                  className="input-field"
                  placeholder="01XXXXXXXXX"
                />
              </Field>
              <Field label="Admission Fee (৳)">
                <input
                  type="number"
                  value={form.admissionFee}
                  onChange={(e) => set('admissionFee', Number(e.target.value))}
                  className="input-field"
                  placeholder="500"
                />
              </Field>
              {(form.bkashNumber || form.nagadNumber) && (
                <div className="card-glass p-3 text-xs text-slate-400 space-y-1 font-hind">
                  <p className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    এই নম্বরগুলো ছাত্র পোর্টালে ফি পরিশোধের জন্য দেখানো হবে।
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── SMS ── */}
          {tab === 'sms' && (
            <div className="card p-5 space-y-4">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <Smartphone size={15} className="text-violet-400" /> MIMSMS Configuration
              </h3>
              <div className="card-glass p-3 text-xs text-slate-300 leading-relaxed">
                The SMS API key is stored securely on the server and never exposed to the browser.
                Configure the <code className="text-sky-400">SMS_API_KEY</code> and{' '}
                <code className="text-sky-400">SMS_SENDER_ID</code> environment variables in your
                hosting platform (Netlify / Vercel) to enable delivery.
              </div>
              <div className="border-t border-white/5 pt-4">
                <p className="text-xs text-slate-400 mb-2">
                  Send a test SMS to verify configuration:
                </p>
                <div className="flex gap-2">
                  <input
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="input-field flex-1"
                    placeholder="01XXXXXXXXX"
                    type="tel"
                  />
                  <button
                    onClick={handleTestSMS}
                    disabled={sendingTest}
                    className="btn-outline text-sm px-4 shrink-0"
                  >
                    {sendingTest ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Send size={13} />
                    )}{' '}
                    Test
                  </button>
                </div>
              </div>
              <div className="card-glass p-3 text-xs text-slate-400 font-hind">
                <p>
                  API: <code className="text-sky-400 text-xs">https://api.mimsms.com/smsapi</code>
                </p>
                <p className="mt-1">
                  Without a server API key, SMS will be logged as &apos;pending&apos; in the
                  sms_logs table.
                </p>
              </div>
            </div>
          )}

          {/* ── Fee Automation ── */}
          {tab === 'fees' && (
            <FeeAutomationTab />
          )}

          {/* ── Stats ── */}
          {tab === 'stats' && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                  <BarChart2 size={15} className="text-sky-400" /> Homepage Stats
                </h3>
                <button
                  onClick={loadStatsFromDb}
                  disabled={loadingStats}
                  className="btn-outline text-xs py-1.5 px-3"
                >
                  {loadingStats ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} className="animate-spin" />} Load from DB
                </button>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => set('statAutoFromDb', !form.statAutoFromDb)}
                  className={cn(
                    'w-10 h-6 rounded-full transition-colors relative',
                    form.statAutoFromDb ? 'bg-sky-500' : 'bg-white/10'
                  )}
                >
                  <div
                    className={cn(
                      'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                      form.statAutoFromDb ? 'left-5' : 'left-1'
                    )}
                  />
                </div>
                <span className="text-sm text-slate-300">Auto-calculate from database</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Students Count">
                  <input
                    type="number"
                    value={form.statStudents}
                    onChange={(e) => set('statStudents', Number(e.target.value))}
                    className="input-field"
                    disabled={form.statAutoFromDb}
                  />
                </Field>
                <Field label="Teachers Count">
                  <input
                    type="number"
                    value={form.statTeachers}
                    onChange={(e) => set('statTeachers', Number(e.target.value))}
                    className="input-field"
                    disabled={form.statAutoFromDb}
                  />
                </Field>
                <Field label="Active Batches">
                  <input
                    type="number"
                    value={form.statBatches}
                    onChange={(e) => set('statBatches', Number(e.target.value))}
                    className="input-field"
                    disabled={form.statAutoFromDb}
                  />
                </Field>
                <Field label="Success Rate (%)">
                  <input
                    type="number"
                    value={form.statSuccessRate}
                    onChange={(e) => set('statSuccessRate', Number(e.target.value))}
                    className="input-field"
                    min={0}
                    max={100}
                  />
                </Field>
              </div>
            </div>
          )}

          {/* ── Social ── */}
          {tab === 'social' && (
            <div className="card p-5 space-y-4">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <Share2 size={15} className="text-sky-400" /> Social Media
              </h3>
              <Field label="Facebook URL">
                <input
                  value={form.socialFacebook}
                  onChange={(e) => set('socialFacebook', e.target.value)}
                  className="input-field"
                  placeholder="https://facebook.com/…"
                />
              </Field>
              <Field label="YouTube URL">
                <input
                  value={form.socialYoutube}
                  onChange={(e) => set('socialYoutube', e.target.value)}
                  className="input-field"
                  placeholder="https://youtube.com/…"
                />
              </Field>
              <Field label="Instagram URL">
                <input
                  value={form.socialInstagram}
                  onChange={(e) => set('socialInstagram', e.target.value)}
                  className="input-field"
                  placeholder="https://instagram.com/…"
                />
              </Field>
            </div>
          )}

          {/* ── Appearance ── */}
          {tab === 'appearance' && (
            <div className="card p-5 space-y-5">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <Palette size={15} className="text-violet-400" /> Appearance
              </h3>
              <div>
                <label className="text-xs text-slate-400 mb-3 block">
                  Primary Color (live preview)
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => set('primaryColor', e.target.value)}
                    className="w-14 h-14 rounded-xl border-2 border-white/10 cursor-pointer bg-transparent"
                  />
                  <div>
                    <p className="text-white font-medium">{form.primaryColor}</p>
                    <p className="text-slate-400 text-xs mt-1">
                      Changes the accent color throughout the app
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {['#38bdf8', '#a78bfa', '#34d399', '#f59e0b', '#ef4444', '#f472b6'].map((c) => (
                    <button
                      key={c}
                      onClick={() => set('primaryColor', c)}
                      className="w-8 h-8 rounded-lg border-2 border-transparent hover:border-white/30 transition-all"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="card-glass p-4 border border-sky-400/10">
                <p className="text-xs text-slate-400 font-hind">
                  Preview buttons with current color:
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    className="btn-primary text-sm"
                    style={{ '--primary': form.primaryColor } as any}
                  >
                    Primary
                  </button>
                  <button className="btn-outline text-sm">Outline</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Admin Accounts ── */}
          {tab === 'admins' && (
            <div className="space-y-5">
              <div className="card p-5 space-y-4">
                <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                  <Users size={15} className="text-sky-400" /> Current Admin
                </h3>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-navy-800/50">
                  <div className="w-9 h-9 rounded-xl bg-sky-400/15 flex items-center justify-center">
                    <Users size={16} className="text-sky-400" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{adminEmail || 'Admin'}</p>
                    <span className="badge-green text-xs">Active</span>
                  </div>
                </div>

                <form
                  onSubmit={handleChangePassword}
                  className="space-y-3 pt-2 border-t border-white/5"
                >
                  <p className="text-xs text-slate-400 font-semibold">Change Password</p>
                  <input
                    type="password"
                    value={curPw}
                    onChange={(e) => setCurPw(e.target.value)}
                    className="input-field"
                    placeholder="Current password"
                  />
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      className="input-field pr-10"
                      placeholder="New password (min 8 chars)"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                    >
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <input
                    type="password"
                    value={confPw}
                    onChange={(e) => setConfPw(e.target.value)}
                    className="input-field"
                    placeholder="Confirm new password"
                  />
                  <button
                    type="submit"
                    disabled={savingPw || !newPw || !confPw}
                    className="btn-outline text-sm py-2"
                  >
                    {savingPw ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <LockIcon size={13} />
                    )}{' '}
                    Update Password
                  </button>
                </form>
              </div>

              <div className="card p-5 space-y-4">
                <h3 className="font-semibold text-white text-sm">Add New Admin</h3>
                <form onSubmit={handleAddAdmin} className="space-y-3">
                  <Field label="Email">
                    <input
                      type="email"
                      value={newAdminEmail}
                      onChange={(e) => setNewAdminEmail(e.target.value)}
                      className="input-field"
                      placeholder="admin@example.com"
                      required
                    />
                  </Field>
                  <Field label="Temporary Password">
                    <input
                      type="password"
                      value={newAdminPw}
                      onChange={(e) => setNewAdminPw(e.target.value)}
                      className="input-field"
                      placeholder="Min 8 characters"
                      minLength={8}
                      required
                    />
                  </Field>
                  <button type="submit" disabled={addingAdmin} className="btn-outline text-sm py-2">
                    {addingAdmin ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Users size={13} />
                    )}{' '}
                    Create Admin Account
                  </button>
                </form>
                <div className="card-glass p-3 text-xs text-slate-500 font-hind flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    New admin will receive a verification email. After verifying, they can login
                    via /admin/login.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sticky save button */}
        <div className="sticky bottom-0 bg-navy-900/95 backdrop-blur-sm border-t border-navy-700/50 py-4 mt-6 -mx-0">
          <button
            onClick={handleSave}
            disabled={saving || tab === 'admins'}
            className="btn-primary w-full justify-center py-3"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            সেটিংস সংরক্ষণ করুন
          </button>
          {tab === 'admins' && (
            <p className="text-center text-slate-500 text-xs mt-2">
              Admin changes are saved immediately above
            </p>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

/* ── Fee Automation tab — monthly auto-generation on/off ────────────────── */
function FeeAutomationTab() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'fee_auto_enabled')
        .maybeSingle();
      setEnabled(data?.value === 'true');
    })();
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    const { error } = await supabase
      .from('site_settings')
      .upsert({ key: 'fee_auto_enabled', value: next ? 'true' : 'false' }, { onConflict: 'key' });
    setSaving(false);
    if (error) {
      handleSupabaseError(error);
      return;
    }
    setEnabled(next);
    toast.success(
      next
        ? 'স্বয়ংক্রিয় ফি চালু হয়েছে — প্রতি মাসের ১ তারিখে ফি তৈরি হবে।'
        : 'স্বয়ংক্রিয় ফি বন্ধ করা হয়েছে।'
    );
  };

  return (
    <div className="card p-5 space-y-4">
      <h3 className="font-semibold text-white text-sm flex items-center gap-2">
        <CalendarClock size={15} className="text-sky-400" /> Monthly Fee Automation
      </h3>
      {enabled === null ? (
        <Loader2 size={18} className="animate-spin text-slate-400" />
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-white">Automatic fee generation</div>
              <div className="text-xs text-slate-400 mt-1 leading-relaxed">
                When ON, fees for the current month are generated automatically for every
                active student (daily check, ~6:30 AM Bangladesh time). Students who join
                mid-month get that month&apos;s fee only — never a fee for a month before
                they joined. When OFF, generate fees manually from Fee Management.
              </div>
            </div>
            <button
              onClick={() => toggle(!enabled)}
              disabled={saving}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors',
                enabled ? 'bg-emerald-500/80' : 'bg-navy-700',
              )}
              aria-pressed={enabled}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                  enabled ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </button>
          </div>
          <div className="card-glass p-3 text-xs text-slate-400 font-hind flex items-start gap-1.5">
            {(() => {
              const St = enabled ? CheckCircle2 : PauseCircle;
              return <St className={cn('h-3.5 w-3.5 shrink-0 mt-0.5', enabled ? 'text-emerald-400' : 'text-slate-400')} />;
            })()}
            <span>
              {enabled
                ? 'চালু — এই মাসের ফি স্বয়ংক্রিয়ভাবে তৈরি হচ্ছে।'
                : 'বন্ধ — ফি ম্যানুয়ালি তৈরি করতে হবে (ফি ম্যানেজমেন্ট থেকে)।'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
