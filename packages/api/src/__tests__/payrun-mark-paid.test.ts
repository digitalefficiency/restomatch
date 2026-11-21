import { describe, expect, it } from 'vitest';
import {
  holdReasonsOf,
  markPaidEnabled,
  markPaidRefusal,
  sortByDue,
  termsCheckStub,
  type HoldInputs,
  type PayRunRow,
} from '../routers/payRun';

/**
 * W2-03 pure guards. The DB half (NOT_FOUND across tenants, FORBIDDEN for receiver/chef,
 * NOT_IMPLEMENTED with the flag off) lives in payrun.attack.test.ts. The write half
 * (paid_at set; claims, ledger credits and letters unchanged; unmark restores; replay
 * of clientMutationId; one audit row) lands with H-03 + G-05 at the γ rebase.
 */

describe('PAY_RUN_MARK_PAID (server flag, default OFF)', () => {
  it.each([
    [{}, false],
    [{ PAY_RUN_MARK_PAID: '' }, false],
    [{ PAY_RUN_MARK_PAID: '0' }, false],
    [{ PAY_RUN_MARK_PAID: 'false' }, false],
    [{ PAY_RUN_MARK_PAID: '1' }, true],
    [{ PAY_RUN_MARK_PAID: 'true' }, true],
    [{ PAY_RUN_MARK_PAID: ' ON ' }, true],
  ])('%j → %s', (env, on) => {
    expect(markPaidEnabled(env)).toBe(on);
  });
});

describe('markPaidRefusal', () => {
  it('a stale expectedStatus is a CONFLICT naming the current status', () => {
    expect(
      markPaidRefusal({ expectedStatus: 'matched' }, { status: 'approved', cappedLeakIls: 0 }),
    ).toEqual({
      code: 'CONFLICT',
      status: 'approved',
    });
  });
  it('an already-paid invoice is a CONFLICT (a double mark never writes twice)', () => {
    expect(
      markPaidRefusal({ expectedStatus: 'paid' }, { status: 'paid', cappedLeakIls: 0 }),
    ).toMatchObject({ code: 'CONFLICT' });
  });
  it('until G-14: a capped leak > 0 is PRECONDITION_FAILED {open_leak, ils}', () => {
    expect(
      markPaidRefusal({ expectedStatus: 'matched' }, { status: 'matched', cappedLeakIls: 100 }),
    ).toEqual({
      code: 'PRECONDITION_FAILED',
      reason: 'open_leak',
      ils: 100,
    });
  });
  it('a clean, current invoice may be marked paid', () => {
    expect(
      markPaidRefusal({ expectedStatus: 'matched' }, { status: 'matched', cappedLeakIls: 0 }),
    ).toBeNull();
  });
});

const BASE: HoldInputs = {
  status: 'pay',
  pendingLink: false,
  awaitingCount: false,
  duplicate: false,
  duplicateIls: 0,
  pendingIls: 0,
  totalInclVat: 4513.15,
  openRole: null,
  openDays: null,
  viewerRole: 'owner',
  missingAllocationVatIls: null,
  noteBilledTwiceIls: null,
};

describe('holdReasonsOf', () => {
  it('a payable row has no hold', () => {
    expect(holdReasonsOf(BASE)).toEqual([]);
  });

  it('"ממתין להחלטת: בעלים · 4 ימים · ₪100.00 בבירור מול הספק מתוך ₪4,513.15"', () => {
    expect(
      holdReasonsOf({ ...BASE, status: 'hold', pendingIls: 100, openRole: 'owner', openDays: 4 }),
    ).toEqual([
      {
        kind: 'decision',
        waitingFor: 'owner',
        days: 4,
        disputeIls: 100,
        ofIls: 4513.15,
        canAct: true,
      },
    ]);
  });

  it('a bookkeeper viewing an owner item gets "שלחו תזכורת" (canAct false)', () => {
    const [h] = holdReasonsOf({
      ...BASE,
      status: 'hold',
      pendingIls: 100,
      openRole: 'owner',
      viewerRole: 'bookkeeper',
    });
    expect(h).toMatchObject({ kind: 'decision', canAct: false });
  });

  it('a duplicate copy is "don\'t pay this copy", not a decision', () => {
    expect(holdReasonsOf({ ...BASE, status: 'hold', duplicate: true, duplicateIls: 300 })).toEqual([
      { kind: 'duplicate', ils: 300 },
    ]);
  });

  it('a missing allocation number holds an otherwise payable row, with the VAT at risk', () => {
    expect(holdReasonsOf({ ...BASE, missingAllocationVatIls: 765.6 })).toEqual([
      { kind: 'missing_allocation', vatIls: 765.6 },
    ]);
  });

  it("G-04's note_billed_twice holds, with the overlap ₪ in dispute", () => {
    expect(holdReasonsOf({ ...BASE, noteBilledTwiceIls: 212.4 })).toEqual([
      { kind: 'note_billed_twice', ils: 212.4 },
    ]);
    expect(holdReasonsOf({ ...BASE, noteBilledTwiceIls: 0 })).toEqual([]);
  });

  it('G-08 question / OCR review holds are calm, never a decision', () => {
    expect(holdReasonsOf({ ...BASE, status: 'hold', awaitingQuestion: true }).map((h) => h.kind)).toEqual(['awaiting_question']);
    expect(holdReasonsOf({ ...BASE, status: 'hold', awaitingReview: true }).map((h) => h.kind)).toEqual(['awaiting_review']);
  });

  it('pending link / awaiting count are calm holds, never a decision', () => {
    expect(
      holdReasonsOf({ ...BASE, status: 'hold', pendingLink: true }).map((h) => h.kind),
    ).toEqual(['pending_link']);
    expect(
      holdReasonsOf({ ...BASE, status: 'hold', awaitingCount: true }).map((h) => h.kind),
    ).toEqual(['awaiting_count']);
  });
});

describe('termsCheck (interim stub with G-17 signature)', () => {
  it('printed שוטף+30 vs agreed שוטף+60 ⇒ shorter, with both dates', () => {
    expect(termsCheckStub('שוטף+60', '2026-10-05', 'שוטף + 30', null)).toEqual({
      verdict: 'shorter',
      agreedDue: '2026-12-30',
      printedDue: '2026-11-30',
      printedSource: 'terms',
    });
  });
  it('a printed date wins over printed terms when they disagree', () => {
    expect(termsCheckStub('שוטף+30', '2026-10-05', 'שוטף+60', '2026-11-10')).toMatchObject({
      verdict: 'shorter',
      printedDue: '2026-11-10',
      printedSource: 'date',
    });
  });
  it('equal or later printed ⇒ ok; a missing side ⇒ unknown (neutral)', () => {
    expect(termsCheckStub('שוטף+30', '2026-10-05', 'שוטף+30', null).verdict).toBe('ok');
    expect(termsCheckStub(null, '2026-10-05', 'שוטף+30', null).verdict).toBe('unknown');
    expect(termsCheckStub('שוטף+30', '2026-10-05', null, null).verdict).toBe('unknown');
  });
});

describe('sortByDue', () => {
  const r = (dueDate: string | null, invoiceDate: string, invoiceNumber: string) =>
    ({ dueDate, invoiceDate, invoiceNumber }) as PayRunRow;
  it('due ascending, unknown last, then invoice date', () => {
    const rows = [
      r(null, '2026-10-01', 'A'),
      r('2026-11-01', '2026-10-01', 'B'),
      r('2026-10-28', '2026-09-28', 'MF-24950'),
      r('2026-10-28', '2026-09-20', 'C'),
    ].sort(sortByDue);
    expect(rows.map((x) => x.invoiceNumber)).toEqual(['C', 'MF-24950', 'B', 'A']);
  });
});
