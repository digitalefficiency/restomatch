/**
 * The honest leak hero's rules (W1-05), kept pure so the home, the showcase and
 * the public leak check render the same states from the same numbers.
 *
 *  - Typed state: no data ("—", one CTA) · clean (T3 sentence) · leak (T1) ·
 *    pending-only (consolidated invoices waiting for a link, T4).
 *  - Thin base: under THIN_BASE_INVOICES checked invoices the ₪ shows, the % does not.
 *  - The delta compares the SAME day-span of the previous period (Oct 1–25 vs
 *    Sep 1–25), never a running month against a full one.
 */

export type LeakHeroState = 'noData' | 'clean' | 'leak' | 'pendingOnly';

/** Fewer checked invoices than this and a % of spend is noise. */
export const THIN_BASE_INVOICES = 5;

export interface HeroFigures {
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
  invoiceCount: number;
  matchedInvoiceCount: number;
  pendingLinkCount: number;
  /** Receiving scans waiting for their receipt's count (not "no data": they will be checked). */
  awaitingCountCount?: number;
}

export function leakHeroState(h: HeroFigures): LeakHeroState {
  if (h.leakIls > 0) return 'leak';
  if (h.matchedInvoiceCount > 0) return 'clean';
  if (h.pendingLinkCount > 0 || (h.awaitingCountCount ?? 0) > 0) return 'pendingOnly';
  return 'noData';
}

/** Show a % only on a real base (spend and enough checked invoices). */
export function showsPct(h: HeroFigures): boolean {
  return h.leakPct != null && h.spendIls > 0 && h.matchedInvoiceCount >= THIN_BASE_INVOICES;
}

export type DeltaDirection = 'up' | 'down' | 'same';

export interface HeroDelta {
  direction: DeltaDirection;
  /** |current − previous| in ₪. */
  amountIls: number;
  /** Signed relative change (−0.19 = 19% lower); null on a thin or empty base. */
  pct: number | null;
}

/**
 * Leak now vs the same day-span before. null when the previous span has no
 * invoices (nothing honest to compare with). A thin previous base keeps the ₪
 * difference but drops the % (₪20 → ₪60 is not "+200%").
 */
export function heroDelta(
  current: Pick<HeroFigures, 'leakIls'>,
  previous: Pick<HeroFigures, 'leakIls' | 'invoiceCount' | 'matchedInvoiceCount'> | null,
): HeroDelta | null {
  if (!previous || previous.invoiceCount === 0) return null;
  const diffAgorot = Math.round(current.leakIls * 100) - Math.round(previous.leakIls * 100);
  const direction: DeltaDirection = diffAgorot > 0 ? 'up' : diffAgorot < 0 ? 'down' : 'same';
  const thin = previous.matchedInvoiceCount < THIN_BASE_INVOICES || previous.leakIls <= 0;
  return {
    direction,
    amountIls: Math.abs(diffAgorot) / 100,
    pct: thin ? null : diffAgorot / Math.round(previous.leakIls * 100),
  };
}

/**
 * The calendar day-span a hero covers: [monthStart, monthEnd) as UTC instants
 * of local midnights → the first and last local day (for "1–25 בספטמבר").
 */
export function daySpan(monthStart: string, monthEnd: string): { from: Date; to: Date } {
  const from = new Date(monthStart);
  const to = new Date(new Date(monthEnd).getTime() - 1);
  // Guard a zero-length span (never shown, but never "25–24").
  return { from, to: to < from ? from : to };
}

/**
 * The hero's split, by payment status, so the parts add up to the hero to the
 * agora: the leak on invoices not yet marked paid (`caughtBeforePaymentIls`, where
 * payment can still be held) and the rest, on invoices already paid (a credit is
 * the only way back). Never a decision status — the engine's "caught" is the leak
 * on UNPAID invoices whatever their decision, so it is labelled as exactly that.
 */
export function leakSplit(h: { leakIls: number; caughtBeforePaymentIls: number }): { unpaidIls: number; paidIls: number } {
  const leak = Math.max(0, Math.round(h.leakIls * 100));
  const unpaid = Math.min(leak, Math.max(0, Math.round(h.caughtBeforePaymentIls * 100)));
  return { unpaidIls: unpaid / 100, paidIls: (leak - unpaid) / 100 };
}
