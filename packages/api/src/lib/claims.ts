import type { LeakBreakdownInvoice, LeakBreakdownLine } from '@restomatch/charts';
import { DISCREPANCY_CLAIMABLE, DISCREPANCY_CLAIMED, DISCREPANCY_DECIDABLE } from '../lifecycle/predicates';
import { OPEN_STATUSES } from '../recovery/lifecycle';

/**
 * The claimable-line rule (₪) shared by the supplier credit letters
 * (/dashboard/leaks/claims), the pay run, the approvals queue, Ask and the dock slip.
 * One rule, so no two pages can disagree on a shekel.
 *
 *  • an invoice still waiting for a PO link has nothing to claim. A PAID invoice KEEPS its
 *    claims (owner decision, W2-03 §5.5): marking an invoice paid never erases a shekel —
 *    after payment the channel is a בקשת זיכוי letter (decision 19);
 *  • a line is claimable when it counts as leak and its type is ever asked back; waived lines
 *    (rejected, or tolerated — the engine's `tolerate`, owner M7) are never emitted;
 *  • G-14 Q3 · ONE ALLOCATOR. Each line's ₪ is its share of the invoice cap from the leak
 *    ledger (charts invoiceAllocationSql, carried on `line.ledger`): rows holding a live claim
 *    first (at the claim's amount), then decided rows (claims before waivers), then undecided
 *    rows get what is left; (created_at, id) inside a tier. The owner-signed rule (G-14, 11.11
 *    line 17): "קודם דרישות זיכוי קיימות…, אחר כך פערים שהוחלטו, ולפערים שלא הוחלטו נשאר מה שנשאר".
 *    A line holding a live claim is emitted `claimed` at what is still outstanding on it
 *    (its capped ₪ less what was credited, while the claim is open; ₪0 once it is recovered or
 *    written off) — never `undecided`, whatever its resolution status.
 */
/**
 * Decided "ask the supplier" statuses. Owner decision 7.11 (M5): 'resolved' counts as decided,
 * exactly like 'accepted' — the same rule recovery (CLAIMABLE_FILTER) and the charts use.
 */
export const CLAIMABLE_DECIDED_STATUSES = DISCREPANCY_CLAIMED;
/** Statuses still waiting for a decision — never put on a supplier letter (decision 18). G-05 predicate. */
export const UNDECIDED_STATUSES = DISCREPANCY_DECIDABLE;
export const CLAIMABLE_STATUSES = DISCREPANCY_CLAIMABLE;
/** Only real findings are ever asked back. */
export const CLAIM_SEVERITIES = ['warn', 'block'] as const;
const CLAIMABLE = new Set<string>(CLAIMABLE_STATUSES);
const DECIDED = new Set<string>(CLAIMABLE_DECIDED_STATUSES);
const SEVERITIES = new Set<string>(CLAIM_SEVERITIES);

/**
 * Discrepancy types that are NEVER asked back from a supplier — the ONE list used by
 * approvals (isClaimableRow), these claim lines (letters, pay run), and the ₪-back
 * tracker's sync. Owner decision 31.10: MISSING_ON_INVOICE is not claimable ("לא") —
 * an ordered line that was never billed has nothing to credit.
 */
export const NEVER_CLAIMABLE_TYPES = ['PRICE_LOWER', 'UNORDERED_ARRIVAL', 'MISSING_ON_INVOICE'] as const;
const NEVER_CLAIMABLE = new Set<string>(NEVER_CLAIMABLE_TYPES);
export function isNeverClaimable(type: string): boolean {
  return NEVER_CLAIMABLE.has(type);
}

/**
 * Days a supplier has to answer a credit claim (from the letter, or the claim when no
 * letter went out) before it is overdue — owner decision 31.10: a week ("שבוע"). One
 * constant for the reminder job, the tracker's countdown and banner, the home row and
 * the letter's reply-by date.
 */
export const CLAIM_ANSWER_DAYS = 7;

/**
 * The overdue boundary, as cases both sides test against (server overdueSql and the
 * web countdown): a claim is overdue when MORE than CLAIM_ANSWER_DAYS whole calendar
 * days (Asia/Jerusalem) passed since the letter — the hour of day never matters.
 * `now` is 2026-10-25 13:00 in Israel.
 */
export const OVERDUE_BOUNDARY_NOW = '2026-10-25T10:00:00.000Z';
export const OVERDUE_BOUNDARY_CASES: ReadonlyArray<{ letterSentAt: string; overdue: boolean; why: string }> = [
  { letterSentAt: '2026-10-18T12:00:00.000Z', overdue: false, why: '18.10 15:00 IL — 7 calendar days: not yet' },
  { letterSentAt: '2026-10-17T22:30:00.000Z', overdue: false, why: '18.10 01:30 IL — 7 calendar days (an instant rule said overdue)' },
  { letterSentAt: '2026-10-17T20:59:00.000Z', overdue: true, why: '17.10 23:59 IL — 8 calendar days' },
  { letterSentAt: '2026-10-17T05:00:00.000Z', overdue: true, why: '17.10 08:00 IL — 8 calendar days' },
];

/**
 * What an amount is measured on. A duplicate invoice is claimed at the invoice's total
 * INCLUDING VAT; a VAT mismatch IS a VAT amount; every other discrepancy is priced on line
 * amounts BEFORE VAT. Shown next to each amount so ₪ figures of different bases are never
 * silently added up as if they were one.
 */
export type VatBasis = 'excl' | 'incl' | 'vat';

export function vatBasisOf(type: string): VatBasis {
  // Both carry the invoice's total incl. VAT as Δ (UNORDERED_ARRIVAL is never claimable, but may be shown).
  if (type === 'DUPLICATE_INVOICE' || type === 'UNORDERED_ARRIVAL') return 'incl';
  if (type === 'VAT_MISMATCH') return 'vat';
  return 'excl';
}

const UNDECIDED = new Set<string>(UNDECIDED_STATUSES);

export interface ClaimRuleInput {
  type: string;
  severity: string;
  resolutionStatus: string;
}
/** THE claimable predicate (decided or undecided). recovery's SQL builds from the same constants. */
export function isClaimable(d: ClaimRuleInput): boolean {
  return SEVERITIES.has(d.severity) && !NEVER_CLAIMABLE.has(d.type) && CLAIMABLE.has(d.resolutionStatus);
}
/** Decided and claimable: what may go on a letter / be offset (= recovery's CLAIMABLE_FILTER). */
export function isDecidedClaim(d: ClaimRuleInput): boolean {
  return isClaimable(d) && DECIDED.has(d.resolutionStatus);
}

export interface ClaimLine {
  line: LeakBreakdownLine;
  /** ₪ on this line after the per-invoice cap (a live claim: what is still outstanding on it). */
  amount: number;
  basis: VatBasis;
  /**
   * The line is still open / escalated and holds no live claim: it counts toward the cap (the
   * ledger's tier 3) but it is NEVER put on a supplier letter or offset in a payment until
   * someone decides it (decision 18).
   */
  undecided: boolean;
  /** The line already holds a live claim (recovery_claims): the tracker owns it, never ask it twice. */
  claimed: boolean;
}

/**
 * Claim statuses whose remaining ₪ is still owed (recovery lifecycle OPEN_STATUSES). A closed claim
 * — `recovered` (short or not) or `written_off` — has nothing outstanding (G-14 Q3 R4-1), exactly
 * as the tracker shows it.
 */
const OWED = new Set<string>(OPEN_STATUSES);

/** The claimable lines of one invoice: the leak ledger's allocation (see the module note). */
export function claimableLines(inv: LeakBreakdownInvoice): ClaimLine[] {
  if (inv.pendingLink) return [];
  const askable = (l: LeakBreakdownLine) => l.countsAsLeak && !NEVER_CLAIMABLE.has(l.type);
  // A persisted invoice (charts breakdownLines) carries the allocator's result on every line.
  if (inv.lines.some((l) => l.ledger !== undefined)) {
    const out: ClaimLine[] = [];
    for (const l of inv.lines) {
      const led = l.ledger;
      if (!led || !askable(l)) continue;
      if (led.liveClaim) {
        const ag = OWED.has(led.claimStatus ?? '') ? Math.max(0, led.cappedAgorot - led.creditedAgorot) : 0;
        if (ag > 0) out.push({ line: l, amount: ag / 100, basis: vatBasisOf(l.type), undecided: false, claimed: true });
        continue;
      }
      if (led.effect === 'waive' || led.cappedAgorot <= 0) continue;
      out.push({ line: l, amount: led.cappedAgorot / 100, basis: vatBasisOf(l.type), undecided: led.effect === 'undecided', claimed: false });
    }
    return out;
  }
  return handBuiltLines(inv, askable);
}

/**
 * Lines that were never persisted (a ריכוז proposal, unit tests) have no ledger row and no
 * claims: the SAME allocator in TypeScript — decided (claims before waivers), then undecided,
 * (createdAt, id) inside a tier, integer agorot, cap = the invoice's capped leak.
 * approvals-router.test.ts ("the hand-built mirror … = the SQL allocator") pins it to the SQL.
 */
function handBuiltLines(inv: LeakBreakdownInvoice, askable: (l: LeakBreakdownLine) => boolean): ClaimLine[] {
  // 0 decided claim · 1 waiver (tolerated accept, or rejected) · 2 undecided — the ledger's
  // tier 2 (claims before waivers) and tier 3.
  const tierOf = (l: LeakBreakdownLine): 0 | 1 | 2 | null => {
    if (!askable(l)) return null;
    if (UNDECIDED.has(l.resolutionStatus)) return 2;
    if (l.tolerated || !CLAIMABLE.has(l.resolutionStatus)) return 1;
    return 0;
  };
  const key = (l: LeakBreakdownLine) => l.createdAt ?? '';
  const ranked = inv.lines
    .map((l) => ({ l, tier: tierOf(l) }))
    .filter((x): x is { l: LeakBreakdownLine; tier: 0 | 1 | 2 } => x.tier !== null)
    .sort(
      (x, y) =>
        x.tier - y.tier ||
        (key(x.l) < key(y.l) ? -1 : key(x.l) > key(y.l) ? 1 : 0) ||
        (x.l.discrepancyId < y.l.discrepancyId ? -1 : x.l.discrepancyId > y.l.discrepancyId ? 1 : 0),
    );
  const capAg = Math.max(0, Math.round(inv.leakIls * 100));
  let usedAg = 0;
  const out: ClaimLine[] = [];
  for (const { l, tier } of ranked) {
    const ag = Math.min(Math.abs(Math.round(l.deltaAmount * 100)), Math.max(0, capAg - usedAg));
    if (ag <= 0) continue;
    usedAg += ag;
    if (tier === 1) continue; // a waiver holds its share of the cap, never asked back
    out.push({ line: l, amount: ag / 100, basis: vatBasisOf(l.type), undecided: tier === 2, claimed: false });
  }
  return out;
}

/** Σ of claim amounts, rounded to the agora (as the letters' totals). */
export function sumClaims(lines: ReadonlyArray<{ amount: number }>): number {
  return Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
}
