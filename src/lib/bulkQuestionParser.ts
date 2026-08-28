/**
 * Bulk MCQ question parser for the admin "Bulk Import Questions" modal.
 *
 * Both an empty line (one or more) and a `---` line separate questions.
 * Fields are matched by their key prefix (Q/A/B/C/D/ANS/MARKS) anywhere in a
 * question block, so a trailing `MARKS:` that follows a blank line but belongs
 * to the preceding question (no `Q:` in its own segment) is attached to the
 * previous question — keyed-field association over strict positional parsing.
 *
 * Tolerant of `\r\n`, trailing whitespace, whitespace-only lines, and
 * malformed/orphaned fragments (no `Q:` → ignored or merged into the previous
 * question, never a broken new question). Full Unicode/Bangla text is intact
 * (we split on lines/keys, never on bytes).
 */

export interface ParsedBulkQuestion {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: 'A' | 'B' | 'C' | 'D';
  marks: number;
}

const KEY_RE = /^([A-Z]+):\s*(.*)$/; // keyed line, e.g. "ANS: B"
const Q_RE = /^Q:\s*/;
const VALID_ANS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D']);
const SEPARATOR_RE = /^\s*-{3,}\s*$/; // "---" (or more) line

export interface ParseOptions {
  /** id factory so tests can inject deterministic ids. */
  nextId?: () => string;
}

const defaultNextId = () => crypto.randomUUID();

/**
 * Split raw pasted text into per-question field maps.
 * A "segment" is a run of non-separator lines; segments containing a `Q:`
 * start a new question, segments without one (e.g. an orphaned `MARKS:`)
 * merge into the pending question.
 */
export function parseBulkQuestions(text: string, opts: ParseOptions = {}): ParsedBulkQuestion[] {
  const nextId = opts.nextId ?? defaultNextId;
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const segments: string[][] = [];
  let current: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === '' || SEPARATOR_RE.test(line)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    segments.push(current);
  }

  const out: ParsedBulkQuestion[] = [];
  let pending: Partial<ParsedBulkQuestion> | null = null;

  const flush = () => {
    if (pending && (pending.question_text ?? '').trim()) {
      out.push({
        id: pending.id ?? nextId(),
        question_text: pending.question_text ?? '',
        option_a: pending.option_a ?? '',
        option_b: pending.option_b ?? '',
        option_c: pending.option_c ?? '',
        option_d: pending.option_d ?? '',
        correct_option: pending.correct_option ?? 'A',
        marks: pending.marks ?? 1,
      });
    }
    pending = null;
  };

  for (const segment of segments) {
    if (segment.length === 0) {
      continue;
    }
    const hasQ = segment.some((l) => Q_RE.test(l));
    if (hasQ && pending) {
      flush();
    }
    if (hasQ) {
      pending = { id: nextId() };
    }
    if (!pending) {
      // Orphaned fragment before any question — skip.
      continue;
    }

    for (const line of segment) {
      const m = line.match(KEY_RE);
      if (!m) {
        continue;
      }
      const key = m[1] as string;
      const value = m[2].trim();
      if (key === 'Q') {
        pending.question_text = value;
      } else if (key === 'A') {
        pending.option_a = value;
      } else if (key === 'B') {
        pending.option_b = value;
      } else if (key === 'C') {
        pending.option_c = value;
      } else if (key === 'D') {
        pending.option_d = value;
      } else if (key === 'ANS') {
        const ans = value.toUpperCase();
        pending.correct_option = (VALID_ANS.has(ans) ? ans : 'A') as 'A' | 'B' | 'C' | 'D';
      } else if (key === 'MARKS') {
        const n = Number(value);
        pending.marks = Number.isFinite(n) && n > 0 ? n : 1;
      }
      // Unknown keys are ignored, preserving the block layout.
    }
  }
  flush();

  return out;
}
