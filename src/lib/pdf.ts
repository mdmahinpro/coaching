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

export async function generateReceipt(r: ReceiptData): Promise<void> {
  const discount = r.discount ?? 0;
  const finalAmount = r.finalAmount ?? r.feeAmount;

  const methodIcon: Record<string, string> = {
    cash: '💵',
    bkash: '📱',
    nagad: '🟠',
  };
  const icon = methodIcon[r.paymentMethod?.toLowerCase() ?? ''] ?? '💳';

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
      background: #f0f4f8;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
      padding: 32px 16px;
    }

    .receipt {
      width: 420px;
      background: #fff;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15);
    }

    /* ── Header ── */
    .header {
      background: linear-gradient(135deg, #0b1120 0%, #0f1f3d 60%, #0369a1 100%);
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
      font-size: 22px;
      box-shadow: 0 4px 14px rgba(56,189,248,0.4);
      flex-shrink: 0;
    }
    .inst-name {
      font-size: 17px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.3px;
      line-height: 1.2;
    }
    .inst-sub {
      font-size: 11px;
      color: rgba(255,255,255,0.55);
      margin-top: 3px;
      font-family: 'Noto Sans Bengali', sans-serif;
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
      animation: pulse 1.8s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
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
      background: linear-gradient(135deg, #0b1120 0%, #0f1f3d 60%, #0369a1 100%);
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
      background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
      border: 1px solid #bae6fd;
      border-radius: 14px;
      padding: 14px 18px;
      display: flex; align-items: center; gap: 14px;
      margin-bottom: 20px;
    }
    .avatar {
      width: 44px; height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #0ea5e9, #38bdf8);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700; color: #fff;
      flex-shrink: 0;
    }
    .student-name {
      font-size: 15px; font-weight: 700; color: #0c1a2e;
      font-family: 'Noto Sans Bengali', 'Inter', sans-serif;
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
    .info-label svg { opacity: 0.7; }
    .info-value {
      font-size: 13px; color: #1e293b; font-weight: 600;
      font-family: 'Noto Sans Bengali', 'Inter', sans-serif;
    }

    /* ── Amount box ── */
    .amount-box {
      background: linear-gradient(135deg, #0f172a, #1e3a5f);
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
    .amt-item { flex: 1; }
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
          <div class="logo-circle">🎓</div>
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
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Fee Month
            </span>
            <span class="info-value">${escapeHtml(r.month)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Payment Method
            </span>
            <div class="payment-chip">
              <span>${icon}</span>
              <span class="payment-chip-label">${escapeHtml(r.paymentMethod)}</span>
            </div>
          </div>
          ${
            r.transactionId
              ? `
          <div class="info-row">
            <span class="info-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
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
              <div class="amt-item-val amt-fee">৳${r.feeAmount.toLocaleString('en-IN')}</div>
            </div>
            ${
              discount > 0
                ? `
            <div class="amt-divider"></div>
            <div class="amt-item">
              <div class="amt-item-label">Discount</div>
              <div class="amt-item-val amt-disc">−৳${discount.toLocaleString('en-IN')}</div>
            </div>`
                : ''
            }
          </div>
          <div class="total-row">
            <span class="total-label">Amount Paid &nbsp;·&nbsp; পরিশোধিত</span>
            <span class="total-val">৳${finalAmount.toLocaleString('en-IN')}</span>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div class="footer">
        <div class="footer-thanks">ধন্যবাদ আপনার পেমেন্টের জন্য 🎉</div>
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

  const container = document.createElement('div');
  container.innerHTML = html;
  container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;z-index:-1;visibility:hidden;';
  container.style.width = '420px';
  document.body.appendChild(container);

  try {
    // The template above is a whole document; when injected via innerHTML the
    // browser keeps <meta> elements and drops the html/head/body wrappers, so
    // firstElementChild is the charset meta tag (display:none) — rendering it
    // gives a 0x0 canvas and jsPDF throws "wrong PNG signature". Target the
    // receipt root explicitly.
    const el = container.querySelector<HTMLElement>('.receipt');
    if (!el) {
      throw new Error('Failed to create receipt container');
    }

    const { html2canvas, jsPDF } = await loadPdfLibs();

    // Wait for fonts and assets
    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 300));

    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'px',
      format: [canvas.width, canvas.height],
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
    pdf.save(`receipt-${r.receiptNo}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
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

  const html = /* html */ `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Result Card</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', 'Noto Sans Bengali', sans-serif;
      background: #f0f4f8;
      display: flex; justify-content: center; align-items: flex-start;
      min-height: 100vh; padding: 32px 16px;
    }
    .wrap { display: flex; flex-direction: column; align-items: center; gap: 16px; }
    .card {
      width: 420px; background: #fff; border-radius: 20px;
      overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.15);
    }
    .header {
      background: linear-gradient(135deg, #0b1120 0%, #0f1f3d 60%, ${passed ? '#065f46' : '#7f1d1d'} 100%);
      padding: 28px 28px 36px; position: relative; overflow: hidden;
    }
    .header::before {
      content: ''; position: absolute; top: -40px; right: -40px;
      width: 160px; height: 160px; border-radius: 50%;
      background: rgba(${passed ? '52,211,153' : '248,113,113'},0.1);
    }
    .inst-row { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; position: relative; z-index: 1; }
    .inst-logo {
      width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
      background: linear-gradient(135deg, ${passed ? '#34d399,#10b981' : '#f87171,#ef4444'});
      display: flex; align-items: center; justify-content: center; font-size: 20px;
    }
    .inst-name { font-size: 16px; font-weight: 800; color: #fff; }
    .result-badge {
      position: relative; z-index: 1;
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(${passed ? '52,211,153' : '248,113,113'},0.15);
      border: 1px solid rgba(${passed ? '52,211,153' : '248,113,113'},0.3);
      border-radius: 100px; padding: 5px 14px; margin-bottom: 14px;
    }
    .result-badge span { font-size: 11px; font-weight: 700; color: ${passed ? '#34d399' : '#f87171'}; letter-spacing: 0.8px; text-transform: uppercase; }
    .score-row { display: flex; align-items: flex-end; justify-content: space-between; position: relative; z-index: 1; }
    .score-big { font-size: 52px; font-weight: 900; line-height: 1; color: ${passed ? '#34d399' : '#f87171'}; }
    .score-sub { font-size: 12px; color: rgba(255,255,255,0.5); margin-bottom: 4px; }
    .grade-pill {
      background: rgba(167,139,250,0.2); border: 1px solid rgba(167,139,250,0.35);
      border-radius: 100px; padding: 6px 18px; color: #a78bfa;
      font-size: 20px; font-weight: 900; letter-spacing: 1px;
    }
    .curve { height: 28px; background: linear-gradient(135deg, #0b1120 0%, #0f1f3d 60%, ${passed ? '#065f46' : '#7f1d1d'} 100%); position: relative; }
    .curve::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 28px; background: #fff; border-radius: 28px 28px 0 0; }
    .body { padding: 20px 28px 28px; }
    .student-card {
      background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
      border: 1px solid #bae6fd; border-radius: 14px;
      padding: 14px 18px; display: flex; align-items: center; gap: 14px; margin-bottom: 18px;
    }
    .avatar {
      width: 44px; height: 44px; border-radius: 12px;
      background: linear-gradient(135deg, #0ea5e9, #38bdf8);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700; color: #fff; flex-shrink: 0;
    }
    .student-name { font-size: 15px; font-weight: 700; color: #0c1a2e; font-family: 'Noto Sans Bengali', sans-serif; }
    .student-id { font-size: 12px; color: #0369a1; margin-top: 2px; font-weight: 500; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 18px; }
    .stat-box { background: #f8fafc; border-radius: 12px; padding: 12px 8px; text-align: center; border: 1px solid #e2e8f0; }
    .stat-val { font-size: 20px; font-weight: 800; margin-bottom: 2px; }
    .stat-correct { color: #10b981; }
    .stat-wrong { color: #ef4444; }
    .stat-skip { color: #94a3b8; }
    .stat-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Noto Sans Bengali', sans-serif; }
    .info-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .info-row:last-child { border-bottom: none; }
    .info-label { font-size: 12px; color: #94a3b8; }
    .info-val { font-size: 13px; color: #1e293b; font-weight: 600; font-family: 'Noto Sans Bengali', sans-serif; }
    .pass-stamp {
      margin-top: 18px;
      background: ${passed ? 'linear-gradient(135deg,#d1fae5,#a7f3d0)' : 'linear-gradient(135deg,#fee2e2,#fecaca)'};
      border: 2px solid ${passed ? '#34d399' : '#f87171'};
      border-radius: 14px; padding: 14px;
      text-align: center;
      color: ${passed ? '#065f46' : '#7f1d1d'};
    }
    .pass-stamp-icon { font-size: 28px; margin-bottom: 4px; }
    .pass-stamp-text { font-size: 18px; font-weight: 900; letter-spacing: 1px; }
    .pass-stamp-sub { font-size: 11px; margin-top: 4px; opacity: 0.7; font-family: 'Noto Sans Bengali', sans-serif; }
    .footer { background: #f8fafc; border-top: 1px dashed #e2e8f0; padding: 16px 28px; text-align: center; }
    .footer-sub { font-size: 10px; color: #94a3b8; }
    .watermark { font-size: 9px; color: #cbd5e1; text-align: center; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">
        <div class="inst-row">
          <div class="inst-logo">🎓</div>
          <div class="inst-name">${escapeHtml(r.instituteName)}</div>
        </div>
        <div class="result-badge">
          <span>Result Card &nbsp;·&nbsp; ফলাফল কার্ড</span>
        </div>
        <div class="score-row">
          <div>
            <div class="score-sub">Score</div>
            <div class="score-big">${pct}<span style="font-size:24px;font-weight:600">%</span></div>
            <div style="color:rgba(255,255,255,0.5);font-size:12px;margin-top:2px">${r.score} / ${r.totalMarks}</div>
          </div>
          <div class="grade-pill">${grade}</div>
        </div>
      </div>
      <div class="curve"></div>
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
            <div class="stat-val stat-skip">${r.timeTaken ? fmtTime(r.timeTaken) : '—'}</div>
            <div class="stat-label">সময়</div>
          </div>
        </div>

        <div style="margin-bottom:18px">
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
          ${r.rank ? `<div class="info-row"><span class="info-label">Rank</span><span class="info-val" style="color:#a78bfa">#${r.rank}</span></div>` : ''}
          <div class="info-row">
            <span class="info-label">Date</span>
            <span class="info-val">${escapeHtml(r.submittedAt)}</span>
          </div>
        </div>

        <div class="pass-stamp">
          <div class="pass-stamp-icon">${passed ? '🎉' : '😔'}</div>
          <div class="pass-stamp-text">${passed ? 'PASSED' : 'FAILED'}</div>
          <div class="pass-stamp-sub">${passed ? 'অভিনন্দন! তুমি পরীক্ষায় পাস করেছ।' : 'আরও পড়াশোনা করো। পরেরবার পারবে!'}</div>
        </div>
      </div>
      <div class="footer">
        <div class="footer-sub">Computer-generated result card &nbsp;·&nbsp; ${escapeHtml(r.instituteName)}</div>
        <div class="watermark">© ${new Date().getFullYear()} ${escapeHtml(r.instituteName)} · All rights reserved</div>
      </div>
    </div>
  </div>
</body>
</html>`;

  const container = document.createElement('div');
  container.innerHTML = html;
  container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;z-index:-1;visibility:hidden;';
  container.style.width = '420px';
  document.body.appendChild(container);

  try {
    // Same whole-document template gotcha as generateReceipt: target the card
    // root instead of the injected <meta> tag.
    const el = container.querySelector<HTMLElement>('.card');
    if (!el) {
      throw new Error('Failed to create result card container');
    }

    const { html2canvas, jsPDF } = await loadPdfLibs();

    // Wait for fonts and assets
    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 300));

    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');
    const pageWidth = 420;
    const pageHeight = (canvas.height / canvas.width) * pageWidth;

    const pdf = new jsPDF({
      orientation: pageHeight > pageWidth ? 'portrait' : 'portrait',
      unit: 'px',
      format: [pageWidth, pageHeight],
    });

    pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
    pdf.save(`result-card-${r.studentName.replace(/\s+/g, '-').toLowerCase()}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
