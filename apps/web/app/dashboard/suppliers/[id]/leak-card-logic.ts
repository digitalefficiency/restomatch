/**
 * Pure helpers for the supplier leak card (flag `supplierLeakCard`).
 * Unit-tested in app/dashboard/__tests__/supplier-leak-card.test.ts.
 */

export const LEAK_CARD_DAYS = 90;

/** 'YYYY-MM-DD' of `now` on the Israel wall clock. */
export function israelYmd(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The last 90 Israel calendar days, today included, as a custom view window. */
export function leakCardWindow(now: Date): { from: string; to: string } {
  const to = israelYmd(now);
  const [y, m, d] = to.split('-').map(Number) as [number, number, number];
  const from = new Date(Date.UTC(y, m - 1, d - (LEAK_CARD_DAYS - 1))).toISOString().slice(0, 10);
  return { from, to };
}

export interface LeakLineLike {
  discrepancyId: string;
  type: string;
  deltaAmount: number;
  countsAsLeak: boolean;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  /** The engine's expected / charged values (the line's ₪ basis), when known. */
  expected?: number | null;
  actual?: number | null;
}

export interface LeakInvoiceLike {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  lines: LeakLineLike[];
}

export interface TopLeakLine extends LeakLineLike {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  /** |deltaAmount| in agorot (what the line cost). */
  amountAgorot: number;
}

/** The `n` largest leak lines (by |Δ ₪|) across the invoices, each linked to its invoice. */
export function topLeakLines(invoices: readonly LeakInvoiceLike[], n = 5): TopLeakLine[] {
  return invoices
    .flatMap((inv) =>
      inv.lines
        .filter((l) => l.countsAsLeak && l.deltaAmount !== 0)
        .map((l) => ({
          ...l,
          invoiceId: inv.invoiceId,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          amountAgorot: Math.round(Math.abs(l.deltaAmount) * 100),
        })),
    )
    .sort((a, b) => b.amountAgorot - a.amountAgorot || a.discrepancyId.localeCompare(b.discrepancyId))
    .slice(0, n);
}

/** Top `n` discrepancy types by ₪, leaking ones only. */
export function topTypes<T extends { key: string; leakIls: number }>(rows: readonly T[], n = 3): T[] {
  return rows
    .filter((r) => r.key !== '' && r.leakIls > 0)
    .slice()
    .sort((a, b) => b.leakIls - a.leakIls)
    .slice(0, n);
}

/** Shekels → integer agorot (half away from zero), so ₪ comparisons are exact. */
export function toAgorot(ils: number): number {
  return Math.round(ils * 100);
}
