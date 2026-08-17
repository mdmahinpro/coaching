/**
 * Fee calculation helpers — pure functions extracted from FeesPage
 * so they can be unit-tested without a React component.
 */

/**
 * Calculate the final payable amount after discount.
 * Never goes below zero (business rule: no negative fees).
 *
 * @param feeAmount - Original fee amount before discount
 * @param discount  - Discount to subtract (must be >= 0)
 * @returns Final amount (feeAmount - discount, floored at 0)
 */
export function calculateFinalAmount(feeAmount: number, discount: number): number {
  const safeFee = Number.isFinite(feeAmount) ? feeAmount : 0;
  const safeDiscount = Number.isFinite(discount) ? Math.max(0, discount) : 0;
  return Math.max(0, safeFee - safeDiscount);
}

/**
 * Calculate how many days a given month is overdue as of today.
 * A fee is considered overdue after the last day of its month + 1 day.
 *
 * @param month - Month string in "MonthName Year" format, e.g. "January 2025"
 * @returns Number of days overdue (0 if not yet overdue or invalid)
 */
export function daysOverdue(month: string): number {
  if (!month || typeof month !== 'string') {
    return 0;
  }
  try {
    const d = new Date(month + ' 01');
    // Due date is the last day of the month + 1 (overdue starts the day after month ends)
    d.setMonth(d.getMonth() + 1, 0);
    const diff = Date.now() - d.getTime();
    return Math.max(0, Math.floor(diff / 86400000));
  } catch {
    return 0;
  }
}

/**
 * Safely parse the `note` JSONB column from the fees table.
 * Falls back to an empty object if the value is null or invalid JSON.
 *
 * @param note - Raw note string from the database (JSONB stored as text)
 * @returns Parsed object or empty object
 */
export function parseFeeNote(note: string | null | undefined): Record<string, unknown> {
  if (!note) {
    return {};
  }
  try {
    return JSON.parse(note) as Record<string, unknown>;
  } catch {
    return {};
  }
}
