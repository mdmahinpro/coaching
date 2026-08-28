import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/utils/errorHandler';

// Shared student-ID generator. Format (Short + Code + Year + Seq):
//   shortName  – coaching short name from site_settings.coaching_short_name (e.g. 'TLY')
//   batchCode  – batches.code (e.g. 'Q' for the Quantum batch)
//   year       – 2-digit current year (e.g. '26')
//   seq        – 3-digit per-prefix counter (e.g. 001)
// Yields e.g. "TLYQ26001". Falls back to shortName+year+seq when a batch has no code.

export interface StudentIdParts {
  shortName?: string;
  batchCode?: string;
  year?: string;
}

const DEFAULT_SHORT_NAME = 'TLY';

export function currentYear2(): string {
  return new Date().getFullYear().toString().slice(-2);
}

export function buildStudentId(
  shortName: string,
  batchCode: string,
  year: string,
  seq: number
): string {
  return `${shortName}${batchCode}${year}${String(seq).padStart(3, '0')}`;
}

/** Sanitize each part to [A-Z0-9] so IDs are always URL/constant-safe. */
function sanitizePart(v: string | undefined, fallback: string): string {
  const s = (v ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return s || fallback;
}

/**
 * Generate the next unique student ID for the given prefix.
 * Scans the highest existing numeric suffix and increments; retries a few
 * times to stay unique under concurrent inserts; falls back to a
 * timestamp-based suffix if the scan/insert races.
 */
export async function generateStudentId(parts: StudentIdParts = {}): Promise<string> {
  const year = sanitizePart(parts.year, currentYear2());
  const short = sanitizePart(parts.shortName, DEFAULT_SHORT_NAME);
  const code = sanitizePart(parts.batchCode, '');
  const prefix = `${short}${code}${year}`;

  let seq = 1;
  try {
    const { data } = await supabase
      .from('students')
      .select('student_id')
      .ilike('student_id', `${prefix}%`)
      .order('student_id', { ascending: false })
      .limit(1);
    const last = data?.[0]?.student_id;
    if (last) {
      const tail = last.slice(prefix.length).match(/^\d+/);
      seq = (tail ? Number(tail[0]) : 0) + 1;
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = buildStudentId(short, code, year, seq);
      const { data: existing } = await supabase
        .from('students')
        .select('id')
        .eq('student_id', candidate)
        .maybeSingle();
      if (!existing) {
        return candidate;
      }
      seq += 1;
    }
  } catch (err) {
    handleSupabaseError(err);
  }

  // Fallback: timestamp-based unique suffix scoped to the same prefix.
  return `${prefix}${Date.now().toString().slice(-4)}`;
}
