/**
 * Parser for the exam "Bulk Import Questions" textarea.
 *
 * Teachers paste blocks in this shape:
 *
 *   Q: বাংলাদেশের জাতীয় পশুর নাম কি?
 *   A: সিংহ
 *   B: রয়েল বেঙ্গল টাইগার
 *   C: হরিণ
 *   D: হাতি
 *   ANS: B
 *   MARKS: 1
 *
 * Question boundaries: a blank line, a `---` separator line, or the next `Q:`
 * line — whichever comes first. The original parser only split on `---`, so a
 * paste that separated questions with a blank line collapsed into a single
 * block and only the first question survived.
 */

export interface ParsedBulkQuestion {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: 'A' | 'B' | 'C' | 'D';
  marks: number;
}

/** `Q:` / `Q :` / `Q：` — the full-width colon shows up in Bengali keyboards. */
const Q_LINE = /^\s*Q\s*[:：]/i;
/** A standalone `---` (three or more dashes) on its own line. */
const DASH_SEPARATOR = /^\s*-{3,}\s*$/;

/**
 * Reads `PREFIX: value` from a block. Tolerates spaces around the colon, a
 * full-width colon, and case differences.
 */
function readField(block: string, ...prefixes: string[]): string {
  for (const prefix of prefixes) {
    const m = block.match(new RegExp(`^\\s*${prefix}\\s*[:：]\\s*(.+)$`, 'im'));
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

/** Splits the pasted text into one block per question. */
export function splitBulkBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const block = current.join('\n').trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (DASH_SEPARATOR.test(line)) {
      flush();
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A new `Q:` line always starts a new question, so pastes without blank
    // lines between questions still import every one of them.
    if (Q_LINE.test(line) && current.length) flush();
    current.push(line);
  }
  flush();
  return blocks;
}

export function parseBulkQuestions(text: string): ParsedBulkQuestion[] {
  const out: ParsedBulkQuestion[] = [];
  for (const block of splitBulkBlocks(text)) {
    const question_text = readField(block, 'Q', 'QUESTION');
    if (!question_text) continue;
    const answer = readField(block, 'ANS', 'ANSWER', 'CORRECT').toUpperCase();
    out.push({
      question_text,
      option_a: readField(block, 'A'),
      option_b: readField(block, 'B'),
      option_c: readField(block, 'C'),
      option_d: readField(block, 'D'),
      correct_option: (['A', 'B', 'C', 'D'] as const).includes(answer as 'A')
        ? (answer as 'A' | 'B' | 'C' | 'D')
        : 'A',
      marks: Number(readField(block, 'MARKS', 'MARK')) || 1,
    });
  }
  return out;
}
