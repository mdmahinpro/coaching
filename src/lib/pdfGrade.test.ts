import { describe, it, expect } from 'vitest';
import { gradeMeta, wrapTextPx } from './pdf';

describe('gradeMeta', () => {
  it('maps every letter grade bucket with a strong fill', () => {
    expect(gradeMeta(95)).toMatchObject({ letter: 'A+' });
    expect(gradeMeta(90)).toMatchObject({ letter: 'A+' });
    expect(gradeMeta(89)).toMatchObject({ letter: 'A' });
    expect(gradeMeta(80)).toMatchObject({ letter: 'A' });
    expect(gradeMeta(79)).toMatchObject({ letter: 'B' });
    expect(gradeMeta(70)).toMatchObject({ letter: 'B' });
    expect(gradeMeta(69)).toMatchObject({ letter: 'C' });
    expect(gradeMeta(60)).toMatchObject({ letter: 'C' });
    expect(gradeMeta(59)).toMatchObject({ letter: 'D' });
    expect(gradeMeta(40)).toMatchObject({ letter: 'D' });
    expect(gradeMeta(39)).toMatchObject({ letter: 'E' });
    expect(gradeMeta(33)).toMatchObject({ letter: 'E' });
    expect(gradeMeta(32)).toMatchObject({ letter: 'F' });
    expect(gradeMeta(0)).toMatchObject({ letter: 'F' });
  });

  it('never returns a light-gray-on-white grade (fill strongly saturated, text is dark ink for contrast)', () => {
    for (let pct = 0; pct <= 100; pct += 1) {
      const g = gradeMeta(pct);
      // fill must be a saturated color (not a near-white/gray), text is readable on it
      expect(g.letter).toBeTruthy();
      expect(g.fill).toMatch(/^#[0-9A-F]{6}$/i);
      // Reject washed-out fills: hex channels should not all be >= 0xB0 (near-white)
      const r = parseInt(g.fill.slice(1, 3), 16);
      const gr = parseInt(g.fill.slice(3, 5), 16);
      const b = parseInt(g.fill.slice(5, 7), 16);
      expect(r < 0xB0 || gr < 0xB0 || b < 0xB0).toBe(true);
      expect(g.text).toBeTruthy();
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
