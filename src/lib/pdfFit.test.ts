import { describe, it, expect } from 'vitest';
import { computeCenteredFit, safePdfFilename } from './pdf';

describe('computeCenteredFit', () => {
  const A4 = { pageWidth: 210, pageHeight: 297, margin: 10 };

  it('fills the full printable width for a portrait asset (width-limited)', () => {
    const fit = computeCenteredFit({ ...A4, imageAspect: 420 / 500 }); // 0.84
    const availW = 210 - 20; // 190
    const availH = 297 - 20; // 277
    expect(fit.w).toBeCloseTo(availW, 6);
    expect(fit.h).toBeCloseTo(availW / 0.84, 6);
    expect(fit.h).toBeLessThanOrEqual(availH);
    // Vertically centered
    expect(fit.y).toBeCloseTo((297 - fit.h) / 2, 6);
    expect(fit.x).toBeCloseTo(10, 6);
  });

  it('respects the printable height for a very tall asset (height-limited)', () => {
    const fit = computeCenteredFit({ ...A4, imageAspect: 1 / 3 });
    const availH = 277;
    expect(fit.h).toBeCloseTo(availH, 6);
    expect(fit.w).toBeCloseTo(availH / 3, 6);
    expect(fit.w).toBeLessThanOrEqual(190);
    // Horizontally centered
    expect(fit.x).toBeCloseTo((210 - fit.w) / 2, 6);
    expect(fit.y).toBeCloseTo(10, 6);
  });

  it('handles a square asset with symmetric margins', () => {
    const fit = computeCenteredFit({ ...A4, imageAspect: 1 });
    expect(fit.w).toBeCloseTo(190, 6);
    expect(fit.h).toBeCloseTo(190, 6);
    expect(fit.x).toBeCloseTo((210 - 190) / 2, 6);
    expect(fit.y).toBeCloseTo((297 - 190) / 2, 6);
  });

  it('never overflows the page (property check over many aspects)', () => {
    for (const ar of [0.1, 0.25, 0.5, 0.84, 1, 1.5, 2, 4, 10]) {
      const fit = computeCenteredFit({ ...A4, imageAspect: ar });
      expect(fit.w).toBeGreaterThan(0);
      expect(fit.h).toBeGreaterThan(0);
      expect(fit.w).toBeLessThanOrEqual(190 + 1e-6);
      expect(fit.h).toBeLessThanOrEqual(277 + 1e-6);
      // On-page with margin (allow rounding epsilon)
      expect(fit.x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(fit.y).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(fit.x + fit.w).toBeLessThanOrEqual(210 - 10 + 1e-6);
      expect(fit.y + fit.h).toBeLessThanOrEqual(297 - 10 + 1e-6);
      // Aspect preserved within epsilon
      expect(fit.w / fit.h).toBeCloseTo(ar, 6);
    }
  });

  it('falls back to a square fit for a non-positive aspect', () => {
    const fit = computeCenteredFit({ ...A4, imageAspect: 0 });
    expect(fit.w / fit.h).toBeCloseTo(1, 6);
  });

  it('only shrinks, never overflows, when the margin is 0', () => {
    const fit = computeCenteredFit({ pageWidth: 210, pageHeight: 297, margin: 0, imageAspect: 2 });
    expect(fit.w).toBeCloseTo(210, 6);
    expect(fit.h).toBeCloseTo(105, 6);
    expect(fit.x).toBeCloseTo(0, 6);
  });
});

describe('safePdfFilename', () => {
  it('lowercases and strips characters that are unsafe in filenames', () => {
    expect(safePdfFilename('Sadia Rahman')).toBe('sadia-rahman');
    expect(safePdfFilename('Tanbir/Ahmed🎓')).toBe('tanbir-ahmed--');
  });

  it('falls back to a safe default for an empty name', () => {
    expect(safePdfFilename('')).toBe('document');
    expect(safePdfFilename(undefined as unknown as string)).toBe('document');
  });
});
