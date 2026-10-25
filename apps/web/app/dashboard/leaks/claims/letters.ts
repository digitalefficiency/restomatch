import type { LeakBreakdownInvoice, LeakBreakdownLine } from '@restomatch/charts';
import { claimableLines, vatBasisOf, type VatBasis } from '@restomatch/api';

/**
 * The claim-letter model (pure, unit-tested): ONE letter per supplier, merging
 *  • "before payment" — this month's claimable lines on invoices not yet paid
 *    (the shared claimableLines rule, the same as the pay run), and
 *  • "for credit"     — ₪-back tracker claims still waiting for a letter
 *    (status `claimed`, on paid invoices too).
 * A tracker claim that IS one of this month's lines stays in "before payment"
 * (never printed twice) and carries its claimId so "mark as sent" moves it.
 * No new money math: every amount is a breakdown or tracker amount as is.
 */

/** The fields of a tracker claim the letters use (recovery.list rows). */
export interface TrackedClaim {
  id: string;
  status: string;
  outstandingAgorot: number;
  supplierId: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  discrepancyType: string;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  claimedAt: string;
  letterSentAt: string | null;
}

export interface LetterLine {
  key: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  type: string;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  /** ₪ asked on this line (2 dp, as the breakdown / tracker hold it). */
  amount: number;
  basis: VatBasis;
  /** The engine's expected / actual values (null when unknown) — display only. */
  expected: number | null;
  actual: number | null;
  deltaAmount: number | null;
  /** The ₪-back claim this line is (status `claimed`) — "mark as sent" moves it. */
  claimId: string | null;
}

export interface SupplierLetter {
  key: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  beforePayment: LetterLine[];
  forCredit: LetterLine[];
  beforePaymentTotal: number;
  forCreditTotal: number;
  total: number;
  /** Tracker claims a "mark as sent" moves to `letter_sent`. */
  claimIds: string[];
}

/** A supplier whose letter already went out (claims in `letter_sent`, still owed). */
export interface SentLetter {
  key: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  sentAt: string;
  count: number;
  outstandingAgorot: number;
}

const supplierKey = (name: string | null | undefined) => (name ?? '').trim() || '—';
const itemKey = (productName: string | null, lineDescription: string | null) => (productName ?? lineDescription ?? '').trim();
const lineKey = (invoiceId: string | null, type: string, productName: string | null, lineDescription: string | null) =>
  `${invoiceId ?? ''}|${type}|${itemKey(productName, lineDescription)}`;

/** Σ of ₪ amounts to the agora (integer agorot, so 0.1 + 0.2 never drifts). */
export function sumAgora(values: ReadonlyArray<number>): number {
  return values.reduce((s, v) => s + Math.round(v * 100), 0) / 100;
}

function fromBreakdown(inv: LeakBreakdownInvoice, l: LeakBreakdownLine, amount: number, basis: VatBasis): LetterLine {
  return {
    key: l.discrepancyId,
    invoiceId: inv.invoiceId,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    type: l.type,
    productName: l.productName,
    productNameEn: l.productNameEn,
    lineDescription: l.lineDescription,
    lineDescriptionEn: l.lineDescriptionEn,
    amount,
    basis,
    expected: l.expected,
    actual: l.actual,
    deltaAmount: l.deltaAmount,
    claimId: null,
  };
}

export function buildLetters(input: {
  /** owner.leakBreakdown of the letters' month. */
  month: LeakBreakdownInvoice[];
  /** recovery.list rows (any status — only `claimed` / `letter_sent` are used). */
  tracked: ReadonlyArray<TrackedClaim>;
  /** Extra breakdown months, only to add invoice dates and the ₪ basis to tracker lines. */
  history?: ReadonlyArray<LeakBreakdownInvoice>;
}): { letters: SupplierLetter[]; sent: SentLetter[] } {
  const groups = new Map<string, SupplierLetter>();
  const group = (name: string | null, nameEn: string | null, supplierId: string | null) => {
    const key = supplierKey(name);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        supplierId,
        supplierName: name,
        supplierNameEn: nameEn,
        beforePayment: [],
        forCredit: [],
        beforePaymentTotal: 0,
        forCreditTotal: 0,
        total: 0,
        claimIds: [],
      };
      groups.set(key, g);
    }
    if (!g.supplierId && supplierId) g.supplierId = supplierId;
    if (!g.supplierNameEn && nameEn) g.supplierNameEn = nameEn;
    return g;
  };

  // Every tracker claim, queued per line key (a key can repeat). A month line that
  // is a tracked claim already past `claimed` (sent, credited, written off…) is
  // handled on the tracker, so it leaves the letter.
  const tracked = new Map<string, TrackedClaim[]>();
  for (const c of input.tracked) {
    const k = lineKey(c.invoiceId, c.discrepancyType, c.productName, c.lineDescription);
    tracked.set(k, [...(tracked.get(k) ?? []), c]);
  }
  for (const queue of tracked.values()) queue.sort((a, b) => Number(b.status === 'claimed') - Number(a.status === 'claimed'));

  // 1. This month, before payment. A matching tracker claim is consumed here.
  for (const inv of input.month) {
    for (const { line, amount, basis } of claimableLines(inv)) {
      const claim = tracked.get(lineKey(inv.invoiceId, line.type, line.productName, line.lineDescription))?.shift();
      if (claim && claim.status !== 'claimed') continue;
      const g = group(inv.supplierName, inv.supplierNameEn, null);
      const out = fromBreakdown(inv, line, amount, basis);
      if (claim) {
        out.claimId = claim.id;
        g.claimIds.push(claim.id);
        if (claim.supplierId) g.supplierId = claim.supplierId;
      }
      g.beforePayment.push(out);
    }
  }

  // Basis lookup for the remaining tracker lines (invoice date, expected / actual).
  const known = new Map<string, { inv: LeakBreakdownInvoice; line: LeakBreakdownLine }>();
  for (const inv of [...input.month, ...(input.history ?? [])]) {
    for (const line of inv.lines) {
      const k = lineKey(inv.invoiceId, line.type, line.productName, line.lineDescription);
      if (!known.has(k)) known.set(k, { inv, line });
    }
  }

  // 2. The rest of the tracker's `claimed` claims: for credit.
  for (const queue of tracked.values()) {
    for (const c of queue) {
      if (c.status !== 'claimed' || c.outstandingAgorot <= 0) continue;
      const g = group(c.supplierName, c.supplierNameEn, c.supplierId);
      const hit = known.get(lineKey(c.invoiceId, c.discrepancyType, c.productName, c.lineDescription));
      g.forCredit.push({
        key: c.id,
        invoiceId: c.invoiceId,
        invoiceNumber: c.invoiceNumber,
        invoiceDate: hit?.inv.invoiceDate ?? null,
        type: c.discrepancyType,
        productName: c.productName,
        productNameEn: c.productNameEn,
        lineDescription: c.lineDescription,
        lineDescriptionEn: c.lineDescriptionEn,
        amount: c.outstandingAgorot / 100,
        basis: vatBasisOf(c.discrepancyType),
        expected: hit?.line.expected ?? null,
        actual: hit?.line.actual ?? null,
        deltaAmount: hit?.line.deltaAmount ?? null,
        claimId: c.id,
      });
      g.claimIds.push(c.id);
    }
  }

  const letters = [...groups.values()]
    .filter((g) => g.beforePayment.length + g.forCredit.length > 0)
    .map((g) => {
      const beforePaymentTotal = sumAgora(g.beforePayment.map((l) => l.amount));
      const forCreditTotal = sumAgora(g.forCredit.map((l) => l.amount));
      return { ...g, beforePaymentTotal, forCreditTotal, total: sumAgora([beforePaymentTotal, forCreditTotal]) };
    })
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

  // Letters already sent: one row per supplier, the latest send date.
  const sentBy = new Map<string, SentLetter>();
  for (const c of input.tracked) {
    if (c.status !== 'letter_sent' || c.outstandingAgorot <= 0 || !c.letterSentAt) continue;
    const key = supplierKey(c.supplierName);
    const s = sentBy.get(key) ?? {
      key,
      supplierId: c.supplierId,
      supplierName: c.supplierName,
      supplierNameEn: c.supplierNameEn,
      sentAt: c.letterSentAt,
      count: 0,
      outstandingAgorot: 0,
    };
    s.count += 1;
    s.outstandingAgorot += c.outstandingAgorot;
    if (c.letterSentAt > s.sentAt) s.sentAt = c.letterSentAt;
    sentBy.set(key, s);
  }
  const sent = [...sentBy.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt) || a.key.localeCompare(b.key));
  return { letters, sent };
}

/**
 * The ₪ basis of one claim line, from the engine's expected / actual (display
 * only — the claimed amount itself is never recomputed):
 *  • PRICE_HIGHER   expected = ordered unit price, actual = billed unit price → qty = |Δ| ÷ (billed − ordered)
 *  • QTY_OVER       expected = received qty, actual = billed qty → unit price = |Δ| ÷ (billed − received)
 *  • VAT_MISMATCH   expected = VAT on the subtotal, actual = VAT on the invoice
 *  • TOTAL_MISMATCH expected = Σ lines, actual = the invoice subtotal
 *  • UNORDERED_ITEM actual = billed qty
 */
export type LineMath =
  | { kind: 'price'; qty: number; charged: number; ordered: number }
  | { kind: 'qty'; billed: number; received: number; unitPrice: number }
  | { kind: 'vat'; charged: number; expected: number }
  | { kind: 'total'; charged: number; expected: number }
  | { kind: 'unordered'; qty: number };

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

export function lineMath(l: Pick<LetterLine, 'type' | 'expected' | 'actual' | 'deltaAmount'>): LineMath | null {
  const { expected: e, actual: a } = l;
  const delta = l.deltaAmount == null ? null : Math.abs(l.deltaAmount);
  switch (l.type) {
    case 'PRICE_HIGHER':
      if (e == null || a == null || delta == null || !(a > e)) return null;
      return { kind: 'price', qty: round(delta / (a - e), 3), charged: a, ordered: e };
    case 'QTY_OVER':
      if (e == null || a == null || delta == null || !(a > e)) return null;
      return { kind: 'qty', billed: a, received: e, unitPrice: round(delta / (a - e), 2) };
    case 'VAT_MISMATCH':
      return e == null || a == null ? null : { kind: 'vat', charged: a, expected: e };
    case 'TOTAL_MISMATCH':
      return e == null || a == null ? null : { kind: 'total', charged: a, expected: e };
    case 'UNORDERED_ITEM':
      return a == null ? null : { kind: 'unordered', qty: a };
    default:
      return null;
  }
}

/** Calendar days left until `fromIso + days`, in Israel days (negative = late). */
export function daysLeft(fromIso: string, days: number, nowIso: string): number {
  const day = (iso: string) => {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date(iso))
      .split('-')
      .map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return day(fromIso) + days - day(nowIso);
}

/** `iso` + n calendar days (Israel), as an ISO instant at the same wall time — for "reply by" dates. */
export function addDays(iso: string, n: number): string {
  return new Date(new Date(iso).getTime() + n * 86_400_000).toISOString();
}

/**
 * Lines approved to claim (accepted / "טופל") that no ₪-back claim holds — the
 * gap between "approved to claim" and what the letters ask for (leaks-03, the
 * ₪12.66 VAT line). Display only; matched on invoice + type + item like the letters.
 */
export function approvedNotClaimed(
  invoices: ReadonlyArray<LeakBreakdownInvoice>,
  tracked: ReadonlyArray<Pick<TrackedClaim, 'invoiceId' | 'discrepancyType' | 'productName' | 'lineDescription'>>,
): Array<{ invoice: LeakBreakdownInvoice; line: LeakBreakdownLine }> {
  const held = new Map<string, number>();
  for (const c of tracked) {
    const k = lineKey(c.invoiceId, c.discrepancyType, c.productName, c.lineDescription);
    held.set(k, (held.get(k) ?? 0) + 1);
  }
  const out: Array<{ invoice: LeakBreakdownInvoice; line: LeakBreakdownLine }> = [];
  for (const inv of invoices) {
    for (const line of inv.lines) {
      if (!line.countsAsLeak || (line.resolutionStatus !== 'accepted' && line.resolutionStatus !== 'resolved')) continue;
      const k = lineKey(inv.invoiceId, line.type, line.productName, line.lineDescription);
      const n = held.get(k) ?? 0;
      if (n > 0) held.set(k, n - 1);
      else out.push({ invoice: inv, line });
    }
  }
  return out;
}
