import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Users, BookOpen, Award, TrendingUp } from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useEffect, useState, useRef } from 'react';
import { useIntersection } from '@/hooks/useIntersection';

function useCountUp(target: number, duration = 1800, active = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration, active]);
  return count;
}

const stats = [
  { icon: <Users size={22} />, value: 1200, suffix: '+', label: 'শিক্ষার্থী', color: 'text-sky-400' },
  { icon: <BookOpen size={22} />, value: 24, suffix: '+', label: 'কোর্স', color: 'text-violet-400' },
  { icon: <Award size={22} />, value: 12, suffix: '+', label: 'শিক্ষক', color: 'text-emerald-400' },
  { icon: <TrendingUp size={22} />, value: 95, suffix: '%', label: 'সাফল্য', color: 'text-amber-400' },
];

const codeLines = [
  { label: 'SSC English', color: '#38bdf8', note: '// morning batch' },
  { label: 'HSC Physics', color: '#a78bfa', note: '// evening batch' },
  { label: 'IELTS Prep', color: '#34d399', note: '// weekend batch' },
  { label: 'SSC Math', color: '#f59e0b', note: '// afternoon' },
  { label: 'HSC Chemistry', color: '#fb7185', note: '// morning' },
];

export function HeroSection() {
  const { settings } = useSettingsStore();
  const { ref: statsRef, isVisible: statsVisible } = useIntersection({ threshold: 0.3 });

  const counts = [
    useCountUp(1200, 1600, statsVisible),
    useCountUp(24, 1200, statsVisible),
    useCountUp(12, 1000, statsVisible),
    useCountUp(95, 1400, statsVisible),
  ];

  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden bg-navy-900">
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
              <span className="badge-blue animate-[pulseDot_1.5s_ease-in-out_infinite]">🎓</span>
              <span className="badge-blue">ভর্তি চলছে ২০২৫</span>
            </motion.div>

            {/* Heading */}
            <h1 className="font-inter font-black text-4xl sm:text-5xl lg:text-6xl xl:text-7xl text-white mb-5 leading-[1.1]">
              Build Your<br />
              <span className="text-gradient">Future</span>
              <span className="text-white"> With Us</span>
            </h1>

            {/* Subtext */}
            <p className="font-hind text-slate-400 text-lg md:text-xl leading-relaxed mb-10 max-w-lg">
              {settings.centerName} — মানসম্পন্ন শিক্ষা ও অভিজ্ঞ শিক্ষকদের গাইডেন্সে তোমার স্বপ্নের গন্তব্যে পৌঁছাও।
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

            {/* Stats row */}
            <div ref={statsRef as React.Ref<HTMLDivElement>} className="grid grid-cols-4 gap-4">
              {stats.map((s, i) => (
                <div key={s.label} className="text-center">
                  <div className={`font-inter font-black text-2xl sm:text-3xl ${s.color} mb-0.5`}>
                    {counts[i].toLocaleString()}{s.suffix}
                  </div>
                  <div className="font-hind text-slate-500 text-xs sm:text-sm">{s.label}</div>
                </div>
              ))}
            </div>
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
                    <span style={{ color: line.color }} className="font-semibold">'</span>
                    <span style={{ color: line.color }}>{line.label}</span>
                    <span style={{ color: line.color }} className="font-semibold">'</span>
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
