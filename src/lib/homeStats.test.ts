import { describe, it, expect } from 'vitest';
import { resolveHomeStats } from './homeStats';

const SET = {
  statStudents: 100,
  statTeachers: 7,
  statBatches: 5,
  statSuccessRate: 95,
};

describe('resolveHomeStats', () => {
  it('uses live DB counts when auto-from-DB is on', () => {
    const r = resolveHomeStats({ students: 42, teachers: 3, batches: 9 }, true, SET);
    expect(r.students).toBe(42);
    expect(r.teachers).toBe(3);
    expect(r.batches).toBe(9);
    expect(r.successRate).toBe(95); // always from settings
    expect(r.usedFromDb).toBe(true);
  });

  it('falls back to 0s (never undefined) when counts absent and auto is on', () => {
    const r = resolveHomeStats(null, true, SET);
    expect(r).toEqual({ students: 0, teachers: 0, batches: 0, successRate: 95, usedFromDb: true });
  });

  it('uses admin-entered values when auto is off, ignoring counts', () => {
    const r = resolveHomeStats({ students: 999, teachers: 99, batches: 99 }, false, SET);
    expect(r.students).toBe(100);
    expect(r.teachers).toBe(7);
    expect(r.batches).toBe(5);
    expect(r.successRate).toBe(95);
    expect(r.usedFromDb).toBe(false);
  });

  it('is boolean-agnostic: never mutates/hides based on a show flag', () => {
    // visibility (showHomeStats) is a render concern in HeroSection; this
    // helper just resolves numbers regardless of any show flag.
    const r = resolveHomeStats({ students: 1, teachers: 1, batches: 1 }, true, SET);
    expect(r.students).toBe(1);
    expect(typeof r.usedFromDb).toBe('boolean');
  });
});