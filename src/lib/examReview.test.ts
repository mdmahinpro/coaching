import { describe, it, expect } from 'vitest';
import { resolveAnswer, resolveAll } from './examReview';
import type { ReviewQuestion } from './examReview';

const q: ReviewQuestion = {
  id: 'q1',
  question_text: 'What is 2+2?',
  option_a: '3',
  option_b: '4',
  option_c: '5',
  option_d: '6',
  correct_option: 'b',
  marks: 5,
};

describe('resolveAnswer', () => {
  it('maps correct answer to letter + option text', () => {
    const r = resolveAnswer(q, { q1: 'b' }, 0);
    expect(r.isRight).toBe(true);
    expect(r.selectedLetter).toBe('B');
    expect(r.selectedText).toBe('4'); // option_b
    expect(r.correctLetter).toBe('B');
    expect(r.correctText).toBe('4');
    expect(r.unanswered).toBe(false);
  });

  it('distinguishes a wrong answer, still shows the correct text', () => {
    const r = resolveAnswer(q, { q1: 'a' }, 0);
    expect(r.isRight).toBe(false);
    expect(r.selectedText).toBe('3'); // option_a
    expect(r.correctText).toBe('4'); // correct answer text
    expect(r.unanswered).toBe(false);
  });

  it('handles unanswered questions', () => {
    const r = resolveAnswer(q, {}, 0);
    expect(r.unanswered).toBe(true);
    expect(r.selectedLetter).toBeNull();
    expect(r.selectedText).toBeNull();
    expect(r.correctText).toBe('4');
    expect(r.isRight).toBe(false);
  });

  it('falls back to the index key for legacy answer payloads', () => {
    const r = resolveAnswer(q, { '0': 'c' }, 0);
    expect(r.selectedLetter).toBe('C');
    expect(r.selectedText).toBe('5');
  });

  it('carries the explanation when present', () => {
    const r = resolveAnswer({ ...q, explanation: 'Because 2+2=4' }, { q1: 'b' }, 0);
    expect(r.explanation).toBe('Because 2+2=4');
  });

  it('normalises a lowercase DB correct_option to uppercase letter', () => {
    const r = resolveAnswer(q, { q1: 'B' }, 0);
    expect(r.correctLetter).toBe('B');
    expect(r.isRight).toBe(true);
  });
});

describe('resolveAll', () => {
  it('resolves every question in order', () => {
    const q2: ReviewQuestion = {
      id: 'q2',
      question_text: 'Capital of France?',
      option_a: 'London',
      option_b: 'Paris',
      option_c: 'Rome',
      option_d: 'Berlin',
      correct_option: 'b',
    };
    const out = resolveAll([q, q2], { q2: 'b' });
    expect(out).toHaveLength(2);
    expect(out[0].selectedText).toBeNull(); // unanswered q1
    expect(out[1].selectedText).toBe('Paris');
  });
});