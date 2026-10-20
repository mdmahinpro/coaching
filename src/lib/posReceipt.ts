// POS-style thermal receipt (80 mm roll) built directly with jsPDF — no
// html2canvas, so it renders instantly and matches the Techely store receipt
// format: courier type, centered header, dashed dividers, GRAND TOTAL block.

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
}

type Doc = InstanceType<typeof import('jspdf').jsPDF>;

const ROLL_W = 227; // 80 mm ≈ 226.77 pt
const M = 14; // side margin
const LABEL_W = 70; // right column for amounts

const money = (n: number) =>
  'Tk ' + (Number.isFinite(n) ? n : 0).toLocaleString('en-US');

function build(data: PosReceiptData, Doc: typeof import('jspdf').jsPDF): Doc {
  const items = 1;
  const estH = 150 + 120 + items * 34 + 140 + 190;
  const pdf = new Doc({
    unit: 'pt',
    format: [ROLL_W, Math.max(620, estH)],
    orientation: 'portrait',
  }) as Doc;

  const W = pdf.internal.pageSize.getWidth();
  let y = 18;

  const center = (txt: string, yy: number, size: number, style = 'normal', color = 20) => {
    pdf.setFont('courier', style);
    pdf.setFontSize(size);
    pdf.setTextColor(color);
    pdf.text(txt, W / 2, yy, { align: 'center' });
  };
  const divider = (yy: number) => {
    pdf.setDrawColor(60);
    pdf.setLineWidth(0.7);
    pdf.line(M, yy, W - M, yy);
  };
  const dashed = (yy: number) => {
    pdf.setDrawColor(120);
    pdf.setLineWidth(0.5);
    const seg = 3;
    const gap = 2;
    let x = M;
    const end = W - M;
    while (x < end) {
      pdf.line(x, yy, Math.min(x + seg, end), yy);
      x += seg + gap;
    }
  };
  const kv = (k: string, v: string) => {
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(20);
    pdf.text(k, M, y);
    pdf.setFont('courier', 'normal');
    const lines = pdf.splitTextToSize(String(v || '-'), W - M - (M + 52));
    pdf.text(lines, M + 52, y);
    y += Math.max(1, lines.length) * 9;
  };
  const sumRow = (label: string, amt: number, neg = false) => {
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(20);
    const lines = pdf.splitTextToSize(label, W - M * 2 - LABEL_W - 6);
    pdf.text(lines, M, y);
    pdf.setTextColor(neg ? 160 : 20);
    pdf.text((neg ? '-' : '') + money(amt), W - M, y, { align: 'right' });
    pdf.setTextColor(20);
    y += Math.max(1, lines.length) * 10;
  };

  /* ── header ── */
  center((data.instituteName || 'Techely Learning Center').toUpperCase(), y, 13, 'bold');
  y += 14;
  if (data.instituteAddress) {
    center(data.instituteAddress, y, 6.5, 'normal', 70);
    y += 10;
  }
  if (data.institutePhone) {
    center('Phone: ' + data.institutePhone, y, 6.5, 'normal', 70);
    y += 10;
  }
  divider(y);
  y += 12;
  center('FEE PAYMENT RECEIPT', y, 8, 'bold', 60);
  y += 15;

  /* ── meta ── */
  pdf.setFont('courier', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(20);
  pdf.text('Receipt: ' + data.receiptNo, M, y);
  y += 10;
  pdf.text('Date: ' + data.date, M, y);
  y += 12;
  dashed(y);
  y += 11;

  /* ── student ── */
  kv('Student', data.studentName);
  if (data.studentId) kv('ID', data.studentId);
  if (data.batchName) kv('Batch', data.batchName);
  kv('Month', data.month);
  y += 3;
  dashed(y);
  y += 12;

  /* ── items ── */
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(7.5);
  pdf.text('ITEM', M, y);
  pdf.text('QTY', W - M - LABEL_W - 24, y, { align: 'right' });
  pdf.text('AMT', W - M, y, { align: 'right' });
  y += 6;
  dashed(y);
  y += 11;

  const label = data.itemLabel || `Tuition Fee — ${data.month}`;
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(20);
  const nameLines = pdf.splitTextToSize(label, W - M * 2 - LABEL_W - 24);
  pdf.text(nameLines, M, y);
  pdf.setFont('courier', 'normal');
  pdf.text('1', W - M - LABEL_W - 24, y, { align: 'right' });
  pdf.text(money(data.feeAmount), W - M, y, { align: 'right' });
  y += Math.max(1, nameLines.length) * 9 + 4;
  dashed(y);
  y += 12;

  /* ── totals ── */
  const discount = data.discount ?? 0;
  const finalAmount = data.finalAmount ?? data.feeAmount;
  sumRow('Subtotal', data.feeAmount);
  if (discount > 0) sumRow('Discount', discount, true);
  y += 3;
  divider(y);
  y += 15;
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(20);
  pdf.text('GRAND TOTAL', M, y);
  pdf.text(money(finalAmount), W - M, y, { align: 'right' });
  y += 12;
  divider(y);
  y += 15;

  /* ── payment ── */
  kv('Paid via', String(data.paymentMethod || 'Cash'));
  if (data.transactionId) kv('Txn ID', data.transactionId);
  if (data.receivedBy) kv('Received', data.receivedBy);
  y += 3;
  dashed(y);
  y += 18;

  /* ── footer ── */
  center('Thank you!', y, 8, 'bold');
  y += 11;
  center(data.instituteName || 'Techely Learning Center', y, 6.5, 'normal', 90);
  y += 10;
  center('- - - - - - - - - - - - - - - -', y + 4, 8, 'normal', 160);

  return pdf;
}

/** Builds and downloads an 80 mm POS receipt PDF. */
export async function downloadPosReceipt(data: PosReceiptData): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = build(data, jsPDF);
  const safe = String(data.receiptNo || 'receipt').replace(/[^\w-]+/g, '');
  pdf.save(`Techely-receipt-${safe}.pdf`);
}
