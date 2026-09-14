import { PublicNavbar } from '@/components/public/PublicNavbar';
import { Footer } from '@/components/public/Footer';
import { AnimatedSection } from '@/components/shared/AnimatedSection';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Phone, Mail, MapPin, Send, MessageCircle } from 'lucide-react';
import {
  contactFormSchema as schema,
  PUBLIC_FORM_LIMITS,
  type ContactFormData as F,
} from '../../../shared/public-form-schemas';

export default function ContactPage() {
  const { settings } = useSettingsStore();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<F>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: F) => {
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        toast.error(response.status === 429 ? 'অনেকবার চেষ্টা করা হয়েছে। পরে আবার চেষ্টা করুন।' : 'বার্তা পাঠাতে সমস্যা হয়েছে।');
        return;
      }
      toast.success('বার্তা সফলভাবে পাঠানো হয়েছে!');
      reset();
    } catch {
      toast.error('বার্তা পাঠাতে সমস্যা হয়েছে।');
    }
  };

  const waLink = settings.centerWhatsapp
    ? `https://wa.me/${settings.centerWhatsapp.replace(/[^0-9]/g, '')}`
    : 'https://wa.me/';
  const normalizeMapUrl = (value: string) => {
    const raw = value.trim();
    const iframeSrc = raw.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] ?? raw;
    if (/^https:\/\/www\.google\.com\/maps\/embed/i.test(iframeSrc)) {return iframeSrc;}
    if (/^https:\/\//i.test(iframeSrc) && /google\.[^/]+\/maps/i.test(iframeSrc)) {
      return `https://www.google.com/maps?q=${encodeURIComponent(iframeSrc)}&output=embed`;
    }
    if (settings.centerAddress.trim()) {
      return `https://www.google.com/maps?q=${encodeURIComponent(settings.centerAddress)}&output=embed`;
    }
    return '';
  };
  const safeMapEmbedUrl = normalizeMapUrl(settings.mapEmbedUrl);

  return (
    <div className="min-h-screen bg-navy-900">
      <PublicNavbar />

      <div className="pt-24 max-w-5xl mx-auto px-4 pb-20">
        <AnimatedSection className="text-center mb-14">
          <span className="badge-blue mb-3 inline-block">যোগাযোগ করুন</span>
          <h1 className="section-title mb-3">Get in <span className="text-gradient">Touch</span></h1>
          <p className="text-slate-400 max-w-xl mx-auto">কোনো প্রশ্ন বা জিজ্ঞাসা থাকলে আমাদের সাথে যোগাযোগ করুন।</p>
        </AnimatedSection>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
          {/* Contact info */}
          <AnimatedSection className="lg:col-span-2 space-y-5">
            <h2 className="font-inter font-semibold text-white text-lg mb-4">Contact Information</h2>

            {[
              {
                icon: <Phone size={18} />,
                label: 'Phone',
                value: settings.centerPhone || 'Not configured',
                href: settings.centerPhone ? `tel:${settings.centerPhone}` : undefined,
                color: 'text-sky-400',
                bg: 'bg-sky-400/10 border-sky-400/20',
              },
              {
                icon: <Mail size={18} />,
                label: 'Email',
                value: settings.centerEmail || 'Not configured',
                href: settings.centerEmail ? `mailto:${settings.centerEmail}` : undefined,
                color: 'text-violet-400',
                bg: 'bg-violet-400/10 border-violet-400/20',
              },
              {
                icon: <MapPin size={18} />,
                label: 'Address',
                value: settings.centerAddress || 'Not configured',
                href: undefined,
                color: 'text-emerald-400',
                bg: 'bg-emerald-400/10 border-emerald-400/20',
              },
            ].map(c => (
              <div key={c.label} className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-xl border flex items-center justify-center ${c.color} ${c.bg} shrink-0`}>
                  {c.icon}
                </div>
                <div>
                  <p className="text-slate-500 text-xs mb-0.5">{c.label}</p>
                  {c.href ? (
                    <a href={c.href} className={`font-medium hover:underline ${c.color}`}>{c.value}</a>
                  ) : (
                    <p className="text-white font-medium">{c.value}</p>
                  )}
                </div>
              </div>
            ))}

            {/* WhatsApp CTA */}
            <div className="pt-4">
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15 hover:border-emerald-500/40 transition-all rounded-xl px-5 py-3 font-medium text-sm"
              >
                <MessageCircle size={18} />
                WhatsApp-এ মেসেজ করুন
              </a>
            </div>

            <div className="mt-6 rounded-xl overflow-hidden border border-white/8 h-44 bg-navy-700/40">
              {safeMapEmbedUrl ? (
                <iframe
                  title="Institute location map"
                  src={safeMapEmbedUrl}
                  className="w-full h-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center text-slate-600">
                    <MapPin size={28} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Map embed</p>
                    <p className="text-xs mt-1 text-slate-700">Configure map embed URL in Settings</p>
                  </div>
                </div>
              )}
            </div>
          </AnimatedSection>

          {/* Contact form */}
          <AnimatedSection delay={100} className="lg:col-span-3">
            <form onSubmit={handleSubmit(onSubmit)} className="card-glass p-7 space-y-5">
              <div className="sr-only" aria-hidden="true">
                <label htmlFor="contact-website">Website</label>
                <input id="contact-website" {...register('website')} tabIndex={-1} autoComplete="off" />
              </div>
              <h2 className="font-inter font-semibold text-white text-lg mb-1">Send a Message</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Name *</label>
                  <input {...register('name')} maxLength={PUBLIC_FORM_LIMITS.name} className="input-field" placeholder="Your name" />
                  {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Email *</label>
                  <input {...register('email')} maxLength={PUBLIC_FORM_LIMITS.email} className="input-field" placeholder="email@example.com" />
                  {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Phone (optional)</label>
                <input {...register('phone')} maxLength={PUBLIC_FORM_LIMITS.phone} className="input-field" placeholder="01XXXXXXXXX" />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Message *</label>
                <textarea {...register('message')} maxLength={PUBLIC_FORM_LIMITS.message} className="input-field" rows={5}
                  placeholder="আপনার বার্তা লিখুন…" />
                {errors.message && <p className="text-red-400 text-xs mt-1">{errors.message.message}</p>}
              </div>

              <button type="submit" disabled={isSubmitting} className="btn-primary w-full justify-center py-3">
                <Send size={16} /> {isSubmitting ? 'Sending…' : 'Send Message'}
              </button>
            </form>
          </AnimatedSection>
        </div>
      </div>

      <Footer />
    </div>
  );
}
