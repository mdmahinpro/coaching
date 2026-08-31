import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationStore } from './useNotificationStore';
import { seenKeyFor, loadSeenIds } from '@/lib/adminNotifications';
import type { AdminNotification } from '@/lib/adminNotifications';

const n = (id: string): AdminNotification => ({
  id,
  kind: 'admission',
  title: id,
  sub: '',
  createdAt: '2026-08-31T10:00:00Z',
  link: '/admin/admissions',
});

const KEY = seenKeyFor('notify-test@example.com');

beforeEach(() => {
  localStorage.clear();
  useNotificationStore.setState({ items: [], unread: 0, seenKey: null });
});

describe('notification unread stays unread until opened', () => {
  it('setFeed with an empty seen-set keeps new items UNREAD', () => {
    useNotificationStore.setState({ seenKey: KEY });
    // A new signup appears; sync passes the persisted seen-set (empty) unchanged.
    useNotificationStore.getState().setFeed([n('adm-new')], []);

    expect(useNotificationStore.getState().unread).toBe(1);
    // The new id must NOT be persisted to the seen-set (so it stays unread).
    expect(loadSeenIds(KEY)).toEqual([]);
  });

  it('markRead clears the read state for the given ids', () => {
    useNotificationStore.setState({ seenKey: KEY });
    useNotificationStore.getState().setFeed([n('adm-new')], []);

    expect(useNotificationStore.getState().unread).toBe(1);
    useNotificationStore.getState().markRead(['adm-new']);
    expect(useNotificationStore.getState().unread).toBe(0);
    expect(loadSeenIds(KEY)).toContain('adm-new');
  });

  it('previously-read items are not re-counted as unread', () => {
    useNotificationStore.setState({ seenKey: KEY });
    // The old item is on screen and the admin opens it → marked read + persisted.
    useNotificationStore.getState().setFeed([n('adm-old')], []);
    useNotificationStore.getState().markRead(['adm-old']);
    expect(useNotificationStore.getState().unread).toBe(0);
    expect(loadSeenIds(KEY)).toContain('adm-old');

    // A NEW item arrives; sync passes the persisted seen-set (contains adm-old).
    useNotificationStore.getState().setFeed(
      [
        n('adm-new'), // not in seen-set → unread
        n('adm-old'), // in seen-set → read
      ],
      loadSeenIds(KEY)
    );
    expect(useNotificationStore.getState().unread).toBe(1);
    expect(loadSeenIds(KEY)).toContain('adm-old'); // read state preserved
    expect(loadSeenIds(KEY)).not.toContain('adm-new'); // new stays unread
  });
});