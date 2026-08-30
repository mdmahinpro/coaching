import { create } from 'zustand';
import {
  loadSeenIds,
  saveSeenIds,
  pruneSeen,
  seenKeyFor,
  unreadCount,
  type AdminNotification,
} from '@/lib/adminNotifications';

interface NotificationState {
  items: AdminNotification[];
  unread: number;
  seenKey: string | null;
  /** Identify the current admin; seen-set lives in localStorage per email. */
  setSeenKey: (email: string | null) => void;
  /** Replace feed with a fresh snapshot; persist provided seen-set. */
  setFeed: (items: AdminNotification[], seen: string[]) => void;
  /** Mark every current item as read. */
  markAllRead: () => void;
  /** Mark specific ids as read. */
  markRead: (ids: string[]) => void;
  /** Clear feed + seen-set (admin logout / engine unmount). */
  reset: () => void;
}

/** Module-scope singleton: survives route changes (AdminLayout remounts per page). */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  seenKey: null,

  setSeenKey: (email) => {
    const key = email ? seenKeyFor(email) : null;
    // Read the persisted seen-set WITHOUT pruning — pruning must only happen
    // in setFeed where the active feed is known; pruning against an empty feed
    // here would wipe read state and re-toast everything after each reload.
    const stored = key ? loadSeenIds(key) : [];
    const items = get().items;
    set({ seenKey: key, unread: unreadCount(items, stored) });
  },

  setFeed: (items, seen) => {
    const { seenKey } = get();
    if (seenKey) {
      saveSeenIds(seenKey, pruneSeen(seen, items.map((n) => n.id)));
    }
    set({ items, unread: unreadCount(items, seen) });
  },

  markAllRead: () => {
    const { items, seenKey } = get();
    if (!seenKey) {
      return;
    }
    const ids = items.map((n) => n.id);
    saveSeenIds(seenKey, pruneSeen(ids, items.map((n) => n.id)));
    set({ unread: 0 });
  },

  markRead: (ids) => {
    const { seenKey, items } = get();
    if (!seenKey) {
      return;
    }
    const stored = loadSeenIds(seenKey);
    const next = [...new Set([...stored, ...ids])];
    saveSeenIds(seenKey, pruneSeen(next, items.map((n) => n.id)));
    set({ items, unread: unreadCount(items, next) });
  },

  reset: () => {
    const { seenKey } = get();
    if (seenKey) {
      saveSeenIds(seenKey, []);
    }
    set({ items: [], unread: 0, seenKey: null });
  },
}));
