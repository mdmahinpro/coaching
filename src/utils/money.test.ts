import { describe, it, expect } from 'vitest';
import { calculateFinalAmount, daysOverdue, parseFeeNote } from '@/utils/money';

describe('calculateFinalAmount', () => {
  it('returns fee minus discount when discount is less than fee', () => {
    expect(calculateFinalAmount(1000, 300)).toBe(700);
  });

  it('returns 0 when discount equals fee', () => {
    expect(calculateFinalAmount(500, 500)).toBe(0);
  });

  it('returns 0 when discount exceeds fee (no negative fees)', () => {
    expect(calculateFinalAmount(300, 500)).toBe(0);
  });

  it('returns full fee when discount is 0', () => {
    expect(calculateFinalAmount(750, 0)).toBe(750);
  });

  it('treats non-finite feeAmount as 0', () => {
    expect(calculateFinalAmount(NaN, 100)).toBe(0);
    expect(calculateFinalAmount(Infinity, 100)).toBe(0);
  });

  it('treats negative discount as 0', () => {
    expect(calculateFinalAmount(500, -50)).toBe(500);
  });

  it('treats non-finite discount as 0', () => {
    expect(calculateFinalAmount(500, NaN)).toBe(500);
    expect(calculateFinalAmount(500, Infinity)).toBe(500);
  });

  it('handles decimal amounts', () => {
    expect(calculateFinalAmount(100.5, 30.25)).toBeCloseTo(70.25);
  });

  it('handles both values as 0', () => {
    expect(calculateFinalAmount(0, 0)).toBe(0);
  });
});

describe('daysOverdue', () => {
  it('returns 0 for null input', () => {
    expect(daysOverdue(null as any)).toBe(0);
  });

  it('returns 0 for undefined input', () => {
    expect(daysOverdue(undefined as any)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(daysOverdue('')).toBe(0);
  });

  it('returns 0 for non-string input', () => {
    expect(daysOverdue(123 as any)).toBe(0);
  });

  it('returns 0 for future dates (not yet overdue)', () => {
    const futureMonth = 'December 2099';
    const result = daysOverdue(futureMonth);
    expect(result).toBe(0);
  });

  it('returns a positive number for past dates', () => {
    const pastMonth = 'January 2020';
    const result = daysOverdue(pastMonth);
    expect(result).toBeGreaterThan(0);
  });

  it('calculates correctly for a known past month', () => {
    // January 2020 is well in the past; result should be a large positive number
    const result = daysOverdue('January 2020');
    // Approx: 2026-08 - 2020-01 = ~6.5 years in days
    expect(result).toBeGreaterThan(2000);
    expect(result).toBeLessThan(3000);
  });
});

describe('parseFeeNote', () => {
  it('returns empty object for null', () => {
    expect(parseFeeNote(null)).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(parseFeeNote(undefined)).toEqual({});
  });

  it('returns empty object for empty string', () => {
    expect(parseFeeNote('')).toEqual({});
  });

  it('parses valid JSON', () => {
    expect(parseFeeNote('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('returns empty object for invalid JSON', () => {
    expect(parseFeeNote('not json')).toEqual({});
  });

  it('returns empty object for empty object string', () => {
    expect(parseFeeNote('{}')).toEqual({});
  });

  it('parses nested objects', () => {
    const note = '{"payment":{"method":"cash","txn_id":"abc"}}';
    expect(parseFeeNote(note)).toEqual({ payment: { method: 'cash', txn_id: 'abc' } });
  });

  it('parses arrays in JSON', () => {
    const note = '{"items":[1,2,3]}';
    expect(parseFeeNote(note)).toEqual({ items: [1, 2, 3] });
  });
});
