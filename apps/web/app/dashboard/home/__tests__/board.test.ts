import { describe, expect, it } from 'vitest';
import { buildBoard, truckHref, truckState, type BoardExpectation } from '../board';

const NOW = new Date('2026-10-25T07:00:00.000Z'); // 10:00 in Israel
const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString();

function po(id: string, over: Partial<BoardExpectation> = {}): BoardExpectation {
  return {
    poId: id,
    supplierName: `ספק ${id}`,
    supplierNameEn: null,
    expectedAt: at(60),
    hasDeliveryDate: true,
    lineCount: 5,
    receiptId: null,
    receiptStatus: null,
    late: false,
    closedAt: null,
    ...over,
  };
}

describe('truckState', () => {
  it('maps the receipt status to one state per truck', () => {
    expect(truckState({ receiptStatus: null })).toBe('notStarted');
    expect(truckState({ receiptStatus: 'pending' })).toBe('inProgress');
    expect(truckState({ receiptStatus: 'completed' })).toBe('received');
    expect(truckState({ receiptStatus: 'partial' })).toBe('receivedPartial');
  });
});

describe('buildBoard', () => {
  it('summary line: today’s trucks, received, late ("היום: 5 משלוחים · 2 התקבלו · 1 באיחור")', () => {
    const b = buildBoard(
      [
        po('a', { receiptStatus: 'completed', receiptId: 'g1', closedAt: at(-120), expectedAt: at(-180) }),
        po('b', { receiptStatus: 'partial', receiptId: 'g2', closedAt: at(-60), expectedAt: at(-90) }),
        po('c', { expectedAt: at(-45) }), // past window + 30 min, not started → late
        po('d', { expectedAt: at(30) }),
        po('e', { expectedAt: at(240) }),
        po('u', { hasDeliveryDate: false }),
      ],
      NOW,
    );
    expect(b.summary).toEqual({ total: 5, received: 2, late: 1 });
  });

  it('past-dated open POs (server `late`) go under באיחור; the oldest late truck is next when nothing is open', () => {
    const b = buildBoard([po('y', { late: true, expectedAt: at(-24 * 60) }), po('z', { late: true, expectedAt: at(-48 * 60) }), po('d')], NOW);
    expect(b.next?.poId).toBe('z');
    expect(b.late.map((i) => i.poId)).toEqual(['y']);
    expect(b.now.map((i) => i.poId)).toEqual(['d']);
  });

  it('an open receipt is next and in progress — never late, never a warning, even past its window', () => {
    const b = buildBoard([po('late', { late: true, expectedAt: at(-1440) }), po('open', { receiptStatus: 'pending', receiptId: 'g', expectedAt: at(-60) })], NOW);
    expect(b.next).toMatchObject({ poId: 'open', state: 'inProgress', isLate: false });
    expect(b.late.map((i) => i.poId)).toEqual(['late']);
  });

  it('a truck within its 30-min grace is not late; due soon → עכשיו, later today → בהמשך', () => {
    const b = buildBoard([po('grace', { expectedAt: at(-20) }), po('soon', { expectedAt: at(45) }), po('pm', { expectedAt: at(300) })], NOW);
    expect(b.next?.poId).toBe('grace');
    expect(b.late).toEqual([]);
    expect(b.now.map((i) => i.poId)).toEqual(['soon']);
    expect(b.later.map((i) => i.poId)).toEqual(['pm']);
  });

  it('closed receipts are listed as received (latest first) and are never the next action', () => {
    const b = buildBoard(
      [
        po('a', { receiptStatus: 'completed', closedAt: at(-120), late: false }),
        po('b', { receiptStatus: 'completed', closedAt: at(-30) }),
      ],
      NOW,
    );
    expect(b.next).toBeNull();
    expect(b.received.map((i) => i.poId)).toEqual(['b', 'a']);
    expect(b.received.every((i) => !i.isLate)).toBe(true);
  });

  it('undated POs sit in ללא תאריך and are next only when nothing dated waits', () => {
    expect(buildBoard([po('u', { hasDeliveryDate: false })], NOW).next?.poId).toBe('u');
    const b = buildBoard([po('u', { hasDeliveryDate: false }), po('d')], NOW);
    expect(b.next?.poId).toBe('d');
    expect(b.undated.map((i) => i.poId)).toEqual(['u']);
  });

  it('an undated receipt closed on an earlier day is history: not "received today", and received never exceeds total', () => {
    const b = buildBoard(
      [
        po('old', { hasDeliveryDate: false, receiptStatus: 'completed', closedAt: at(-3 * 24 * 60) }),
        po('today', { hasDeliveryDate: false, receiptStatus: 'completed', closedAt: at(-30) }),
        po('d'),
      ],
      NOW,
    );
    expect(b.received.map((i) => i.poId)).toEqual(['today']);
    expect(b.summary).toEqual({ total: 2, received: 1, late: 0 });
  });

  it('a late truck received today counts as received today', () => {
    const b = buildBoard([po('y', { late: false, expectedAt: at(-24 * 60), receiptStatus: 'completed', closedAt: at(-15) })], NOW);
    expect(b.received.map((i) => i.poId)).toEqual(['y']);
    expect(b.summary).toEqual({ total: 1, received: 1, late: 0 });
  });

  it('every truck appears exactly once', () => {
    const rows = [po('a', { late: true, expectedAt: at(-1440) }), po('b', { receiptStatus: 'pending' }), po('c'), po('d', { expectedAt: at(500) }), po('e', { hasDeliveryDate: false }), po('f', { receiptStatus: 'completed' })];
    const b = buildBoard(rows, NOW);
    const ids = [b.next, ...b.late, ...b.now, ...b.later, ...b.undated, ...b.received].filter(Boolean).map((i) => i!.poId);
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('truckHref', () => {
  it('open trucks go to the wizard; closed ones open read-only on the board', () => {
    expect(truckHref({ poId: 'p1', state: 'inProgress' })).toBe('/dashboard/receiving/p1');
    expect(truckHref({ poId: 'p1', state: 'received' })).toBe('/dashboard/receiving?receipt=p1');
    expect(truckHref({ poId: 'p1', state: 'receivedPartial' })).toBe('/dashboard/receiving?receipt=p1');
  });
});
