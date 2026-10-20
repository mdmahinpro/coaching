// Width-safety harness for the 80 mm POS document generator.
// Renders both variants with hostile data using a jsPDF subclass that records
// every text() draw, then asserts each drawn run stays inside the printable
// area (page width minus margins) and above the page bottom.
import fs from 'node:fs';
import { buildPosDoc, ROLL_WIDTH, CONTENT_MARGIN } from '../src/lib/posReceipt.ts';

const { jsPDF } = await import('jspdf');

const out = '/opt/data/cache/scratch/out-pos';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let draws = [];
class Traced extends jsPDF {
  constructor(...args) {
    super(...args);
    const orig = this.text.bind(this);
    this.text = (txt, x, y, opts) => {
      const w = this.getTextWidth(String(txt));
      const align = opts?.align;
      const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      draws.push({
        text: String(txt),
        left,
        right: left + w,
        y,
        pageW: this.internal.pageSize.getWidth(),
        pageH: this.internal.pageSize.getHeight(),
      });
      return orig(txt, x, y, opts);
    };
  }
}

const CASES = [
  {
    name: 'real-world receipt',
    data: {
      receiptNo: 'RCT-20261020-9116', date: 'Oct 20, 2026',
      instituteName: 'Techely Learning Center', instituteAddress: 'Chattogram', institutePhone: '01700000000',
      studentName: 'QA Student 7687', studentId: 'CF260003', batchName: 'QA Batch A', month: 'November 2026',
      feeAmount: 1500, discount: 0, finalAmount: 1500, paymentMethod: 'cash',
      transactionId: 'CASH-8871', receivedBy: 'qa-admin@example.test', kind: 'receipt',
    },
  },
  {
    name: 'real-world invoice',
    data: {
      receiptNo: 'INV-202611-000123', date: 'Oct 20, 2026', instituteName: 'Techely Learning Center',
      studentName: 'QA Student 7687', studentId: 'CF260003', batchName: 'QA Batch A', month: 'November 2026',
      feeAmount: 1500, finalAmount: 1500, paymentMethod: 'cash', kind: 'invoice', dueDate: 'November 2026 10',
    },
  },
  {
    name: 'hostile receipt (long strings, huge amount)',
    data: {
      receiptNo: 'RCT-20261020-999999-EXTREMELY-LONG-RECEIPT-NUMBER-FOR-TESTING',
      date: 'Wednesday, October 20, 2026, 11:47 PM (Asia/Dhaka)',
      instituteName: 'Techely Learning Center Advanced Coaching And Admission Program Chattogram',
      instituteAddress: 'House 12, Road 4, Khulshi Residential Area, Chattogram 4225, Bangladesh',
      institutePhone: '+880 1700 000000 ext. 123456789',
      studentName: 'Mohammad Abdul Karim Chowdhury Siddiqui Rahman Hossain',
      studentId: 'CF2026-VERY-LONG-STUDENT-IDENTIFIER-000345',
      batchName: 'Class Eleven Science Admission Intensive Evening Batch Section B',
      month: 'September October November December 2026 Combined',
      feeAmount: 9876543, discount: 123456, finalAmount: 9753087,
      paymentMethod: 'bank transfer (bKash merchant)',
      transactionId: 'TXN-BKASH-20261020-ABC123XYZ987654321-REFERENCE-LONG',
      receivedBy: 'qa-admin-with-a-long-email-address@example.test',
      itemLabel: 'Tuition Fee plus Library and Lab charges for the combined months - very long label',
      kind: 'receipt',
    },
  },
  {
    name: 'hostile invoice (unbroken tokens)',
    data: {
      receiptNo: 'INVXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      date: 'Oct 20, 2026', instituteName: 'T',
      studentName: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      studentId: 'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
      batchName: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ',
      month: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
      feeAmount: 999999999, finalAmount: 999999999, paymentMethod: 'cash',
      kind: 'invoice', dueDate: 'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN',
    },
  },
];

const minLeft = CONTENT_MARGIN - 0.75;
const maxRight = ROLL_WIDTH - CONTENT_MARGIN + 0.75;
let failures = 0;

for (const c of CASES) {
  draws = [];
  let pdf;
  try {
    pdf = buildPosDoc(c.data, Traced);
  } catch (e) {
    console.log(`FAIL build ${c.name}: ${e.message}`);
    failures += 1;
    continue;
  }
  const bad = draws.filter((d) => d.right > maxRight || d.left < minLeft);
  const outside = draws.filter((d) => d.y > d.pageH - 4 || d.y < 4);
  const worst = draws.reduce((m, d) => (d.right > m.right ? d : m), { right: 0, text: '-' });
  const pageH = pdf.internal.pageSize.getHeight();
  const lastY = draws.reduce((m, d) => Math.max(m, d.y), 0);
  const ok = bad.length === 0 && outside.length === 0;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${c.name}: runs=${draws.length} pageW=${ROLL_WIDTH} printable=[${CONTENT_MARGIN},${ROLL_WIDTH - CONTENT_MARGIN}] ` +
      `maxRight=${worst.right.toFixed(2)} ("${worst.text.slice(0, 24)}") overWidth=${bad.length} offPage=${outside.length} ` +
      `pageH=${pageH.toFixed(0)} lastBaselineY=${lastY.toFixed(1)}`
  );
  for (const b of bad.slice(0, 4)) console.log(`   overflow x=${b.left.toFixed(1)}..${b.right.toFixed(1)} :: "${b.text}"`);
  for (const b of outside.slice(0, 4)) console.log(`   off-page y=${b.y.toFixed(1)} (h=${b.pageH}) :: "${b.text}"`);
  pdf.save(`${out}/Techely-${c.name.replace(/[^\w]+/g, '-')}.pdf`);
}

console.log('files:', fs.readdirSync(out).join(', '));

// Negative control: the harness must be able to SEE an overflowing run.
draws = [];
const ctl = new Traced({ unit: 'pt', format: [ROLL_WIDTH, 300] });
ctl.text('CONTROL-RUN-WIDER-THAN-THE-ROLL-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 0, 10);
const caught = draws.filter((d) => d.right > maxRight || d.left < minLeft).length;
console.log(`control: overflowDetected=${caught > 0} (expected true)`);
if (caught === 0) failures += 1;

console.log(failures === 0 ? 'RESULT: ALL FIT' : `RESULT: ${failures} FAILING CASE(S)`);
