import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { UserPlus, CreditCard } from 'lucide-react';
import { useNotificationStore } from '@/store/useNotificationStore';
import {
  fetchNotificationSnapshot,
  diffNewItems,
  loadSeenIds,
  saveSeenIds,
  pruneSeen,
  seenKeyFor,
  timeAgo,
  type AdminNotification,
} from '@/lib/adminNotifications';

const POLL_MS = 45_000;
const MAX_TOASTS_PER_TICK = 3;

/**
 * Admin notification engine — single instance mounted at the App root for
 * admins only (see AdminNotificationMount in App.tsx). Polls the pending
 * admission + payment-approval queues, diffs against the last feed, fires
 * react-hot-toast popups for NEW items that aren't already seen, and keeps
 * the badge counts up to date. Admin's own approvals remove items from the
 * feed — so they never toast back to themselves.
 */
export function useAdminNotifications(email: string | null) {
  const navigate = useNavigate();
  const setSeenKey = useNotificationStore((s) => s.setSeenKey);
  const setFeed = useNotificationStore((s) => s.setFeed);
  const keysRef = useRef<string | null>(null);

  useEffect(() => {
    if (!email) {
      return;
    }
    const key = seenKeyFor(email);
    keysRef.current = key;
    setSeenKey(email);

    const showToast = (item: AdminNotification) => {
      const Icon = item.kind === 'payment' ? CreditCard : UserPlus;
      toast(
        (t) => (
          <button
            onClick={() => {
              navigate(item.link);
              toast.dismiss(t.id);
            }}
            className="flex items-start gap-3 text-left w-full"
          >
            <span className="mt-0.5 w-8 h-8 rounded-lg bg-sky-400/15 flex items-center justify-center shrink-0">
              <Icon size={15} className="text-sky-400" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-white text-sm leading-snug">
                {item.title}
              </span>
              {item.sub && (
                <span className="block text-slate-400 text-xs mt-0.5">{item.sub}</span>
              )}
              <span className="block text-slate-500 text-[11px] mt-0.5">
                {timeAgo(item.createdAt)} · দেখুন →
              </span>
            </span>
          </button>
        ),
        { id: `notif-${item.id}`, duration: 8000 }
      );
    };

    const sync = async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      try {
        const snapshot = await fetchNotificationSnapshot();
        const prev = useNotificationStore.getState().items;
        const fresh = diffNewItems(prev, snapshot);

        const seenSet = new Set(keysRef.current ? loadSeenIds(keysRef.current) : []);
        const visible = typeof document !== 'undefined' && document.visibilityState === 'visible';
        if (!silent && visible) {
          fresh
            .filter((n) => !seenSet.has(n.id))
            .slice(0, MAX_TOASTS_PER_TICK)
            .forEach(showToast);
        }
        // Mark the fresh ones seen NOW so a second poll (or refocus) can't toast
        // them again; then persist the whole pruned seen-set.
        const nextSeen = [...new Set([...seenSet, ...fresh.map((n) => n.id)])];
        if (keysRef.current) {
          saveSeenIds(keysRef.current, pruneSeen(nextSeen, snapshot.map((n) => n.id)));
        }
        setFeed(snapshot, nextSeen);
      } catch {
        // The bell must never crash the admin UI — swallow snapshot failures.
      }
    };

    sync();

    const interval = window.setInterval(() => sync(), POLL_MS);
    const onFocus = () => void sync();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void sync({ silent: true });
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      keysRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);
}
