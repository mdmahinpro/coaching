import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { sanitize } from '@/utils/sanitize';

export { sanitize };

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Apply the admin-selected accent to the shared CSS theme tokens. */
export function applyThemeColor(value: string, buttonStyle: 'solid' | 'outline' | 'glass' = 'solid'): void {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : '#38bdf8';
  const channels = color
    .slice(1)
    .match(/.{2}/g)!
    .map((part) => parseInt(part, 16));
  const rgb = channels.join(', ');
  const luminance = (0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2]) / 255;
  const root = document.documentElement;
  root.style.setProperty('--primary', color);
  root.style.setProperty('--primary-rgb', rgb);
  root.style.setProperty('--primary-soft', `rgba(${rgb}, 0.14)`);
  root.style.setProperty('--primary-border', `rgba(${rgb}, 0.42)`);
  root.style.setProperty('--primary-glow', `rgba(${rgb}, 0.34)`);
  root.style.setProperty('--primary-ink', luminance > 0.67 ? '#07111f' : '#ffffff');
  root.dataset.buttonStyle = buttonStyle;
  // Tailwind's sky tokens are the app's existing accent utilities. Rebinding
  // them keeps legacy utility classes responsive to the Appearance setting.
  root.style.setProperty('--color-sky-400', color);
  root.style.setProperty('--color-sky-500', color);
  root.style.setProperty('--color-sky-600', color);
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatCurrency(amount: number): string {
  return '৳' + new Intl.NumberFormat('en-US').format(amount);
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

export function truncate(str: string, length: number): string {
  return str.length > length ? str.slice(0, length) + '…' : str;
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Split the comma-separated class-levels setting (শ্রেণী) into a clean list
 * for <option> rendering. Drops empties + whitespace. Same source used by the
 * admission forms and the admin student modal, so class level is always one
 * managed list (editable in Settings → Class Levels).
 */
export function classLevelList(classLevels: string): string[] {
  return (classLevels ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Keep the browser-tab favicon in sync with the active site logo so the two
 * always match. Replaces the <link rel="icon"> href (creating it if missing).
 */
export function applyFavicon(urlOrFallback: string): void {
  const href = urlOrFallback || '/favicon.svg';
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) {
    link.setAttribute('href', href);
  }
}

/**
 * Strict client-side batch scoping for exams (defense-in-depth on top of
 * portal_get_exams). A student can see an exam ONLY when it targets their
 * batch: `batch_ids` is authoritative, `batch_id` is the legacy single-batch
 * fallback. An exam with NO batch target at all is considered unassigned and
 * is shown to no student — it must never leak into every portal.
 */
export function isExamForBatch(
  exam: { batch_ids?: string[] | null; batch_id?: string | null },
  batchId?: string | null
): boolean {
  if (!batchId) {
    return false; // student has no batch → nothing that targets batches
  }
  const target =
    exam.batch_ids && exam.batch_ids.length > 0
      ? exam.batch_ids
      : exam.batch_id
        ? [exam.batch_id]
        : null;
  if (!target) {
    return false; // unassigned exam → hidden from every student
  }
  return target.includes(batchId);
}
