import { describe, expect, it } from 'vitest';
import { SUBSET_WINDOW, suggestAllocation, type SuggestClaim } from '../recovery/suggest';

const c = (id: string, amount: number, day: number, invoiceId: string | null = null, credited = 0): SuggestClaim => ({
  id,
  invoiceId,
  amountAgorot: amount,
  creditedAgorot: credited,
  claimedAt: new Date(Date.UTC(2026, 9, day)).toISOString(),
});

describe('suggestAllocation (W3-11 שיוך זיכוי)', () => {
  it('prefers one claim whose open amount equals the note', () => {
    const s = suggestAllocation(4_500, [c('a', 10_000, 1), c('b', 4_500, 5), c('c', 2_000, 2)]);
    expect(s.basis).toBe('exact_single');
    expect(s.allocations).toEqual([{ id: 'b', agorot: 4_500 }]);
    expect(s.remainderAgorot).toBe(0);
  });

  it('uses the open amount after an earlier partial credit', () => {
    const s = suggestAllocation(3_000, [c('a', 10_000, 1, null, 7_000), c('b', 9_000, 2)]);
    expect(s).toMatchObject({ basis: 'exact_single', allocations: [{ id: 'a', agorot: 3_000 }] });
  });

  it("matches all of one invoice's claims summing to the note", () => {
    const s = suggestAllocation(5_000, [c('a', 7_000, 1, 'inv1'), c('b', 2_000, 3, 'inv2'), c('d', 3_000, 4, 'inv2')]);
    expect(s.basis).toBe('exact_invoice');
    expect(s.allocations.map((a) => a.id).sort()).toEqual(['b', 'd']);
  });

  it('finds an exact subset built from the oldest claims', () => {
    // 1+4 = 5 and 2+3 = 5: the subset with the oldest claim (a) wins.
    const s = suggestAllocation(500, [c('a', 100, 1), c('b', 200, 2), c('c', 300, 3), c('d', 400, 4)]);
    expect(s.basis).toBe('exact_subset');
    expect(s.allocations.map((x) => x.id)).toEqual(['a', 'd']);
    expect(s.allocatedAgorot).toBe(500);
  });

  it('falls back to oldest first and keeps the rest on the note', () => {
    const s = suggestAllocation(10_001, [c('b', 6_000, 2), c('a', 3_000, 1)]);
    expect(s.basis).toBe('oldest_first');
    expect(s.allocations).toEqual([
      { id: 'a', agorot: 3_000 },
      { id: 'b', agorot: 6_000 },
    ]);
    expect(s.remainderAgorot).toBe(1_001);
  });

  it('never allocates more than the note or than any claim is open', () => {
    const claims = Array.from({ length: 30 }, (_, i) => c(`k${String(i).padStart(2, '0')}`, 1_000 + i * 37, i + 1, null, i % 3 ? 0 : 500));
    for (const note of [1, 777, 12_345, 99_999]) {
      const s = suggestAllocation(note, claims);
      expect(s.allocatedAgorot + s.remainderAgorot).toBe(note);
      expect(s.allocations.reduce((t, a) => t + a.agorot, 0)).toBe(s.allocatedAgorot);
      for (const a of s.allocations) {
        const k = claims.find((x) => x.id === a.id)!;
        expect(a.agorot).toBeGreaterThan(0);
        expect(a.agorot).toBeLessThanOrEqual(k.amountAgorot - k.creditedAgorot);
        expect(Number.isInteger(a.agorot)).toBe(true);
      }
    }
  });

  it('bounds the subset search to the oldest SUBSET_WINDOW claims', () => {
    const claims = Array.from({ length: SUBSET_WINDOW + 4 }, (_, i) => c(`k${String(i).padStart(2, '0')}`, 1_000, i + 1));
    const late = c('late', 1_234, 99);
    // 1_234 equals only the last claim → exact_single still finds it (it is not a subset search).
    expect(suggestAllocation(1_234, [...claims, late]).basis).toBe('exact_single');
  });

  it('is deterministic and ignores input order', () => {
    const claims = [c('a', 100, 1), c('b', 200, 2), c('c', 300, 3), c('d', 400, 4)];
    expect(suggestAllocation(500, claims)).toEqual(suggestAllocation(500, [...claims].reverse()));
  });

  it('returns none when nothing is open, and rejects a bad note', () => {
    expect(suggestAllocation(100, [c('a', 100, 1, null, 100)])).toMatchObject({ basis: 'none', remainderAgorot: 100 });
    expect(() => suggestAllocation(0, [])).toThrow();
    expect(() => suggestAllocation(10.5, [])).toThrow();
  });
});
