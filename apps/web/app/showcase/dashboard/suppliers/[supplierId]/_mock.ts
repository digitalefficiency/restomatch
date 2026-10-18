/**
 * Deep supplier profile — what the owner sees when drilling into a single
 * supplier from anywhere in the dashboard. Combines price history,
 * delivery performance, recent invoices, and an activity feed.
 */

export interface SupplierMetadata {
  id: string;
  name: string;
  initials: string;
  businessId: string;
  contactPhone: string;
  contactEmail: string;
  contactWhatsapp: string;
  category: string;
  activeSince: string; // YYYY-MM
  deliverySchedule: string; // human-friendly e.g. "ראשון/רביעי, 08:00"
  paymentTerms: string;
}

export interface SupplierKpi {
  cleanDeliveryPct: number;
  cleanDeliveryRestaurantAvg: number;
  avgPriceVariancePct: number;
  monthSpendIls: number;
  prevMonthSpendIls: number;
  openDisputes: number;
  totalInvoicesThisMonth: number;
  flaggedInvoicesThisMonth: number;
}

export interface PriceTrendProduct {
  productId: string;
  name: string;
  unit: string;
  currentPrice: number;
  avgPrice60d: number;
  trendPct: number; // current vs 60d
  series: number[]; // last 12 weeks
}

export interface SupplierInvoiceListItem {
  id: string;
  invoiceNumber: string;
  scannedAt: string;
  totalIls: number;
  approvedIls: number;
  status: 'clean' | 'minor' | 'major' | 'blocked';
  discrepanciesCount: number;
  savingsCapturedIls: number;
}

export type ActivityEventType =
  | 'price_alert'
  | 'invoice_closed'
  | 'invoice_blocked'
  | 'dispute_opened'
  | 'late_delivery'
  | 'note';

export interface ActivityEvent {
  id: string;
  at: string; // ISO
  type: ActivityEventType;
  title: string;
  detail?: string;
  amount?: number;
}

export interface SupplierProfile {
  metadata: SupplierMetadata;
  kpi: SupplierKpi;
  topProducts: PriceTrendProduct[];
  recentInvoices: SupplierInvoiceListItem[];
  activity: ActivityEvent[];
}

const today = new Date();

function isoDaysAgo(days: number, hour = 9, minute = 0): string {
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function weekly(base: number, vol: number, drift: number, seed: number): number[] {
  return Array.from({ length: 12 }, (_, i) => {
    const trend = (i / 11) * drift;
    const noise = Math.sin(i * 1.6 + seed) * vol;
    return Math.max(0, Math.round((base + trend + noise) * 100) / 100);
  });
}

export const SUPPLIER_PROFILES: Record<string, SupplierProfile> = {
  'sup-avi': {
    metadata: {
      id: 'sup-avi',
      name: 'ירקני אבי',
      initials: 'יא',
      businessId: '514778123',
      contactPhone: '052-1234567',
      contactEmail: 'avi@yarkanavi.co.il',
      contactWhatsapp: '972521234567',
      category: 'ירקות ופירות',
      activeSince: '2023-04',
      deliverySchedule: 'א׳, ג׳, ה׳ · 06:00–08:00',
      paymentTerms: 'שוטף +30',
    },
    kpi: {
      cleanDeliveryPct: 78,
      cleanDeliveryRestaurantAvg: 88,
      avgPriceVariancePct: 4.2,
      monthSpendIls: 14820,
      prevMonthSpendIls: 13290,
      openDisputes: 2,
      totalInvoicesThisMonth: 18,
      flaggedInvoicesThisMonth: 6,
    },
    topProducts: [
      {
        productId: 'prod-tomato',
        name: 'עגבניה שרי',
        unit: 'ק״ג',
        currentPrice: 8.5,
        avgPrice60d: 7.02,
        trendPct: 21.1,
        series: weekly(7, 0.4, 1.8, 0.5),
      },
      {
        productId: 'prod-cucumber',
        name: 'מלפפון חממה',
        unit: 'ק״ג',
        currentPrice: 6.0,
        avgPrice60d: 5.92,
        trendPct: 1.3,
        series: weekly(5.9, 0.25, 0.15, 1.2),
      },
      {
        productId: 'prod-pepper',
        name: 'פלפל אדום',
        unit: 'ק״ג',
        currentPrice: 12.0,
        avgPrice60d: 11.2,
        trendPct: 7.1,
        series: weekly(11.2, 0.6, 1.0, 2.1),
      },
      {
        productId: 'prod-lettuce',
        name: 'חסה אייסברג',
        unit: 'יח׳',
        currentPrice: 7.5,
        avgPrice60d: 7.7,
        trendPct: -2.6,
        series: weekly(7.8, 0.3, -0.4, 3.4),
      },
      {
        productId: 'prod-mint',
        name: 'נענע',
        unit: 'יח׳',
        currentPrice: 4.5,
        avgPrice60d: 4.5,
        trendPct: 0,
        series: weekly(4.5, 0.2, 0, 4.7),
      },
    ],
    recentInvoices: [
      {
        id: 'inv-7821',
        invoiceNumber: 'INV-7821',
        scannedAt: isoDaysAgo(0, 8, 12),
        totalIls: 1284.5,
        approvedIls: 1191,
        status: 'major',
        discrepanciesCount: 3,
        savingsCapturedIls: 93.5,
      },
      {
        id: 'inv-7782',
        invoiceNumber: 'INV-7782',
        scannedAt: isoDaysAgo(2, 8, 5),
        totalIls: 980,
        approvedIls: 980,
        status: 'clean',
        discrepanciesCount: 0,
        savingsCapturedIls: 0,
      },
      {
        id: 'inv-7754',
        invoiceNumber: 'INV-7754',
        scannedAt: isoDaysAgo(4, 7, 58),
        totalIls: 1120,
        approvedIls: 1056,
        status: 'major',
        discrepanciesCount: 2,
        savingsCapturedIls: 64,
      },
      {
        id: 'inv-7711',
        invoiceNumber: 'INV-7711',
        scannedAt: isoDaysAgo(7, 8, 22),
        totalIls: 845,
        approvedIls: 845,
        status: 'minor',
        discrepanciesCount: 1,
        savingsCapturedIls: 0,
      },
      {
        id: 'inv-7689',
        invoiceNumber: 'INV-7689',
        scannedAt: isoDaysAgo(9, 8, 15),
        totalIls: 1340,
        approvedIls: 1190,
        status: 'major',
        discrepanciesCount: 3,
        savingsCapturedIls: 150,
      },
    ],
    activity: [
      {
        id: 'a1',
        at: isoDaysAgo(0, 8, 18),
        type: 'invoice_closed',
        title: 'INV-7821 נסגרה',
        detail: 'יוסי תפס עליית מחיר עגבניות 21% · אישר ידנית',
        amount: 93.5,
      },
      {
        id: 'a2',
        at: isoDaysAgo(0, 8, 13),
        type: 'price_alert',
        title: 'עגבניה שרי — קפיצה 21%',
        detail: 'מעל הממוצע ההיסטורי של 60 ימים',
      },
      {
        id: 'a3',
        at: isoDaysAgo(2, 8, 5),
        type: 'invoice_closed',
        title: 'INV-7782 נסגרה',
        detail: 'התאמה מלאה · 8 פריטים תאמו',
      },
      {
        id: 'a4',
        at: isoDaysAgo(3, 14, 0),
        type: 'dispute_opened',
        title: 'דיון פתוח על מחיר פלפל',
        detail: 'הבקשה ממתינה לחזרת ספק',
      },
      {
        id: 'a5',
        at: isoDaysAgo(4, 7, 58),
        type: 'invoice_closed',
        title: 'INV-7754 נסגרה',
        detail: '₪64 נחסכו בעקבות התאמת כמות סלמון',
        amount: 64,
      },
      {
        id: 'a6',
        at: isoDaysAgo(6, 8, 30),
        type: 'late_delivery',
        title: 'אחור באספקה — 45 דק׳',
        detail: 'הגיע ב-08:45 במקום 08:00 הצפוי',
      },
    ],
  },
  'sup-kerem': {
    metadata: {
      id: 'sup-kerem',
      name: 'קצביית הכרם',
      initials: 'קה',
      businessId: '516223890',
      contactPhone: '03-7654321',
      contactEmail: 'orders@kerem-meat.co.il',
      contactWhatsapp: '97237654321',
      category: 'בשרים',
      activeSince: '2022-11',
      deliverySchedule: 'ג׳, ה׳ · 09:00–10:30',
      paymentTerms: 'שוטף +45',
    },
    kpi: {
      cleanDeliveryPct: 94,
      cleanDeliveryRestaurantAvg: 88,
      avgPriceVariancePct: 0.8,
      monthSpendIls: 38420,
      prevMonthSpendIls: 41100,
      openDisputes: 1,
      totalInvoicesThisMonth: 9,
      flaggedInvoicesThisMonth: 1,
    },
    topProducts: [
      {
        productId: 'prod-entrecote',
        name: 'אנטריקוט',
        unit: 'ק״ג',
        currentPrice: 145,
        avgPrice60d: 143,
        trendPct: 1.4,
        series: weekly(143, 4, 2, 6.1),
      },
      {
        productId: 'prod-chicken-breast',
        name: 'חזה עוף',
        unit: 'ק״ג',
        currentPrice: 38,
        avgPrice60d: 38.5,
        trendPct: -1.3,
        series: weekly(38.5, 1, -0.5, 7.3),
      },
      {
        productId: 'prod-chicken-liver',
        name: 'כבד עוף',
        unit: 'ק״ג',
        currentPrice: 32,
        avgPrice60d: 31.5,
        trendPct: 1.6,
        series: weekly(31.5, 0.6, 0.5, 8.4),
      },
    ],
    recentInvoices: [
      {
        id: 'inv-7822',
        invoiceNumber: 'INV-4882',
        scannedAt: isoDaysAgo(0, 9, 35),
        totalIls: 3420,
        approvedIls: 0,
        status: 'blocked',
        discrepanciesCount: 1,
        savingsCapturedIls: 3420,
      },
      {
        id: 'inv-7800',
        invoiceNumber: 'INV-4860',
        scannedAt: isoDaysAgo(2, 9, 40),
        totalIls: 4280,
        approvedIls: 4280,
        status: 'clean',
        discrepanciesCount: 0,
        savingsCapturedIls: 0,
      },
      {
        id: 'inv-7770',
        invoiceNumber: 'INV-4834',
        scannedAt: isoDaysAgo(5, 9, 28),
        totalIls: 3950,
        approvedIls: 3950,
        status: 'clean',
        discrepanciesCount: 0,
        savingsCapturedIls: 0,
      },
    ],
    activity: [
      {
        id: 'a1',
        at: isoDaysAgo(0, 9, 35),
        type: 'invoice_blocked',
        title: 'INV-4882 חסומה — חשבונית כפולה',
        detail: 'תשלום חסום אוטומטית · ממתין לבירור',
        amount: 3420,
      },
      {
        id: 'a2',
        at: isoDaysAgo(2, 9, 40),
        type: 'invoice_closed',
        title: 'INV-4860 נסגרה',
        detail: 'התאמה מלאה · 11 פריטים תאמו',
      },
    ],
  },
  'sup-kobi': {
    metadata: {
      id: 'sup-kobi',
      name: 'דגי קובי',
      initials: 'דק',
      businessId: '511445672',
      contactPhone: '054-9876543',
      contactEmail: 'kobi@kobifish.co.il',
      contactWhatsapp: '972549876543',
      category: 'דגים וים',
      activeSince: '2023-08',
      deliverySchedule: 'ב׳, ה׳ · 11:00–12:00',
      paymentTerms: 'שוטף +30',
    },
    kpi: {
      cleanDeliveryPct: 82,
      cleanDeliveryRestaurantAvg: 88,
      avgPriceVariancePct: 3.1,
      monthSpendIls: 12380,
      prevMonthSpendIls: 11200,
      openDisputes: 1,
      totalInvoicesThisMonth: 7,
      flaggedInvoicesThisMonth: 2,
    },
    topProducts: [
      {
        productId: 'prod-salmon',
        name: 'סלמון נורווגי',
        unit: 'ק״ג',
        currentPrice: 195,
        avgPrice60d: 189,
        trendPct: 3.2,
        series: weekly(189, 4, 6, 9.5),
      },
      {
        productId: 'prod-denis',
        name: 'דניס',
        unit: 'ק״ג',
        currentPrice: 92,
        avgPrice60d: 85,
        trendPct: 8.2,
        series: weekly(85, 2, 7, 10.5),
      },
    ],
    recentInvoices: [
      {
        id: 'inv-7824',
        invoiceNumber: 'INV-9012',
        scannedAt: isoDaysAgo(0, 11, 5),
        totalIls: 1850,
        approvedIls: 1694,
        status: 'major',
        discrepanciesCount: 2,
        savingsCapturedIls: 156,
      },
      {
        id: 'inv-7790',
        invoiceNumber: 'INV-8988',
        scannedAt: isoDaysAgo(3, 11, 10),
        totalIls: 1620,
        approvedIls: 1620,
        status: 'clean',
        discrepanciesCount: 0,
        savingsCapturedIls: 0,
      },
    ],
    activity: [
      {
        id: 'a1',
        at: isoDaysAgo(0, 11, 15),
        type: 'invoice_closed',
        title: 'INV-9012 נסגרה',
        detail: 'דנה תפסה כמות חסרה בסלמון · ₪156 נחסכו',
        amount: 156,
      },
      {
        id: 'a2',
        at: isoDaysAgo(0, 11, 7),
        type: 'price_alert',
        title: 'דניס — קפיצה 8.2%',
        detail: 'מעל הממוצע ההיסטורי של 60 ימים',
      },
    ],
  },
  'sup-brans': {
    metadata: {
      id: 'sup-brans',
      name: 'מאפיית ברנס',
      initials: 'מב',
      businessId: '512887901',
      contactPhone: '08-9988776',
      contactEmail: 'orders@brans-bakery.co.il',
      contactWhatsapp: '972544456677',
      category: 'מאפים',
      activeSince: '2022-06',
      deliverySchedule: 'כל יום · 06:00',
      paymentTerms: 'שוטף +60',
    },
    kpi: {
      cleanDeliveryPct: 98,
      cleanDeliveryRestaurantAvg: 88,
      avgPriceVariancePct: 0.0,
      monthSpendIls: 7250,
      prevMonthSpendIls: 7100,
      openDisputes: 0,
      totalInvoicesThisMonth: 30,
      flaggedInvoicesThisMonth: 1,
    },
    topProducts: [
      {
        productId: 'prod-garlic-rolls',
        name: 'לחמניות שום',
        unit: 'יח׳',
        currentPrice: 4,
        avgPrice60d: 4,
        trendPct: 0,
        series: weekly(4, 0.05, 0, 11.2),
      },
      {
        productId: 'prod-sliced-bread',
        name: 'לחם פרוס',
        unit: 'יח׳',
        currentPrice: 18,
        avgPrice60d: 18,
        trendPct: 0,
        series: weekly(18, 0.1, 0, 12.4),
      },
    ],
    recentInvoices: [
      {
        id: 'inv-7823',
        invoiceNumber: 'INV-2210',
        scannedAt: isoDaysAgo(0, 6, 8),
        totalIls: 240,
        approvedIls: 240,
        status: 'clean',
        discrepanciesCount: 0,
        savingsCapturedIls: 0,
      },
      {
        id: 'inv-7795',
        invoiceNumber: 'INV-2198',
        scannedAt: isoDaysAgo(1, 6, 5),
        totalIls: 240,
        approvedIls: 240,
        status: 'clean',
        discrepanciesCount: 0,
        savingsCapturedIls: 0,
      },
    ],
    activity: [
      {
        id: 'a1',
        at: isoDaysAgo(0, 6, 10),
        type: 'invoice_closed',
        title: 'INV-2210 נסגרה',
        detail: 'התאמה מלאה',
      },
    ],
  },
  'sup-shegev': {
    metadata: {
      id: 'sup-shegev',
      name: 'אלכוהול שגב',
      initials: 'אש',
      businessId: '514779203',
      contactPhone: '03-7711224',
      contactEmail: 'sales@shegev-liquor.co.il',
      contactWhatsapp: '972549988221',
      category: 'משקאות חריפים',
      activeSince: '2023-02',
      deliverySchedule: 'שני · 11:00',
      paymentTerms: 'שוטף +60',
    },
    kpi: {
      cleanDeliveryPct: 86,
      cleanDeliveryRestaurantAvg: 88,
      avgPriceVariancePct: 4.2,
      monthSpendIls: 11280,
      prevMonthSpendIls: 9650,
      openDisputes: 1,
      totalInvoicesThisMonth: 4,
      flaggedInvoicesThisMonth: 2,
    },
    topProducts: [
      {
        productId: 'prod-goldstar-330',
        name: 'גולדסטאר 0.33ל׳',
        unit: 'בקבוק',
        currentPrice: 4.8,
        avgPrice60d: 4.5,
        trendPct: 6.7,
        series: weekly(4.5, 0.2, 0.18, 14.3),
      },
      {
        productId: 'prod-merlot',
        name: 'יין מרלו רקנאטי',
        unit: 'בקבוק',
        currentPrice: 62,
        avgPrice60d: 58,
        trendPct: 6.9,
        series: weekly(58, 2, 0.2, 18.1),
      },
      {
        productId: 'prod-absolut-700',
        name: 'וודקה אבסולוט 0.7ל׳',
        unit: 'בקבוק',
        currentPrice: 95,
        avgPrice60d: 92,
        trendPct: 3.3,
        series: weekly(92, 2, 0.15, 22.7),
      },
    ],
    recentInvoices: [
      {
        id: 'inv-7820',
        invoiceNumber: 'INV-3344',
        scannedAt: isoDaysAgo(0, 11, 24),
        totalIls: 3140,
        approvedIls: 2986,
        status: 'major',
        discrepanciesCount: 2,
        savingsCapturedIls: 154,
      },
      {
        id: 'inv-7780',
        invoiceNumber: 'INV-3318',
        scannedAt: isoDaysAgo(7, 11, 11),
        totalIls: 2740,
        approvedIls: 2740,
        status: 'minor',
        discrepanciesCount: 1,
        savingsCapturedIls: 0,
      },
      {
        id: 'inv-7745',
        invoiceNumber: 'INV-3287',
        scannedAt: isoDaysAgo(14, 11, 18),
        totalIls: 2980,
        approvedIls: 2980,
        status: 'clean',
        discrepanciesCount: 0,
        savingsCapturedIls: 0,
      },
    ],
    activity: [
      {
        id: 'a1',
        at: isoDaysAgo(0, 11, 30),
        type: 'price_alert',
        title: 'גולדסטאר עלה ב-6.7%',
        detail: 'מ-₪4.5 ל-₪4.8 בקבוק. בדוק מול הסכם.',
        amount: 142,
      },
      {
        id: 'a2',
        at: isoDaysAgo(0, 11, 28),
        type: 'invoice_closed',
        title: 'INV-3344 נסגרה עם 2 חריגות',
        detail: 'יוסי תיקן 8 בקבוקים יין שלא הגיעו',
        amount: 154,
      },
      {
        id: 'a3',
        at: isoDaysAgo(3, 14, 0),
        type: 'dispute_opened',
        title: 'מחלוקת על חוסר במשלוח',
        detail: 'חסרו 4 בקבוקי וודקה — ממתינים לתגובת הספק',
      },
      {
        id: 'a4',
        at: isoDaysAgo(14, 11, 25),
        type: 'invoice_closed',
        title: 'INV-3287 נסגרה',
        detail: 'התאמה מלאה',
      },
    ],
  },
};

export function getSupplierProfile(id: string): SupplierProfile | null {
  return SUPPLIER_PROFILES[id] ?? null;
}
