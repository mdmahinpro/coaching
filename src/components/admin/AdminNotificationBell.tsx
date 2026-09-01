import { useEffect, useRef, useState } from 'react';
import { Bell, UserPlus, CreditCard, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotificationStore } from '@/store/useNotificationStore';
import { timeAgo, type AdminNotification } from '@/lib/adminNotifications';

function KindIcon({ kind }: { kind: AdminNotification['kind'] }) {
  return kind === 'payment' ? (
    <span className="w-8 h-8 rounded-lg bg-emerald-400/15 flex items-center justify-center shrink-0">
      <CreditCard size={14} className="text-emerald-400" />
    </span>
  ) : (
    <span className="w-8 h-8 rounded-lg bg-sky-400/15 flex items-center justify-center shrink-0">
      <UserPlus size={14} className="text-sky-400" />
    </span>
  );
}

export function AdminNotificationBell() {
  const { items, unread, markAllRead, markRead } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click and Escape — listeners attach only while open.
  // NOTE: opening the dropdown does NOT mark anything read. A notification
  // stays unread until the admin explicitly opens that specific item (or
  // presses "Mark all read") — that's what keeps it "until opened".
  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
        className="relative w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors shrink-0"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-sky-400 text-navy-900 text-[10px] font-bold grid place-items-center shadow">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-80 bg-navy-800 border border-navy-600/70 rounded-xl overflow-hidden z-[60] shadow-2xl shadow-black/50"
            >
              <div className="px-4 py-3 border-b border-white/10 bg-navy-900/60 flex items-center justify-between">
                <p className="text-white text-sm font-medium">Notifications</p>
                <button
                  onClick={markAllRead}
                  className="text-sky-400 text-xs font-medium hover:text-sky-300 transition-colors"
                >
                  Mark all read
                </button>
              </div>

              {items.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell size={20} className="text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-500 text-xs font-medium">No pending notifications</p>
                  <p className="text-slate-600 text-[11px] mt-1">
                    নতুন ভর্তি আবেদন ও পেমেন্ট এখানে আসবে
                  </p>
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-white/5">
                  {items.map((n) => (
                    <Link
                      key={n.id}
                      to={n.link}
                      onClick={() => {
                        markRead([n.id]);
                        setOpen(false);
                      }}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                    >
                      <KindIcon kind={n.kind} />
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-xs font-medium leading-snug break-words">
                          {n.title}
                        </p>
                        {n.sub && (
                          <p className="text-slate-400 text-[11px] mt-0.5 truncate">{n.sub}</p>
                        )}
                        <p className="text-slate-600 text-[10px] mt-1">{timeAgo(n.createdAt)}</p>
                      </div>
                      <ExternalLink size={11} className="text-slate-600 mt-1 shrink-0" />
                    </Link>
                  ))}
                </div>
              )}

              <div className="px-4 py-2 border-t border-white/10 bg-navy-900/40 flex items-center justify-between text-[11px]">
                <Link to="/admin/admissions" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
                  Admissions
                </Link>
                <Link
                  to="/admin/fees?tab=approvals"
                  onClick={() => setOpen(false)}
                  className="text-slate-400 hover:text-white"
                >
                  Payment Approvals
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
