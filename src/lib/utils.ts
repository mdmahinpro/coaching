import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { sanitize } from '@/utils/sanitize';

export { sanitize };

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
