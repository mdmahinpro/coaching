import { PublicNavbar } from '@/components/public/PublicNavbar';
import { Footer } from '@/components/public/Footer';
import { HeroSection } from '@/components/public/HeroSection';
import { BatchCard } from '@/components/public/BatchCard';
import { AnimatedSection } from '@/components/shared/AnimatedSection';
import { Avatar } from '@/components/shared/Avatar';
import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/utils/errorHandler';
import { sanitize } from '@/lib/utils';
import { usePoll } from '@/hooks/useRealtimePoll';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BookOpen, Clock, Trophy, MessageSquare, Star, Shield,
  ChevronRight, Bell, ArrowRight
} from 'lucide-react';

const whyUs = [
  { icon: <BookOpen size={22} />, title: 'অভিজ্ঞ শিক্ষকমণ্ডলী', desc: 'বিশ্ববিদ্যালয় থেকে উচ্চতর ডিগ্রিপ্রাপ্ত এবং বছরের পর বছর অভিজ্ঞ শিক্ষকদের সরাসরি গাইডেন্স।' },
  { icon: <Clock size={22} />, title: 'নমনীয় সময়সূচি', desc: 'সকাল, দুপুর ও সন্ধ্যা — তিনটি শিফটে ক্লাস পরিচালিত হয়। তোমার সুবিধামতো বেছে নাও।' },
  { icon: <Trophy size={22} />, title: 'উচ্চ সাফল্যের হার', desc: 'আমাদের ৯৫%+ শিক্ষার্থী পরীক্ষায় উত্তীর্ণ হয় এবং জিপিএ ৫ অর্জন করে।' },
  { icon: <MessageSquare size={22} />, title: 'নিয়মিত মডেল টেস্ট', desc: 'মাসিক মডেল টেস্ট ও মক পরীক্ষার মাধ্যমে পরীক্ষার প্রস্তুতি নিশ্চিত করা হয়।' },
  { icon: <Star size={22} />, title: 'ব্যক্তিগতকৃত মনোযোগ', desc: 'ছোট ব্যাচে পড়ানো হয় যাতে প্রতিটি শিক্ষার্থী পর্যাপ্ত মনোযোগ পায়।' },
  { icon: <Shield size={22} />, title: 'নিরাপদ পরিবেশ', desc: 'নিরাপদ, শান্তিপূর্ণ ও পড়াশোনার উপযুক্ত পরিবেশ নিশ্চিত করা হয়।' },
];

const testimonials = [
  { name: 'রাহিম উদ্দিন', grade: 'SSC 2024 — GPA 5.00', text: 'এই কোচিং সেন্টারের সহায়তায় আমি SSC-তে A+ পেয়েছি। স্যারদের পড়ানোর পদ্ধতি অসাধারণ ছিল।' },
  { name: 'সুমাইয়া বেগম', grade: 'HSC 2024 — GPA 4.83', text: 'নিয়মিত মডেল টেস্ট ও স্যারদের গাইডেন্স আমাকে ভালো ফলাফল করতে সাহায্য করেছে।' },
  { name: 'করিম হোসেন', grade: 'IELTS 7.5 Band', text: 'IELTS প্রস্তুতির জন্য এটি সেরা জায়গা। Speaking ও Writing এ অনেক উপকার হয়েছে।' },
];

export default function HomePage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);

  // Polled "realtime" fetchers — run immediately, then every interval and on
  // window focus, so batch occupancy, the notice ticker and teachers stay live.
  const fetchBatches = useCallback(async () => {
    try {
      const { data } = await supabase.from('batches').select('*').eq('is_active', true).limit(6);
      setBatches(
        (data ?? []).map((b: any) => ({
          ...b, name: sanitize(b.name),
          // teacher is a text column (teacher name string), not a relation object
          teacher: b.teacher ? sanitize(String(b.teacher)) : b.teacher,
        }))
      );
    } catch (err) {
      handleSupabaseError(err);
    }
  }, []);

  const fetchTeachers = useCallback(async () => {
    try {
      // Explicit column list, not `*`: anon holds column-level SELECT on the
      // public teacher card fields only. salary, phone and email are revoked,
      // and `*` would fail the whole query with 42501.
      const { data } = await supabase
        .from('teachers')
        .select('id,name,subject,qualification,bio,photo_url,is_active')
        .eq('is_active', true)
        .limit(4);
      setTeachers(
        (data ?? []).map((t: any) => ({
          ...t, name: sanitize(t.name), subject: t.subject ? sanitize(t.subject) : t.subject,
        }))
      );
    } catch (err) {
      handleSupabaseError(err);
    }
  }, []);

  const fetchNotices = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('notices')
        .select('title')
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(8);
      setNotices((data ?? []).map((n: any) => ({ ...n, title: sanitize(n.title) })));
    } catch (err) {
      handleSupabaseError(err);
    }
  }, []);

  usePoll(fetchBatches);
  usePoll(fetchTeachers);
  usePoll(fetchNotices);

  const tickerItems = notices.length > 0
    ? [...notices, ...notices].map(n => n.title)
    : ['Welcome to our coaching center!', 'Admissions open for 2025', 'Excellent results in SSC 2024'];

  return (
    <div className="min-h-screen bg-navy-900">
      <PublicNavbar />

      {/* Hero */}
      <HeroSection />

      {/* Notice Ticker */}
      {notices.length > 0 && (
        <div className="bg-navy-700/60 border-y border-navy-700/80 py-2.5 overflow-hidden">
          <div className="flex items-center gap-0">
            <div className="shrink-0 bg-sky-500 text-white text-xs font-bold px-4 py-1 mr-4 flex items-center gap-1.5 z-10">
              <Bell size={12} />
              <span>📢 NOTICE</span>
            </div>
            <div className="overflow-hidden flex-1">
              <div className="ticker-track">
                {[...tickerItems, ...tickerItems].map((title, i) => (
                  <span key={i} className="text-sky-400 text-sm font-medium mr-12">
                    • {title}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Why Choose Us */}
      <AnimatedSection className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <span className="badge-violet mb-3 inline-block">কেন আমাদের বেছে নেবেন?</span>
          <h2 className="section-title mb-3">আমাদের <span className="text-gradient">বিশেষত্ব</span></h2>
          <p className="text-slate-400 max-w-xl mx-auto">মানসম্পন্ন শিক্ষা, অভিজ্ঞ শিক্ষক ও আধুনিক পদ্ধতিতে পড়াশোনার সুবিধা।</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {whyUs.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="card-glass p-6 hover:border-sky-400/20 transition-all group"
            >
              <div className="w-11 h-11 rounded-xl bg-sky-400/10 border border-sky-400/20 flex items-center justify-center text-sky-400 mb-4 group-hover:bg-sky-400/15 transition-colors">
                {item.icon}
              </div>
              <h3 className="font-inter font-semibold text-white mb-2">{item.title}</h3>
              <p className="font-hind text-slate-400 text-sm leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </AnimatedSection>

      {/* Courses Preview */}
      {batches.length > 0 && (
        <AnimatedSection className="bg-navy-800/40 py-20">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center mb-12">
              <span className="badge-blue mb-3 inline-block">আমাদের কোর্সসমূহ</span>
              <h2 className="section-title mb-3">চলমান <span className="text-gradient">ব্যাচসমূহ</span></h2>
              <p className="text-slate-400 max-w-xl mx-auto">সকল সক্রিয় ব্যাচ ব্রাউজ করুন এবং তোমার পছন্দের কোর্সে ভর্তি হও।</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
              {batches.map((b, i) => <BatchCard key={b.id} batch={b} index={i} />)}
            </div>
            <div className="text-center">
              <Link to="/courses" className="btn-outline px-8 py-3">
                সব কোর্স দেখুন <ChevronRight size={16} />
              </Link>
            </div>
          </div>
        </AnimatedSection>
      )}

      {/* Teachers */}
      {teachers.length > 0 && (
        <AnimatedSection className="max-w-6xl mx-auto px-4 py-20">
          <div className="text-center mb-12">
            <span className="badge-green mb-3 inline-block">আমাদের টিম</span>
            <h2 className="section-title mb-3">আমাদের <span className="text-gradient">শিক্ষকমণ্ডলী</span></h2>
            <p className="text-slate-400 max-w-xl mx-auto">অভিজ্ঞ ও দক্ষ শিক্ষকগণ তোমাদের সাফল্যের জন্য নিরলসভাবে কাজ করছেন।</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {teachers.map((t, i) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="card-glass p-6 text-center hover:border-violet-400/20 transition-all"
              >
                <div className="flex justify-center mb-4">
                  <Avatar name={t.name} size="lg" src={t.photo_url} seed={t.id} />
                </div>
                <h3 className="font-inter font-semibold text-white mb-1">{t.name}</h3>
                <span className="badge-violet mb-2 text-xs">{t.subject}</span>
                {t.qualification && (
                  <p className="font-hind text-slate-500 text-xs mt-2 leading-relaxed">{t.qualification}</p>
                )}
              </motion.div>
            ))}
          </div>
        </AnimatedSection>
      )}

      {/* Testimonials */}
      <AnimatedSection className="bg-navy-800/40 py-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <span className="badge-yellow mb-3 inline-block">শিক্ষার্থীদের মতামত</span>
            <h2 className="section-title mb-3">সাফল্যের <span className="text-gradient">গল্প</span></h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {testimonials.map((t, i) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="card-glass p-6"
              >
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} size={14} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="font-hind text-slate-300 text-sm leading-relaxed mb-5 italic">&quot;{t.text}&quot;</p>
                <div className="flex items-center gap-3 border-t border-white/5 pt-4">
                  <Avatar name={t.name} size="sm" fallbackToInitials />
                  <div>
                    <p className="font-semibold text-white text-sm">{t.name}</p>
                    <p className="text-slate-500 text-xs">{t.grade}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      {/* Admission CTA */}
      <AnimatedSection>
        <div
          className="py-20"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #0b1120 50%, #0f172a 100%)' }}
        >
          <div
            className="max-w-4xl mx-auto px-4 text-center rounded-2xl py-16 relative overflow-hidden"
            style={{ background: 'radial-gradient(ellipse 70% 80% at 50% 50%, rgba(56,189,248,0.07) 0%, transparent 70%)' }}
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-px bg-gradient-to-r from-transparent via-sky-400/50 to-transparent" />
            <span className="badge-blue mb-4 inline-block">ভর্তি চলছে ২০২৫</span>
            <h2 className="font-inter font-black text-3xl md:text-5xl text-white mb-4">
              আজই শুরু করুন আপনার{' '}
              <span className="text-gradient">শিক্ষা যাত্রা</span>
            </h2>
            <p className="font-hind text-slate-400 text-lg mb-8 max-w-xl mx-auto">
              সীমিত আসন বাকি আছে। দেরি না করে এখনই ভর্তি আবেদন করুন এবং আপনার স্বপ্নের পথে এগিয়ে যান।
            </p>
            <Link to="/admission" className="btn-primary text-base px-10 py-4">
              ভর্তি আবেদন করুন <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </AnimatedSection>

      <Footer />
    </div>
  );
}
