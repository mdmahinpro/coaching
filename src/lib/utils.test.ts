import { describe, it, expect } from 'vitest';
import { isExamForBatch } from './utils';

describe('isExamForBatch', () => {
  it('returns true when the exam targets no batch (all batches)', () => {
    expect(isExamForBatch({ batch_ids: null, batch_id: null }, 'b1')).toBe(true);
    expect(isExamForBatch({ batch_ids: [], batch_id: null }, 'b1')).toBe(true);
    expect(isExamForBatch({ batch_ids: null, batch_id: null }, undefined)).toBe(true);
  });

  it('prefers batch_ids over the legacy batch_id when both are set', () => {
    // batch_ids is authoritative; batch_id is only a back-compat fallback.
    expect(isExamForBatch({ batch_ids: ['b1'], batch_id: 'b2' }, 'b2')).toBe(false);
    expect(isExamForBatch({ batch_ids: ['b1'], batch_id: 'b2' }, 'b1')).toBe(true);
  });

  it('falls back to legacy batch_id when batch_ids is empty/null', () => {
    expect(isExamForBatch({ batch_ids: null, batch_id: 'b1' }, 'b1')).toBe(true);
    expect(isExamForBatch({ batch_ids: [], batch_id: 'b1' }, 'b2')).toBe(false);
  });

  it('shows nothing to a student with no batch when the exam targets batches', () => {
    expect(isExamForBatch({ batch_ids: ['b1'], batch_id: 'b1' }, undefined)).toBe(false);
    expect(isExamForBatch({ batch_ids: null, batch_id: 'b1' }, null)).toBe(false);
  });
});
