import { describe, expect, it } from 'vitest';
import { CLAIM_ANSWER_DAYS, OVERDUE_BOUNDARY_CASES, OVERDUE_BOUNDARY_NOW } from '@restomatch/api';
import {
  ANSWER_DAYS,
  CONFIRMED_MOVES,
  NEXT,
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

describe('answer countdown from COALESCE(letterSentAt, claimedAt) + a week (owner 31.10)', () => {
  const now = '2026-10-25T10:00:00.000Z';
  it('one constant with the server: ANSWER_DAYS = @restomatch/api CLAIM_ANSWER_DAYS = 7', () => {
    expect(ANSWER_DAYS).toBe(7);
    expect(ANSWER_DAYS).toBe(CLAIM_ANSWER_DAYS);
  });
  it.each(OVERDUE_BOUNDARY_CASES)('the SAME boundary cases as the server overdue rule: $letterSentAt → $overdue ($why)', (c) => {
    const cd = countdownOf({ status: 'letter_sent', letterSentAt: c.letterSentAt, claimedAt: '2026-09-01T00:00:00Z' }, OVERDUE_BOUNDARY_NOW);
    expect(cd?.tone === 'danger').toBe(c.overdue);
    const f = followUps([{ status: 'letter_sent', letterSentAt: c.letterSentAt, claimedAt: '2026-09-01T00:00:00Z', outstandingAgorot: 100 }], OVERDUE_BOUNDARY_NOW);
    expect(f.waiting.count === 1).toBe(c.overdue);
  });
  it('neutral above 3 days, warn at 3 or fewer, danger when late (after 7 days)', () => {
    expect(countdownOf({ status: 'letter_sent', letterSentAt: '2026-10-24T10:00:00.000Z', claimedAt: '2026-09-01T00:00:00Z' }, now)).toMatchObject({
      tone: 'neutral',
      daysLeft: 6,
    });
    expect(countdownOf({ status: 'claimed', letterSentAt: null, claimedAt: '2026-10-21T10:00:00.000Z' }, now)).toMatchObject({
      tone: 'warn',
      daysLeft: 3,
    });
    expect(countdownOf({ status: 'letter_sent', letterSentAt: '2026-10-18T10:00:00.000Z', claimedAt: '2026-09-01T00:00:00Z' }, now)).toMatchObject({
      tone: 'warn',
      daysLeft: 0,
    });
    expect(countdownOf({ status: 'acknowledged', letterSentAt: '2026-10-16T10:00:00.000Z', claimedAt: '2026-09-01T00:00:00Z' }, now)).toMatchObject({
      tone: 'danger',
      daysLate: 2,
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
  it('waiting starts after a week (owner 31.10): 6 days → not yet, 8 days → waiting', () => {
    const now = '2026-10-25T10:00:00.000Z';
    const sent = (iso: string, supplierName: string) =>
      ({ status: 'letter_sent' as const, outstandingAgorot: 1000, letterSentAt: iso, claimedAt: '2026-09-01T00:00:00Z', supplierName });
    expect(followUps([sent('2026-10-19T10:00:00.000Z', 'A')], now).waiting.count).toBe(0);
    expect(followUps([sent('2026-10-17T10:00:00.000Z', 'B')], now).waiting.count).toBe(1);
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
