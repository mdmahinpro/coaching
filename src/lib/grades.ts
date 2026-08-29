// Single source of truth for the letter-grade system, used by the result-card
// PDF, student portal results, and admin results/reports pages so every surface
// shows the same grade boundaries and point values.
//
//     80–100 → A+ (5.00)
//     70–79  → A  (4.00)
//     60–69  → A- (3.50)
//     50–59  → B  (3.00)
//     40–49  → C  (2.00)
//     33–39  → D  (1.00)
//     <33    → F  (0.00 — Fail)

export interface GradeInfo {
  letter: string;
  /** Grade point value (5.00 / 4.00 / 3.50 / 3.00 / 2.00 / 1.00 / 0.00). */
  point: number;
  /** Display label, e.g. "A- (3.50)". */
  label: string;
  /** Strong high-contrast fill (never a light gray-on-white). */
  fill: string;
  /** Text color on top of the fill (dark ink for contrast). */
  text: string;
  failed: boolean;
}

export function gradeInfo(pct: number): GradeInfo {
  if (pct >= 80) {
    return { letter: 'A+', point: 5.0, label: 'A+ (5.00)', fill: '#10B981', text: '#06281E', failed: false };
  }
  if (pct >= 70) {
    return { letter: 'A', point: 4.0, label: 'A (4.00)', fill: '#059669', text: '#F0FDF4', failed: false };
  }
  if (pct >= 60) {
    return { letter: 'A-', point: 3.5, label: 'A- (3.50)', fill: '#0EA5E9', text: '#062B38', failed: false };
  }
  if (pct >= 50) {
    return { letter: 'B', point: 3.0, label: 'B (3.00)', fill: '#38BDF8', text: '#062B38', failed: false };
  }
  if (pct >= 40) {
    return { letter: 'C', point: 2.0, label: 'C (2.00)', fill: '#F59E0B', text: '#3B2309', failed: false };
  }
  if (pct >= 33) {
    return { letter: 'D', point: 1.0, label: 'D (1.00)', fill: '#F97316', text: '#3B1507', failed: false };
  }
  return { letter: 'F', point: 0, label: 'F (0.00)', fill: '#EF4444', text: '#460B0B', failed: true };
}

/** Backwards-compatible alias used by the PDF module. */
export function gradeMeta(pct: number): GradeInfo {
  return gradeInfo(pct);
}
