// POS-style thermal document (80 mm roll) built directly with jsPDF — no
// html2canvas, so it renders instantly.
//
// Layout guarantee: every string is hard-wrapped to the roll width (tokens
// longer than a line are split character by character), and the page height is
// measured from the drawn content — nothing is clipped and there is no blank
// tail.

export interface PosReceiptData {
  receiptNo: string;
  date: string;
  instituteName: string;
  instituteAddress?: string;
  institutePhone?: string;
  /** Student block */
  studentName: string;
  studentId?: string;
  batchName?: string;
  month: string;
  /** Money */
  feeAmount: number;
  discount?: number;
  finalAmount: number;
  /** Payment */
  paymentMethod: string;
  transactionId?: string;
  receivedBy?: string;
  /** Optional line-item label override */
  itemLabel?: string;
  /** 'receipt' (paid, default) or 'invoice' (bill awaiting payment) */
  kind?: 'receipt' | 'invoice';
  dueDate?: string;
}

type Doc = InstanceType<typeof import('jspdf').jsPDF>;
type DocCtor = typeof import('jspdf').jsPDF;

export const ROLL_WIDTH = 227; // 80 mm ≈ 226.77 pt
export const CONTENT_MARGIN = 14;
const ROLL_W = ROLL_WIDTH;
const M = CONTENT_MARGIN;
const CW = ROLL_W - M * 2; // content width
const MIN_H = 200;

const money = (n: number) => 'Tk ' + (Number.isFinite(n) ? n : 0).toLocaleString('en-US');

/**
 * Wraps text to `maxW` for the given font. Words that cannot fit on a line at
 * all are broken per character, so no string can run past the roll edge.
 */
export function wrapText(pdf: Doc, text: string, size: number, style: 'normal' | 'bold', maxW: number): string[] {
  pdf.setFont('courier', style);
  pdf.setFontSize(size);
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim() || '-';
  if (!(maxW > 6)) return []; // no usable room — caller draws nothing

  // 1. split over-long tokens into chunks that fit
  const chunks: string[] = [];
  for (const word of raw.split(' ')) {
    if (pdf.getTextWidth(word) <= maxW) {
      chunks.push(word);
      continue;
    }
    let cur = '';
    for (const ch of word) {
      if (pdf.getTextWidth(cur + ch) <= maxW) cur += ch;
      else {
        if (cur) chunks.push(cur);
        cur = ch;
      }
    }
    if (cur) chunks.push(cur);
  }

  // 2. greedy line filling
  const lines: string[] = [];
  let line = '';
  for (const c of chunks) {
    const next = line ? `${line} ${c}` : c;
    if (!line || pdf.getTextWidth(next) <= maxW) line = next;
    else {
      lines.push(line);
      line = c;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
}

/**
 * Hard-clips one line to `maxW` (with a plain ".." tail). Used for values that
 * must never wrap — money amounts and the label column — so a huge figure can
 * never push past the roll edge.
 */
export function clipText(pdf: Doc, text: string, size: number, style: 'normal' | 'bold', maxW: number): string {
  pdf.setFont('courier', style);
  pdf.setFontSize(size);
  let out = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!out) return '-';
  if (pdf.getTextWidth(out) <= maxW) return out;
  while (out.length > 1 && pdf.getTextWidth(out + '..') > maxW) out = out.slice(0, -1);
  return maxW >= pdf.getTextWidth(out + '..') ? out + '..' : out;
}

/** Draws the document on the given page and returns the last baseline used. */
function render(pdf: Doc, data: PosReceiptData): number {
  const W = pdf.internal.pageSize.getWidth();
  const isInvoice = data.kind === 'invoice';
  let y = 20;

  const center = (txt: string, size: number, style: 'normal' | 'bold' = 'normal', color = 20) => {
    const lines = wrapText(pdf, txt, size, style, CW);
    pdf.setFont('courier', style);
    pdf.setFontSize(size);
    pdf.setTextColor(color);
    for (const l of lines) {
      pdf.text(l, W / 2, y, { align: 'center' });
      y += size + 3;
    }
  };
  const divider = () => {
    pdf.setDrawColor(60);
    pdf.setLineWidth(0.7);
    pdf.line(M, y, W - M, y);
    y += 10;
  };
  const dashed = () => {
    pdf.setDrawColor(120);
    pdf.setLineWidth(0.5);
    const seg = 3;
    const gap = 2;
    let x = M;
    while (x < W - M) {
      pdf.line(x, y, Math.min(x + seg, W - M), y);
      x += seg + gap;
    }
    y += 9;
  };
  /** bold label column + wrapped value column */
  const kv = (k: string, v: string) => {
    const labelW = 52;
    const kTxt = clipText(pdf, k, 7.5, 'bold', labelW);
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(20);
    pdf.text(kTxt, M, y);
    const lines = wrapText(pdf, v, 7.5, 'normal', CW - labelW - 4);
    pdf.setFont('courier', 'normal');
    for (const l of lines) {
      pdf.text(l, M + labelW, y);
      y += 9;
    }
  };
  /** wrapped label on the left, amount right-aligned */
  const amountRow = (label: string, amt: string, opts: { bold?: boolean; size?: number; color?: number } = {}) => {
    const size = opts.size ?? 8;
    const style: 'normal' | 'bold' = opts.bold ? 'bold' : 'normal';
    pdf.setFont('courier', style);
    pdf.setFontSize(size);
    const amtTxt = clipText(pdf, amt, size, style, CW * 0.6);
    const amtW = pdf.getTextWidth(amtTxt) + 6;
    const lines = wrapText(pdf, label, size, style, CW - amtW);
    pdf.setTextColor(opts.color ?? 20);
    lines.forEach((l, i) => pdf.text(l, M, y + i * (size + 2)));
    pdf.text(amtTxt, W - M, y, { align: 'right' });
    y += Math.max(1, lines.length) * (size + 2);
  };

  /* ── header ── */
  center((data.instituteName || 'Techely Learning Center').toUpperCase(), 12, 'bold');
  if (data.instituteAddress) center(data.instituteAddress, 6.5, 'normal', 70);
  if (data.institutePhone) center('Phone: ' + data.institutePhone, 6.5, 'normal', 70);
  y += 2;
  divider();
  center(isInvoice ? 'FEE INVOICE' : 'FEE PAYMENT RECEIPT', 8, 'bold', 60);
  y += 4;

  /* ── meta ── */
  pdf.setFont('courier', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(20);
  for (const t of [(isInvoice ? 'Invoice: ' : 'Receipt: ') + data.receiptNo, 'Date: ' + data.date]) {
    for (const l of wrapText(pdf, t, 7.5, 'normal', CW)) {
      pdf.text(l, M, y);
      y += 10;
    }
  }
  y += 1;
  dashed();
  y += 2;

  /* ── student ── */
  kv('Student', data.studentName);
  if (data.studentId) kv('ID', data.studentId);
  if (data.batchName) kv('Batch', data.batchName);
  kv('Month', data.month);
  y += 2;
  dashed();
  y += 2;

  /* ── item table ── */
  // jsPDF's courier (WinAnsi) drops non-ASCII punctuation, so keep it plain.
  const label = data.itemLabel || `Tuition Fee - ${data.month}`;
  const qtyW = 22;
  const amtTxt = clipText(pdf, money(data.feeAmount), 7.5, 'normal', CW * 0.35);
  const amtW = pdf.getTextWidth(amtTxt) + 6;
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(20);
  pdf.text('ITEM', M, y);
  pdf.text('QTY', W - M - amtW - 18, y, { align: 'right' });
  pdf.text('AMT', W - M, y, { align: 'right' });
  y += 6;
  dashed();
  y += 2;

  const labelLines = wrapText(pdf, label, 7.5, 'bold', CW - qtyW - amtW);
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(20);
  labelLines.forEach((l, i) => pdf.text(l, M, y + i * 9));
  pdf.setFont('courier', 'normal');
  pdf.text('1', W - M - amtW, y, { align: 'right' });
  pdf.text(amtTxt, W - M, y, { align: 'right' });
  y += Math.max(1, labelLines.length) * 9 + 4;
  dashed();
  y += 2;

  /* ── totals ── */
  const discount = data.discount ?? 0;
  const finalAmount = data.finalAmount ?? data.feeAmount;
  amountRow('Subtotal', money(data.feeAmount));
  if (discount > 0) amountRow('Discount', '-' + money(discount), { color: 160 });
  y += 2;
  divider();
  amountRow('GRAND TOTAL', money(finalAmount), { bold: true, size: 10 });
  y += 1;
  divider();

  /* ── payment / status ── */
  if (isInvoice) {
    kv('Status', 'UNPAID');
    if (data.dueDate) kv('Pay by', data.dueDate);
    kv('Amount Due', money(finalAmount));
  } else {
    const method = String(data.paymentMethod || 'Cash');
    kv('Paid via', method.charAt(0).toUpperCase() + method.slice(1));
    if (data.transactionId) kv('Txn ID', data.transactionId);
    if (data.receivedBy) kv('Received', data.receivedBy);
  }
  y += 2;
  dashed();
  y += 3;

  /* ── footer ── */
  center(isInvoice ? 'Please pay by the due date.' : 'Thank you!', 8, 'bold');
  center(data.instituteName || 'Techely Learning Center', 6.5, 'normal', 90);
  center('- - - - - - - - - - - - - - - -', 8, 'normal', 160);

  return y;
}

function makeDoc(jsPDF: DocCtor, height: number): Doc {
  return new jsPDF({ unit: 'pt', format: [ROLL_W, height], orientation: 'portrait' }) as Doc;
}

/** Builds the document (exposed so tests can render it with a tracing jsPDF). */
export function buildPosDoc(data: PosReceiptData, jsPDF: DocCtor): Doc {
  // Pass 1 — measure on a throwaway tall page.
  const measured = render(makeDoc(jsPDF, 2000), data);
  const height = Math.max(MIN_H, Math.ceil(measured + 18));

  // Pass 2 — real page, exactly as tall as the content needs.
  const pdf = makeDoc(jsPDF, height);
  render(pdf, data);
  return pdf;
}

/** Builds and downloads an 80 mm POS document (receipt or invoice). */
export async function downloadPosReceipt(data: PosReceiptData): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = buildPosDoc(data, jsPDF);
  const safe = String(data.receiptNo || 'receipt').replace(/[^\w-]+/g, '');
  pdf.save(`Techely-${data.kind === 'invoice' ? 'invoice' : 'receipt'}-${safe}.pdf`);
}
