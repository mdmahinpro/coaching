import { supabase } from '@/lib/supabase';
import { sanitize, formatCurrency } from '@/lib/utils';

/**
 * Admin notification feed.
 *
 * Deliberately derived (no table/triggers/RLS/realtime): the two "work
 * queues" the admin acts on already exist as pending rows —
 *   • student signup  → `admission_requests` with status='pending'
 *   • new payment     → `payment_approvals` with status='pending'
 * The bell groups these, diffs them on each poll, and toasts new items.
 * Because approving/rejecting only REMOVES items from the feed, the admin's
 * own actions never toast back to them.
 */

export type NotificationKind = 'admission' | 'payment';

export interface AdminNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  sub: string;
  createdAt: string;
  link: string;
}

export const NOTIFICATIONS_LS_PREFIX = 'coaching-center-notif-seen-';
export const NOTIFICATIONS_MAX = 8;
export const NOTIFICATIONS_SEEN_CAP = 200;

/** Fetch the merged pending feed (top N admission + payment items). */
export async function fetchNotificationSnapshot(): Promise<AdminNotification[]> {
  const [admins, payments] = await Promise.all([
    supabase
      .from('admission_requests')
      .select('id, name, phone, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(NOTIFICATIONS_MAX),
    supabase.rpc('admin_payment_approvals', { p_status: 'pending' }),
  ]);

  const admissionItems: AdminNotification[] = (admins.data ?? []).map((a: any) => ({
    id: `adm-${a.id}`,
    kind: 'admission',
    title: `নতুন ভর্তি আবেদন: ${sanitize(a.name ?? '')}`,
    sub: a.phone ?? '',
    createdAt: a.created_at ?? new Date().toISOString(),
    link: '/admin/admissions',
  }));

  const paymentItems: AdminNotification[] = ((payments.data ?? []) as any[])
    .slice(0, NOTIFICATIONS_MAX)
    .map((p: any) => ({
      id: `pay-${p.id}`,
      kind: 'payment',
      title: `নতুন পেমেন্ট অনুমোদন: ${sanitize(p.student_name ?? '')}`,
      sub: [p.month, p.amount ? formatCurrency(p.amount) : null, p.method]
        .filter(Boolean)
        .join(' · '),
      createdAt: p.created_at ?? new Date().toISOString(),
      link: '/admin/fees?tab=approvals',
    }));

  return [...admissionItems, ...paymentItems]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, NOTIFICATIONS_MAX);
}

/** Items present in `curr` that were not in `prev` (by id). */
export function diffNewItems(
  prev: AdminNotification[],
  curr: AdminNotification[]
): AdminNotification[] {
  const prevIds = new Set(prev.map((n) => n.id));
  return curr.filter((n) => !prevIds.has(n.id));
}

/** localStorage seen-set accessors (per admin email). */
export function seenKeyFor(email: string): string {
  return `${NOTIFICATIONS_LS_PREFIX}${(email ?? '').trim().toLowerCase()}`;
}

export function loadSeenIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveSeenIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* storage unavailable — badge just resets next poll */
  }
}

/** Drop ids no longer in the active feed; cap total size. */
export function pruneSeen(seen: string[], activeIds: string[]): string[] {
  const active = new Set(activeIds);
  const kept = seen.filter((id) => active.has(id));
  return kept.slice(0, NOTIFICATIONS_SEEN_CAP);
}

export function unreadCount(items: AdminNotification[], seen: string[]): number {
  const seenSet = new Set(seen);
  return items.filter((n) => !seenSet.has(n.id)).length;
}

/** Compact Bengali/English relative-time label. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return '';
  }
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) {
    return 'এখনই';
  }
  if (m < 60) {
    return `${m} মিনিট আগে`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h} ঘণ্টা আগে`;
  }
  const d = Math.floor(h / 24);
  return `${d} দিন আগে`;
}
