import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllExamDrafts, loadExamDraft, saveExamDraft } from './examRecovery';

describe('exam draft recovery', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips only for the same exam and UUID student identity', () => {
    saveExamDraft('exam-a', 'uuid-a', { q1: 'B' }, 1000);
    expect(loadExamDraft('exam-a', 'uuid-a', new Set(['q1']), 2000)).toEqual({ q1: 'B' });
    expect(loadExamDraft('exam-a', 'uuid-b', new Set(['q1']), 2000)).toBeNull();
    expect(loadExamDraft('exam-b', 'uuid-a', new Set(['q1']), 2000)).toBeNull();
  });

  it('drops stale, malformed, and unknown-question answers', () => {
    saveExamDraft('exam-a', 'uuid-a', { q1: 'B', stale: 'C', invalid: 'X' }, 1000);
    expect(loadExamDraft('exam-a', 'uuid-a', new Set(['q1']), 1000 + 24 * 60 * 60 * 1000 + 1)).toBeNull();
    saveExamDraft('exam-a', 'uuid-a', { q1: 'B', stale: 'C', invalid: 'X' }, 1000);
    expect(loadExamDraft('exam-a', 'uuid-a', new Set(['q1']), 2000)).toEqual({ q1: 'B' });
  });

  it('clears all drafts on account logout', () => {
    saveExamDraft('exam-a', 'uuid-a', { q1: 'A' });
    saveExamDraft('exam-b', 'uuid-b', { q2: 'D' });
    clearAllExamDrafts();
    expect(localStorage.length).toBe(0);
  });
});
