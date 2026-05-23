/**
 * Mock invoice audit records. Each record represents a single invoice
 * that was scanned by the receiver and processed through the matching
 * engine. The detail includes the full 3-way comparison (PO ↔ Received
 * ↔ Invoice) plus the action timeline.
 */

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
  variance: number; // financial impact in ILS (positive = loss)
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
  supplierName: string;
  supplierInitials: string;
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

export const MOCK_INVOICE_AUDITS: InvoiceAuditRecord[] = [
  {
    id: 'inv-7821',
    invoiceNumber: 'INV-7821',
    supplierName: 'ירקני אבי',
    supplierInitials: 'יא',
    scannedAt: isoAt(8, 12),
    scannedBy: 'יוסי כהן',
    approvedAt: isoAt(8, 18),
    approvedBy: 'יוסי כהן',
    status: 'major',
    totalInvoiceIls: 1284.5,
    totalApprovedIls: 1191.0,
    discrepanciesCount: 3,
    savingsCapturedIls: 93.5,
    potentialLossIls: 93.5,
    lines: [
      {
        productName: 'עגבניה שרי',
        unit: 'ק״ג',
        poQty: 10,
        poUnitPrice: 7,
        receivedQty: 10,
        invoiceQty: 12,
        invoiceUnitPrice: 8.5,
        status: 'price_higher',
        variance: 30, // (8.5-7) * 10 + (12-10)*7 caught
        note: 'מחיר עלה ב-21% מהממוצע. העובד התעקש על מחיר ההזמנה.',
      },
      {
        productName: 'מלפפון חממה',
        unit: 'ק״ג',
        poQty: 5,
        poUnitPrice: 6,
        receivedQty: 5,
        invoiceQty: 5,
        invoiceUnitPrice: 6,
        status: 'matched',
        variance: 0,
      },
      {
        productName: 'פלפל אדום',
        unit: 'ק״ג',
        poQty: 3,
        poUnitPrice: 12,
        receivedQty: 2.5,
        invoiceQty: 3,
        invoiceUnitPrice: 12,
        status: 'qty_short',
        variance: 6, // 0.5 * 12
        note: 'התקבל פחות מההזמנה. חויב על הכמות המלאה.',
      },
      {
        productName: 'חסה אייסברג',
        unit: 'יח׳',
        poQty: 4,
        poUnitPrice: 7.5,
        receivedQty: 4,
        invoiceQty: 4,
        invoiceUnitPrice: 7.5,
        status: 'matched',
        variance: 0,
      },
      {
        productName: 'נענע',
        unit: 'יח׳',
        poQty: null,
        poUnitPrice: null,
        receivedQty: 2,
        invoiceQty: 2,
        invoiceUnitPrice: 4.5,
        status: 'unordered',
        variance: 9,
        note: 'הספק הוסיף פריט שלא הוזמן. העובד אישר את הקבלה.',
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
        action: 'זיהתה 3 חריגות',
        detail: 'מחיר גבוה, כמות חסרה, פריט לא בהזמנה',
      },
      {
        at: isoAt(8, 16),
        actor: 'יוסי כהן',
        role: 'employee',
        action: 'עדכן כמות פלפל אדום',
        detail: 'מ-3 ק״ג ל-2.5 ק״ג',
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
    invoiceNumber: 'INV-4882',
    supplierName: 'קצביית הכרם',
    supplierInitials: 'קה',
    scannedAt: isoAt(9, 35),
    scannedBy: 'דנה לוי',
    approvedAt: isoAt(9, 35),
    approvedBy: 'מערכת',
    status: 'blocked',
    totalInvoiceIls: 3420,
    totalApprovedIls: 0,
    discrepanciesCount: 1,
    savingsCapturedIls: 3420,
    potentialLossIls: 3420,
    lines: [
      {
        productName: 'אנטריקוט',
        unit: 'ק״ג',
        poQty: 12,
        poUnitPrice: 145,
        receivedQty: null,
        invoiceQty: 12,
        invoiceUnitPrice: 145,
        status: 'matched',
        variance: 0,
      },
      {
        productName: 'חזה עוף',
        unit: 'ק״ג',
        poQty: 20,
        poUnitPrice: 38,
        receivedQty: null,
        invoiceQty: 20,
        invoiceUnitPrice: 38,
        status: 'matched',
        variance: 0,
      },
      {
        productName: 'כבד עוף',
        unit: 'ק״ג',
        poQty: 6,
        poUnitPrice: 32,
        receivedQty: null,
        invoiceQty: 6,
        invoiceUnitPrice: 32,
        status: 'matched',
        variance: 0,
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
        detail: 'INV-4882 כבר קיימת מ-12/05',
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
    invoiceNumber: 'INV-2210',
    supplierName: 'מאפיית ברנס',
    supplierInitials: 'מב',
    scannedAt: isoAt(6, 8),
    scannedBy: 'יוסי כהן',
    approvedAt: isoAt(6, 10),
    approvedBy: 'יוסי כהן',
    status: 'clean',
    totalInvoiceIls: 240,
    totalApprovedIls: 240,
    discrepanciesCount: 0,
    savingsCapturedIls: 0,
    potentialLossIls: 0,
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
        variance: 0,
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
        variance: 0,
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
    invoiceNumber: 'INV-9012',
    supplierName: 'דגי קובי',
    supplierInitials: 'דק',
    scannedAt: isoAt(11, 5),
    scannedBy: 'דנה לוי',
    approvedAt: isoAt(11, 15),
    approvedBy: 'דנה לוי',
    status: 'major',
    totalInvoiceIls: 1850,
    totalApprovedIls: 1694,
    discrepanciesCount: 2,
    savingsCapturedIls: 156,
    potentialLossIls: 195,
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
        variance: 156,
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
        variance: 35,
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
    invoiceNumber: 'INV-3344',
    supplierName: 'אלכוהול שגב',
    supplierInitials: 'אש',
    scannedAt: isoAt(14, 22),
    scannedBy: 'יוסי כהן',
    approvedAt: isoAt(14, 25),
    approvedBy: 'יוסי כהן',
    status: 'minor',
    totalInvoiceIls: 4280,
    totalApprovedIls: 4280,
    discrepanciesCount: 1,
    savingsCapturedIls: 0,
    potentialLossIls: 0,
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
        variance: 0,
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
        variance: 0,
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
        variance: 0,
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

export function statsForToday(records: InvoiceAuditRecord[]) {
  const totalScanned = records.length;
  const withDiscrepancies = records.filter((r) => r.discrepanciesCount > 0).length;
  const savingsCaptured = records.reduce((s, r) => s + r.savingsCapturedIls, 0);
  const openIssues = records.filter((r) => r.status === 'blocked' || r.status === 'major').length;
  return { totalScanned, withDiscrepancies, savingsCaptured, openIssues };
}
