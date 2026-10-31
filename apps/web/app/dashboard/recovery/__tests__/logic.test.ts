import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_MOVES,
  NEXT,
  batchMoves,
  bySupplier,
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
      const menu = menuMoves(s);
      for (const to of menu) expect(NEXT[s]).toContain(to);
      const p = nextStep(s);
      if (p?.kind === 'move') expect(menu).not.toContain(p.to);
    }
  });
  it('ending a claim (write-off, money back) always needs a confirm', () => {
    expect(CONFIRMED_MOVES).toEqual(['written_off', 'recovered']);
  });
  it('a batch offers only the moves valid for EVERY selected claim', () => {
    expect(batchMoves(['claimed', 'letter_sent'])).toEqual(['acknowledged', 'disputed', 'written_off']);
    expect(batchMoves(['claimed', 'credited'])).toEqual(['disputed']);
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
        { status: 'letter_sent', outstandingAgorot: 2000, letterSentAt: '2026-10-01T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z' },
        { status: 'letter_sent', outstandingAgorot: 4000, letterSentAt: '2026-10-24T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z' },
        { status: 'credited', outstandingAgorot: 8000, letterSentAt: '2026-09-01T00:00:00Z', claimedAt: '2026-09-01T00:00:00Z' },
      ],
      '2026-10-25T10:00:00.000Z',
    );
    expect(q.unsent).toEqual({ count: 1, agorot: 1000 });
    expect(q.waiting).toEqual({ count: 1, agorot: 2000 });
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
