import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { wrapText, ROLL_WIDTH, CONTENT_MARGIN } from './posReceipt';

/**
 * The thermal roll is only 227 pt wide; anything wider is clipped by the
 * printer. These cases pin the invariant that no rendered line can exceed the
 * printable content width, whatever the input text is.
 */
describe('posReceipt text wrapping', () => {
  const CW = ROLL_WIDTH - CONTENT_MARGIN * 2;

  const cases = [
    'Tuition Fee - October 2026',
    'Mohammad Abul Kalam Azad Chowdhury Siddique Rahman',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'QA Student 7687 (batch: HSC 2026 Evening Shift - Science Group - Section B)',
    'Tk 1,25,00,000',
    'মাসিক বেতন অক্টোবর ২০২৬',
  ];

  const sizes: Array<[number, 'normal' | 'bold']> = [
    [6.5, 'normal'],
    [7.5, 'normal'],
    [7.5, 'bold'],
    [8, 'normal'],
    [10, 'bold'],
    [12, 'bold'],
  ];

  it('never produces a line wider than the printable width', () => {
    const pdf = new jsPDF({ unit: 'pt', format: [ROLL_WIDTH, 400] });
    for (const text of cases) {
      for (const [size, style] of sizes) {
        for (const maxW of [CW, CW - 56, CW - 74, 52]) {
          const lines = wrapText(pdf, text, size, style, maxW);
          pdf.setFont('courier', style);
          pdf.setFontSize(size);
          for (const line of lines) {
            expect(pdf.getTextWidth(line)).toBeLessThanOrEqual(maxW + 0.01);
          }
          expect(lines.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
        }
      }
    }
  });

  it('always returns at least one line', () => {
    const pdf = new jsPDF({ unit: 'pt', format: [ROLL_WIDTH, 400] });
    expect(wrapText(pdf, '', 7.5, 'normal', CW)).toEqual(['-']);
    expect(wrapText(pdf, '   ', 7.5, 'normal', CW)).toEqual(['-']);
  });
});
