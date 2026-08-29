// PDF generation via native browser-canvas rendering + jsPDF embedding.
//
// Background: the previous implementation rasterized HTML with html2canvas,
// whose bespoke layout engine mis-rendered tables/flex and produced overlapping
// output (proven by a pixel-band diagnostic). Here we instead draw the card
// directly onto a 2x <canvas> with the browser's own text engine (so Bengali
// shaping and word-wrap are correct), then embed that canvas into a standard
// A4 page with jsPDF. Every rect/text is placed at explicit coordinates from a
// running y-cursor, so overlapping content is structurally impossible.
//
// jsPDF (~400KB) is loaded on demand the first time a PDF is generated, so it
// stays out of the main bundle.

let jsPDFMod: typeof import('jspdf').jsPDF | null = null;

async function loadJspdf() {
  if (!jsPDFMod) {
    const m = await import('jspdf');
    jsPDFMod = m.jsPDF;
  }
  return jsPDFMod;
}

// ── Pure geometry & grade helpers (unit-tested) ───────────────────────────────

export interface PdfFit {
  /** Left offset (mm) of the placed image on the page. */
  x: number;
  /** Top offset (mm) of the placed image on the page. */
  y: number;
  /** Placed width (mm), aspect-preserving and ≤ available width. */
  w: number;
  /** Placed height (mm), aspect-preserving and ≤ available height. */
  h: number;
}

/**
 * Compute the rectangle (in mm) that places an image of the given aspect
 * ratio (width/height) centered within a page minus a uniform margin,
 * preserving the aspect ratio and never overflowing the printable area.
 */
export function computeCenteredFit(opts: {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  imageAspect: number;
}): PdfFit {
  const { pageWidth, pageHeight, margin, imageAspect } = opts;
  const availW = Math.max(0, pageWidth - margin * 2);
  const availH = Math.max(0, pageHeight - margin * 2);
  const ar = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
  let w = availW;
  let h = w / ar;
  if (h > availH) {
    h = availH;
    w = h * ar;
  }
  return { x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, w, h };
}

/** Filesystem-safe PDF stem from any display name. */
export function safePdfFilename(name: string): string {
  return (name || 'document').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
}

export interface GradeMeta {
  letter: string;
  /** Strong high-contrast fill (never a light gray-on-white). */
  fill: string;
  /** Text color on top of the fill (dark ink for contrast). */
  text: string;
}

/**
 * Letter-grade metadata with strong, high-contrast fills for the result card.
 * Grade boundaries: A+ ≥90, A ≥80, B ≥70, C ≥60, D ≥40, E ≥33, F below.
 */
export function gradeMeta(pct: number): GradeMeta {
  if (pct >= 90) {return { letter: 'A+', fill: '#10B981', text: '#06281E' };}
  if (pct >= 80) {return { letter: 'A', fill: '#0FA868', text: '#F0FDF4' };}
  if (pct >= 70) {return { letter: 'B', fill: '#0EA5E9', text: '#062B38' };}
  if (pct >= 60) {return { letter: 'C', fill: '#38BDF8', text: '#062B38' };}
  if (pct >= 40) {return { letter: 'D', fill: '#F59E0B', text: '#3B2309' };}
  if (pct >= 33) {return { letter: 'E', fill: '#F97316', text: '#3B1507' };}
  return { letter: 'F', fill: '#EF4444', text: '#460B0B' };
}

// ── Word-wrap (pure; measure() injectable for tests) ──────────────────────────

export type TextMeasurer = (text: string) => number;

/**
 * Wrap text to a pixel width using a supplied measure function. Breaks at
 * whitespace; a single token wider than the line is hard-wrapped. Preserves
 * Unicode/Bengali intact (operates on characters, never bytes).
 */
export function wrapTextPx(
  text: string,
  measure: TextMeasurer,
  maxWidthPx: number
): string[] {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) {return [];}
  if (maxWidthPx <= 0 || measure(clean) <= maxWidthPx) {
    return [clean];
  }
  const tokens = clean.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const tok of tokens) {
    const candidate = line ? `${line} ${tok}` : tok;
    if (measure(candidate) <= maxWidthPx) {
      line = candidate;
    } else if (!line && measure(tok) > maxWidthPx) {
      let cur = '';
      for (const ch of tok) {
        if (cur && measure(cur + ch) > maxWidthPx) {
          lines.push(cur);
          cur = ch;
        } else {
          cur += ch;
        }
      }
      if (cur) {line = cur;}
    } else {
      lines.push(line);
      line = tok;
    }
  }
  if (line) {lines.push(line);}
  return lines;
}

// ── Browser-canvas font / measurement primitives ──────────────────────────────

const FONT_STACK = "'Hind Siliguri', 'Noto Sans Bengali', 'Inter', 'Segoe UI', sans-serif";

function fontCss(sizePx: number, weight = 400): string {
  return `${weight} ${sizePx}px ${FONT_STACK}`;
}

const measureCanvas = (() => {
  let cv: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  return () => {
    if (!cv) {
      cv = document.createElement('canvas');
      ctx = cv.getContext('2d');
    }
    return ctx;
  };
})();

/** Measure text width in px using the current font (fallback: rough estimate). */
function measureText(text: string, sizePx: number, weight = 400): number {
  const ctx = measureCanvas();
  if (ctx) {
    ctx.font = fontCss(sizePx, weight);
    return ctx.measureText(text).width;
  }
  return text.length * sizePx * 0.55;
}

/** Ensure the fonts the PDF text relies on are loaded before drawing. */
async function ensureFontsLoaded(): Promise<void> {
  try {
    if (!document.fonts) {return;}
    const loads = [
      `400 16px ${FONT_STACK}`,
      `600 16px ${FONT_STACK}`,
      `700 16px ${FONT_STACK}`,
      `800 16px ${FONT_STACK}`,
    ].map((f) => document.fonts.load(f).catch(() => null));
    await Promise.all(loads);
  } catch {
    /* best-effort — fall back to whatever fonts are available */
  }
}

// ── Image loading ──────────────────────────────────────────────────────────────

async function loadImageBitmap(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

let markImage: HTMLImageElement | null = null;
/** Loaded (decoded) Concept-B mark image, cached after first load. */
async function loadMark(): Promise<HTMLImageElement | null> {
  if (markImage !== null) {return markImage;}
  markImage = await loadImageBitmap('/techely-mark.svg');
  return markImage;
}

// ── Canvas drawing helpers ─────────────────────────────────────────────────────

interface RoundParams {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

function roundRect(ctx: CanvasRenderingContext2D, p: RoundParams): void {
  const { x, y, w, h, r: rr, fill, stroke, strokeWidth } = p;
  const rad = Math.min(rr, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rad);
  } else {
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth ?? 1;
    ctx.stroke();
  }
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  sizePx: number,
  color: string,
  opts: { weight?: number; align?: CanvasTextAlign; baseline?: CanvasTextBaseline } = {}
): void {
  const { weight = 400, align = 'left', baseline = 'alphabetic' } = opts;
  ctx.font = fontCss(sizePx, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
}

/** Draw a wrapped block of text starting at topY; returns the block height. */
function drawTextWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  topY: number,
  maxWidthPx: number,
  sizePx: number,
  color: string,
  weight = 400,
  align: CanvasTextAlign = 'left'
): { heightPx: number } {
  const lines = wrapTextPx(text, (t) => measureText(t, sizePx, weight), maxWidthPx);
  let y = topY;
  for (const ln of lines) {
    drawText(ctx, ln, x, y, sizePx, color, { weight, align, baseline: 'top' });
    y += Math.round(sizePx * 1.3);
  }
  return { heightPx: Math.round(y - topY) };
}

/** Draw an image (mark/avatar) centered inside a box, scaled to fit. */
function drawImageBox(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  radius: number,
  bg: string
): void {
  roundRect(ctx, { x, y, w: boxW, h: boxH, r: radius, fill: bg });
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + boxW / 2, y + boxH / 2, Math.min(boxW, boxH) / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const side = Math.min(boxW, boxH) * 0.9;
  ctx.drawImage(img, x + (boxW - side) / 2, y + (boxH - side) / 2, side, side);
  ctx.restore();
}

// ── Shared canvas → A4 embedding ───────────────────────────────────────────────

/**
 * Place a card canvas centered within a standard A4 portrait sheet (10mm
 * margin), preserving aspect — prints/views identically on every device.
 */
async function placeOnA4(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const JsPDF = await loadJspdf();
  const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const fit = computeCenteredFit({
    pageWidth: 210,
    pageHeight: 297,
    margin: 10,
    imageAspect: canvas.width / canvas.height,
  });
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', fit.x, fit.y, fit.w, fit.h);
  pdf.save(filename);
}

// ── Shared layout tracking (for tests + debug assertions) ─────────────────────

export interface LayoutSection {
  name: string;
  y: number; // top
  h: number; // height
}

const lastLayout: LayoutSection[] = [];
/** Order the drawn sections (debug/testing only — proves non-overlap structurally). */
export function pdfDebugLayout(): LayoutSection[] {
  return lastLayout.slice();
}

function track(name: string, y: number, h: number): void {
  lastLayout.push({ name, y, h });
}

// ── Colors ─────────────────────────────────────────────────────────────────────

const C = {
  ink: '#0B1120',
  ink2: '#1E293B',
  nearBlack: '#0F172A',
  slateDark: '#334155',
  slateDim: '#64748B',
  border: '#E2E8F0',
  skyLight: '#EEF7FF',
  skyBorder: '#BAE6FD',
  emerald: '#10B981',
  red: '#EF4444',
  amber: '#F59E0B',
  teal: '#0369A1',
  sky: '#0EA5E9',
  white: '#FFFFFF',
  muted: '#FFFFFF99',
};

// ── RECEIPT ────────────────────────────────────────────────────────────────────

/** Payment-method color dot (no emoji — device-safe). */
function methodColor(method: string): string {
  switch ((method || '').toLowerCase()) {
    case 'cash':
      return '#16A34A';
    case 'bkash':
      return '#E0218A';
    case 'nagad':
      return '#F97316';
    default:
      return '#0EA5E9';
  }
}

export interface ReceiptData {
  receiptNo: string;
  date: string;
  studentName: string;
  studentId?: string;
  batchName?: string;
  month: string;
  feeAmount: number;
  discount: number;
  finalAmount: number;
  paymentMethod: string;
  transactionId?: string;
  instituteName: string;
  instituteAddress?: string;
  institutePhone?: string;
}

export interface StudentReceiptData {
  receiptNo: string;
  date: string;
  studentName: string;
  studentId?: string;
  month: string;
  feeAmount: number;
  discount: number;
  finalAmount: number;
  paymentMethod: string;
  transactionId?: string;
  instituteName: string;
}

// ── RECEIPT layout ─────────────────────────────────────────────────────────────

const PAGE = { w: 620, s: 2, pad: 30 };

function newCanvas(hPx: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE.w * PAGE.s;
  canvas.height = hPx * PAGE.s;
  const ctx = canvas.getContext('2d');
  if (!ctx) {throw new Error('Canvas 2D context unavailable');}
  ctx.scale(PAGE.s, PAGE.s);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PAGE.w, hPx);
  return { canvas, ctx };
}

function trimToUsed(canvas: HTMLCanvasElement, usedHPx: number): HTMLCanvasElement {
  const h = Math.ceil(usedHPx);
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = h * PAGE.s;
  out.getContext('2d')!.drawImage(canvas, 0, 0);
  return out;
}

function drawReceiptCanvas(r: ReceiptData, mark: HTMLImageElement | null): { canvas: HTMLCanvasElement; usedH: number } {
  const W = PAGE.w;
  const P = PAGE.pad;
  const CW = W - P * 2;
  const headerH = 156;
  const { canvas, ctx } = newCanvas(900);
  let y = P;
  lastLayout.length = 0;

  const discount = r.discount ?? 0;
  const finalAmount = r.finalAmount ?? r.feeAmount;
  const method = r.paymentMethod || 'Cash';

  // ── Header ──
  roundRect(ctx, { x: P, y, w: CW, h: headerH, r: 18, fill: C.ink });
  if (mark) {
    drawImageBox(ctx, mark, P + 22, y + 20, 48, 48, 12, 'transparent');
    drawText(ctx, 'FEE RECEIPT · ফি রশিদ', P + 86, y + 24, 15, '#7DD3FC', { weight: 700, baseline: 'top' });
  } else {
    drawText(ctx, 'FEE RECEIPT · ফি রশিদ', P + 22, y + 24, 17, C.white, { weight: 800, baseline: 'top' });
  }
  drawTextWrapped(ctx, r.instituteName, P + (mark ? 86 : 22), y + (mark ? 56 : 56), CW - 220, 24, C.white, 800);

  drawText(ctx, 'Receipt Number', P + CW - 30, y + 28, 11, C.muted, { align: 'right', weight: 600, baseline: 'top' });
  drawText(ctx, r.receiptNo, P + CW - 30, y + 42, 16, C.white, { align: 'right', weight: 700, baseline: 'top' });
  drawText(ctx, 'Date', P + CW - 30, y + 72, 11, C.muted, { align: 'right', weight: 600, baseline: 'top' });
  drawText(ctx, r.date, P + CW - 30, y + 86, 13, C.white, { align: 'right', weight: 600, baseline: 'top' });
  roundRect(ctx, { x: P + CW - 30 - 122, y: y + 112, w: 122, h: 26, r: 13, fill: C.emerald });
  drawText(ctx, 'PAID', P + CW - 30, y + 124, 13, C.white, { align: 'right', weight: 800, baseline: 'middle' });

  y += headerH + 18;
  track('header', y - headerH - 18, headerH);

  // ── Student card ──
  const stuH = 84;
  roundRect(ctx, { x: P, y, w: CW, h: stuH, r: 14, fill: C.skyLight, stroke: C.skyBorder });
  roundRect(ctx, { x: P + 16, y: y + 15, w: 54, h: 54, r: 27, fill: C.sky });
  drawText(ctx, r.studentName.charAt(0).toUpperCase(), P + 16 + 27, y + 15 + 27, 24, C.white, { align: 'center', weight: 800, baseline: 'middle' });
  drawText(ctx, r.studentName, P + 92, y + 26, 19, C.nearBlack, { weight: 700, baseline: 'top' });
  let subY = y + 54;
  if (r.studentId) {
    drawText(ctx, r.studentId, P + 92, subY, 13, C.teal, { weight: 600, baseline: 'top' });
    subY += 18;
  }
  if (r.batchName) {
    drawText(ctx, r.batchName, P + 92, subY, 12, C.slateDim, { weight: 500, baseline: 'top' });
  }
  y += stuH + 18;
  track('student', y - stuH - 18, stuH);

  // ── Info rows ──
  const rows: Array<[string, string, string?]> = [
    ['Fee Month', r.month],
    ['Payment Method', method],
    ...(r.transactionId ? ([[
      'Transaction ID',
      r.transactionId,
      '#0369A1',
    ]] as Array<[string, string, string?]>) : []),
  ];
  const rowH = 40;
  for (const [label, value, valColor] of rows) {
    drawText(ctx, label, P + 4, y + rowH / 2, 14, C.slateDark, { weight: 600, baseline: 'middle' });
    roundRect(ctx, { x: P + CW - 12, y: y + rowH / 2 - 8, w: 16, h: 16, r: 8, fill: methodColor(method) });
    drawText(ctx, value, P + CW - 26, y + rowH / 2, 15, valColor ?? C.nearBlack, { align: 'right', weight: 700, baseline: 'middle' });
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(P + 2, y + rowH);
    ctx.lineTo(P + CW - 2, y + rowH);
    ctx.stroke();
    y += rowH;
  }
  track('info', y - rows.length * rowH, rows.length * rowH);

  y += 18;

  // ── Amount box ──
  const amtH = 172;
  roundRect(ctx, { x: P, y, w: CW, h: amtH, r: 16, fill: C.ink2 });
  drawText(ctx, 'Payment Breakdown', P + 26, y + 24, 12, C.muted, { weight: 600, baseline: 'top' });
  drawText(ctx, 'Original Fee', P + 26, y + 58, 14, C.white, { weight: 500, baseline: 'top' });
  drawText(ctx, `৳${Math.round(r.feeAmount).toLocaleString('en-IN')}`, P + CW - 26, y + 58, 15, C.white, { align: 'right', weight: 700, baseline: 'top' });
  if (discount > 0) {
    drawText(ctx, 'Discount', P + 26, y + 90, 14, '#FCA5A5', { weight: 500, baseline: 'top' });
    drawText(ctx, `−৳${Math.round(discount).toLocaleString('en-IN')}`, P + CW - 26, y + 90, 15, '#FCA5A5', { align: 'right', weight: 700, baseline: 'top' });
  }
  roundRect(ctx, { x: P + 18, y: y + 118, w: CW - 36, h: 40, r: 10, fill: 'rgba(56,189,248,0.18)', stroke: 'rgba(56,189,248,0.4)' });
  drawText(ctx, 'Amount Paid · পরিশোধিত', P + 40, y + 138, 14, C.white, { weight: 600, baseline: 'middle' });
  drawText(ctx, `৳${Math.round(finalAmount).toLocaleString('en-IN')}`, P + CW - 40, y + 138, 22, '#38BDF8', { align: 'right', weight: 800, baseline: 'middle' });
  y += amtH + 18;
  track('amount', y - amtH - 18, amtH);

  // ── Signature ──
  const sigH = 64;
  const sigW = (CW - 48) / 2;
  const drawSig = (x: number, label: string) => {
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 30);
    ctx.lineTo(x + sigW, y + 30);
    ctx.stroke();
    drawText(ctx, label, x + sigW / 2, y + 42, 11, C.slateDim, { align: 'center', weight: 500, baseline: 'top' });
  };
  drawSig(P + 22, 'Student Signature');
  drawSig(P + 22 + sigW + 24, 'Authorized By');
  y += sigH;
  track('signature', y - sigH, sigH);

  // ── Footer ──
  const footH = 42;
  drawText(ctx, `© ${new Date().getFullYear()} ${r.instituteName} · All rights reserved`, W / 2, y + 20, 11, C.slateDim, { align: 'center', weight: 400, baseline: 'top' });
  y += footH;
  track('footer', y - footH, footH);

  return { canvas, usedH: y + P };
}

export async function generateReceipt(r: ReceiptData): Promise<void> {
  await ensureFontsLoaded();
  const mark = await loadMark();
  const { canvas, usedH } = drawReceiptCanvas(r, mark);
  const trimmed = trimToUsed(canvas, usedH);
  await placeOnA4(trimmed, `receipt-${r.receiptNo}.pdf`);
}

export async function generateStudentReceipt(r: StudentReceiptData): Promise<void> {
  await generateReceipt({
    receiptNo: r.receiptNo,
    date: r.date,
    studentName: r.studentName,
    studentId: r.studentId,
    month: r.month,
    feeAmount: r.feeAmount,
    discount: r.discount,
    finalAmount: r.finalAmount,
    paymentMethod: r.paymentMethod,
    transactionId: r.transactionId,
    instituteName: r.instituteName,
  });
}

// ── RESULT CARD ────────────────────────────────────────────────────────────────

export interface ResultCardData {
  studentName: string;
  studentId?: string;
  /** Public photo URL from students.photo_url (rendered as a round avatar). */
  photoUrl?: string;
  examTitle: string;
  subject: string;
  score: number;
  totalMarks: number;
  passMarks: number;
  correctCount: number;
  wrongCount: number;
  timeTaken?: number;
  rank?: number;
  submittedAt: string;
  instituteName: string;
}

function drawResultCard(
  r: ResultCardData,
  mark: HTMLImageElement | null,
  avatar: HTMLImageElement | null
): { canvas: HTMLCanvasElement; usedH: number } {
  const W = PAGE.w;
  const P = PAGE.pad;
  const CW = W - P * 2;
  const headerH = 178;
  const { canvas, ctx } = newCanvas(980);
  let y = P;
  lastLayout.length = 0;

  const pct = r.totalMarks > 0 ? Math.round((r.score / r.totalMarks) * 100) : 0;
  const passed = r.score >= r.passMarks;
  const grade = gradeMeta(pct);
  const accent = passed ? C.emerald : C.red;
  const fmtTime = (s?: number) => (!s ? '—' : `${Math.floor(s / 60)}m ${s % 60}s`);

  // ── Header ──
  roundRect(ctx, { x: P, y, w: CW, h: headerH, r: 18, fill: C.ink });

  if (mark) {
    drawImageBox(ctx, mark, P + 26, y + 22, 44, 44, 12, 'transparent');
    drawText(ctx, r.instituteName, P + 88, y + 26, 19, C.white, { weight: 800, baseline: 'top' });
    drawText(ctx, 'COACHING ACADEMY', P + 88, y + 50, 10, C.muted, { weight: 600, baseline: 'top' });
  } else {
    drawText(ctx, r.instituteName, P + 26, y + 28, 20, C.white, { weight: 800, baseline: 'top' });
  }

  // Badge
  roundRect(ctx, { x: P + 26, y: y + 82, w: 190, h: 27, r: 14, fill: C.ink2, stroke: '#334155' });
  drawText(ctx, 'RESULT CARD · ফলাফল কার্ড', P + 26 + 95, y + 95, 10.5, '#7DD3FC', { align: 'center', weight: 700, baseline: 'middle' });

  // Score (left) + grade pill (right at bottom of header)
  drawText(ctx, 'SCORE', P + 26, y + 124, 11, '#94A3B8', { weight: 600, baseline: 'top' });
  drawText(ctx, `${pct}%`, P + 26, y + 136, 42, accent, { weight: 800, baseline: 'top' });
  drawText(ctx, `${r.score} / ${r.totalMarks}`, P + 26, y + 136 + 46, 14, C.white, { weight: 700, baseline: 'top' });

  const pillW = 86;
  const pillH = 56;
  roundRect(ctx, {
    x: P + CW - 26 - pillW,
    y: y + headerH - pillH - 26,
    w: pillW,
    h: pillH,
    r: 14,
    fill: grade.fill,
  });
  drawText(ctx, grade.letter, P + CW - 26 - pillW / 2, y + headerH - 26 - pillH / 2, 30, grade.text, { align: 'center', weight: 800, baseline: 'middle' });

  y += headerH + 18;
  track('header', y - headerH - 18, headerH);

  // ── Student row ──
  const stuH = 88;
  roundRect(ctx, { x: P, y, w: CW, h: stuH, r: 14, fill: C.skyLight, stroke: C.skyBorder });
  const d = 56;
  const avX = P + 18;
  const avY = y + (stuH - d) / 2;
  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avX + d / 2, avY + d / 2, d / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = C.sky;
    ctx.fillRect(avX, avY, d, d);
    ctx.drawImage(avatar, avX, avY, d, d);
    ctx.restore();
  } else {
    roundRect(ctx, { x: avX, y: avY, w: d, h: d, r: d / 2, fill: C.sky });
    drawText(ctx, r.studentName.charAt(0).toUpperCase(), avX + d / 2, avY + d / 2, 24, C.white, { align: 'center', weight: 800, baseline: 'middle' });
  }
  drawText(ctx, r.studentName, P + 96, y + 26, 19, C.nearBlack, { weight: 700, baseline: 'top' });
  let stuSubY = y + 54;
  if (r.studentId) {
    drawText(ctx, r.studentId, P + 96, stuSubY, 13, C.teal, { weight: 600, baseline: 'top' });
    stuSubY += 18;
  }
  void stuSubY;
  y += stuH + 18;
  track('student', y - stuH - 18, stuH);

  // ── Stats ──
  const stats: Array<{ label: string; value: string; fill: string }> = [
    { label: 'সঠিক / Correct', value: String(r.correctCount ?? 0), fill: C.emerald },
    { label: 'ভুল / Wrong', value: String(r.wrongCount ?? 0), fill: C.red },
    { label: 'সময় / Time', value: fmtTime(r.timeTaken), fill: C.amber },
  ];
  const gap = 14;
  const statW = (CW - gap * 2) / 3;
  const statH = 96;
  stats.forEach((s, i) => {
    const sx = P + i * (statW + gap);
    roundRect(ctx, { x: sx, y, w: statW, h: statH, r: 14, fill: s.fill });
    drawText(ctx, s.value, sx + statW / 2, y + 50, 30, C.white, { align: 'center', weight: 800, baseline: 'middle' });
    drawText(ctx, s.label, sx + statW / 2, y + 80, 11, C.white, { align: 'center', weight: 600, baseline: 'middle' });
  });
  y += statH + 18;
  track('stats', y - statH - 18, statH);

  // ── Info rows ──
  const infoRows: Array<[string, string, string?]> = [
    ['Exam', r.examTitle],
    ['Subject', r.subject],
    ['Pass Marks', `${r.passMarks} / ${r.totalMarks}`],
    ...(r.rank ? ([[
      'Rank',
      `#${r.rank}`,
      '#7C3AED',
    ]] as Array<[string, string, string?]>) : []),
    ['Date', r.submittedAt],
  ];
  const infoH = 40;
  for (const [label, value, valColor] of infoRows) {
    drawText(ctx, label, P + 4, y + infoH / 2, 14, C.slateDark, { weight: 600, baseline: 'middle' });
    drawText(ctx, value, P + CW - 4, y + infoH / 2, 15, valColor ?? C.nearBlack, { align: 'right', weight: 700, baseline: 'middle' });
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(P + 2, y + infoH);
    ctx.lineTo(P + CW - 2, y + infoH);
    ctx.stroke();
    y += infoH;
  }
  track('info', y - infoRows.length * infoH, infoRows.length * infoH);

  y += 18;

  // ── Pass stamp ──
  const passH = 96;
  roundRect(ctx, { x: P, y, w: CW, h: passH, r: 16, fill: accent });
  drawText(ctx, passed ? '✔' : '✘', P + CW / 2, y + 26, 24, C.white, { align: 'center', weight: 800, baseline: 'top' });
  drawText(ctx, passed ? 'PASSED' : 'FAILED', P + CW / 2, y + 52, 22, C.white, { align: 'center', weight: 800, baseline: 'top' });
  drawText(ctx, passed ? 'অভিনন্দন! তুমি পরীক্ষায় পাস করেছ।' : 'আরও পড়াশোনা করো। পরেরবার পারবে!', P + CW / 2, y + 82, 11, C.white, { align: 'center', weight: 600, baseline: 'top' });
  y += passH + 18;
  track('pass', y - passH - 18, passH);

  // ── Footer ──
  const footH = 42;
  drawText(ctx, `Computer-generated result card · ${r.instituteName}`, W / 2, y + 20, 11, C.slateDim, { align: 'center', weight: 400, baseline: 'top' });
  y += footH;
  track('footer', y - footH, footH);

  return { canvas, usedH: y + P };
}

export async function generateResultCard(r: ResultCardData): Promise<void> {
  await ensureFontsLoaded();
  const [mark, avatar] = await Promise.all([loadMark(), r.photoUrl ? loadImageBitmap(r.photoUrl) : Promise.resolve(null)]);
  const { canvas, usedH } = drawResultCard(r, mark, avatar);
  const trimmed = trimToUsed(canvas, usedH);
  await placeOnA4(trimmed, `result-card-${safePdfFilename(r.studentName)}.pdf`);
}
