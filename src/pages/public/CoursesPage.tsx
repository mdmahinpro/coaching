import { useEffect, useState } from 'react';
import { PublicNavbar } from '@/components/public/PublicNavbar';
import { Footer } from '@/components/public/Footer';
import { BatchCard } from '@/components/public/BatchCard';
import { AnimatedSection } from '@/components/shared/AnimatedSection';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/utils/errorHandler';
import { cn, sanitize } from '@/lib/utils';
import { Search, BookOpen } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';

const LEVELS = ['All', 'SSC', 'HSC', 'Class 6-8', 'IELTS', 'Admission Test'];
const SUBJECTS = ['All Subjects', 'English', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Bengali', 'ICT'];

export default function CoursesPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('All');
  const [subject, setSubject] = useState('All Subjects');
  const q = useDebounce(search, 300);

  useEffect(() => {
    let query = supabase.from('batches').select('*').eq('is_active', true);
    if (q) {query = query.ilike('name', `%${q}%`);}
    if (subject !== 'All Subjects') {query = query.ilike('subject', `%${subject}%`);}
    if (level !== 'All') {query = query.ilike('name', `%${level}%`);}
    setLoading(true);
    // Promise.resolve wraps the builder (typed PromiseLike) so .finally is available
    Promise.resolve(query).then(({ data }) => {
      const cleaned = (data ?? []).map((b: any) => ({ ...b, name: sanitize(b.name) }));
      setBatches(cleaned);
    },(err: any) => { handleSupabaseError(err); }).finally(() => { setLoading(false); });
  }, [q, level, subject]);

  return (
    <div className="min-h-screen bg-navy-900">
      <PublicNavbar />

      <div className="pt-24 max-w-6xl mx-auto px-4 pb-20">
        <AnimatedSection className="text-center mb-12">
          <span className="badge-blue mb-3 inline-block">আমাদের কোর্সসমূহ</span>
          <h1 className="section-title mb-3">Available <span className="text-gradient">Courses</span></h1>
          <p className="text-slate-400 max-w-xl mx-auto">সকল সক্রিয় ব্যাচ ব্রাউজ করুন এবং তোমার পছন্দের কোর্সে ভর্তি হও।</p>
        </AnimatedSection>

        {/* Search */}
        <div className="relative mb-6 max-w-md mx-auto">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pl-10"
            placeholder="Search batches…"
          />
        </div>

        {/* Level filter pills */}
        <div className="flex flex-wrap justify-center gap-2 mb-4">
          {LEVELS.map(l => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={`filter-pill ${level === l ? 'active' : ''}`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Subject dropdown */}
        <div className="flex justify-center mb-10">
          <select
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="input-field max-w-xs text-sm"
          >
            {SUBJECTS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Results count */}
        {!loading && (
          <p className="text-slate-500 text-sm mb-5 text-center">
            {batches.length} {batches.length === 1 ? 'batch' : 'batches'} found
          </p>
        )}

        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : batches.length === 0 ? (
          <EmptyState
            title="কোনো কোর্স পাওয়া যায়নি"
            description="অনুসন্ধান পরিবর্তন করুন অথবা পরে আবার চেষ্টা করুন।"
            icon={<BookOpen size={48} strokeWidth={1.2} />}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {batches.map((b, i) => <BatchCard key={b.id} batch={b} index={i} />)}
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
