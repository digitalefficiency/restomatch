/**
 * Mock invoice audit records. Each record represents a single invoice
 * that was scanned by the receiver and processed through the matching
 * engine. The detail includes the full 3-way comparison (PO ↔ Received
 * ↔ Invoice) plus the action timeline.
 */

import { localDayMonth } from '../../_lib/time';

export type InvoiceAuditStatus = 'clean' | 'minor' | 'major' | 'blocked';

export type LineComparisonStatus =
  | 'matched'
  | 'qty_short'
  | 'qty_over'
  | 'price_higher'
  | 'price_lower'
  | 'unordered'
  | 'missing_from_invoice';

export interface LineComparison {
  productName: string;
  unit: string;
  poQty: number | null;
  poUnitPrice: number | null;
  receivedQty: number | null;
  invoiceQty: number | null;
  invoiceUnitPrice: number | null;
  status: LineComparisonStatus;
  variance: number; // ILS ex-VAT, derived: billed − approved for this line (positive = loss)
  note?: string; // why this line was flagged or adjusted
}

export interface AuditTimelineEvent {
  at: string; // ISO
  actor: string;
  role: 'employee' | 'system' | 'manager' | 'owner';
  action: string;
  detail?: string;
}

export interface InvoiceAuditRecord {
  id: string;
  invoiceNumber: string;
  /** The order it was received against — same numbers as the receiver demo and the feed. */
  poNumber: string;
  supplierId: string;
  supplierName: string;
  supplierInitials: string;
  /**
   * Object-storage URL where the receiver's phone photo of the original
   * invoice is stored (simulated via a Next.js page route at
   * /scans/[invoiceId]). The UI loads this as an <iframe> so the
   * architecture mirrors fetching a JPG/PDF from S3 in production.
   */
  rawImageUrl: string;
  scannedAt: string;
  scannedBy: string;
  approvedAt: string;
  approvedBy: string;
  status: InvoiceAuditStatus;
  totalInvoiceIls: number; // what supplier billed
  totalApprovedIls: number; // what employee said arrived (adjusted)
  discrepanciesCount: number;
  savingsCapturedIls: number; // money saved by employee catching+adjusting
  potentialLossIls: number; // money that would have been lost without adjustment
  lines: LineComparison[];
  timeline: AuditTimelineEvent[];
}

const today = new Date();
function isoAt(hour: number, minute = 0): string {
  const d = new Date(today);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** When INV-4882's number was first filed — the duplicate check points back here. */
export const INV_4882_FIRST_SEEN = isoDaysAgo(9, 10, 40);

/** `isoAt(h, m)` N days back — every showcase date is relative to today. */
export function isoDaysAgo(days: number, hour: number, minute = 0): string {
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

type RecordInput = Omit<
  InvoiceAuditRecord,
  | 'lines'
  | 'discrepanciesCount'
  | 'totalInvoiceIls'
  | 'totalApprovedIls'
  | 'savingsCapturedIls'
  | 'potentialLossIls'
> & { lines: Omit<LineComparison, 'variance'>[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every ₪ on an audit record is DERIVED from its lines (ex-VAT, like supplier
 * price lists), so the header tiles, the line variances, the PO comparison and
 * the rendered scan can never disagree:
 *   billed   = Σ invoiceQty × invoiceUnitPrice
 *   approved = Σ receivedQty × agreed price (the PO price; an unordered item the
 *              team accepted counts at its invoiced price)
 *   variance = billed − approved, per line;  caught = Σ variance
 * A blocked invoice (e.g. a duplicate) approves nothing: the whole bill is caught.
 * discrepanciesCount = lines not `matched` (a blocked invoice counts at least 1).
 */
function audit(input: RecordInput): InvoiceAuditRecord {
  const blocked = input.status === 'blocked';
  const lines: LineComparison[] = input.lines.map((l) => {
    const billed = (l.invoiceQty ?? 0) * (l.invoiceUnitPrice ?? 0);
    const approved = (l.receivedQty ?? 0) * (l.poUnitPrice ?? l.invoiceUnitPrice ?? 0);
    return { ...l, variance: blocked ? 0 : round2(billed - approved) };
  });
  const billed = round2(input.lines.reduce((s, l) => s + (l.invoiceQty ?? 0) * (l.invoiceUnitPrice ?? 0), 0));
  const caught = blocked ? billed : round2(lines.reduce((s, l) => s + l.variance, 0));
  const flagged = lines.filter((l) => l.status !== 'matched').length;
  return {
    ...input,
    lines,
    discrepanciesCount: blocked ? Math.max(1, flagged) : flagged,
    totalInvoiceIls: billed,
    totalApprovedIls: round2(billed - caught),
    savingsCapturedIls: caught,
    potentialLossIls: caught,
  };
}

const AUTHORED: RecordInput[] = [
  {
    id: 'inv-7821',
    poNumber: 'PO-1234',
    invoiceNumber: 'INV-7821',
    supplierId: 'sup-avi',
    rawImageUrl: '/scans/inv-7821',
    supplierName: 'ירקני אבי',
    supplierInitials: 'יא',
    scannedAt: isoAt(8, 12),
    scannedBy: 'יוסי כהן',
    approvedAt: isoAt(8, 18),
    approvedBy: 'יוסי כהן',
    status: 'major',
    lines: [
      {
        productName: 'עגבניה שרי',
        unit: 'ק״ג',
        poQty: 20,
        poUnitPrice: 7,
        receivedQty: 20,
        invoiceQty: 20,
        invoiceUnitPrice: 8.5,
        status: 'price_higher',
        note: 'מחיר עלה ב-21% מהממוצע. העובד התעקש על מחיר ההזמנה.',
      },
      {
        productName: 'מלפפון חממה',
        unit: 'ק״ג',
        poQty: 15,
        poUnitPrice: 6,
        receivedQty: 15,
        invoiceQty: 15,
        invoiceUnitPrice: 6,
        status: 'matched',
      },
      {
        productName: 'פלפל אדום',
        unit: 'ק״ג',
        poQty: 8,
        poUnitPrice: 12,
        receivedQty: 7.5,
        invoiceQty: 8,
        invoiceUnitPrice: 12,
        status: 'qty_short',
        note: 'התקבל פחות מההזמנה. חויב על הכמות המלאה.',
      },
      {
        productName: 'חסה אייסברג',
        unit: 'יח׳',
        poQty: 12,
        poUnitPrice: 7.5,
        receivedQty: 12,
        invoiceQty: 12,
        invoiceUnitPrice: 7.5,
        status: 'matched',
      },
      {
        productName: 'נענע',
        unit: 'יח׳',
        poQty: null,
        poUnitPrice: null,
        receivedQty: 4,
        invoiceQty: 4,
        invoiceUnitPrice: 4.5,
        status: 'unordered',
        note: 'הספק הוסיף פריט שלא הוזמן. העובד אישר את הקבלה.',
      },
      {
        productName: 'פטרוזיליה',
        unit: 'יח׳',
        poQty: 2,
        poUnitPrice: 3,
        receivedQty: null,
        invoiceQty: null,
        invoiceUnitPrice: null,
        status: 'missing_from_invoice',
        note: 'הוזמן ולא סופק — לא חויב.',
      },
    ],
    timeline: [
      {
        at: isoAt(8, 5),
        actor: 'מערכת',
        role: 'system',
        action: 'PO #1234 הופעל לקבלה',
      },
      {
        at: isoAt(8, 12),
        actor: 'יוסי כהן',
        role: 'employee',
        action: 'צילם את החשבונית',
        detail: 'OCR בביטחון 94%',
      },
      {
        at: isoAt(8, 13),
        actor: 'מערכת',
        role: 'system',
        action: 'זיהתה 4 חריגות',
        detail: 'מחיר גבוה, כמות חסרה, פריט לא בהזמנה, פריט שלא סופק',
      },
      {
        at: isoAt(8, 16),
        actor: 'יוסי כהן',
        role: 'employee',
        action: 'עדכן כמות פלפל אדום',
        detail: 'מ-8 ק״ג ל-7.5 ק״ג',
      },
      {
        at: isoAt(8, 18),
        actor: 'יוסי כהן',
        role: 'employee',
        action: 'סגר את הקבלה',
        detail: '4 סטטוסים סודרו · 1 לאישור מנהל',
      },
    ],
  },
  {
    id: 'inv-7822',
    poNumber: 'PO-1235',
    invoiceNumber: 'INV-4882',
    supplierId: 'sup-kerem',
    rawImageUrl: '/scans/inv-7822',
    supplierName: 'קצביית הכרם',
    supplierInitials: 'קה',
    scannedAt: isoAt(9, 35),
    scannedBy: 'דנה לוי',
    approvedAt: isoAt(9, 35),
    approvedBy: 'מערכת',
    status: 'blocked',
    lines: [
      {
        productName: 'אנטריקוט',
        unit: 'ק״ג',
        poQty: 16,
        poUnitPrice: 145,
        receivedQty: 16,
        invoiceQty: 16,
        invoiceUnitPrice: 145,
        status: 'matched',
      },
      {
        productName: 'חזה עוף',
        unit: 'ק״ג',
        poQty: 18,
        poUnitPrice: 38,
        receivedQty: 18,
        invoiceQty: 18,
        invoiceUnitPrice: 38,
        status: 'matched',
      },
      {
        productName: 'כבד עוף',
        unit: 'ק״ג',
        poQty: 13,
        poUnitPrice: 32,
        receivedQty: 13,
        invoiceQty: 13,
        invoiceUnitPrice: 32,
        status: 'matched',
      },
    ],
    timeline: [
      {
        at: isoAt(9, 35),
        actor: 'דנה לוי',
        role: 'employee',
        action: 'צילמה את החשבונית',
      },
      {
        at: isoAt(9, 35),
        actor: 'מערכת',
        role: 'system',
        action: 'חשבונית כפולה זוהתה',
        detail: `INV-4882 כבר קיימת מ-${localDayMonth(INV_4882_FIRST_SEEN)}`,
      },
      {
        at: isoAt(9, 35),
        actor: 'מערכת',
        role: 'system',
        action: 'תשלום נחסם אוטומטית',
        detail: 'נשלחה התראה לחשב + בעלים',
      },
    ],
  },
  {
    id: 'inv-7823',
    poNumber: 'PO-1236',
    invoiceNumber: 'INV-2210',
    supplierId: 'sup-brans',
    rawImageUrl: '/scans/inv-7823',
    supplierName: 'מאפיית ברנס',
    supplierInitials: 'מב',
    scannedAt: isoAt(6, 8),
    scannedBy: 'יוסי כהן',
    approvedAt: isoAt(6, 10),
    approvedBy: 'יוסי כהן',
    status: 'clean',
    lines: [
      {
        productName: 'לחמניות שום',
        unit: 'יח׳',
        poQty: 30,
        poUnitPrice: 4,
        receivedQty: 30,
        invoiceQty: 30,
        invoiceUnitPrice: 4,
        status: 'matched',
      },
      {
        productName: 'לחם פרוס',
        unit: 'יח׳',
        poQty: 6,
        poUnitPrice: 18,
        receivedQty: 6,
        invoiceQty: 6,
        invoiceUnitPrice: 18,
        status: 'matched',
      },
    ],
    timeline: [
      {
        at: isoAt(6, 8),
        actor: 'יוסי כהן',
        role: 'employee',
        action: 'צילם את החשבונית',
      },
      {
        at: isoAt(6, 9),
        actor: 'מערכת',
        role: 'system',
        action: 'התאמה מלאה',
        detail: '2/2 פריטים תואמים',
      },
      {
        at: isoAt(6, 10),
        actor: 'יוסי כהן',
        role: 'employee',
        action: 'אישר אוטומטית',
      },
    ],
  },
  {
    id: 'inv-7824',
    poNumber: 'PO-1237',
    invoiceNumber: 'INV-9012',
    supplierId: 'sup-kobi',
    rawImageUrl: '/scans/inv-7824',
    supplierName: 'דגי קובי',
    supplierInitials: 'דק',
    scannedAt: isoAt(11, 5),
    scannedBy: 'דנה לוי',
    approvedAt: isoAt(11, 15),
    approvedBy: 'דנה לוי',
    status: 'major',
    lines: [
      {
        productName: 'סלמון נורווגי',
        unit: 'ק״ג',
        poQty: 4,
        poUnitPrice: 195,
        receivedQty: 3.2,
        invoiceQty: 4,
        invoiceUnitPrice: 195,
        status: 'qty_short',
        note: 'התקבל 3.2 ק״ג בלבד. דנה תפסה — חויב על 4 ק״ג מלאים.',
      },
      {
        productName: 'דניס',
        unit: 'ק״ג',
        poQty: 5,
        poUnitPrice: 85,
        receivedQty: 5,
        invoiceQty: 5,
        invoiceUnitPrice: 92,
        status: 'price_higher',
        note: 'מחיר עלה ב-8.2% מההזמנה. ממתין לבירור עם הספק.',
      },
    ],
    timeline: [
      {
        at: isoAt(11, 5),
        actor: 'דנה לוי',
        role: 'employee',
        action: 'צילמה את החשבונית',
      },
      {
        at: isoAt(11, 7),
        actor: 'מערכת',
        role: 'system',
        action: 'זיהתה 2 חריגות',
        detail: 'כמות קצרה + מחיר גבוה',
      },
      {
        at: isoAt(11, 12),
        actor: 'דנה לוי',
        role: 'employee',
        action: 'עדכנה כמות סלמון',
        detail: 'מ-4 ל-3.2 ק״ג',
      },
      {
        at: isoAt(11, 15),
        actor: 'דנה לוי',
        role: 'employee',
        action: 'סגרה את הקבלה',
        detail: 'מחיר דניס מסומן לבירור',
      },
    ],
  },
  {
    id: 'inv-7825',
    poNumber: 'PO-1238',
    invoiceNumber: 'INV-3344',
    supplierId: 'sup-shegev',
    rawImageUrl: '/scans/inv-7825',
    supplierName: 'אלכוהול שגב',
    supplierInitials: 'אש',
    scannedAt: isoAt(14, 22),
    scannedBy: 'יוסי כהן',
    approvedAt: isoAt(14, 25),
    approvedBy: 'יוסי כהן',
    status: 'minor',
    lines: [
      {
        productName: 'יין אדום קברנה',
        unit: 'בק׳',
        poQty: 24,
        poUnitPrice: 95,
        receivedQty: 24,
        invoiceQty: 24,
        invoiceUnitPrice: 95,
        status: 'matched',
      },
      {
        productName: 'וודקה גריי גוס',
        unit: 'בק׳',
        poQty: 6,
        poUnitPrice: 320,
        receivedQty: 6,
        invoiceQty: 6,
        invoiceUnitPrice: 320,
        status: 'matched',
      },
      {
        productName: 'תוויות מבצע',
        unit: 'יח׳',
        poQty: null,
        poUnitPrice: null,
        receivedQty: 80,
        invoiceQty: 80,
        invoiceUnitPrice: 0,
        status: 'unordered',
        note: 'תוויות שיווק חינם מהספק. נרשם לתיעוד.',
      },
    ],
    timeline: [
      {
        at: isoAt(14, 22),
        actor: 'יוסי כהן',
        role: 'employee',
        action: 'צילם את החשבונית',
      },
      {
        at: isoAt(14, 23),
        actor: 'מערכת',
        role: 'system',
        action: 'זיהתה פריט לא בהזמנה',
        detail: 'תוויות בעלות 0 — לא נדרשת התערבות',
      },
      {
        at: isoAt(14, 25),
        actor: 'יוסי כהן',
        role: 'employee',
        action: 'אישר את הקבלה',
      },
    ],
  },
];

export const MOCK_INVOICE_AUDITS: InvoiceAuditRecord[] = AUTHORED.map(audit);

export function statsForToday(records: InvoiceAuditRecord[]) {
  const totalScanned = records.length;
  const withDiscrepancies = records.filter((r) => r.discrepanciesCount > 0).length;
  const savingsCaptured = records.reduce((s, r) => s + r.savingsCapturedIls, 0);
  const openIssues = records.filter((r) => r.status === 'blocked' || r.status === 'major').length;
  return { totalScanned, withDiscrepancies, savingsCaptured, openIssues };
}
