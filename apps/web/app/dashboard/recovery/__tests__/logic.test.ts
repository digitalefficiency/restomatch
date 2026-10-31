import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_MOVES,
  batchMoves,
  bySupplier,
  confirmAgorot,
  countdownOf,
  followUps,
  funnelOf,
  hamiltonShekels,
  menuMoves,
  nextStep,
  type RecoveryStatus,
} from '../logic';

describe('Hamilton rounding: printed parts add up to the printed whole', () => {
  it('rounds parts so Σ round(parts) = round(Σ parts)', () => {
    // 3 × ₪0.50 = ₪1.50 → ₪2, never 1 + 1 + 1 = 3 or 0 + 0 + 0.
    expect(hamiltonShekels([50, 50, 50])).toEqual([1, 1, 0]);
    // The chain-07 case: 551.40 + 401.60 = 953 (not 551 + 402 ≠ 952).
    const parts = hamiltonShekels([55140, 40160]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(953);
  });
  it('holds for random parts', () => {
    for (let k = 0; k < 200; k++) {
      const parts = Array.from({ length: 5 }, () => Math.floor(Math.random() * 500_000));
      const sum = hamiltonShekels(parts).reduce((a, b) => a + b, 0);
      expect(sum).toBe(Math.round(parts.reduce((a, b) => a + b, 0) / 100));
    }
  });
});

describe('the recovery funnel', () => {
  it('נדרש = הוחזר + זוכה + פתוח + במחלוקת + ויתרנו, in agorot and in whole shekels', () => {
    const f = funnelOf({
      claimedAgorot: 367210,
      creditedAgorot: 191400,
      recoveredAgorot: 80000,
      outstandingAgorot: 165810,
      disputedAgorot: 12000,
      writtenOffAgorot: 10000,
    });
    expect(f.totalAgorot).toBe(367210);
    expect(f.agorot).toEqual({ returned: 80000, credited: 111400, open: 153810, disputed: 12000, writtenOff: 10000 });
    expect(Object.values(f.shekels).reduce((a, b) => a + b, 0)).toBe(f.totalShekels);
    expect(f.totalShekels).toBe(3672);
    expect(f.stages).toEqual({ claimed: 3672, credited: f.shekels.returned + f.shekels.credited, returned: f.shekels.returned });
  });
});

/**
 * The server's `next[]` per status (packages/api lifecycle.ts). The table's own
 * cases moved to packages/api/src/__tests__/recovery-transition-batch.test.ts;
 * here it is only the input the screen receives.
 */
const NEXT: Record<RecoveryStatus, RecoveryStatus[]> = {
  claimed: ['letter_sent', 'acknowledged', 'disputed', 'written_off'],
  letter_sent: ['acknowledged', 'disputed', 'written_off'],
  acknowledged: ['disputed', 'written_off'],
  credited: ['recovered', 'disputed'],
  recovered: [],
  disputed: ['letter_sent', 'acknowledged', 'written_off'],
  written_off: ['claimed'],
};

describe('row actions: never a money move on select change (chain-01)', () => {
  it('one next step per status', () => {
    expect(nextStep('claimed')).toEqual({ kind: 'move', to: 'letter_sent' });
    expect(nextStep('letter_sent')).toEqual({ kind: 'credit' });
    expect(nextStep('credited')).toEqual({ kind: 'move', to: 'recovered' });
    expect(nextStep('written_off')).toEqual({ kind: 'move', to: 'claimed' });
    expect(nextStep('recovered')).toBeNull();
  });
  it('the ⋯ menu holds the other allowed moves, never the primary twice, never a disallowed one', () => {
    for (const s of Object.keys(NEXT) as RecoveryStatus[]) {
      const menu = menuMoves(s, NEXT[s]);
      for (const to of menu) expect(NEXT[s]).toContain(to);
      const p = nextStep(s);
      if (p?.kind === 'move') expect(menu).not.toContain(p.to);
    }
  });
  it('ending a claim (write-off, money back) always needs a confirm', () => {
    expect(CONFIRMED_MOVES).toEqual(['written_off', 'recovered']);
  });
  it('a batch offers only the moves valid for EVERY selected claim', () => {
    expect(batchMoves([NEXT.claimed, NEXT.letter_sent])).toEqual(['acknowledged', 'disputed', 'written_off']);
    expect(batchMoves([NEXT.claimed, NEXT.credited])).toEqual(['disputed']);
    expect(batchMoves([])).toEqual([]);
  });
});

describe('answer countdown from COALESCE(letterSentAt, claimedAt) + 14 (chain-04)', () => {
  const now = '2026-10-25T10:00:00.000Z';
  it('neutral above 7 days, warn at 7 or fewer, danger when late', () => {
    expect(countdownOf({ status: 'letter_sent', letterSentAt: '2026-10-24T10:00:00.000Z', claimedAt: '2026-09-01T00:00:00Z' }, now)).toMatchObject({
      tone: 'neutral',
      daysLeft: 13,
    });
    expect(countdownOf({ status: 'claimed', letterSentAt: null, claimedAt: '2026-10-18T10:00:00.000Z' }, now)).toMatchObject({
      tone: 'warn',
      daysLeft: 7,
    });
    expect(countdownOf({ status: 'acknowledged', letterSentAt: '2026-10-02T10:00:00.000Z', claimedAt: '2026-09-01T00:00:00Z' }, now)).toMatchObject({
      tone: 'danger',
      daysLate: 9,
    });
  });
  it('no countdown once the supplier is not the one we wait for', () => {
    for (const s of ['credited', 'recovered', 'disputed', 'written_off'] as const) {
      expect(countdownOf({ status: s, letterSentAt: null, claimedAt: '2026-01-01T00:00:00Z' }, now)).toBeNull();
    }
  });
});

describe('follow-up queues (the banner split)', () => {
  it('never-sent claims and late sent letters are separate queues', () => {
    const q = followUps(
      [
        { status: 'claimed', outstandingAgorot: 1000, letterSentAt: null, claimedAt: '2026-09-01T00:00:00Z' },
        { status: 'letter_sent', outstandingAgorot: 2000, letterSentAt: '2026-10-01T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z', supplierName: 'A' },
        { status: 'letter_sent', outstandingAgorot: 4000, letterSentAt: '2026-10-24T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z', supplierName: 'B' },
        { status: 'credited', outstandingAgorot: 8000, letterSentAt: '2026-09-01T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z' },
      ],
      '2026-10-25T10:00:00.000Z',
    );
    expect(q.unsent).toEqual({ count: 1, agorot: 1000 });
    expect(q.waiting).toEqual({ count: 1, agorot: 2000 });
  });
  it('"waiting" is the sent list’s rule: letter_sent only, late by the supplier’s LATEST send', () => {
    const q = followUps(
      [
        // Acknowledged = the supplier answered — not waiting, even when old.
        { status: 'acknowledged', outstandingAgorot: 1000, letterSentAt: '2026-09-01T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z', supplierName: 'A' },
        // Supplier B: one old send, then a fresh one → the letter is NOT late (the sent list shows "N days left").
        { status: 'letter_sent', outstandingAgorot: 2000, letterSentAt: '2026-10-01T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z', supplierName: 'B' },
        { status: 'letter_sent', outstandingAgorot: 3000, letterSentAt: '2026-10-24T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z', supplierName: 'B' },
        // Supplier C: late → both its claims wait.
        { status: 'letter_sent', outstandingAgorot: 400, letterSentAt: '2026-10-01T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z', supplierName: 'C' },
        { status: 'letter_sent', outstandingAgorot: 500, letterSentAt: '2026-10-02T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z', supplierName: 'C' },
      ],
      '2026-10-25T10:00:00.000Z',
    );
    expect(q.waiting).toEqual({ count: 2, agorot: 900 });
  });
});

describe('closing confirms name the right ₪', () => {
  it('"the money came back" names Σ credited (a fully credited claim is not ₪0); a write-off names Σ still owed', () => {
    const claims = [
      { creditedAgorot: 13132, outstandingAgorot: 0 },
      { creditedAgorot: 5000, outstandingAgorot: 1000 },
    ];
    expect(confirmAgorot(claims, 'recovered')).toBe(18132);
    expect(confirmAgorot(claims, 'written_off')).toBe(1000);
  });
});

describe('phone cards grouped by supplier', () => {
  it('groups and orders by outstanding ₪', () => {
    const g = bySupplier([
      { supplierId: 'a', supplierName: 'A', outstandingAgorot: 100 },
      { supplierId: 'b', supplierName: 'B', outstandingAgorot: 500 },
      { supplierId: 'a', supplierName: 'A', outstandingAgorot: 300 },
    ]);
    expect(g.map((x) => [x.key, x.claims.length, x.outstandingAgorot])).toEqual([
      ['b', 1, 500],
      ['a', 2, 400],
    ]);
  });
});

describe('credit form VAT preview (display only; the server converts)', () => {
  it('matches the server examples: ₪118.00 incl. at 18% → ₪100.00; half-up', async () => {
    const { previewExclAgorot } = await import('../logic');
    expect(previewExclAgorot(11_800, 'incl', 1800)).toBe(10_000);
    expect(previewExclAgorot(11_800, 'excl', 1800)).toBe(11_800);
    expect(previewExclAgorot(3, 'incl', 10_000)).toBe(2);
    expect(previewExclAgorot(59, 'incl', 1800)).toBe(50);
  });
  it('"1,250" is ₪1,250.00 and "12,50" is ₪12.50', async () => {
    const { parseIlsInput } = await import('../parseIls');
    expect(parseIlsInput('1,250')).toBe(125_000);
    expect(parseIlsInput('12,50')).toBe(1_250);
  });
});

describe('desk ranking: owed ₪ × days overdue (W2-10)', () => {
  it('ranks by Σ owed × days overdue, then owed; ₪0-owed suppliers never lead', async () => {
    const { bySupplier } = await import('../logic');
    const g = bySupplier([
      { supplierId: 'big-fresh', supplierName: 'A', outstandingAgorot: 90_000, daysOverdue: 0 },
      { supplierId: 'small-late', supplierName: 'B', outstandingAgorot: 10_000, daysOverdue: 20 },
      { supplierId: 'credited', supplierName: 'C', outstandingAgorot: 0, daysOverdue: 40 },
      { supplierId: 'mid-late', supplierName: 'D', outstandingAgorot: 30_000, daysOverdue: 3 },
    ]);
    expect(g.map((x) => x.key)).toEqual(['small-late', 'mid-late', 'big-fresh', 'credited']);
    expect(g[0]!.urgency).toBe(200_000);
  });
});
