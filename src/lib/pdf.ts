// html2canvas (~200KB) and jsPDF (~400KB) are heavy. Load them on demand the
// first time a PDF is actually generated, so they stay out of the main bundle
// and page chunks.
let pdfLibs: {
  html2canvas: typeof import('html2canvas').default;
  jsPDF: typeof import('jspdf').jsPDF;
} | null = null;

async function loadPdfLibs() {
  if (!pdfLibs) {
    const [h2c, jspdf] = await Promise.all([import('html2canvas'), import('jspdf')]);
    pdfLibs = { html2canvas: h2c.default, jsPDF: jspdf.jsPDF };
  }
  return pdfLibs;
}

// ── Pure geometry helpers (unit-tested in pdfFit.test.ts) ─────────────────────

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
 * Allows margins ≥ 0; for margins larger than the page, callers should clamp.
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

// ── Rendering pipeline ─────────────────────────────────────────────────────────

/**
 * Wait for the document fonts (chiefly the Bengali webfont) to actually be
 * ready rather than sleeping a fixed magic delay. `document.fonts.ready`
 * resolves when all fonts listed by the page have loaded *or failed*; the
 * additional check loop guarantees the "Noto Sans Bengali" face is really
 * present before rasterizing, so glyph shaping is deterministic across
 * devices and network conditions. Also bounded by a timeout so a slow/absent
 * network degrades to the fallback font instead of hanging the download.
 */
async function waitForFonts(timeoutMs = 5000): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    /* FontAccess unsupported — proceed optimistically. */
  }
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline && !document.fonts.check('16px "Noto Sans Bengali"')) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  } catch {
    /* check() unsupported — already awaited ready; move on. */
  }
  // Let the just-settled layout paint so html2canvas measures final boxes.
  await new Promise((resolve) => setTimeout(resolve, 80));
}

/**
 * A4 page geometry used by every generated document, so the PDF opens and
 * prints identically on phones, tablets, desktops and physical printers:
 * a standard A4 portrait sheet with the card centered inside a 10mm margin.
 * Contrast with the previous behaviour of sizing the page to the raw canvas
 * pixels, which produced non-standard page sizes that viewers scaled
 * unpredictably.
 */
const A4_PORTRAIT = { pageWidth: 210, pageHeight: 297, margin: 10 };

/**
 * Render a self-contained HTML card into a standard A4 PDF.
 *
 * @param html      Full HTML document to stamp into the DOM (the template).
 * @param selector  Query selector for the card element within that HTML —
 *                  the string is a FULL document, so div.innerHTML flattens
 *                  its nodes and `firstElementChild` is the <style> tag
 *                  (display:none) → html2canvas measures 0x0 → jsPDF
 *                  "wrong PNG signature". Always query by real selector.
 * @param filename  Output file name (should end in .pdf).
 */
async function renderCardToPdf(html: string, selector: string, filename: string): Promise<void> {
  // The HTML string is a FULL document; assigning a document into div.innerHTML
  // flattens its nodes, so the first child is the <style> element — NOT the
  // card. Query by selector, and keep the container in-viewport (offscreen or
  // `visibility:hidden` make html2canvas measure 0x0 → broken PNG).
  const container = document.createElement('div');
  container.innerHTML = html;
  container.style.cssText =
    'position:fixed;top:0;left:0;width:420px;z-index:-9999;pointer-events:none;';
  let appended = false;
  try {
    document.body.appendChild(container);
    appended = true;

    const el = container.querySelector(selector) as HTMLElement | null;
    if (!el) {
      throw new Error(`Failed to create PDF container (${selector})`);
    }

    // Lazy libraries are dynamic-imported; a first failure can be a transient
    // chunk-load hiccup, so retry once before surfacing.
    let libs: { html2canvas: typeof import('html2canvas').default; jsPDF: typeof import('jspdf').jsPDF };
    try {
      libs = await loadPdfLibs();
    } catch (importErr) {
      libs = await loadPdfLibs();
    }
    const { html2canvas, jsPDF } = libs;

    await waitForFonts();

    // Rasterize at a resolution that stays crisp when the card is scaled up
    // to A4 width, while capping memory on very high-DPR screens.
    // 420px card × 2.5 → ≈1050px wide → ≈140 DPI at 190mm printable width.
    const rastScale = Math.min(4, Math.max(2.5, window.devicePixelRatio || 1));
    const canvas = await html2canvas(el, {
      scale: rastScale,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    // JPEG, not PNG: these cards are flat design (solid fills + text), and PNG's
    // lossless RGBA makes a 6MB file for a 420px card scaled to 2.5x. JPEG at
    // 0.92 is visually indistinguishable on this artwork and keeps the download
    // a few hundred KB on phones.
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const { pageWidth, pageHeight, margin } = A4_PORTRAIT;
    const fit = computeCenteredFit({
      pageWidth,
      pageHeight,
      margin,
      imageAspect: canvas.width / canvas.height,
    });
    pdf.addImage(imgData, 'JPEG', fit.x, fit.y, fit.w, fit.h);
    pdf.save(filename);
  } finally {
    if (appended && container.parentNode) {
      try {
        document.body.removeChild(container);
      } catch {
        /* already detached */
      }
    }
  }
}

// ── Admin: Fee Receipt ─────────────────────────────────────────────────────────
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

/** Deterministic payment-method dot color (no emoji — device-safe). */
function methodColor(method: string): string {
  switch ((method || '').toLowerCase()) {
    case 'cash':
      return '#16a34a';
    case 'bkash':
      return '#e0218a';
    case 'nagad':
      return '#f97316';
    default:
      return '#0ea5e9';
  }
}

export async function generateReceipt(r: ReceiptData): Promise<void> {
  const discount = r.discount ?? 0;
  const finalAmount = r.finalAmount ?? r.feeAmount;
  const method = r.paymentMethod || 'Cash';

  const html = /* html */ `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Receipt ${r.receiptNo}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', 'Noto Sans Bengali', sans-serif;
      background: #ffffff;
    }

    .receipt {
      width: 420px;
      max-width: 100%;
      background: #fff;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15);
    }

    /* ── Header ── */
    .header {
      background: #0b1120;
      padding: 28px 28px 36px;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: '';
      position: absolute;
      top: -40px; right: -40px;
      width: 160px; height: 160px;
      border-radius: 50%;
      background: rgba(56,189,248,0.12);
    }
    .header::after {
      content: '';
      position: absolute;
      bottom: -30px; left: 20px;
      width: 100px; height: 100px;
      border-radius: 50%;
      background: rgba(56,189,248,0.07);
    }
    .header-top {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 18px;
      position: relative;
      z-index: 1;
    }
    .logo-circle {
      width: 48px; height: 48px;
      border-radius: 14px;
      background: linear-gradient(135deg, #38bdf8, #0ea5e9);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 700; color: #062033;
      box-shadow: 0 4px 14px rgba(56,189,248,0.4);
      flex-shrink: 0;
    }
    .inst-name {
      font-size: 17px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.3px;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
    .inst-sub {
      font-size: 11px;
      color: rgba(255,255,255,0.55);
      margin-top: 3px;
      font-family: 'Noto Sans Bengali', sans-serif;
      overflow-wrap: anywhere;
    }
    .receipt-badge {
      position: relative; z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(56,189,248,0.15);
      border: 1px solid rgba(56,189,248,0.3);
      border-radius: 100px;
      padding: 6px 14px;
      margin-bottom: 12px;
    }
    .receipt-badge span {
      font-size: 11px;
      font-weight: 600;
      color: #38bdf8;
      letter-spacing: 0.8px;
      text-transform: uppercase;
    }
    .receipt-badge-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #38bdf8;
    }
    .receipt-no-row {
      position: relative; z-index: 1;
      display: flex; align-items: flex-end; justify-content: space-between;
    }
    .receipt-no-label {
      font-size: 10px; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 2px;
    }
    .receipt-no-val {
      font-size: 15px; font-weight: 700; color: #fff; font-family: 'Inter', monospace; letter-spacing: 0.5px;
    }
    .receipt-date {
      text-align: right;
    }

    /* ── Curved divider ── */
    .curve {
      height: 28px;
      background: #0b1120;
      position: relative;
    }
    .curve::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 28px;
      background: #fff;
      border-radius: 28px 28px 0 0;
    }

    /* ── Body ── */
    .body { padding: 20px 28px 28px; }

    /* ── Student card ── */
    .student-card {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 14px;
      padding: 14px 18px;
      display: flex; align-items: center; gap: 14px;
      margin-bottom: 20px;
    }
    .avatar {
      width: 44px; height: 44px;
      border-radius: 12px;
      background: #0ea5e9;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700; color: #fff;
      flex-shrink: 0;
    }
    .student-name {
      font-size: 15px; font-weight: 700; color: #0c1a2e;
      font-family: 'Noto Sans Bengali', 'Inter', sans-serif;
      overflow-wrap: anywhere;
    }
    .student-meta {
      font-size: 12px; color: #0369a1; margin-top: 2px; font-weight: 500;
      font-family: 'Inter', monospace;
    }
    .student-batch {
      font-size: 11px; color: #64748b; margin-top: 1px;
      font-family: 'Noto Sans Bengali', sans-serif;
    }

    /* ── Info rows ── */
    .info-section { margin-bottom: 18px; }
    .info-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 9px 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label {
      font-size: 12px; color: #94a3b8; font-weight: 500;
      display: flex; align-items: center; gap: 6px;
    }
    .info-value {
      font-size: 13px; color: #1e293b; font-weight: 600;
      font-family: 'Noto Sans Bengali', 'Inter', sans-serif;
      overflow-wrap: anywhere;
      text-align: right;
    }

    /* ── Amount box ── */
    .amount-box {
      background: #0f172a;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 20px;
      position: relative;
      overflow: hidden;
    }
    .amount-box::before {
      content: '';
      position: absolute;
      top: -20px; right: -20px;
      width: 90px; height: 90px;
      border-radius: 50%;
      background: rgba(56,189,248,0.1);
    }
    .amount-title {
      font-size: 10px; color: rgba(255,255,255,0.5); text-transform: uppercase;
      letter-spacing: 0.8px; margin-bottom: 14px; position: relative; z-index: 1;
    }
    .amount-breakdown {
      display: flex; justify-content: space-between; gap: 10px;
      margin-bottom: 14px; position: relative; z-index: 1;
    }
    .amt-item { flex: 1; min-width: 0; }
    .amt-item-label { font-size: 10px; color: rgba(255,255,255,0.45); margin-bottom: 4px; }
    .amt-item-val { font-size: 15px; font-weight: 700; }
    .amt-fee { color: #cbd5e1; }
    .amt-disc { color: #f87171; }
    .amt-divider {
      width: 1px; background: rgba(255,255,255,0.1); flex-shrink: 0; margin: 0 4px;
    }
    .total-row {
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(56,189,248,0.15);
      border: 1px solid rgba(56,189,248,0.25);
      border-radius: 10px;
      padding: 10px 14px;
      position: relative; z-index: 1;
    }
    .total-label { font-size: 12px; color: rgba(255,255,255,0.7); font-weight: 500; }
    .total-val { font-size: 22px; font-weight: 800; color: #38bdf8; letter-spacing: -0.5px; }

    /* ── Payment method chip ── */
    .payment-chip {
      display: inline-flex; align-items: center; gap: 8px;
      background: #f0fdf4; border: 1px solid #86efac;
      border-radius: 100px; padding: 6px 14px;
    }
    .payment-chip-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: ${methodColor(method)};
      flex-shrink: 0;
    }
    .payment-chip-label { font-size: 13px; font-weight: 600; color: #166534; text-transform: capitalize; }

    /* ── Footer ── */
    .footer {
      background: #f8fafc;
      border-top: 1px dashed #e2e8f0;
      padding: 16px 28px;
      text-align: center;
    }
    .footer-thanks {
      font-size: 13px; font-weight: 600; color: #0369a1;
      font-family: 'Noto Sans Bengali', 'Inter', sans-serif;
      margin-bottom: 4px;
    }
    .footer-sub {
      font-size: 10px; color: #94a3b8; letter-spacing: 0.3px;
    }
    .footer-sig {
      margin-top: 20px;
      display: flex; justify-content: space-between; align-items: flex-end;
    }
    .sig-line {
      width: 110px; border-top: 1.5px solid #cbd5e1; padding-top: 6px;
      font-size: 10px; color: #94a3b8; text-align: center;
    }
    .watermark {
      font-size: 9px; color: #cbd5e1; text-align: center; margin-top: 12px;
      letter-spacing: 0.3px;
    }
  </style>
</head>
<body>
  <div>
    <div class="receipt">
      <!-- Header -->
      <div class="header">
        <div class="header-top">
          <div class="logo-circle">${escapeHtml(r.instituteName.charAt(0).toUpperCase())}</div>
          <div>
            <div class="inst-name">${escapeHtml(r.instituteName)}</div>
            ${r.instituteAddress ? `<div class="inst-sub">${escapeHtml(r.instituteAddress)}</div>` : ''}
            ${r.institutePhone ? `<div class="inst-sub">${escapeHtml(r.institutePhone)}</div>` : ''}
          </div>
        </div>
        <div class="receipt-badge">
          <div class="receipt-badge-dot"></div>
          <span>Fee Receipt &nbsp;·&nbsp; ফি রশিদ</span>
        </div>
        <div class="receipt-no-row">
          <div>
            <div class="receipt-no-label">Receipt Number</div>
            <div class="receipt-no-val">${escapeHtml(r.receiptNo)}</div>
          </div>
          <div class="receipt-date">
            <div class="receipt-no-label">Date</div>
            <div class="receipt-no-val" style="font-size:13px">${escapeHtml(r.date)}</div>
          </div>
        </div>
      </div>

      <!-- Curved divider -->
      <div class="curve"></div>

      <!-- Body -->
      <div class="body">

        <!-- Student card -->
        <div class="student-card">
          <div class="avatar">${escapeHtml(r.studentName.charAt(0).toUpperCase())}</div>
          <div>
            <div class="student-name">${escapeHtml(r.studentName)}</div>
            ${r.studentId ? `<div class="student-meta">${escapeHtml(r.studentId)}</div>` : ''}
            ${r.batchName ? `<div class="student-batch">${escapeHtml(r.batchName)}</div>` : ''}
          </div>
        </div>

        <!-- Info rows -->
        <div class="info-section">
          <div class="info-row">
            <span class="info-label">
              Fee Month
            </span>
            <span class="info-value">${escapeHtml(r.month)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">
              Payment Method
            </span>
            <div class="payment-chip">
              <span class="payment-chip-dot"></span>
              <span class="payment-chip-label">${escapeHtml(method)}</span>
            </div>
          </div>
          ${
            r.transactionId
              ? `
          <div class="info-row">
            <span class="info-label">
              Transaction ID
            </span>
            <span class="info-value" style="font-family:monospace;font-size:12px;color:#0369a1">${escapeHtml(r.transactionId!)}</span>
          </div>`
              : ''
          }
        </div>

        <!-- Amount breakdown -->
        <div class="amount-box">
          <div class="amount-title">Payment Breakdown</div>
          <div class="amount-breakdown">
            <div class="amt-item">
              <div class="amt-item-label">Original Fee</div>
              <div class="amt-item-val amt-fee">৳${Math.round(r.feeAmount).toLocaleString('en-IN')}</div>
            </div>
            ${
              discount > 0
                ? `
            <div class="amt-divider"></div>
            <div class="amt-item">
              <div class="amt-item-label">Discount</div>
              <div class="amt-item-val amt-disc">−৳${Math.round(discount).toLocaleString('en-IN')}</div>
            </div>`
                : ''
            }
          </div>
          <div class="total-row">
            <span class="total-label">Amount Paid &nbsp;·&nbsp; পরিশোধিত</span>
            <span class="total-val">৳${Math.round(finalAmount).toLocaleString('en-IN')}</span>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div class="footer">
        <div class="footer-thanks">ধন্যবাদ আপনার পেমেন্টের জন্য</div>
        <div class="footer-sub">Thank you for your payment &nbsp;·&nbsp; Computer-generated receipt</div>
        <div class="footer-sig">
          <div class="sig-line">Student Signature</div>
          <div class="sig-line">Authorized By</div>
        </div>
        <div class="watermark">© ${new Date().getFullYear()} ${escapeHtml(r.instituteName)} &nbsp;·&nbsp; All rights reserved</div>
      </div>
    </div>
  </div>
</body>
</html>`;

  await renderCardToPdf(html, '.receipt', `receipt-${r.receiptNo}.pdf`);
}

// ── Student Portal: Fee Receipt ───────────────────────────────────────────────
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

// ── Student Portal: Result Card ───────────────────────────────────────────────
export interface ResultCardData {
  studentName: string;
  studentId?: string;
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

export async function generateResultCard(r: ResultCardData): Promise<void> {
  const pct = r.totalMarks > 0 ? Math.round((r.score / r.totalMarks) * 100) : 0;
  const passed = r.score >= r.passMarks;
  const grade =
    pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 40 ? 'D' : 'F';
  const fmtTime = (s?: number) => (!s ? '—' : `${Math.floor(s / 60)}m ${s % 60}s`);

  const accent = passed ? '#10b981' : '#ef4444';
  const html = /* html */ `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Result Card</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', 'Noto Sans Bengali', sans-serif;
      background: #ffffff;
    }
    .wrap { display: flex; flex-direction: column; align-items: center; }
    .card { width: 420px; max-width: 100%; background: #fff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; }
    /* Solid app-palette header (navy #0b1120), no gradients — html2canvas-safe. */
    .header { background: #0b1120; padding: 24px 24px 28px; }
    .inst-row { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
    .inst-logo { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; background: #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; color: #062033; }
    .inst-name { font-size: 15px; font-weight: 800; color: #fff; overflow-wrap: anywhere; }
    .result-badge { display: inline-flex; align-items: center; gap: 8px; background: #1e293b; border: 1px solid #334155; border-radius: 100px; padding: 5px 12px; margin-bottom: 14px; }
    .result-badge span { font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: 0.8px; text-transform: uppercase; }
    .score-row { display: flex; align-items: flex-end; justify-content: space-between; }
    .score-sub { font-size: 12px; color: #64748b; margin-bottom: 4px; }
    .score-big { font-size: 48px; font-weight: 800; line-height: 1; color: ${accent}; }
    .grade-pill { background: #a78bfa; border-radius: 100px; padding: 6px 16px; color: #0b1120; font-size: 18px; font-weight: 800; letter-spacing: 1px; }
    .body { padding: 18px 24px 24px; }
    .student-card { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
    .avatar { width: 40px; height: 40px; border-radius: 10px; background: #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; color: #062033; flex-shrink: 0; }
    .student-name { font-size: 14px; font-weight: 700; color: #0b1120; font-family: 'Noto Sans Bengali', sans-serif; overflow-wrap: anywhere; }
    .student-id { font-size: 11px; color: #0369a1; margin-top: 2px; font-weight: 600; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 6px; text-align: center; }
    .stat-val { font-size: 18px; font-weight: 800; margin-bottom: 2px; }
    .stat-correct { color: #10b981; }
    .stat-wrong { color: #ef4444; }
    .stat-skip { color: #64748b; }
    .stat-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Noto Sans Bengali', sans-serif; }
    .info-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #f1f5f9; }
    .info-row:last-child { border-bottom: none; }
    .info-label { font-size: 11px; color: #94a3b8; }
    .info-val { font-size: 12px; color: #0f172a; font-weight: 600; font-family: 'Noto Sans Bengali', sans-serif; overflow-wrap: anywhere; text-align: right; }
    .pass-stamp { margin-top: 14px; background: #f8fafc; border: 2px solid ${accent}; border-radius: 12px; padding: 12px; text-align: center; }
    .pass-stamp-icon { font-size: 24px; color: ${accent}; margin-bottom: 2px; }
    .pass-stamp-text { font-size: 16px; font-weight: 800; letter-spacing: 1px; color: ${accent}; }
    .pass-stamp-sub { font-size: 10px; margin-top: 4px; color: #475569; font-family: 'Noto Sans Bengali', sans-serif; }
    .footer { background: #f8fafc; border-top: 1px dashed #e2e8f0; padding: 12px 24px; text-align: center; }
    .footer-sub { font-size: 10px; color: #94a3b8; }
    .watermark { font-size: 9px; color: #cbd5e1; text-align: center; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">
        <div class="inst-row">
          <div class="inst-logo">${escapeHtml(r.instituteName.charAt(0).toUpperCase())}</div>
          <div class="inst-name">${escapeHtml(r.instituteName)}</div>
        </div>
        <div class="result-badge">
          <span>Result Card · ফলাফল কার্ড</span>
        </div>
        <div class="score-row">
          <div>
            <div class="score-sub">Score</div>
            <div class="score-big">${pct}%</div>
            <div style="color:#64748b;font-size:11px;margin-top:2px">${r.score} / ${r.totalMarks}</div>
          </div>
          <div class="grade-pill">${grade}</div>
        </div>
      </div>
      <div class="body">
        <div class="student-card">
          <div class="avatar">${escapeHtml(r.studentName.charAt(0).toUpperCase())}</div>
          <div>
            <div class="student-name">${escapeHtml(r.studentName)}</div>
            ${r.studentId ? `<div class="student-id">${escapeHtml(r.studentId)}</div>` : ''}
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-val stat-correct">${r.correctCount}</div>
            <div class="stat-label">সঠিক</div>
          </div>
          <div class="stat-box">
            <div class="stat-val stat-wrong">${r.wrongCount}</div>
            <div class="stat-label">ভুল</div>
          </div>
          <div class="stat-box">
            <div class="stat-val stat-skip">${r.timeTaken !== null && r.timeTaken !== undefined ? fmtTime(r.timeTaken) : '—'}</div>
            <div class="stat-label">সময়</div>
          </div>
        </div>

        <div>
          <div class="info-row">
            <span class="info-label">Exam</span>
            <span class="info-val">${escapeHtml(r.examTitle)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Subject</span>
            <span class="info-val">${escapeHtml(r.subject)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Pass Marks</span>
            <span class="info-val">${r.passMarks} / ${r.totalMarks}</span>
          </div>
          ${r.rank ? `<div class="info-row"><span class="info-label">Rank</span><span class="info-val" style="color:#7c3aed">#${r.rank}</span></div>` : ''}
          <div class="info-row">
            <span class="info-label">Date</span>
            <span class="info-val">${escapeHtml(r.submittedAt)}</span>
          </div>
        </div>

        <div class="pass-stamp">
          <div class="pass-stamp-icon">${passed ? '✔' : '✘'}</div>
          <div class="pass-stamp-text">${passed ? 'PASSED' : 'FAILED'}</div>
          <div class="pass-stamp-sub">${passed ? 'অভিনন্দন! তুমি পরীক্ষায় পাস করেছ।' : 'আরও পড়াশোনা করো। পরেরবার পারবে!'}</div>
        </div>
      </div>
      <div class="footer">
        <div class="footer-sub">Computer-generated result card · ${escapeHtml(r.instituteName)}</div>
        <div class="watermark">© ${new Date().getFullYear()} ${escapeHtml(r.instituteName)}</div>
      </div>
    </div>
  </div>
</body>
</html>`;

  await renderCardToPdf(html, '.card', `result-card-${safePdfFilename(r.studentName)}.pdf`);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
