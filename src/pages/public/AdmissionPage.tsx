import { PublicNavbar } from '@/components/public/PublicNavbar';
import { Footer } from '@/components/public/Footer';
import { AnimatedSection } from '@/components/shared/AnimatedSection';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/utils/errorHandler';
import toast from 'react-hot-toast';
import { CheckCircle, ChevronRight, ChevronLeft, User, BookOpen, ClipboardCheck } from 'lucide-react';
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { sanitize } from '@/lib/utils';
import { useSettingsStore, classLevelList } from '@/store/useSettingsStore';
import { generateReferenceNo } from '@/lib/studentId';
import { usePoll } from '@/hooks/useRealtimePoll';

const schema = z.object({
  name: z.string().min(2, 'নাম কমপক্ষে ২ অক্ষর হতে হবে'),
  email: z.string().email('সঠিক ইমেইল দিন'),
  phone: z.string().min(10, 'সঠিক ফোন নম্বর দিন'),
  guardian_name: z.string().min(2, 'অভিভাবকের নাম দিন'),
  guardian_phone: z.string().min(10, 'অভিভাবকের ফোন দিন'),
  address: z.string().optional(),
  class_level: z.string().optional(),
  gender: z.string().optional(),
  batch_id: z.string().min(1, 'একটি ব্যাচ বেছে নিন'),
  message: z.string().optional(),
});
type F = z.infer<typeof schema>;

const steps = [
  { id: 1, label: 'Personal Info', icon: <User size={16} /> },
  { id: 2, label: 'Select Batch', icon: <BookOpen size={16} /> },
  { id: 3, label: 'Review & Submit', icon: <ClipboardCheck size={16} /> },
];

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-400 mb-1.5 block">{label}</label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

export default function AdmissionPage() {
  const { settings } = useSettingsStore();
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [refNo, setRefNo] = useState('');
  const [batches, setBatches] = useState<any[]>([]);

  const {
    register, handleSubmit, trigger, getValues,
    formState: { errors, isSubmitting }
  } = useForm<F>({ resolver: zodResolver(schema), mode: 'onTouched' });

  const fetchBatches = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('batches')
        .select('id,name,subject,fee')
        .eq('is_active', true);
      setBatches(
        (data ?? []).map((b: any) => ({ ...b, name: sanitize(b.name), subject: b.subject ? sanitize(b.subject) : b.subject }))
      );
    } catch (err) {
      handleSupabaseError(err);
    }
  }, []);
  usePoll(fetchBatches);

  const nextStep = async () => {
    const fields: (keyof F)[] = step === 1
      ? ['name', 'email', 'phone', 'guardian_name', 'guardian_phone']
      : ['batch_id'];
    const ok = await trigger(fields);
    if (ok) {setStep(s => s + 1);}
  };

  const onSubmit = async (data: F) => {
    try {
      // Reference number persists with the application and becomes the
      // DEFAULT portal password once an admin approves the admission.
      const ref = generateReferenceNo();
      const { error } = await supabase.from('admission_requests').insert([
        { ...data, reference_no: ref, status: 'pending' },
      ]);
      if (error) { toast.error('জমা দিতে সমস্যা হয়েছে। আবার চেষ্টা করুন।'); return; }
      setRefNo(ref);
      setSubmitted(true);
      toast.success('আবেদন সফলভাবে জমা হয়েছে!');
    } catch (err) {
      handleSupabaseError(err);
    }
  };

  const values = getValues();
  const selectedBatch = batches.find(b => b.id === values.batch_id);

  if (submitted) {
    return (
      <div className="min-h-screen bg-navy-900">
        <PublicNavbar />
        <div className="pt-24 max-w-lg mx-auto px-4 pb-20">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="card-glass p-10 text-center"
          >
            <div className="w-20 h-20 rounded-full bg-emerald-400/15 border border-emerald-400/20 flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={40} className="text-emerald-400" />
            </div>
            <h2 className="font-inter font-bold text-2xl text-white mb-3">আবেদন সফল!</h2>
            <p className="font-hind text-slate-400 mb-5 leading-relaxed">
              আমরা শীঘ্রই আপনার সাথে যোগাযোগ করব। ধন্যবাদ আবেদন করার জন্য।
            </p>
            <div className="bg-navy-700/60 rounded-xl px-6 py-4 mb-4 inline-block">
              <p className="text-slate-500 text-xs mb-1">আপনার রেফারেন্স নম্বর</p>
              <p className="font-inter font-bold text-sky-400 text-xl tracking-widest">{refNo}</p>
            </div>
            <p className="text-slate-500 text-sm mb-1">এই নম্বরটি সংরক্ষণ করুন।</p>
            <p className="text-slate-500 text-xs font-hind leading-relaxed">
              ভর্তি অনুমোদিত হলে এই রেফারেন্স নম্বরই হবে আপনার পোর্টালের ডিফল্ট পাসওয়ার্ড (লগইন: ফোন
              নম্বর + রেফারেন্স নম্বর)।
            </p>
          </motion.div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-900">
      <PublicNavbar />
      <div className="pt-24 max-w-2xl mx-auto px-4 pb-20">
        <AnimatedSection className="text-center mb-10">
          <span className="badge-blue mb-3 inline-block">ভর্তি আবেদন</span>
          <h1 className="section-title mb-3">Apply for <span className="text-gradient">Admission</span></h1>
          <p className="text-slate-400">ফর্মটি পূরণ করুন, ২৪ ঘণ্টার মধ্যে যোগাযোগ করা হবে।</p>
        </AnimatedSection>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3">
                <div className="flex flex-col items-center gap-1">
                  <div className={`step-dot ${step === s.id ? 'active' : step > s.id ? 'done' : 'inactive'}`}>
                    {step > s.id ? <CheckCircle size={14} /> : s.icon}
                  </div>
                  <span className={`text-xs hidden sm:block ${step === s.id ? 'text-sky-400 font-medium' : step > s.id ? 'text-emerald-400' : 'text-slate-600'}`}>
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`w-16 sm:w-24 h-px mb-4 ${step > s.id ? 'bg-emerald-400/50' : 'bg-navy-700'} transition-colors duration-300`} />
                )}
              </div>
            ))}
          </div>
          {/* Progress fill */}
          <div className="h-1 bg-navy-700 rounded-full overflow-hidden">
            <motion.div
              animate={{ width: `${((step - 1) / (steps.length - 1)) * 100}%` }}
              transition={{ duration: 0.4 }}
              className="h-full bg-gradient-to-r from-sky-500 to-violet-500 rounded-full"
            />
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <AnimatePresence mode="wait">
            {/* Step 1: Personal Info */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                className="card-glass p-6 space-y-4"
              >
                <h3 className="font-inter font-semibold text-white mb-1 flex items-center gap-2">
                  <User size={17} className="text-sky-400" /> Personal Information
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Full Name *" error={errors.name?.message}>
                    <input {...register('name')} className="input-field" placeholder="Your full name" />
                  </Field>
                  <Field label="Email *" error={errors.email?.message}>
                    <input {...register('email')} className="input-field" placeholder="email@example.com" />
                  </Field>
                  <Field label="Phone *" error={errors.phone?.message}>
                    <input {...register('phone')} className="input-field" placeholder="01XXXXXXXXX" />
                  </Field>
                  <Field label="Guardian's Name *" error={errors.guardian_name?.message}>
                    <input {...register('guardian_name')} className="input-field" placeholder="Parent / Guardian" />
                  </Field>
                  <Field label="Guardian's Phone *" error={errors.guardian_phone?.message}>
                    <input {...register('guardian_phone')} className="input-field" placeholder="01XXXXXXXXX" />
                  </Field>
                  <Field label="Class Level (শ্রেণী)">
                    <select {...register('class_level')} className="input-field">
                      <option value="">-- Select class --</option>
                      {classLevelList(settings.classLevels).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Gender">
                    <select {...register('gender')} className="input-field">
                      <option value="">-- Select --</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label="Address">
                    <input {...register('address')} className="input-field" placeholder="Your address" />
                  </Field>
                </div>
                <div className="pt-2 flex justify-end">
                  <button type="button" onClick={nextStep} className="btn-primary px-8">
                    Next <ChevronRight size={16} />
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 2: Select Batch */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                className="card-glass p-6 space-y-4"
              >
                <h3 className="font-inter font-semibold text-white mb-1 flex items-center gap-2">
                  <BookOpen size={17} className="text-sky-400" /> Select Batch
                </h3>
                <Field label="Preferred Batch *" error={errors.batch_id?.message}>
                  <select {...register('batch_id')} className="input-field">
                    <option value="">-- Select a batch --</option>
                    {batches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} — ৳{b.fee}/month
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Additional Message (optional)">
                  <textarea {...register('message')} className="input-field" rows={4}
                    placeholder="Any questions or notes for us?" />
                </Field>
                <div className="pt-2 flex justify-between">
                  <button type="button" onClick={() => setStep(1)} className="btn-outline px-6">
                    <ChevronLeft size={16} /> Back
                  </button>
                  <button type="button" onClick={nextStep} className="btn-primary px-8">
                    Review <ChevronRight size={16} />
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 3: Review */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                className="card-glass p-6 space-y-5"
              >
                <h3 className="font-inter font-semibold text-white mb-1 flex items-center gap-2">
                  <ClipboardCheck size={17} className="text-sky-400" /> Review & Submit
                </h3>

                <div className="space-y-3">
                  {[
                    { label: 'Full Name', value: values.name },
                    { label: 'Email', value: values.email },
                    { label: 'Phone', value: values.phone },
                    { label: "Guardian's Name", value: values.guardian_name },
                    { label: "Guardian's Phone", value: values.guardian_phone },
                    { label: 'Class Level', value: values.class_level || '—' },
                    { label: 'Gender', value: values.gender || '—' },
                    { label: 'Address', value: values.address || '—' },
                    { label: 'Batch', value: selectedBatch ? `${selectedBatch.name} (৳${selectedBatch.fee}/mo)` : '—' },
                    { label: 'Message', value: values.message || '—' },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between items-start gap-4 text-sm border-b border-white/5 pb-2">
                      <span className="text-slate-500 shrink-0">{row.label}</span>
                      <span className="text-white text-right">{row.value}</span>
                    </div>
                  ))}
                </div>

                <p className="text-slate-500 text-xs">
                  তথ্য নিশ্চিত করুন এবং &quot;Submit Application&quot; বাটনে ক্লিক করুন।
                </p>

                <div className="pt-2 flex justify-between">
                  <button type="button" onClick={() => setStep(2)} className="btn-outline px-6">
                    <ChevronLeft size={16} /> Back
                  </button>
                  <button type="submit" disabled={isSubmitting} className="btn-primary px-8">
                    {isSubmitting ? 'Submitting…' : 'Submit Application'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </div>
      <Footer />
    </div>
  );
}
