/**
 * G-16 invariant "a discrepancy is on at most one letter" (GAP-PACKAGES G-16 §2),
 * on the letter model itself: for random months + tracker claims (duplicates,
 * written-off claims, sent letters, mixed suppliers), every discrepancy appears on
 * at most one line across all unsent letters, and never also on a sent letter.
 * Hard assertion: the model holds this today; a regression fails here.
 */
import { describe, expect, it } from 'vitest';
import type { LeakBreakdownInvoice, LeakBreakdownLine } from '@restomatch/charts';
import { buildLetters, type TrackedClaim } from '@/app/dashboard/leaks/claims/letters';

/** Deterministic PRNG (mulberry32) so a failure reproduces from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUPPLIERS = [
  { id: 's1', he: 'קצביית הכרם', en: 'HaKerem' },
  { id: 's2', he: 'ירקות השרון', en: 'Sharon Veg' },
  { id: 's3', he: 'מאפיית אבי', en: null },
];
const STATUSES = ['claimed', 'claimed', 'letter_sent', 'written_off', 'acknowledged', 'recovered'] as const;
const RESOLUTION = ['accepted', 'accepted', 'open', 'escalated'] as const;
const TYPES = ['PRICE_HIGHER', 'QTY_OVER', 'VAT_MISMATCH', 'MISSING_ON_INVOICE'] as const;

function scenario(seed: number) {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const discrepancyIds = Array.from({ length: 12 }, (_, i) => `d${i}`);
  // A discrepancy belongs to one invoice (or to none of this month's).
  const invoiceOf = new Map(discrepancyIds.map((d) => [d, Math.floor(r() * 5)] as const));
  const month: LeakBreakdownInvoice[] = [];
  for (let i = 0; i < 4; i += 1) {
    const s = pick(SUPPLIERS);
    const lines: LeakBreakdownLine[] = discrepancyIds
      .filter((d) => invoiceOf.get(d) === i)
      .map((discrepancyId) => ({
        discrepancyId,
        type: pick(TYPES),
        severity: 'warn',
        resolutionStatus: pick(RESOLUTION),
        deltaAmount: Math.round(r() * 20000) / 100,
        expected: null,
        actual: null,
        countsAsLeak: r() < 0.9,
        productName: null,
        productNameEn: null,
        lineDescription: null,
        lineDescriptionEn: null,
        poLineId: null,
        invoiceLineId: null,
        productId: null,
      }));
    month.push({
      invoiceId: `inv${i}`,
      invoiceNumber: `N-${i}`,
      invoiceDate: '2026-10-20T10:00:00.000Z',
      status: r() < 0.3 ? 'paid' : 'received',
      supplierName: s.he,
      supplierNameEn: s.en,
      totalInclVat: 5000,
      leakIls: 10000,
      pendingLink: r() < 0.1,
      lines,
    });
  }
  const tracked: TrackedClaim[] = discrepancyIds
    .filter(() => r() < 0.6)
    .flatMap((discrepancyId, i) => {
      // Sometimes an old written-off claim AND a new one for the same discrepancy.
      const n = r() < 0.25 ? 2 : 1;
      return Array.from({ length: n }, (_, k) => {
        const s = pick(SUPPLIERS);
        const status = pick(STATUSES);
        return {
          id: `c${i}-${k}`,
          discrepancyId,
          status,
          outstandingAgorot: r() < 0.1 ? 0 : 100 + Math.floor(r() * 10000),
          supplierId: s.id,
          supplierName: s.he,
          supplierNameEn: s.en,
          invoiceId: `inv${Math.floor(r() * 4)}`,
          invoiceNumber: null,
          discrepancyType: pick(TYPES),
          productName: null,
          productNameEn: null,
          lineDescription: null,
          lineDescriptionEn: null,
          claimedAt: '2026-10-10T08:00:00.000Z',
          letterSentAt: status === 'letter_sent' ? '2026-10-12T08:00:00.000Z' : null,
        } satisfies TrackedClaim;
      });
    });
  return { month, tracked };
}

describe('one-letter-per-discrepancy (letter model)', () => {
  it('holds for 500 random months: ≤1 letter line per discrepancy, never also on a sent letter', () => {
    let lines = 0;
    let sentRows = 0;
    for (let seed = 1; seed <= 500; seed += 1) {
      const { month, tracked } = scenario(seed);
      const { letters, sent: sentLetters } = buildLetters({ month, tracked });
      sentRows += sentLetters.length;
      const claimById = new Map(tracked.map((c) => [c.id, c]));
      const onLetters = new Map<string, number>();
      for (const l of letters) {
        for (const line of [...l.beforePayment, ...l.forCredit]) {
          const d = line.claimId ? claimById.get(line.claimId)!.discrepancyId : line.key;
          onLetters.set(d, (onLetters.get(d) ?? 0) + 1);
          lines += 1;
        }
      }
      const twice = [...onLetters].filter(([, n]) => n > 1).map(([d]) => d);
      expect(twice, `seed ${seed}`).toEqual([]);
      // A discrepancy whose live claim already went out in a letter is not asked again.
      const sent = new Set(tracked.filter((c) => c.status === 'letter_sent').map((c) => c.discrepancyId));
      const live = new Set(tracked.filter((c) => c.status !== 'written_off' && c.status !== 'letter_sent').map((c) => c.discrepancyId));
      const reAsked = [...onLetters.keys()].filter((d) => sent.has(d) && !live.has(d));
      expect(reAsked, `seed ${seed}`).toEqual([]);
    }
    // Not vacuous: the scenarios produce many letter lines and sent letters.
    expect(lines).toBeGreaterThan(1000);
    expect(sentRows).toBeGreaterThan(100);
  });
});
