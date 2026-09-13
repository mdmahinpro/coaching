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
    const r = resolveHomeStats(
      { ok: true, counts: { students: 42, teachers: 3, batches: 9 } },
      true,
      SET
    );
    expect(r.students).toBe(42);
    expect(r.teachers).toBe(3);
    expect(r.batches).toBe(9);
    expect(r.successRate).toBe(95); // always from settings
    expect(r.usedFromDb).toBe(true);
    expect(r.failed).toBe(false);
  });

  it('marks success after a confirmed empty aggregate (0 is honest)', () => {
    const r = resolveHomeStats(
      { ok: true, counts: { students: 0, teachers: 0, batches: 0 } },
      true,
      SET
    );
    expect(r.students).toBe(0);
    expect(r.failed).toBe(false);
  });

  it('tracks failure, not zero, when the fetch is unavailable via auto mode', () => {
    const r = resolveHomeStats({ ok: false }, true, SET);
    expect(r.students).toBe(0);
    expect(r.failed).toBe(true);
    expect(r.teachers).toBe(0);
    expect(r.batches).toBe(0);
  });

  it('falls back to 0s (never undefined) when skipped/null and auto is on', () => {
    const r = resolveHomeStats(null, true, SET);
    expect(r).toEqual({
      students: 0,
      teachers: 0,
      batches: 0,
      successRate: 95,
      usedFromDb: true,
      failed: true,
    });
  });

  it('uses admin-entered values when auto is off, ignoring counts', () => {
    const r = resolveHomeStats(
      { ok: true, counts: { students: 999, teachers: 99, batches: 99 } },
      false,
      SET
    );
    expect(r.students).toBe(100);
    expect(r.teachers).toBe(7);
    expect(r.batches).toBe(5);
    expect(r.successRate).toBe(95);
    expect(r.usedFromDb).toBe(false);
    expect(r.failed).toBe(false);
  });

  it('is boolean-agnostic: never mutates/hides based on a show flag', () => {
    // visibility (showHomeStats) is a render concern in HeroSection; this
    // helper just resolves numbers regardless of any show flag.
    const r = resolveHomeStats(
      { ok: true, counts: { students: 1, teachers: 1, batches: 1 } },
      true,
      SET
    );
    expect(r.students).toBe(1);
    expect(typeof r.usedFromDb).toBe('boolean');
  });
});
