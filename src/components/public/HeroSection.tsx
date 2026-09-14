import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Users, BookOpen, Award, TrendingUp } from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Logo } from '@/components/shared/Logo';
import { useCallback, useEffect, useState } from 'react';
import { useIntersection } from '@/hooks/useIntersection';
import { usePoll } from '@/hooks/useRealtimePoll';
import { resolveHomeStats, type HomeStatsFetch } from '@/lib/homeStats';
import { supabase } from '@/lib/supabase';

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function useCountUp(target: number, duration = 1800, active = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) {return undefined;}
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else {setCount(Math.floor(start));}
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration, active]);
  return count;
}

const codeLines = [
  { label: 'SSC English', color: '#38bdf8', note: '// morning batch' },
  { label: 'HSC Physics', color: '#a78bfa', note: '// evening batch' },
  { label: 'IELTS Prep', color: '#34d399', note: '// weekend batch' },
  { label: 'SSC Math', color: '#f59e0b', note: '// afternoon' },
  { label: 'HSC Chemistry', color: '#fb7185', note: '// morning' },
];

export function HeroSection() {
  const { settings } = useSettingsStore();
  const prefersReducedMotion = useReducedMotion();
  const { ref: statsRef, isVisible: statsVisible } = useIntersection(
    { threshold: 0.3 },
    settings.showHomeStats
  );

  // Live DB counts for the hero stats — polled when "auto-calculate from
  // database" is on (students approved+active, active teachers, active batches).
  const autoFromDb = settings.statAutoFromDb;
  const countFetcher = useCallback(async (): Promise<HomeStatsFetch> => {
    if (!useSettingsStore.getState().settings.statAutoFromDb) {
      return { ok: false }; // skipped when the admin disabled auto-from-DB
    }
    const results = await Promise.all([
      // Students is a private table: count it through the SECURITY DEFINER
      // home_stats() RPC (aggregate counts only), never as an anon SELECT.
      supabase.rpc('home_stats'),
      supabase
        .from('teachers')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),
      supabase
        .from('batches')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),
    ]).catch(() => null);
    if (!results) {
      return { ok: false };
    }
    const [statsRpc, t, b] = results;
    const stats = (statsRpc?.data ?? null) as { students?: unknown } | null;
    const studentsCount = stats?.students;
    // Only explicit nonnegative integers are counts. Missing/invalid values
    // and query failures are unavailable, not an empty database.
    if (statsRpc?.error || t.error || b.error || !isCount(studentsCount) || !isCount(t.count) || !isCount(b.count)) {
      return { ok: false };
    }
    return {
      ok: true,
      counts: {
        students: studentsCount,
        teachers: t.count,
        batches: b.count,
      },
    };
  }, []);
  const dbStats = usePoll<HomeStatsFetch>(countFetcher);

  const resolved = resolveHomeStats(autoFromDb ? dbStats : null, autoFromDb, settings);

  const stats = [
    { icon: <Users size={22} />, value: resolved.students, fromDb: autoFromDb, suffix: '+', label: 'শিক্ষার্থী', color: 'text-sky-400' },
    { icon: <BookOpen size={22} />, value: resolved.batches, fromDb: autoFromDb, suffix: '+', label: 'কোর্স', color: 'text-violet-400' },
    { icon: <Award size={22} />, value: resolved.teachers, fromDb: autoFromDb, suffix: '+', label: 'শিক্ষক', color: 'text-emerald-400' },
    // Success rate is configured independently, never fetched from the DB counts.
    { icon: <TrendingUp size={22} />, value: resolved.successRate, fromDb: false, suffix: '%', label: 'সাফল্য', color: 'text-amber-400' },
  ];

  const counts = [
    useCountUp(resolved.students, 1600, !prefersReducedMotion && statsVisible && settings.showHomeStats),
    useCountUp(resolved.batches, 1200, !prefersReducedMotion && statsVisible && settings.showHomeStats),
    useCountUp(resolved.teachers, 1000, !prefersReducedMotion && statsVisible && settings.showHomeStats),
    useCountUp(resolved.successRate, 1400, !prefersReducedMotion && statsVisible && settings.showHomeStats),
  ];

  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden bg-navy-900">
      {/* Custom banner background (optional — set in Settings → Institute) */}
      {settings.bannerUrl && (
        <>
          <img
            src={settings.bannerUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          />
          <div className="absolute inset-0 pointer-events-none bg-navy-900/70" />
        </>
      )}
      {/* Radial glow bg */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(56,189,248,0.12) 0%, transparent 70%)' }}
      />
      {/* Grid pattern */}
      <div className="hero-grid absolute inset-0 pointer-events-none opacity-60" />
      {/* Extra ambient blobs */}
      <div className="absolute top-1/3 left-1/4 w-80 h-80 bg-violet-500/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-sky-500/8 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 py-24 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left: content */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="inline-flex items-center gap-2 mb-6"
            >
              <Logo className="w-5 h-5 rounded" />
              <span className="badge-blue">ভর্তি চলছে ২০২৫</span>
            </motion.div>

            {/* Heading — admin-editable via Settings → Institute (heroTitle). */}
            <h1 className="font-inter font-black text-4xl sm:text-5xl lg:text-6xl xl:text-7xl text-white mb-5 leading-[1.1]">
              {settings.heroTitle ? (
                settings.heroTitle
              ) : (
                <>
                  Build Your<br />
                  <span className="text-gradient">Future</span>
                  <span className="text-white"> With Us</span>
                </>
              )}
            </h1>

            {/* Subtext — admin-editable via Settings → Institute (heroSubtitle). */}
            <p className="font-hind text-slate-400 text-lg md:text-xl leading-relaxed mb-10 max-w-lg">
              {settings.heroSubtitle
                ? settings.heroSubtitle
                : `${settings.centerName} — মানসম্পন্ন শিক্ষা ও অভিজ্ঞ শিক্ষকদের গাইডেন্সে তোমার স্বপ্নের গন্তব্যে পৌঁছাও।`}
            </p>

            {/* Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 mb-16">
              <Link to="/admission" className="btn-primary text-base px-7 py-3.5">
                ভর্তি হন <ArrowRight size={18} />
              </Link>
              <Link to="/courses" className="btn-outline text-base px-7 py-3.5">
                কোর্স দেখুন
              </Link>
            </div>

            {/* Stats row — shown only when the admin enables it */}
            {settings.showHomeStats && (
              <div ref={statsRef as React.Ref<HTMLDivElement>} className="grid grid-cols-4 gap-4">
                {stats.map((s, i) => (
                  <div key={s.label} className="text-center">
                    <div className={`font-inter font-black text-2xl sm:text-3xl ${s.color} mb-0.5`}>
                      {resolved.failed && s.fromDb
                        ? '—'
                        : `${(prefersReducedMotion ? s.value : counts[i]).toLocaleString()}${s.suffix}`}
                    </div>
                    <div className="font-hind text-slate-500 text-xs sm:text-sm">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Right: decorative code card */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.25 }}
            className="hidden lg:block"
          >
            <div className="card-glass p-5 font-mono text-sm relative overflow-hidden">
              {/* Traffic lights */}
              <div className="flex items-center gap-1.5 mb-5">
                <div className="w-3 h-3 rounded-full bg-red-400/70" />
                <div className="w-3 h-3 rounded-full bg-amber-400/70" />
                <div className="w-3 h-3 rounded-full bg-emerald-400/70" />
                <span className="ml-3 text-slate-500 text-xs">courses.config.ts</span>
              </div>

              <div className="space-y-2.5">
                <div className="text-slate-500">
                  <span className="text-violet-400">const</span>{' '}
                  <span className="text-sky-400">batches</span>{' '}
                  <span className="text-white">= {'['}</span>
                </div>
                {codeLines.map((line, i) => (
                  <motion.div
                    key={line.label}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + i * 0.12 }}
                    className="pl-6 flex items-center gap-2"
                  >
                    <span style={{ color: line.color }} className="font-semibold">&apos;</span>
                    <span style={{ color: line.color }}>{line.label}</span>
                    <span style={{ color: line.color }} className="font-semibold">&apos;</span>
                    <span className="text-slate-500 text-xs">{line.note}</span>
                    <span className="text-slate-400">,</span>
                  </motion.div>
                ))}
                <div className="text-white">{']'}</div>

                <div className="mt-4 pt-4 border-t border-white/5">
                  <span className="text-violet-400">export default </span>
                  <span className="text-white">{'{'} </span>
                  <span className="text-sky-400">batches</span>
                  <span className="text-slate-400">, </span>
                  <span className="text-emerald-400">totalStudents</span>
                  <span className="text-white">: </span>
                  <span className="text-amber-400">1200</span>
                  <span className="text-white"> {'}'}</span>
                </div>
              </div>

              {/* Glow overlay */}
              <div className="absolute -bottom-8 -right-8 w-40 h-40 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
