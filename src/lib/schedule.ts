/**
 * Batch schedule formatting — one canonical place to turn a batch row's
 * schedule fields into the short human label every card uses.
 *
 * The batches table carries BOTH:
 *   • structured fields: `schedule_days` (string[]), `start_time`, `end_time`, and
 *   • a legacy free-text `schedule` column (e.g. "Sat-Thu 8:00-9:30 AM") written
 *     before the structured fields existed.
 * Old rows only have the free-text; new rows are edited via the structured
 * fields. Cards should show the structured values when present and fall back
 * to the legacy text otherwise, so nothing ever renders blank.
 */

export interface BatchScheduleLike {
  schedule_days?: unknown;
  start_time?: string | null;
  /** Legacy form-side alias of `start_time` (some flows still carry it). */
  schedule_time?: string | null;
  end_time?: string | null;
  schedule?: string | null;
}

/** Coerce the raw `schedule_days` column into a clean string list. */
export function batchDayList(b: BatchScheduleLike): string[] {
  const d = b.schedule_days;
  if (!Array.isArray(d)) return [];
  return d
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x.length > 0);
}

/**
 * Render a DB time ("09:30", "17:00", possibly with seconds) as 12-hour
 * "9:30 AM" / "5:00 PM". Non-time input passes through trimmed.
 */
export function formatTimeText(t?: string | null): string {
  if (!t) return '';
  const raw = t.trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return raw;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (h > 23) return raw; // not a time — leave untouched
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${period}`;
}

/** "9:30 AM – 11:00 AM" (either side alone is fine, both shown when present). */
export function formatTimeRange(start?: string | null, end?: string | null): string {
  const s = formatTimeText(start);
  const e = formatTimeText(end);
  if (s && e) return `${s} – ${e}`;
  return s || e;
}

/**
 * The schedule label for a batch card.
 * Priority: structured days + time range → legacy free-text `schedule`.
 */
export function formatBatchSchedule(b: BatchScheduleLike): string {
  const days = batchDayList(b);
  const start = b.start_time ?? b.schedule_time ?? null;
  const end = b.end_time ?? null;

  const parts: string[] = [];
  if (days.length > 0) parts.push(days.join('/'));
  const range = formatTimeRange(start, end);
  if (range) parts.push(range);

  if (parts.length > 0) return parts.join(' · ');
  return (b.schedule ?? '').trim();
}