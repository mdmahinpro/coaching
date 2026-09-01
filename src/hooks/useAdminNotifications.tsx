import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { UserPlus, CreditCard } from 'lucide-react';
import { useNotificationStore } from '@/store/useNotificationStore';
import {
  fetchNotificationSnapshot,
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
 * admission + payment-approval queues, fires react-hot-toast popups for NEW
 * items, and keeps the badge counts up to date.
 *
 * Read/unread is tracked by the persisted seen-set (localStorage): an item
 * stays UNREAD in the badge until the admin explicitly opens it (markRead /
 * markAllRead in the bell). A separate in-memory set guards against re-toasting,
 * so toasting never marks an item read. Admin's own approvals remove items
 * from the feed — so they never toast back to themselves.
 */
export function useAdminNotifications(email: string | null) {
  const navigate = useNavigate();
  const setSeenKey = useNotificationStore((s) => s.setSeenKey);
  const setFeed = useNotificationStore((s) => s.setFeed);
  const keysRef = useRef<string | null>(null);
  // Session-only: ids already toasted once. Deliberately NOT written to the
  // seen-set / localStorage, so marking-something-toast does not mark it read.
  const toastedRef = useRef<Set<string>>(new Set());

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
              // Accepting the toast (clicking it) acknowledges the item so it
              // is treated as read and the popup is removed.
              useNotificationStore.getState().markRead([item.id]);
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
        // Keep each notification on screen until the admin interacts with it
        // (clicks to open, or marks read from the bell) instead of auto-dismissing.
        { id: `notif-${item.id}`, duration: Infinity }
      );
    };

    const sync = async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      try {
        const snapshot = await fetchNotificationSnapshot();

        // persisted seen-set = items the admin has actually opened. Anything not
        // in it is UNREAD and must stay unread until the admin opens it.
        const stored = keysRef.current ? loadSeenIds(keysRef.current) : [];
        const seenSet = new Set(stored);
        const unread = snapshot.filter((n) => !seenSet.has(n.id));

        // Toast only genuinely-new, unseen items — guarded by the in-memory set
        // (NOT persisted) so we never re-toast AND never mark an item read.
        const toastable = unread.filter((n) => !toastedRef.current.has(n.id));
        const visible = typeof document !== 'undefined' && document.visibilityState === 'visible';
        if (!silent && visible) {
          toastable.slice(0, MAX_TOASTS_PER_TICK).forEach((n) => {
            toastedRef.current.add(n.id);
            showToast(n);
          });
        }

        // Persist the SEEN-SET unchanged (pruned to the active feed). Unread
        // items are intentionally NOT added here, so they remain unread until
        // the admin opens them (markRead / markAllRead).
        if (keysRef.current) {
          saveSeenIds(keysRef.current, pruneSeen(stored, snapshot.map((n) => n.id)));
        }
        setFeed(snapshot, stored);
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
