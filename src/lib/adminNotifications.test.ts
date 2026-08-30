import { describe, it, expect } from 'vitest';
import {
  diffNewItems,
  loadSeenIds,
  saveSeenIds,
  pruneSeen,
  unreadCount,
  timeAgo,
  seenKeyFor,
} from './adminNotifications';
import type { AdminNotification } from './adminNotifications';

const n = (id: string, createdAt = '2026-08-30T10:00:00Z'): AdminNotification => ({
  id,
  kind: 'admission',
  title: id,
  sub: '',
  createdAt,
  link: '/admin/admissions',
});

describe('diffNewItems', () => {
  it('returns items present in curr but not prev (by id)', () => {
    const prev = [n('a'), n('b')];
    const curr = [n('a'), n('b'), n('c'), n('d')];
    const fresh = diffNewItems(prev, curr);
    expect(fresh.map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('returns nothing when no new ids appear', () => {
    expect(diffNewItems([n('a')], [n('a')])).toEqual([]);
    expect(diffNewItems([], [])).toEqual([]);
  });

  it('returns all current items when prev is empty', () => {
    const curr = [n('x')];
    expect(diffNewItems([], curr).map((x) => x.id)).toEqual(['x']);
  });
});

describe('seen-set (localStorage)', () => {
  const KEY = seenKeyFor('Admin@Test.com'); // email lowercased in key
  it('round-trips through localStorage', () => {
    localStorage.setItem(KEY, JSON.stringify(['a', 'b']));
    expect(loadSeenIds(KEY)).toEqual(['a', 'b']);
    saveSeenIds(KEY, ['b', 'c']);
    expect(loadSeenIds(KEY)).toEqual(['b', 'c']);
  });

  it('tolerates corrupt JSON / non-array shapes', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadSeenIds(KEY)).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(loadSeenIds(KEY)).toEqual([]);
  });
});

describe('pruneSeen', () => {
  it('drops ids no longer in the active feed', () => {
    expect(pruneSeen(['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', 'c']);
  });

  it('caps the stored set', () => {
    const seen = Array.from({ length: 300 }, (_, i) => `id-${i}`);
    const active = seen.slice(0, 300);
    const pruned = pruneSeen(seen, active);
    expect(pruned.length).toBeLessThanOrEqual(200);
  });
});

describe('unreadCount', () => {
  it('counts items not in the seen set', () => {
    const items = [n('a'), n('b'), n('c')];
    expect(unreadCount(items, ['a'])).toBe(2);
    expect(unreadCount(items, [])).toBe(3);
    expect(unreadCount(items, ['a', 'b', 'c'])).toBe(0);
  });
});

describe('timeAgo', () => {
  it('returns a label for recent/old timestamps', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 5000).toISOString())).toContain('এখনই');
    expect(timeAgo(new Date(now - 5 * 60000).toISOString())).toBe('5 মিনিট আগে');
    expect(timeAgo(new Date(now - 3 * 3600000).toISOString())).toBe('3 ঘণ্টা আগে');
    expect(timeAgo(new Date(now - 2 * 86400000).toISOString())).toBe('2 দিন আগে');
  });

  it('is empty for invalid timestamps', () => {
    expect(timeAgo('not-a-date')).toBe('');
  });
});
