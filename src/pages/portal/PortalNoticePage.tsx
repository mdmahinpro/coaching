import { useEffect, useState, useCallback } from 'react';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { fetchNotices, fetchNoticeReads, markNoticeRead } from '@/lib/portalApi';
import { handleSupabaseError } from '@/utils/errorHandler';
import { useStudentStore } from '@/store/useStudentStore';
import { formatDate, cn, sanitize } from '@/lib/utils';
import { Bell, Pin, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const TYPE_COLORS: Record<string, string> = {
  exam: 'badge-violet',
  holiday: 'badge-green',
  fee: 'badge-yellow',
  result: 'badge-blue',
  event: 'badge-violet',
  general: 'badge-blue',
};
const ALL_TYPES = ['all', 'general', 'exam', 'fee', 'holiday', 'result', 'event'];

export default function PortalNoticePage() {
  const { student } = useStudentStore();
  const [notices, setNotices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  // readIds is the server-persisted set of (this student's) read notices —
  // loaded from portal_get_notice_reads, updated optimistically on expand and
  // written back through portal_mark_notice_read so it survives reloads and
  // follows the student across devices.
  const [readIds, setReadIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchNotices(filter !== 'all' ? filter : undefined);
      const cleaned = (data ?? []).map((n: any) => ({
        ...n,
        title: sanitize(n.title),
        content: sanitize(n.content),
      }));
      setNotices(cleaned);
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setLoading(false);
    }
  }, [filter, student]);

  useEffect(() => {
    load();
  }, [load]);

  // Load the server-side read receipts once per session/student.
  useEffect(() => {
    if (!student) {
      return;
    }
    fetchNoticeReads().then(
      (rows: any[]) => setReadIds((rows ?? []).map((r) => r.notice_id)),
      (err: any) => {
        handleSupabaseError(err);
      }
    );
  }, [student]);

  const markRead = (id: string) => {
    if (readIds.includes(id)) {
      return;
    }
    // Optimistic local update; persist server-side (best-effort).
    setReadIds((prev) => [...prev, id]);
    markNoticeRead(id).catch((err: any) => {
      handleSupabaseError(err);
    });
  };

  const toggleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      markRead(id);
    }
  };

  const unread = notices.filter((n) => !readIds.includes(n.id)).length;

  return (
    <PortalLayout>
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-inter font-bold text-xl text-white font-hind flex items-center gap-2">
          <Bell size={20} className="text-sky-400" /> নোটিশ বোর্ড
        </h1>
        {unread > 0 && <span className="badge-blue text-xs">{unread} অপঠিত</span>}
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {ALL_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all font-hind',
              filter === t
                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
            )}
          >
            {t === 'all'
              ? 'সব'
              : t === 'exam'
                ? 'পরীক্ষা'
                : t === 'fee'
                  ? 'ফি'
                  : t === 'holiday'
                    ? 'ছুটি'
                    : t === 'result'
                      ? 'ফলাফল'
                      : t === 'event'
                        ? 'ইভেন্ট'
                        : 'সাধারণ'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-sky-400" />
        </div>
      ) : notices.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-slate-500 font-hind">কোনো নোটিশ নেই</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notices.map((n) => {
            const isUnread = !readIds.includes(n.id);
            const isOpen = expanded === n.id;
            return (
              <motion.div
                key={n.id}
                layout
                className={cn(
                  'card border-l-4 overflow-hidden transition-all',
                  n.is_pinned ? 'border-l-sky-400' : 'border-l-transparent'
                )}
              >
                <button onClick={() => toggleExpand(n.id)} className="w-full text-left p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div
                        className={cn(
                          'p-1.5 rounded-lg shrink-0 mt-0.5',
                          n.is_pinned ? 'bg-sky-400/15' : 'bg-white/5'
                        )}
                      >
                        {n.is_pinned ? (
                          <Pin size={13} className="text-sky-400" />
                        ) : (
                          <Bell size={13} className="text-slate-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          {isUnread && <div className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />}
                          <h3
                            className={cn(
                              'text-sm font-hind',
                              isUnread ? 'font-bold text-white' : 'font-medium text-slate-300'
                            )}
                          >
                            {n.title}
                          </h3>
                          {n.type && (
                            <span
                              className={cn(
                                TYPE_COLORS[n.type] ?? 'badge-blue',
                                'text-xs capitalize'
                              )}
                            >
                              {n.type}
                            </span>
                          )}
                          {n.is_pinned && <span className="badge-blue text-xs">Pinned</span>}
                        </div>
                        {!isOpen && (
                          <p className="text-slate-500 text-xs line-clamp-1 font-hind">
                            {n.content}
                          </p>
                        )}
                        <p className="text-slate-600 text-xs mt-1">{formatDate(n.created_at)}</p>
                      </div>
                    </div>
                    <div className="text-slate-500 shrink-0 mt-0.5">
                      {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-1 border-t border-white/5">
                        <p className="text-slate-300 text-sm font-hind leading-relaxed whitespace-pre-wrap">
                          {n.content}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </PortalLayout>
  );
}
