import { useEffect, useState } from 'react';
import { PublicNavbar } from '@/components/public/PublicNavbar';
import { Footer } from '@/components/public/Footer';
import { AnimatedSection } from '@/components/shared/AnimatedSection';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { supabase } from '@/lib/supabase';
import { formatDate, sanitize } from '@/lib/utils';
import { Bell, Pin, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

type Category = 'all' | 'exam' | 'fees' | 'holiday' | 'result' | 'urgent' | 'general';

const FILTERS: { id: Category; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'exam', label: 'Exam' },
  { id: 'fees', label: 'Fee' },
  { id: 'holiday', label: 'Holiday' },
  { id: 'result', label: 'Result' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'general', label: 'General' },
];

const categoryStyles: Record<string, { badge: string; border: string; icon: string }> = {
  exam:    { badge: 'badge-blue',   border: 'border-sky-400/30',    icon: 'text-sky-400' },
  fees:    { badge: 'badge-violet', border: 'border-violet-400/30', icon: 'text-violet-400' },
  holiday: { badge: 'badge-green',  border: 'border-emerald-400/30',icon: 'text-emerald-400' },
  result:  { badge: 'badge-yellow', border: 'border-amber-400/30',  icon: 'text-amber-400' },
  urgent:  { badge: 'badge-red',    border: 'border-red-400/40',    icon: 'text-red-400' },
  general: { badge: 'badge-blue',   border: 'border-sky-400/20',    icon: 'text-sky-400' },
};

export default function NoticeBoardPage() {
  const [notices, setNotices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Category>('all');

  useEffect(() => {
    supabase
      .from('notices')
      .select('*')
      .eq('is_published', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const cleaned = (data ?? []).map((n: any) => ({
          ...n,
          title: sanitize(n.title),
          content: sanitize(n.content),
        }));
        setNotices(cleaned);
        setLoading(false);
      });
  }, []);

  const getCategory = (notice: any) => {
    const value = String(notice.type ?? notice.category ?? 'general').toLowerCase();
    return value === 'fee' ? 'fees' : value;
  };

  const filtered = filter === 'all'
    ? notices
    : notices.filter((n) => getCategory(n) === filter);

  return (
    <div className="min-h-screen bg-navy-900">
      <PublicNavbar />

      <div className="pt-24 max-w-3xl mx-auto px-4 pb-20">
        <AnimatedSection className="text-center mb-10">
          <span className="badge-blue mb-3 inline-block">নোটিশ বোর্ড</span>
          <h1 className="section-title mb-3">Notice <span className="text-gradient">Board</span></h1>
          <p className="text-slate-400">Stay updated with latest announcements and news.</p>
        </AnimatedSection>

        {/* Filter pills */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`filter-pill ${filter === f.id ? 'active' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="কোনো নোটিশ পাওয়া যায়নি"
            description="এই ক্যাটাগরিতে কোনো নোটিশ নেই।"
            icon={<Bell size={48} strokeWidth={1.2} />}
          />
        ) : (
          <div className="space-y-4">
            {filtered.map((n, i) => {
               const cat = getCategory(n);
              const style = categoryStyles[cat] ?? categoryStyles.general;
              const isUrgent = cat === 'urgent';

              return (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className={`card-glass p-5 border-l-2 transition-all ${
                    isUrgent ? 'border-l-red-400 border-red-400/20' : `border-l-sky-400/30 ${style.border}`
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                      isUrgent ? 'bg-red-400/10' : n.is_pinned ? 'bg-sky-500/10' : 'bg-white/5'
                    }`}>
                      {isUrgent
                        ? <AlertTriangle size={15} className="text-red-400" />
                        : n.is_pinned
                          ? <Pin size={15} className="text-sky-400" />
                          : <Bell size={15} className="text-slate-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h3 className="font-inter font-semibold text-white text-sm leading-snug">{n.title}</h3>
                        {n.is_pinned && <span className="badge-blue">Pinned</span>}
                        {n.category && (
                          <span className={style.badge}>
                            {isUrgent && '🚨 '}{n.category}
                          </span>
                        )}
                      </div>
                      <p className="font-hind text-slate-400 text-sm leading-relaxed mb-2">{n.content}</p>
                      <p className="text-slate-600 text-xs">{formatDate(n.created_at)}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
