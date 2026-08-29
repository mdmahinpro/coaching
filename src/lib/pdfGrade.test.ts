import { describe, it, expect } from 'vitest';
import { gradeInfo } from './grades';
import { wrapTextPx } from './pdf';

describe('gradeInfo (7-step grading system)', () => {
  it('maps the exact grade boundaries with point values', () => {
    expect(gradeInfo(100)).toMatchObject({ letter: 'A+', point: 5.0 });
    expect(gradeInfo(80)).toMatchObject({ letter: 'A+', point: 5.0 });
    expect(gradeInfo(79)).toMatchObject({ letter: 'A', point: 4.0 });
    expect(gradeInfo(70)).toMatchObject({ letter: 'A', point: 4.0 });
    expect(gradeInfo(69)).toMatchObject({ letter: 'A-', point: 3.5 });
    expect(gradeInfo(60)).toMatchObject({ letter: 'A-', point: 3.5 });
    expect(gradeInfo(59)).toMatchObject({ letter: 'B', point: 3.0 });
    expect(gradeInfo(50)).toMatchObject({ letter: 'B', point: 3.0 });
    expect(gradeInfo(49)).toMatchObject({ letter: 'C', point: 2.0 });
    expect(gradeInfo(40)).toMatchObject({ letter: 'C', point: 2.0 });
    expect(gradeInfo(39)).toMatchObject({ letter: 'D', point: 1.0 });
    expect(gradeInfo(33)).toMatchObject({ letter: 'D', point: 1.0 });
    expect(gradeInfo(32)).toMatchObject({ letter: 'F', point: 0, failed: true });
    expect(gradeInfo(0)).toMatchObject({ letter: 'F', point: 0, failed: true });
  });

  it('labels include the grade point', () => {
    expect(gradeInfo(85).label).toBe('A+ (5.00)');
    expect(gradeInfo(75).label).toBe('A (4.00)');
    expect(gradeInfo(65).label).toBe('A- (3.50)');
    expect(gradeInfo(55).label).toBe('B (3.00)');
    expect(gradeInfo(45).label).toBe('C (2.00)');
    expect(gradeInfo(35).label).toBe('D (1.00)');
    expect(gradeInfo(20).label).toBe('F (0.00)');
  });

  it('only F is failed; every other grade passes', () => {
    for (let pct = 0; pct <= 100; pct += 1) {
      const g = gradeInfo(pct);
      expect(g.failed).toBe(pct < 33);
    }
  });

  it('never returns a light-gray-on-white fill (strongly saturated + dark text contrast)', () => {
    for (let pct = 0; pct <= 100; pct += 1) {
      const g = gradeInfo(pct);
      expect(g.fill).toMatch(/^#[0-9A-F]{6}$/i);
      const r = parseInt(g.fill.slice(1, 3), 16);
      const gr = parseInt(g.fill.slice(3, 5), 16);
      const b = parseInt(g.fill.slice(5, 7), 16);
      expect(r < 0xB0 || gr < 0xB0 || b < 0xB0).toBe(true);
      expect(g.text).toBeTruthy();
      expect(g.letter).toBeTruthy();
    }
  });
});

describe('wrapTextPx', () => {
  // A deterministic width function: char * width
  const measure = (w: number) => (t: string) => t.length * w;

  it('returns a single line when it fits', () => {
    expect(wrapTextPx('hello world', measure(10), 200)).toEqual(['hello world']);
  });

  it('wraps at whitespace (greedy first-fit)', () => {
    expect(wrapTextPx('hello brave new world', measure(10), 100)).toEqual([
      'hello',
      'brave new',
      'world',
    ]);
  });

  it('hard-wraps a single overlong token', () => {
    expect(wrapTextPx('abcdefghij', measure(10), 30)).toEqual(['abc', 'def', 'ghi', 'j']);
  });

  it('preserves Bengali text intact — no characters lost, no bytes split', () => {
    const input = 'সঠিক উত্তর ভুল উত্তর';
    const lines = wrapTextPx(input, measure(20), 60);
    // concat of all lines === input with its inner spaces removed
    expect(lines.join('')).toBe(input.replace(/ /g, ''));
    expect(lines.length).toBeGreaterThan(1);
  });

  it('handles empty / whitespace-only input', () => {
    expect(wrapTextPx('', measure(10), 100)).toEqual([]);
    expect(wrapTextPx('   ', measure(10), 100)).toEqual([]);
  });

  it('returns the full text as one line for non-positive width (never drops text)', () => {
    expect(wrapTextPx('hello', measure(10), 0)).toEqual(['hello']);
    expect(wrapTextPx('hello', measure(10), -5)).toEqual(['hello']);
  });
});
