import { describe, it, expect } from 'vitest';
import { isExamForBatch, classLevelList } from './utils';

describe('classLevelList', () => {
  it('splits a comma-separated string into trimmed, non-empty entries', () => {
    expect(classLevelList('Class 6,  Class 8,SSC,')).toEqual(['Class 6', 'Class 8', 'SSC']);
  });

  it('handles empty / whitespace-only / null-ish input', () => {
    expect(classLevelList('')).toEqual([]);
    expect(classLevelList('   , ,')).toEqual([]);
    expect(classLevelList(undefined as unknown as string)).toEqual([]);
  });

  it('returns single entry for a singleton list', () => {
    expect(classLevelList('HSC')).toEqual(['HSC']);
  });
});

describe('isExamForBatch (strict per-batch scoping)', () => {
  it('shows nothing when the exam targets no batch (unassigned = hidden)', () => {
    expect(isExamForBatch({ batch_ids: null, batch_id: null }, 'b1')).toBe(false);
    expect(isExamForBatch({ batch_ids: [], batch_id: null }, 'b1')).toBe(false);
    expect(isExamForBatch({ batch_ids: null, batch_id: null }, undefined)).toBe(false);
  });

  it('prefers batch_ids over the legacy batch_id when both are set', () => {
    expect(isExamForBatch({ batch_ids: ['b1'], batch_id: 'b2' }, 'b2')).toBe(false);
    expect(isExamForBatch({ batch_ids: ['b1'], batch_id: 'b2' }, 'b1')).toBe(true);
  });

  it('falls back to legacy batch_id when batch_ids is empty/null', () => {
    expect(isExamForBatch({ batch_ids: null, batch_id: 'b1' }, 'b1')).toBe(true);
    expect(isExamForBatch({ batch_ids: [], batch_id: 'b1' }, 'b2')).toBe(false);
  });

  it('shows nothing to a student with no batch', () => {
    expect(isExamForBatch({ batch_ids: ['b1'], batch_id: 'b1' }, undefined)).toBe(false);
    expect(isExamForBatch({ batch_ids: null, batch_id: 'b1' }, null)).toBe(false);
    expect(isExamForBatch({ batch_ids: null, batch_id: null }, null)).toBe(false);
  });
});
