import { describe, it, expect } from 'vitest';
import { parseBulkQuestions } from '@/lib/bulkQuestionParser';

// Deterministic ids for stability.
let n = 0;
const nextId = () => `q-${++n}`;

const reset = () => {
  n = 0;
};

describe('parseBulkQuestions', () => {
  it('parses questions separated by ---', () => {
    reset();
    const input = [
      'Q: ৫ × ১২ = কত?',
      'A: ৫০',
      'B: ৬০',
      'C: ৫৫',
      'D: ৬৫',
      'ANS: B',
      'MARKS: 3',
      '---',
      'Q: √১৪৪ = কত?',
      'A: ১১',
      'B: ১২',
      'C: ১৩',
      'D: ১৪',
      'ANS: B',
      'MARKS: 2',
    ].join('\n');

    const qs = parseBulkQuestions(input, { nextId });
    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ question_text: '৫ × ১২ = কত?', correct_option: 'B', marks: 3 });
    expect(qs[1]).toMatchObject({ question_text: '√১৪৪ = কত?', correct_option: 'B', marks: 2 });
  });

  it('parses questions separated by blank lines', () => {
    reset();
    const input = [
      'Q: প্রথম প্রশ্ন',
      'A: ক',
      'B: খ',
      'ANS: A',
      'MARKS: 1',
      '',
      '',
      'Q: দ্বিতীয় প্রশ্ন',
      'A: গ',
      'B: ঘ',
      'ANS: B',
      'MARKS: 1',
    ].join('\n');

    const qs = parseBulkQuestions(input, { nextId });
    expect(qs).toHaveLength(2);
    expect(qs[0].question_text).toBe('প্রথম প্রশ্ন');
    expect(qs[1].question_text).toBe('দ্বিতীয় প্রশ্ন');
  });

  it('handles mixed separators (--- and blank lines)', () => {
    reset();
    const input = [
      'Q: 하나',
      'A: 1',
      'B: 2',
      'ANS: A',
      '---',
      'Q: 둘',
      'A: 3',
      'B: 4',
      'ANS: B',
      '',
      'Q: 셋',
      'A: 5',
      'B: 6',
      'ANS: A',
    ].join('\n');

    const qs = parseBulkQuestions(input, { nextId });
    expect(qs).toHaveLength(3);
    expect(qs.map((q) => q.question_text)).toEqual(['하나', '둘', '셋']);
  });

  it('parses the exact reported sample as TWO questions with marks 1 and 1', () => {
    reset();
    const input = [
      'Q: নিচের কোনটি একটি ভার্চুয়াল অ্যাসিস্ট্যান্টের (Virtual Assistant) উদাহরণ?',
      'A: গুগল ক্রোম',
      'B: মাইক্রোসফট এক্সেল',
      'C: অ্যাপল সিরি',
      'D: অ্যাডোবি ফটোশপ',
      'ANS: C',
      '',
      'MARKS: 1',
      'Q: \'ডিপ লার্নিং\' (Deep Learning) মূলত কোন প্রযুক্তির একটি শাখা?',
      'A: ব্লকচেইন',
      'B: মেশিন লার্নিং',
      'C: ইন্টারনেট অফ থিংস',
      'D: কোয়ান্টাম কম্পিউটিং',
      'ANS: B',
      'MARKS: 1',
    ].join('\n');

    const qs = parseBulkQuestions(input, { nextId });
    expect(qs).toHaveLength(2);
    // The blank line separates the ANS: of Q1 from Q2's field group. The
    // post-blank segment includes Q2's `Q:`, so its leading `MARKS: 1` is
    // merged into that (Q2) question — both end up worth 1 mark, matching
    // the requested "2 questions with marks 1 and 1".
    expect(qs[0]).toMatchObject({ correct_option: 'C', marks: 1 });
    expect(qs[1]).toMatchObject({ correct_option: 'B', marks: 1 });
    expect(qs[1].question_text).toContain('ডিপ লার্নিং');
  });

  it('attaches an orphaned MARKS to the previous question', () => {
    reset();
    const input = [
      'Q: প্রান্তিক প্রশ্ন',
      'A: ক',
      'B: খ',
      'ANS: A',
      '',
      'MARKS: 4',
    ].join('\n');

    const qs = parseBulkQuestions(input, { nextId });
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ question_text: 'প্রান্তিক প্রশ্ন', marks: 4 });
  });

  it('skips malformed / orphaned fragments without Q:', () => {
    reset();
    const input = [
      'MARKS: 9',
      '',
      'A: কিছু',
      'B: কিছু',
      '',
      'Q: বৈধ প্রশ্ন',
      'A: ক',
      'B: খ',
      'ANS: B',
    ].join('\n');

    const qs = parseBulkQuestions(input, { nextId });
    expect(qs).toHaveLength(1);
    expect(qs[0].question_text).toBe('বৈধ প্রশ্ন');
  });

  it('is tolerant of CRLF and trailing whitespace', () => {
    reset();
    const input = [
      'Q: প্রথম  ',
      'A: ক  ',
      'B: খ',
      'ANS: a',
      'MARKS: 0', // invalid marks -> falls back to 1
      '',
      'Q: দ্বিতীয়',
      'A: গ',
      'B: ঘ',
      'ANS: B',
      'MARKS: 2',
    ].join('\r\n');

    const qs = parseBulkQuestions(input, { nextId });
    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ question_text: 'প্রথম', correct_option: 'A', marks: 1 });
    expect(qs[0].option_a).toBe('ক');
    expect(qs[1].marks).toBe(2);
  });
});
