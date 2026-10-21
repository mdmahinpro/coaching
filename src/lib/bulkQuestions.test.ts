import { describe, expect, it } from 'vitest';
import { parseBulkQuestions, splitBulkBlocks } from './bulkQuestions';

const BLANK_LINE_PASTE = `Q: বাংলাদেশের জাতীয় পশুর নাম কি?
A: সিংহ
B: রয়েল বেঙ্গল টাইগার
C: হরিণ
D: হাতি
ANS: B
MARKS: 1


Q: সূর্য কোন দিকে উদিত হয়?
A: পূর্ব
B: পশ্চিম
C: উত্তর
D: দক্ষিণ
ANS: A
MARKS: 1
`;

const DASH_PASTE = `Q: one
A: a1
B: b1
C: c1
D: d1
ANS: A
---
Q: two
A: a2
B: b2
C: c2
D: d2
ANS: D
MARKS: 2`;

describe('splitBulkBlocks', () => {
  it('splits on blank lines', () => {
    expect(splitBulkBlocks(BLANK_LINE_PASTE)).toHaveLength(2);
  });

  it('splits on --- separators', () => {
    expect(splitBulkBlocks(DASH_PASTE)).toHaveLength(2);
  });

  it('splits on the next Q: line even without blank lines', () => {
    const dense = DASH_PASTE.replace(/\n---\n/g, '\n');
    expect(splitBulkBlocks(dense)).toHaveLength(2);
  });

  it('ignores leading/trailing blank lines', () => {
    expect(splitBulkBlocks('\n\n  \n' + DASH_PASTE + '\n\n')).toHaveLength(2);
  });
});

describe('parseBulkQuestions', () => {
  it('imports every question from a blank-line separated paste', () => {
    const qs = parseBulkQuestions(BLANK_LINE_PASTE);
    expect(qs).toHaveLength(2);
    expect(qs[0].question_text).toBe('বাংলাদেশের জাতীয় পশুর নাম কি?');
    expect(qs[0].option_b).toBe('রয়েল বেঙ্গল টাইগার');
    expect(qs[0].correct_option).toBe('B');
    expect(qs[1].question_text).toBe('সূর্য কোন দিকে উদিত হয়?');
    expect(qs[1].correct_option).toBe('A');
  });

  it('reads marks, defaulting to 1', () => {
    const qs = parseBulkQuestions(DASH_PASTE);
    expect(qs[0].marks).toBe(1);
    expect(qs[1].marks).toBe(2);
  });

  it('defaults the answer to A when missing and keeps case-insensitive keys', () => {
    const [q] = parseBulkQuestions('q: only\nA: a\nb: bee\nC: c\nD: d\nanswer: c');
    expect(q.question_text).toBe('only');
    expect(q.option_b).toBe('bee');
    expect(q.correct_option).toBe('C');
  });

  it('accepts a full-width colon and extra spacing', () => {
    const [q] = parseBulkQuestions('Q ： প্রশ্ন\nA ： ক\nB ： খ\nC ： গ\nD ： ঘ\nANS ： B');
    expect(q.question_text).toBe('প্রশ্ন');
    expect(q.option_a).toBe('ক');
    expect(q.correct_option).toBe('B');
  });

  it('drops blocks with no question text', () => {
    expect(parseBulkQuestions('A: orphan\nB: none')).toHaveLength(0);
  });
});
