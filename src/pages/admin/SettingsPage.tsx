import { AdminLayout } from '@/components/admin/AdminLayout';
import { useSettingsStore } from '@/store/useSettingsStore';
import { supabase } from '@/lib/supabase';
import { useState, useEffect, useRef } from 'react';
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
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Lock as LockIcon,
  ClipboardList,
  Camera,
  GraduationCap,
  X,
  Plus,
  Upload,
  ImagePlus,
} from 'lucide-react';
import { applyThemeColor, cn } from '@/lib/utils';
import { classLevelList } from '@/store/useSettingsStore';
import { sendSMS } from '@/lib/sms';
import { handleSupabaseError } from '@/utils/errorHandler';
import { Avatar } from '@/components/shared/Avatar';

type Tab = 'institute' | 'payment' | 'sms' | 'stats' | 'social' | 'appearance' | 'admins';
const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'institute', label: 'Institute', icon: Building },
  { id: 'payment', label: 'Payment', icon: CreditCard },
  { id: 'sms', label: 'SMS', icon: Send },
  { id: 'stats', label: 'Stats', icon: BarChart2 },
  { id: 'social', label: 'Social', icon: Share2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'admins', label: 'Admins', icon: Users },
];

const THEME_PRESETS = [
  { name: 'Neon Cyan', color: '#38bdf8', description: 'Clean cyber blue' },
  { name: 'Electric Violet', color: '#a78bfa', description: 'Arcade purple' },
  { name: 'Laser Lime', color: '#a3e635', description: 'High-energy green' },
  { name: 'Hot Magenta', color: '#f472b6', description: 'Synthwave pink' },
  { name: 'Plasma Orange', color: '#fb923c', description: 'Competitive orange' },
  { name: 'Carbon Gray', color: '#a7b0bd', description: 'Carbon/silver stealth' },
];

const BUTTON_STYLES = [
  { id: 'solid' as const, name: 'Solid', description: 'Bright filled CTA buttons' },
  { id: 'outline' as const, name: 'Outline', description: 'Neon border, lighter visual weight' },
  { id: 'glass' as const, name: 'Glass', description: 'Transparent glass with glow' },
];

/**
 * Upload button + preview for a site image (logo / banner). Uploads to the
 * shared avatars bucket and writes the public URL back via onChange; a URL
 * input remains for manual entry.
 */
function SiteImageUpload({
  label,
  preview,
  uploading,
  onUpload,
  currentUrl,
  onChange,
  hint,
}: {
  label: string;
  preview?: string;
  uploading: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  currentUrl: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  return (
    <div>
      <label className="text-xs text-slate-400 mb-1.5 block">{label}</label>
      <div className="flex items-start gap-4">
        <div className="w-24 h-16 rounded-xl border border-white/10 bg-navy-800/50 flex items-center justify-center overflow-hidden shrink-0">
          {preview ? (
            <img
              src={preview}
              alt={label}
              className={cn('object-cover w-full h-full', label === 'Logo' && 'object-contain p-1')}
            />
          ) : (
            <ImagePlus size={20} className="text-slate-600" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <label htmlFor={`site-${label.toLowerCase()}`} className="btn-outline text-xs py-2 px-3 cursor-pointer inline-flex items-center gap-1.5">
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {uploading ? 'Uploading…' : 'Upload Image'}
          </label>
          <input
            id={`site-${label.toLowerCase()}`}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onUpload}
          />
          <p className="text-slate-600 text-xs mt-1.5">{hint}</p>
        </div>
      </div>
      <input
        value={currentUrl}
        onChange={(e) => onChange(e.target.value)}
        className="input-field mt-2 font-mono text-xs"
        placeholder="https://… (or paste a URL)"
      />
    </div>
  );
}

/**
 * Chips + add-input editor for the comma-separated class-levels string
 * (শ্রেণী). Remove a chip to delete it; type + Enter/Add to append one.
 */
function ClassLevelsEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState('');
  const levels = classLevelList(value);

  const append = () => {
    const next = draft.trim();
    if (!next) {
      return;
    }
    if (!levels.includes(next)) {
      onChange([...levels, next].join(','));
    }
    setDraft('');
  };

  const remove = (target: string) => {
    onChange(levels.filter((l) => l !== target).join(','));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {levels.map((l) => (
          <span
            key={l}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/15 border border-violet-400/30 text-violet-200 text-xs"
          >
            {l}
            <button
              type="button"
              onClick={() => remove(l)}
              className="hover:text-red-400 transition-colors"
              aria-label={`Remove ${l}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {levels.length === 0 && <span className="text-slate-600 text-xs">কোনো শ্রেণী নেই</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              append();
            }
          }}
          className="input-field flex-1"
          placeholder="নতুন শ্রেণী লিখুন (যেমন: Class 5, NU Admission)"
        />
        <button type="button" onClick={append} className="btn-outline text-sm px-4 shrink-0">
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-400 mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}

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
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [admins, setAdmins] = useState<{ email: string; created_at: string }[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [feedbackRows, setFeedbackRows] = useState<any[]>([]);
  const [feedbackForm, setFeedbackForm] = useState({ name: '', grade: '', content: '', rating: 5, image_url: '', is_published: true });
  const [providerSecrets, setProviderSecrets] = useState({ smsKey: '', smsEndpoint: '', smsSender: '', emailKey: '', emailEndpoint: '', emailFrom: '' });
  // Admin profile picture
  const [adminPhotoUrl, setAdminPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  // Logo / banner upload
  const [uploadingImg, setUploadingImg] = useState<string | null>(null); // 'logo' | 'banner' | null

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    setForm({ ...settings });
  }, [settings]);
  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (data.user?.email) {
          setAdminEmail(data.user.email);
        }
        if (data.user?.user_metadata?.photo_url) {
          setAdminPhotoUrl(data.user.user_metadata.photo_url);
        }
      })
      .catch((err) => {
        handleSupabaseError(err);
      });
  }, []);

  // Live color preview
  useEffect(() => {
    applyThemeColor(form.primaryColor, form.buttonStyle);
  }, [form.primaryColor, form.buttonStyle]);

  // Fetch the admin roster the first time the Admins tab is opened. A ref (not
  // `admins.length`) guards the one-shot so re-renders during the fetch cannot
  // queue a second request, and so an empty roster is not re-fetched forever.
  const rosterRequested = useRef(false);
  useEffect(() => {
    if (tab === 'admins' && !rosterRequested.current) {
      rosterRequested.current = true;
      loadAdmins();
    }
  }, [tab]);

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
      toast.success('✅ সেটিংস সংরক্ষিত হয়েছে');
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
        `📱 Test SMS from ${form.centerName}. MIMSMS API is working!`,
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

  /**
   * Load the admin roster from the server.
   *
   * Admin status lives in the `admin_users` table, not in `user_metadata`
   * (which the browser can rewrite via auth.updateUser). `admin_list` is a
   * SECURITY DEFINER RPC gated on is_admin(), so a non-admin gets an error
   * rather than the roster.
   */
  const loadAdmins = async () => {
    setLoadingAdmins(true);
    try {
      const { data, error } = await supabase.rpc('admin_list');
      if (error) {
        throw error;
      }
      setAdmins(data ?? []);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoadingAdmins(false);
    }
  };

  const loadFeedback = async () => {
    const { data } = await supabase.from('feedback').select('*').order('sort_order').order('created_at', { ascending: false });
    setFeedbackRows(data ?? []);
  };

  const loadProviderSecrets = async () => {
    const { data } = await supabase.from('provider_secrets').select('provider,endpoint,sender_id,from_email').in('provider', ['sms', 'email']);
    const sms = data?.find((x) => x.provider === 'sms');
    const email = data?.find((x) => x.provider === 'email');
    setProviderSecrets((p) => ({ ...p, smsEndpoint: sms?.endpoint ?? '', smsSender: sms?.sender_id ?? '', emailEndpoint: email?.endpoint ?? '', emailFrom: email?.from_email ?? '' }));
  };
  const saveProviderSecrets = async () => {
    const rows = [
      { provider: 'sms', ...(providerSecrets.smsKey ? { api_key: providerSecrets.smsKey } : {}), endpoint: providerSecrets.smsEndpoint, sender_id: providerSecrets.smsSender },
      { provider: 'email', ...(providerSecrets.emailKey ? { api_key: providerSecrets.emailKey } : {}), endpoint: providerSecrets.emailEndpoint, from_email: providerSecrets.emailFrom },
    ];
    const { error } = await supabase.from('provider_secrets').upsert(rows, { onConflict: 'provider' });
    if (error) toast.error(error.message);
    else { toast.success('Provider settings saved'); setProviderSecrets((p) => ({ ...p, smsKey: '', emailKey: '' })); }
  };

  const saveFeedback = async () => {
    if (!feedbackForm.name.trim() || !feedbackForm.content.trim()) {
      toast.error('Name and feedback are required');
      return;
    }
    const { error } = await supabase.from('feedback').insert(feedbackForm);
    if (error) toast.error(error.message);
    else { toast.success('Feedback saved'); setFeedbackForm({ name: '', grade: '', content: '', rating: 5, image_url: '', is_published: true }); loadFeedback(); }
  };

  useEffect(() => {
    if (tab === 'institute') loadFeedback();
    if (tab === 'sms') loadProviderSecrets();
  }, [tab]);

  const uploadFeedbackImage = async (file: File) => {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type) || file.size > 5 * 1024 * 1024) {
      toast.error('Use JPG, PNG, or WebP under 5 MB');
      return;
    }
    const path = `feedback/${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
    if (error) toast.error(error.message);
    else {
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      setFeedbackForm((p) => ({ ...p, image_url: data.publicUrl }));
    }
  };

  /** Resize an image while preserving alpha when the output is PNG. */
  const compressImage = (file: File, outputType = 'image/jpeg'): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1024;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(objectUrl);
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('compress failed'))),
          outputType,
          outputType === 'image/png' ? undefined : 0.85
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('image load failed'));
      };
      img.src = objectUrl;
    });

  const handleAdminPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.match(/^image\/(png|jpe?g|webp)$/i)) {
      toast.error('Unsupported image. Use JPG, PNG, or WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Profile photo must be under 5 MB. Choose a smaller image.');
      return;
    }
    setPhotoUploading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Not signed in');
        return;
      }
      const blob = await compressImage(file);
      const path = `admins/${user.id}-photo.jpg`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) {
        throw upErr;
      }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      // Persist on the auth user; the header/sidebar read it from user_metadata.
      const { error: metaErr } = await supabase.auth.updateUser({
        data: { photo_url: data.publicUrl },
      });
      if (metaErr) {
        throw metaErr;
      }
      setAdminPhotoUrl(`${data.publicUrl}?t=${Date.now()}`);
      toast.success('Profile picture updated');
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  };

  /** Upload a site logo or banner to the shared avatars bucket → public URL. */
  const handleSiteImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: 'logo' | 'banner'
  ) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      toast.error('Unsupported image. Use PNG, JPG, WebP, or SVG.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(`${kind === 'logo' ? 'Logo' : 'Banner'} must be under 5 MB. Choose a smaller image.`);
      return;
    }
    setUploadingImg(kind);
    try {
      const isSvg = file.type === 'image/svg+xml';
      const preserveAlpha = kind === 'logo' && !isSvg && file.type !== 'image/jpeg';
      const outputType = preserveAlpha ? 'image/png' : 'image/jpeg';
      const blob = isSvg ? file : await compressImage(file, outputType);
      const ext = isSvg ? 'svg' : preserveAlpha ? 'png' : 'jpg';
      const path = `site/${kind}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: isSvg ? file.type : outputType });
      if (upErr) {
        throw upErr;
      }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      set(kind === 'logo' ? 'logoUrl' : 'bannerUrl', data.publicUrl);
      toast.success(kind === 'logo' ? 'Logo set — now save settings' : 'Banner set — now save settings');
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setUploadingImg(null);
      e.target.value = '';
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminEmail) {
      return;
    }
    setAddingAdmin(true);
    try {
      // Grant only — account creation is deliberately NOT done here. Issuing
      // credentials from the browser required a client-side signUp with a
      // self-declared role, which any visitor could replicate. The person
      // signs themselves up first; an existing admin then promotes them.
      const { error } = await supabase.rpc('admin_grant', { p_email: newAdminEmail });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`${newAdminEmail} is now an admin`);
      setNewAdminEmail('');
      await loadAdmins();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setAddingAdmin(false);
    }
  };

  const handleRevokeAdmin = async (email: string) => {
    setRevoking(email);
    try {
      const { error } = await supabase.rpc('admin_revoke', { p_email: email });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`Admin access revoked for ${email}`);
      await loadAdmins();
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setRevoking(null);
    }
  };

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
                <Field label="Short Name (student IDs)">
                  <input
                    value={form.shortName}
                    onChange={(e) => set('shortName', e.target.value.toUpperCase().slice(0, 6))}
                    className="input-field font-mono"
                    placeholder="TLY"
                  />
                  <p className="text-slate-600 text-xs mt-1">
                    ID prefix, e.g. TLY → student ID like TLYQ26001
                  </p>
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
                <Field label="Map Embed URL">
                  <input
                    type="url"
                    value={form.mapEmbedUrl}
                    onChange={(e) => set('mapEmbedUrl', e.target.value)}
                    className="input-field"
                    placeholder="https://www.google.com/maps/embed?pb=…"
                  />
                  <p className="text-slate-500 text-xs mt-1">
                    Paste the iframe HTML, iframe src, or normal Google Maps URL. The app will normalize it safely.
                  </p>
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
                <SiteImageUpload
                  label="Logo"
                  preview={form.logoUrl}
                  uploading={uploadingImg === 'logo'}
                  onUpload={(e) => handleSiteImageUpload(e, 'logo')}
                  currentUrl={form.logoUrl}
                  onChange={(v) => set('logoUrl', v)}
                  hint="Used in the site navbars, login pages, PDFs, and browser-tab icon."
                />
                <SiteImageUpload
                  label="Banner"
                  preview={form.bannerUrl}
                  uploading={uploadingImg === 'banner'}
                  onUpload={(e) => handleSiteImageUpload(e, 'banner')}
                  currentUrl={form.bannerUrl}
                  onChange={(v) => set('bannerUrl', v)}
                  hint="Homepage hero background (optional)."
                />
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
              <div className="card p-5 space-y-4">
                <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                  <ClipboardList size={15} className="text-sky-400" /> Exam Defaults
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Default Duration (minutes)">
                    <input
                      type="number"
                      min={1}
                      value={form.defaultExamDuration}
                      onChange={(e) => set('defaultExamDuration', Number(e.target.value))}
                      className="input-field"
                      placeholder="30"
                    />
                  </Field>
                  <div>
                    <span className="text-xs text-slate-400 mb-1.5 block">Default Strict Mode</span>
                    <label className="flex items-center gap-3 cursor-pointer pt-1">
                      <div
                        onClick={() => set('defaultStrictMode', !form.defaultStrictMode)}
                        className={cn(
                          'w-10 h-6 rounded-full transition-colors relative',
                          form.defaultStrictMode ? 'bg-violet-500' : 'bg-white/10'
                        )}
                      >
                        <div
                          className={cn(
                            'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                            form.defaultStrictMode ? 'left-5' : 'left-1'
                          )}
                        />
                      </div>
                      <span className="text-xs text-slate-400 font-hind">
                        {form.defaultStrictMode
                          ? 'Tab-switch penalty ON for new exams'
                          : 'Tab-switch penalty OFF for new exams'}
                      </span>
                    </label>
                  </div>
                </div>
                <p className="text-slate-600 text-xs">
                  Pre-fills the Create Exam form. Existing exams are never changed.
                </p>
              </div>
              <div className="card p-5 space-y-4">
                <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                  <GraduationCap size={15} className="text-sky-400" /> Class Levels (শ্রেণী)
                </h3>
                <ClassLevelsEditor
                  value={form.classLevels}
                  onChange={(v) => set('classLevels', v)}
                />
                <p className="text-slate-600 text-xs">
                  Used as the শ্রেণী dropdown on the admission form, the student form, and the
                  portal. Each on its own line.
                </p>
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
              <Field label="One-time Admission Fee (৳)">
                <input
                  type="number"
                  value={form.admissionFee}
                  onChange={(e) => set('admissionFee', Number(e.target.value))}
                  className="input-field"
                  placeholder="0"
                />
                <p className="text-slate-500 text-xs mt-1">
                  This is separate from each batch&apos;s monthly fee. Set 0 if admission is free.
                </p>
              </Field>

              {/* Gateway toggles — explicit on/off per payment method */}
              <div className="grid sm:grid-cols-2 gap-2">
                {(
                  [
                    ['bkashEnabled', 'bKash', 'bkashNumber'],
                    ['nagadEnabled', 'Nagad', 'nagadNumber'],
                  ] as const
                ).map(([enabledKey, label, numKey]) => (
                  <label key={enabledKey} className="flex items-center gap-3 cursor-pointer">
                    <div
                      onClick={() => set(enabledKey, !form[enabledKey])}
                      className={cn(
                        'w-10 h-6 rounded-full transition-colors relative shrink-0',
                        form[enabledKey] ? 'bg-sky-500' : 'bg-white/10'
                      )}
                    >
                      <div
                        className={cn(
                          'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                          form[enabledKey] ? 'left-5' : 'left-1'
                        )}
                      />
                    </div>
                    <div>
                      <p className="text-sm text-white">{label}</p>
                      <p className="text-xs text-slate-400">
                        {form[enabledKey]
                          ? `Visible on portal (${form[numKey] || 'no number set'})`
                          : 'Hidden from students'}
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              <Field label="Payment Instructions (portal fee page)">
                <textarea
                  value={form.paymentInstructions}
                  onChange={(e) => set('paymentInstructions', e.target.value)}
                  className="input-field font-hind"
                  rows={3}
                  placeholder="পেমেন্ট করতে: bKash / Nagad নম্বরে টাকা পাঠিয়ে ট্রানজেকশন আইডি জমা দিন…"
                />
              </Field>

              <Field label="Receipt Footer (optional — tax/thanks line)">
                <textarea
                  value={form.receiptFooter}
                  onChange={(e) => set('receiptFooter', e.target.value)}
                  className="input-field font-hind"
                  rows={2}
                  placeholder="e.g. ধন্যবাদ — Techely Learning Academy"
                />
                <p className="text-slate-600 text-xs mt-1">
                  Printed below the signature on every fee receipt (blank = omitted).
                </p>
              </Field>

              {(form.bkashNumber || form.nagadNumber) && (
                <div className="card-glass p-3 text-xs text-slate-400 space-y-1 font-hind">
                  <p>ℹ️ এই নম্বরগুলো ছাত্র পোর্টালে ফি পরিশোধের জন্য দেখানো হবে।</p>
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
                You can configure provider, endpoint, sender ID, and API keys below. Keys are
                masked and never returned after saving.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="SMS Provider"><input className="input-field" value={form.smsProvider} onChange={(e) => set('smsProvider', e.target.value)} placeholder="mimsms or custom" /></Field>
                <Field label="SMS Sender ID"><input className="input-field" value={providerSecrets.smsSender} onChange={(e) => setProviderSecrets((p) => ({ ...p, smsSender: e.target.value }))} placeholder="YourSchool" /></Field>
                <Field label="SMS Endpoint"><input className="input-field" type="url" value={providerSecrets.smsEndpoint} onChange={(e) => setProviderSecrets((p) => ({ ...p, smsEndpoint: e.target.value }))} placeholder="https://provider.example/send" /></Field>
                <Field label="SMS API Key"><input className="input-field" type="password" value={providerSecrets.smsKey} onChange={(e) => setProviderSecrets((p) => ({ ...p, smsKey: e.target.value }))} placeholder="Leave blank to keep current key" /></Field>
                <Field label="Email Provider"><input className="input-field" value={form.emailProvider} onChange={(e) => set('emailProvider', e.target.value)} placeholder="resend or custom" /></Field>
                <Field label="Email Endpoint"><input className="input-field" type="url" value={providerSecrets.emailEndpoint} onChange={(e) => setProviderSecrets((p) => ({ ...p, emailEndpoint: e.target.value }))} placeholder="https://api.resend.com/emails" /></Field>
                <Field label="Email From"><input className="input-field" type="email" value={providerSecrets.emailFrom} onChange={(e) => setProviderSecrets((p) => ({ ...p, emailFrom: e.target.value }))} placeholder="office@school.com" /></Field>
                <Field label="Email API Key"><input className="input-field" type="password" value={providerSecrets.emailKey} onChange={(e) => setProviderSecrets((p) => ({ ...p, emailKey: e.target.value }))} placeholder="Leave blank to keep current key" /></Field>
              </div>
              <button type="button" onClick={saveProviderSecrets} className="btn-primary text-sm">Save provider settings</button>
              <p className="text-xs text-slate-500">Provider keys are stored in protected provider_secrets and are never returned to the browser.</p>
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
                  {loadingStats ? <Loader2 size={12} className="animate-spin" /> : '↻'} Load from DB
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
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => set('showHomeStats', !form.showHomeStats)}
                  className={cn(
                    'w-10 h-6 rounded-full transition-colors relative',
                    form.showHomeStats ? 'bg-sky-500' : 'bg-white/10'
                  )}
                >
                  <div
                    className={cn(
                      'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                      form.showHomeStats ? 'left-5' : 'left-1'
                    )}
                  />
                </div>
                <span className="text-sm text-slate-300">Show homepage stats / counters</span>
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
              <p className="text-xs text-slate-400 leading-relaxed">
                Paste the complete public page URL. After saving, the enabled links
                appear as icons in the public website footer. WhatsApp is managed in
                the Institute tab using the international phone number.
              </p>
              <Field label="Facebook URL">
                <input
                  type="url"
                  value={form.socialFacebook}
                  onChange={(e) => set('socialFacebook', e.target.value)}
                  className="input-field"
                  placeholder="https://www.facebook.com/your-page"
                />
              </Field>
              <Field label="YouTube URL">
                <input
                  type="url"
                  value={form.socialYoutube}
                  onChange={(e) => set('socialYoutube', e.target.value)}
                  className="input-field"
                  placeholder="https://www.youtube.com/@your-channel"
                />
              </Field>
              <Field label="Instagram URL">
                <input
                  type="url"
                  value={form.socialInstagram}
                  onChange={(e) => set('socialInstagram', e.target.value)}
                  className="input-field"
                  placeholder="https://www.instagram.com/your-page"
                />
              </Field>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                  Footer preview
                </p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={cn('badge-blue', !form.socialFacebook && 'opacity-40')}>
                    Facebook {form.socialFacebook ? 'enabled' : 'not set'}
                  </span>
                  <span className={cn('badge-red', !form.socialYoutube && 'opacity-40')}>
                    YouTube {form.socialYoutube ? 'enabled' : 'not set'}
                  </span>
                  <span className={cn('badge-violet', !form.socialInstagram && 'opacity-40')}>
                    Instagram {form.socialInstagram ? 'enabled' : 'not set'}
                  </span>
                  <span className={cn('badge-green', !form.centerWhatsapp && 'opacity-40')}>
                    WhatsApp {form.centerWhatsapp ? 'enabled' : 'not set'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {tab === 'institute' && (
            <div className="card p-5 space-y-4">
              <h3 className="font-semibold text-white text-sm">Student Feedback / Success Stories</h3>
              <p className="text-xs text-slate-500">Only published feedback appears on the homepage. Upload an optional student photo.</p>
              <div className="grid grid-cols-2 gap-3">
                <input className="input-field" placeholder="Student name" value={feedbackForm.name} onChange={(e) => setFeedbackForm((p) => ({ ...p, name: e.target.value }))} />
                <input className="input-field" placeholder="SSC 2025 — GPA 5.00" value={feedbackForm.grade} onChange={(e) => setFeedbackForm((p) => ({ ...p, grade: e.target.value }))} />
              </div>
              <textarea className="input-field" rows={3} placeholder="Student feedback" value={feedbackForm.content} onChange={(e) => setFeedbackForm((p) => ({ ...p, content: e.target.value }))} />
              <div className="flex items-center gap-3">
                <input type="number" min={1} max={5} className="input-field w-24" value={feedbackForm.rating} onChange={(e) => setFeedbackForm((p) => ({ ...p, rating: Number(e.target.value) }))} />
                <label className="btn-outline text-xs py-2 px-3 cursor-pointer">Upload image<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFeedbackImage(e.target.files[0])} /></label>
                <button type="button" onClick={saveFeedback} className="btn-primary text-xs px-4 py-2">Add feedback</button>
              </div>
              <div className="space-y-2">
                {feedbackRows.map((row) => <div key={row.id} className="flex items-center gap-3 rounded-lg border border-white/10 p-3"><span className="flex-1 text-sm text-white">{row.name}<span className="block text-xs text-slate-500">{row.content}</span></span><button type="button" className="btn-outline text-xs px-2 py-1" onClick={async () => { await supabase.from('feedback').update({ is_published: !row.is_published }).eq('id', row.id); loadFeedback(); }}>{row.is_published ? 'Unpublish' : 'Publish'}</button></div>)}
              </div>
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
                  Theme Accent (live preview)
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
                      Changes buttons, links, focus rings, active states, badges, and glows throughout the app.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
                  {THEME_PRESETS.map((preset) => (
                    <button
                      key={preset.color}
                      type="button"
                      onClick={() => set('primaryColor', preset.color)}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-left transition-all hover:-translate-y-0.5',
                        form.primaryColor.toLowerCase() === preset.color
                          ? 'border-white/70 bg-white/10 shadow-lg'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/30'
                      )}
                    >
                      <span className="block h-1.5 rounded-full mb-1" style={{ backgroundColor: preset.color }} />
                      <span className="block text-[11px] text-white">{preset.name}</span>
                      <span className="block text-[10px] text-slate-500">{preset.description}</span>
                    </button>
                  ))}
                </div>
                </div>
                <div className="pt-3 border-t border-white/10">
                  <label className="text-xs text-slate-400 mb-2 block">Button Style</label>
                  <div className="grid grid-cols-3 gap-2">
                    {BUTTON_STYLES.map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => set('buttonStyle', style.id)}
                        className={cn(
                          'rounded-xl border px-2.5 py-2 text-left transition-all',
                          form.buttonStyle === style.id
                            ? 'border-white/70 bg-white/10'
                            : 'border-white/10 bg-white/[0.03] hover:border-white/30'
                        )}
                      >
                        <span className="block text-xs text-white">{style.name}</span>
                        <span className="block text-[10px] text-slate-500 mt-0.5">{style.description}</span>
                      </button>
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
                  {/* Profile picture + change control */}
                  <div className="relative shrink-0 group">
                    <Avatar
                      name={adminEmail?.split('@')[0] ?? 'Admin'}
                      src={adminPhotoUrl ?? undefined}
                      size="md"
                      className="w-12 h-12 text-sm"
                    />
                    <label
                      htmlFor="admin-photo-input"
                      className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-sky-500 hover:bg-sky-400 text-navy-900 flex items-center justify-center cursor-pointer shadow border-2 border-navy-800 transition-colors"
                      title="Change profile picture"
                    >
                      {photoUploading ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <Camera size={10} />
                      )}
                    </label>
                    <input
                      id="admin-photo-input"
                      type="file"
                       accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={handleAdminPhotoChange}
                    />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{adminEmail || 'Admin'}</p>
                    <span className="badge-green text-xs">Active</span>
                  </div>
                  </div>
                  <p className="text-slate-500 text-[11px] mt-2">
                    JPG/PNG/WebP · original max 5 MB · resized to 1024 px before upload
                  </p>

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
                <h3 className="font-semibold text-white text-sm">Grant Admin Access</h3>
                <form onSubmit={handleAddAdmin} className="space-y-3">
                  <Field label="Existing Account Email">
                    <input
                      type="email"
                      value={newAdminEmail}
                      onChange={(e) => setNewAdminEmail(e.target.value)}
                      className="input-field"
                      placeholder="admin@example.com"
                      required
                    />
                  </Field>
                  <button
                    type="submit"
                    disabled={addingAdmin || !newAdminEmail}
                    className="btn-outline text-sm py-2"
                  >
                    {addingAdmin ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <ShieldCheck size={13} />
                    )}{' '}
                    Grant Admin
                  </button>
                </form>
                <div className="card-glass p-3 text-xs text-slate-500 font-hind">
                  ℹ️ This promotes an <strong>existing</strong> account. The person signs up at
                  /admin/login first, then an admin grants them access here. Accounts are never
                  created from the browser — that would let anyone self-declare admin.
                </div>
              </div>

              <div className="card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white text-sm">Admin Roster</h3>
                  <button
                    type="button"
                    onClick={loadAdmins}
                    disabled={loadingAdmins}
                    className="btn-outline text-xs py-1.5 px-3"
                  >
                    {loadingAdmins ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RefreshCw size={12} />
                    )}{' '}
                    Refresh
                  </button>
                </div>

                {loadingAdmins && admins.length === 0 ? (
                  <p className="text-xs text-slate-500">Loading roster…</p>
                ) : admins.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No admins on the roster. Run the security hardening migration if this looks
                    wrong.
                  </p>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {admins.map((a) => (
                      <li key={a.email} className="flex items-center justify-between py-2.5 gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">{a.email}</p>
                          <p className="text-[11px] text-slate-500">
                            Added {new Date(a.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRevokeAdmin(a.email)}
                          disabled={revoking === a.email || admins.length === 1}
                          title={
                            admins.length === 1
                              ? 'Cannot revoke the last admin'
                              : `Revoke admin access for ${a.email}`
                          }
                          className="btn-outline text-xs py-1.5 px-3 shrink-0 disabled:opacity-40"
                        >
                          {revoking === a.email ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <ShieldOff size={12} />
                          )}{' '}
                          Revoke
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
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
