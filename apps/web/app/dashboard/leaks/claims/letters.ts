import type { LeakBreakdownInvoice, LeakBreakdownLine } from '@restomatch/charts';
import { claimableLines, vatBasisOf, type VatBasis } from '@restomatch/api';

/**
 * The claim-letter model (pure, unit-tested): ONE letter per supplier. A letter
 * asks only for what the team DECIDED to claim (decision 18):
 *  • every ₪-back tracker claim still waiting for a letter (status `claimed`), and
 *  • this month's lines approved to claim (`accepted`) that no claim holds yet
 *    (the tracker off, or not synced yet).
 * Each sits in "before payment" when its invoice is not paid yet (offset it from the
 * payment) or "for credit" when it is paid / unknown. A discrepancy with a claim that
 * is not written off is the CLAIM's line — never also a month line (dedupe by
 * discrepancy id). Undecided lines (open / escalated) are never addressed to a
 * supplier: they come back as `undecided`, a T2 "decide" prompt.
 * No new money math: every amount is a breakdown or tracker amount as is.
 */

/** The fields of a tracker claim the letters use (recovery.list rows). */
export interface TrackedClaim {
  id: string;
  /** The discrepancy this claim is for — the ONE key that pairs it with a breakdown line. */
  discrepancyId: string;
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
  /** The engine's severity (null when unknown) — tells the QTY_OVER shapes apart. */
  severity: string | null;
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
    severity: l.severity,
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

/** Month lines nobody decided on yet (open / escalated) — never in a letter. */
export interface UndecidedLines {
  count: number;
  amount: number;
  /** Per supplier (letter key), for a one-supplier view. */
  bySupplier: Map<string, { count: number; amount: number }>;
}

export function buildLetters(input: {
  /** owner.leakBreakdown of the letters' month. */
  month: LeakBreakdownInvoice[];
  /** recovery.list rows (any status — only `claimed` / `letter_sent` are used). */
  tracked: ReadonlyArray<TrackedClaim>;
  /** Extra breakdown months: invoice date, paid status and ₪ basis of tracker lines. */
  history?: ReadonlyArray<LeakBreakdownInvoice>;
}): { letters: SupplierLetter[]; sent: SentLetter[]; undecided: UndecidedLines } {
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

  // The claim of each discrepancy (a `claimed` one wins over an older closed one). A
  // written-off claim gives the discrepancy back to the month (it may be claimed again).
  const claimOf = new Map<string, TrackedClaim>();
  for (const c of input.tracked) {
    if (c.status === 'written_off') continue;
    const prev = claimOf.get(c.discrepancyId);
    if (!prev || (c.status === 'claimed' && prev.status !== 'claimed')) claimOf.set(c.discrepancyId, c);
  }

  // Lookup for tracker lines: invoice (date, paid?) and the engine's expected / actual.
  const known = new Map<string, { inv: LeakBreakdownInvoice; line: LeakBreakdownLine }>();
  for (const inv of [...input.month, ...(input.history ?? [])]) {
    for (const line of inv.lines) if (!known.has(line.discrepancyId)) known.set(line.discrepancyId, { inv, line });
  }
  const unpaid = (inv: LeakBreakdownInvoice | undefined) => inv != null && inv.status !== 'paid' && !inv.pendingLink;

  // 1. This month's DECIDED lines no claim holds; undecided ones are counted, not sent.
  const undecided: UndecidedLines = { count: 0, amount: 0, bySupplier: new Map() };
  for (const inv of input.month) {
    for (const { line, amount, basis } of claimableLines(inv)) {
      if (claimOf.has(line.discrepancyId)) continue;
      if (line.resolutionStatus !== 'accepted') {
        const key = supplierKey(inv.supplierName);
        const u = undecided.bySupplier.get(key) ?? { count: 0, amount: 0 };
        u.count += 1;
        u.amount = sumAgora([u.amount, amount]);
        undecided.bySupplier.set(key, u);
        undecided.count += 1;
        undecided.amount = sumAgora([undecided.amount, amount]);
        continue;
      }
      group(inv.supplierName, inv.supplierNameEn, null).beforePayment.push(fromBreakdown(inv, line, amount, basis));
    }
  }

  // 2. Every tracker claim still waiting for its letter: before payment while its invoice is unpaid.
  for (const c of claimOf.values()) {
    if (c.status !== 'claimed' || c.outstandingAgorot <= 0) continue;
    const g = group(c.supplierName, c.supplierNameEn, c.supplierId);
    const hit = known.get(c.discrepancyId);
    const out: LetterLine = {
      key: c.id,
      invoiceId: c.invoiceId,
      invoiceNumber: c.invoiceNumber,
      invoiceDate: hit?.inv.invoiceDate ?? null,
      type: c.discrepancyType,
      severity: hit?.line.severity ?? null,
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
    };
    (unpaid(hit?.inv) ? g.beforePayment : g.forCredit).push(out);
    g.claimIds.push(c.id);
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
  return { letters, sent, undecided };
}

/**
 * The ₪ basis of one claim line, from the engine's expected / actual (display
 * only — the claimed amount itself is never recomputed). Each wording states only
 * what the engine's shape actually holds:
 *  • PRICE_HIGHER   expected = the reference price (the order's, OR the supplier's
 *                   usual p90 — the line can't tell which), actual = billed price
 *                   → qty = |Δ| ÷ (billed − expected); worded neutrally ("expected price").
 *  • QTY_OVER block expected = received qty, actual = billed qty (billed > received)
 *  • QTY_OVER other expected = ordered qty, actual = received qty (more arrived than ordered)
 *  • VAT_MISMATCH   expected = VAT on the subtotal, actual = VAT on the invoice
 *  • TOTAL_MISMATCH expected = Σ lines, actual = the invoice subtotal
 *  • UNORDERED_ITEM actual = billed qty
 */
export type LineMath =
  | { kind: 'price'; qty: number; charged: number; expected: number }
  | { kind: 'qty'; billed: number; received: number; unitPrice: number }
  | { kind: 'qtyReceived'; ordered: number; received: number; unitPrice: number }
  | { kind: 'vat'; charged: number; expected: number }
  | { kind: 'total'; charged: number; expected: number }
  | { kind: 'unordered'; qty: number };

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

export function lineMath(l: Pick<LetterLine, 'type' | 'expected' | 'actual' | 'deltaAmount'> & { severity?: string | null }): LineMath | null {
  const { expected: e, actual: a } = l;
  const delta = l.deltaAmount == null ? null : Math.abs(l.deltaAmount);
  switch (l.type) {
    case 'PRICE_HIGHER':
      if (e == null || a == null || delta == null || !(a > e)) return null;
      return { kind: 'price', qty: round(delta / (a - e), 3), charged: a, expected: e };
    case 'QTY_OVER':
      if (e == null || a == null || delta == null || !(a > e)) return null;
      // Only the block shape is billed-vs-received; unknown severity → no basis line.
      if (l.severity === 'block') return { kind: 'qty', billed: a, received: e, unitPrice: round(delta / (a - e), 2) };
      if (l.severity === 'warn' || l.severity === 'info')
        return { kind: 'qtyReceived', ordered: e, received: a, unitPrice: round(delta / (a - e), 2) };
      return null;
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
 * ₪12.66 VAT line). Display only; matched on the discrepancy id like the letters.
 */
export function approvedNotClaimed(
  invoices: ReadonlyArray<LeakBreakdownInvoice>,
  tracked: ReadonlyArray<Pick<TrackedClaim, 'discrepancyId'>>,
): Array<{ invoice: LeakBreakdownInvoice; line: LeakBreakdownLine }> {
  const held = new Set(tracked.map((c) => c.discrepancyId));
  const out: Array<{ invoice: LeakBreakdownInvoice; line: LeakBreakdownLine }> = [];
  for (const inv of invoices) {
    for (const line of inv.lines) {
      if (!line.countsAsLeak || (line.resolutionStatus !== 'accepted' && line.resolutionStatus !== 'resolved')) continue;
      if (!held.has(line.discrepancyId)) out.push({ invoice: inv, line });
    }
  }
  return out;
}

/**
 * The ₪ of ONE supplier's claim letter, in agorot — what a "open the credit
 * request · ₪X" button may promise (the same total the letter prints). Matched
 * on the supplier id when the letter has one, else on its name; 0 = no letter.
 */
export function letterAgorotFor(
  letters: ReadonlyArray<Pick<SupplierLetter, 'supplierId' | 'supplierName' | 'total'>>,
  supplier: { id: string; name: string | null },
): number {
  const name = (supplier.name ?? '').trim();
  const hit = letters.find((l) => l.supplierId === supplier.id) ?? (name ? letters.find((l) => (l.supplierName ?? '').trim() === name) : undefined);
  return hit ? Math.round(hit.total * 100) : 0;
}
