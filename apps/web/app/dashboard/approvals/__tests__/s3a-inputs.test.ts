import superjson from 'superjson';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { approvals } from '@/lib/i18n/messages/approvals';
import {
  approveInput,
  batchFailSel,
  batchFailureOf,
  batchMutationId,
  decideFailBack,
  decideManyInput,
  decisionCall,
  deskReducer,
  escalateInput,
  focusAfterDecision,
  howOr,
  initDeskState,
  isOpenRow,
  rejectInput,
  reopenCall,
  type DeskAction,
  type DeskState,
  type FailureOutcome,
} from '../desk-state';
import type { QueueItem, QueueSummary } from '../desk-types';

/**
 * DS3-04 S3a fix round: what the controller (use-desk.ts) sends and how it rolls back, as pure functions.
 * Spec §5.4: every decision calls the same procedure with the same input as list.tsx — pinned field by field, in
 * key order, and through the transport's own serializer (superjson, lib/trpc/client.tsx) against the literal objects
 * list.tsx builds (list.tsx:244-255, :320, :329, :418-430).
 */

const he = createTranslator('he', approvals);
const wire = (v: unknown) => JSON.stringify(superjson.serialize(v));

const BASE: QueueItem = {
  id: '6f1c2a4e-0b6d-4c1e-9a55-0d6f3b8e7a01',
  type: 'PRICE_HIGHER',
  severity: 'warn',
  resolutionStatus: 'open',
  requiredRole: 'owner',
  deltaAmount: '104.80',
  expectedValue: '522.6000',
  actualValue: '575.0000',
  toleranceUsed: 'price: ±2% or ₪5',
  ruleName: null,
  ruleId: null,
  productName: 'בירה מהחבית',
  productNameEn: 'Draught beer',
  supplierName: 'משקאות שטיינברג',
  supplierNameEn: 'Steinberg Drinks',
  invoiceNumber: 'ST-24108',
  invoiceDueDate: null,
  invoiceStatus: 'matched',
  invoiceDate: null,
  hasScan: false,
  message: null,
  createdAt: new Date('2026-10-20T08:00:00.000Z'),
  matchRunId: 'mr-1',
  invoiceId: 'inv-1',
  invoiceLineId: 'line-1',
  lineDescription: null,
  lineDescriptionEn: null,
  qtyBilled: '2.000',
  billedUnit: 'חבית',
  unitPriceBilled: '575.0000',
  lineTotal: '1150.00',
  qtyOrdered: '2.000',
  orderedUnit: 'חבית',
  unitPriceExpected: '522.6000',
  qtyReceived: null,
  poId: 'po-1',
  poRef: null,
  poDate: null,
  claimable: true,
  claimAgorot: 10480,
  canAct: true,
  waitingOn: 'owner',
};
const row = (o: Partial<QueueItem>): QueueItem => ({ ...BASE, ...o });
const ESCALATED = row({ id: '0e8d7c6b-5a49-4382-8170-6f5e4d3c2b1a', resolutionStatus: 'escalated', claimAgorot: 0 });

describe('approveInput: approve {discrepancyId, expectedStatus, seenClaimAgorot} (claim, hold the copy)', () => {
  it('field by field, in list.tsx order', () => {
    const input = approveInput(BASE);
    expect(Object.keys(input)).toEqual(['discrepancyId', 'expectedStatus', 'seenClaimAgorot']);
    expect(input.discrepancyId).toBe(BASE.id);
    expect(input.expectedStatus).toBe('open');
    expect(input.seenClaimAgorot).toBe(10480);
  });
  it('an escalated row sends its own status; a ₪0 claim sends 0 (never dropped)', () => {
    const input = approveInput(ESCALATED);
    expect(input.expectedStatus).toBe('escalated');
    expect(input.seenClaimAgorot).toBe(0);
    expect('seenClaimAgorot' in input).toBe(true);
  });
  it('the same bytes on the wire as list.tsx:244-248', () => {
    for (const d of [BASE, ESCALATED]) {
      const today = { discrepancyId: d.id, expectedStatus: d.resolutionStatus as 'open' | 'escalated', seenClaimAgorot: d.claimAgorot };
      expect(wire(approveInput(d))).toBe(wire(today));
    }
  });
});

describe('rejectInput: reject {discrepancyId, reason, reasonCode} (review, pay as billed)', () => {
  it('pay as billed: the chip text and its code, field by field', () => {
    const input = rejectInput(BASE, he('reasons.price_agreed'), 'price_agreed');
    expect(Object.keys(input)).toEqual(['discrepancyId', 'reason', 'reasonCode']);
    expect(input.discrepancyId).toBe(BASE.id);
    expect(input.reason).toBe(he('reasons.price_agreed'));
    expect(input.reasonCode).toBe('price_agreed');
    expect(input).not.toHaveProperty('expectedStatus'); // list.tsx never sent one with reject
  });
  it('"אחר": the typed text goes as the reason with the code other', () => {
    expect(rejectInput(BASE, 'הספק אישר בטלפון', 'other')).toEqual({ discrepancyId: BASE.id, reason: 'הספק אישר בטלפון', reasonCode: 'other' });
  });
  it('review: decision.reviewed with the code reviewed; the same bytes as list.tsx:250-254', () => {
    const reason = he('decision.reviewed');
    const input = rejectInput(BASE, reason, 'reviewed');
    expect(input).toEqual({ discrepancyId: BASE.id, reason, reasonCode: 'reviewed' });
    expect(wire(input)).toBe(wire({ discrepancyId: BASE.id, reason, reasonCode: 'reviewed' }));
  });
});

describe('escalateInput: escalate {discrepancyId, note}', () => {
  it('with the Sheet’s note', () => {
    const input = escalateInput(BASE, 'המחיר לא תואם להסכם');
    expect(Object.keys(input)).toEqual(['discrepancyId', 'note']);
    expect(input).toEqual({ discrepancyId: BASE.id, note: 'המחיר לא תואם להסכם' });
  });
  it('no note: the key is still sent, undefined — the same bytes as list.tsx:255', () => {
    const input = escalateInput(BASE, undefined);
    expect(Object.keys(input)).toEqual(['discrepancyId', 'note']);
    expect(input.note).toBeUndefined();
    expect(wire(input)).toBe(wire({ discrepancyId: BASE.id, note: undefined }));
    // The check is meaningful: superjson tells a present-undefined key from a missing one.
    expect(wire(input)).not.toBe(wire({ discrepancyId: BASE.id }));
  });
  it('no expectedStatus (list.tsx never sent one with escalate)', () => {
    expect(escalateInput(ESCALATED, 'x')).not.toHaveProperty('expectedStatus');
  });
});

describe('decideManyInput: decideMany {items: [{discrepancyId, expectedStatus}], decision: accepted, clientMutationId}', () => {
  const rows = [BASE, ESCALATED];
  it('field by field, item by item, rows in the order given', () => {
    const input = decideManyInput(rows, 'cm-12345678');
    expect(Object.keys(input)).toEqual(['items', 'decision', 'clientMutationId']);
    expect(input.items).toHaveLength(2);
    expect(input.items.map((i) => Object.keys(i))).toEqual([
      ['discrepancyId', 'expectedStatus'],
      ['discrepancyId', 'expectedStatus'],
    ]);
    expect(input.items[0]).toEqual({ discrepancyId: BASE.id, expectedStatus: 'open' });
    expect(input.items[1]).toEqual({ discrepancyId: ESCALATED.id, expectedStatus: 'escalated' });
    expect(input.decision).toBe('accepted');
    expect(input.clientMutationId).toBe('cm-12345678');
    expect(input).not.toHaveProperty('reason');
    expect(input).not.toHaveProperty('reasonCode');
  });
  it('no claim figure travels with a bulk approve (the server reads each row)', () => {
    const input = decideManyInput(rows, 'cm-12345678');
    for (const item of input.items) expect(item).not.toHaveProperty('seenClaimAgorot');
  });
  it('the same bytes as list.tsx:418-430', () => {
    const today = {
      items: rows.map((r) => ({ discrepancyId: r.id, expectedStatus: r.resolutionStatus as 'open' | 'escalated' })),
      decision: 'accepted',
      clientMutationId: 'cm-12345678',
    };
    expect(wire(decideManyInput(rows, 'cm-12345678'))).toBe(wire(today));
  });
  it('the replay id: the same sorted ids keep the attempt’s id; a success forgets it (use-desk sets null)', () => {
    let n = 0;
    const fresh = () => `cm-${++n}-abcdefgh`;
    const first = batchMutationId(null, [ESCALATED.id, BASE.id], fresh);
    const retry = batchMutationId(first, [BASE.id, ESCALATED.id], fresh);
    expect(decideManyInput(rows, retry.id).clientMutationId).toBe(decideManyInput(rows, first.id).clientMutationId);
    const afterOk = batchMutationId(null, [BASE.id, ESCALATED.id], fresh);
    expect(afterOk.id).not.toBe(first.id);
  });
});

describe('decisionCall: one decision → its procedure and the input above', () => {
  it('approve', () => {
    expect(decisionCall(BASE, { procedure: 'approve' })).toEqual({ procedure: 'approve', input: approveInput(BASE) });
  });
  it('reject (pay as billed and review)', () => {
    expect(decisionCall(BASE, { procedure: 'reject', reason: 'r', reasonCode: 'negligible' })).toEqual({
      procedure: 'reject',
      input: { discrepancyId: BASE.id, reason: 'r', reasonCode: 'negligible' },
    });
    expect(decisionCall(BASE, { procedure: 'reject', reason: he('decision.reviewed'), reasonCode: 'reviewed' })).toEqual({
      procedure: 'reject',
      input: rejectInput(BASE, he('decision.reviewed'), 'reviewed'),
    });
  });
  it('escalate, with and without a note', () => {
    expect(decisionCall(BASE, { procedure: 'escalate', note: 'n' })).toEqual({ procedure: 'escalate', input: { discrepancyId: BASE.id, note: 'n' } });
    const bare = decisionCall(BASE, { procedure: 'escalate' });
    expect(bare.procedure).toBe('escalate');
    expect(Object.keys(bare.input)).toEqual(['discrepancyId', 'note']);
  });
});

describe('reopenCall: undo → reopen {discrepancyId} / reopenMany {discrepancyIds}', () => {
  it('one decision → reopen its gap (list.tsx:329)', () => {
    const call = reopenCall({ ids: [BASE.id], bulk: false });
    expect(call).toEqual({ procedure: 'reopen', input: { discrepancyId: BASE.id } });
    expect(call && Object.keys(call.input)).toEqual(['discrepancyId']);
  });
  it('a bulk or group decision → reopenMany with every id, in order (list.tsx:320)', () => {
    const ids = [BASE.id, ESCALATED.id];
    const call = reopenCall({ ids, bulk: true });
    expect(call).toEqual({ procedure: 'reopenMany', input: { discrepancyIds: ids } });
    expect(call?.procedure === 'reopenMany' && call.input.discrepancyIds).toEqual(ids);
    expect(wire(call?.input)).toBe(wire({ discrepancyIds: ids }));
  });
  it('a bulk undo of one gap is still reopenMany; no id → null', () => {
    expect(reopenCall({ ids: [BASE.id], bulk: true })?.procedure).toBe('reopenMany');
    expect(reopenCall({ ids: [], bulk: false })).toBeNull();
    expect(reopenCall({ ids: [], bulk: true })).toBeNull();
  });
});

describe('decideFailBack: a failed decision returns to its gap only while ?sel= is where the decision put it', () => {
  const KINDS: FailureOutcome['kind'][] = ['amountChanged', 'escalatedToYou', 'forbidden', 'error'];
  it('the next loaded gap is still current → back to the failed gap, its primary (elsewhere → "הסתירו")', () => {
    for (const outcome of KINDS) {
      expect(decideFailBack({ advance: true, sel: 'B', landedOn: 'B', id: 'A', outcome }), outcome).toEqual({
        sel: 'A',
        focus: { to: 'primary' },
      });
    }
    expect(decideFailBack({ advance: true, sel: 'B', landedOn: 'B', id: 'A', outcome: 'elsewhere' })).toEqual({
      sel: 'A',
      focus: { to: 'hide' },
    });
  });
  it('the last loaded gap, the next page still loading (?sel= removed) → back', () => {
    expect(decideFailBack({ advance: true, sel: null, landedOn: null, id: 'A', outcome: 'error' })).toEqual({
      sel: 'A',
      focus: { to: 'primary' },
    });
  });
  it('the next page landed and the controller brought its first gap up (landedOn = P1) → still back', () => {
    expect(decideFailBack({ advance: true, sel: 'P1', landedOn: 'P1', id: 'A', outcome: 'forbidden' })).toEqual({
      sel: 'A',
      focus: { to: 'primary' },
    });
    // The old check (?sel= === the next loaded gap, null) missed exactly this case.
    expect(decideFailBack({ advance: true, sel: 'P1', landedOn: null, id: 'A', outcome: 'forbidden' })).toBeNull();
  });
  it('the user moved → nothing moves; a decision that did not move the current gap → nothing moves', () => {
    expect(decideFailBack({ advance: true, sel: 'C', landedOn: 'B', id: 'A', outcome: 'error' })).toBeNull();
    expect(decideFailBack({ advance: true, sel: 'C', landedOn: 'P1', id: 'A', outcome: 'error' })).toBeNull();
    expect(decideFailBack({ advance: false, sel: 'B', landedOn: 'B', id: 'A', outcome: 'error' })).toBeNull();
  });
});

describe('batchFailSel: a refused group returns the current gap (R11, §2.6); a refused selection stays', () => {
  const ids = ['E1', 'E2'];
  it('group, the user has not moved → the group’s first gap', () => {
    expect(batchFailSel({ origin: 'group', advance: true, sel: 'F', target: 'F', ids })).toBe('E1');
  });
  it('group, the last loaded gaps: the next page loading (null) or landed (its first gap) → still the first gap', () => {
    expect(batchFailSel({ origin: 'group', advance: true, sel: null, target: null, ids })).toBe('E1');
    expect(batchFailSel({ origin: 'group', advance: true, sel: 'P1', target: 'P1', ids })).toBe('E1');
  });
  it('group, the user moved, or the current gap was not in the group → ?sel= stays', () => {
    expect(batchFailSel({ origin: 'group', advance: true, sel: 'X', target: 'F', ids })).toBeNull();
    expect(batchFailSel({ origin: 'group', advance: false, sel: 'C', target: 'C', ids })).toBeNull();
  });
  it('selection → ?sel= stays (the BatchBar note speaks, §5.3); no ids → null', () => {
    expect(batchFailSel({ origin: 'selection', advance: true, sel: 'F', target: 'F', ids })).toBeNull();
    expect(batchFailSel({ origin: 'selection', advance: false, sel: 'C', target: 'C', ids })).toBeNull();
    expect(batchFailSel({ origin: 'group', advance: true, sel: 'F', target: 'F', ids: [] })).toBeNull();
  });
});

describe('batchFailureOf: the note of a refused decideMany (list.tsx:441-449)', () => {
  it('CONFLICT → batchConflict; FORBIDDEN / BAD_REQUEST → batchError; nothing reloads', () => {
    expect(batchFailureOf({ data: { code: 'CONFLICT' } })).toEqual({ note: 'desk.batchConflict', unknown: false });
    expect(batchFailureOf({ data: { code: 'FORBIDDEN' } })).toEqual({ note: 'desk.batchError', unknown: false });
    expect(batchFailureOf({ data: { code: 'BAD_REQUEST' } })).toEqual({ note: 'desk.batchError', unknown: false });
  });
  it('a 500, a network error or nothing → batchUnknown, and the queue reloads', () => {
    expect(batchFailureOf({ data: { code: 'INTERNAL_SERVER_ERROR' } })).toEqual({ note: 'desk.batchUnknown', unknown: true });
    expect(batchFailureOf({ message: 'Failed to fetch' })).toEqual({ note: 'desk.batchUnknown', unknown: true });
    expect(batchFailureOf(null)).toEqual({ note: 'desk.batchUnknown', unknown: true });
  });
  it('every note is a real message', () => {
    for (const code of ['CONFLICT', 'FORBIDDEN', 'X']) {
      const { note } = batchFailureOf({ data: { code } });
      expect(he(note)).not.toBe(note);
      expect(he(note).length).toBeGreaterThan(0);
    }
  });
});

describe('focusAfterDecision: the last LOADED gap is not the last gap', () => {
  it('no next loaded gap but the server holds more → stay (not the empty state)', () => {
    expect(focusAfterDecision({ how: 'pointer', origin: 'bar', nextId: null, hasMore: true })).toEqual({ to: 'stay' });
    expect(focusAfterDecision({ how: 'key', origin: 'queue', nextId: null, hasMore: true })).toEqual({ to: 'stay' });
  });
  it('nothing more anywhere → the empty state (hasMore false or not given, as before)', () => {
    expect(focusAfterDecision({ how: 'pointer', origin: 'bar', nextId: null, hasMore: false })).toEqual({ to: 'empty' });
    expect(focusAfterDecision({ how: 'pointer', origin: 'bar', nextId: null })).toEqual({ to: 'empty' });
  });
  it('a next gap: hasMore changes nothing', () => {
    expect(focusAfterDecision({ how: 'keyboard', origin: 'bar', nextId: 'B', hasMore: true })).toEqual({ to: 'primary' });
    expect(focusAfterDecision({ how: 'pointer', origin: 'bar', nextId: 'B', hasMore: true })).toEqual({ to: 'row', id: 'B' });
  });
});

describe('howOr: an optional how, defaulting to today’s behaviour', () => {
  it('the three words pass', () => {
    expect(howOr('pointer', 'keyboard')).toBe('pointer');
    expect(howOr('keyboard', 'pointer')).toBe('keyboard');
    expect(howOr('key', 'pointer')).toBe('key');
  });
  it('nothing, another word, or a click event handed over by `onClick={c.retry}` → the fallback', () => {
    expect(howOr(undefined, 'keyboard')).toBe('keyboard');
    expect(howOr('mouse', 'pointer')).toBe('pointer');
    expect(howOr({ type: 'click', detail: 1 }, 'keyboard')).toBe('keyboard');
    expect(howOr(null, 'pointer')).toBe('pointer');
  });
});

describe('a batch over the rows still open restores exactly what it marked (batch/start ↔ batch/fail)', () => {
  const C = row({ id: 'C', claimAgorot: 11800, invoiceId: 'inv-C' });
  const E1 = row({ id: 'E1', claimAgorot: 3000, invoiceId: 'inv-E' });
  const E2 = row({ id: 'E2', claimAgorot: 1500, invoiceId: 'inv-E' });
  const SUMMARY: QueueSummary = {
    count: 3,
    blockers: 0,
    oldestAt: null,
    claimableIls: 163,
    duplicateIls: 0,
    vatIls: 0,
    toDecide: { count: 3, amountIls: 163 },
    toReview: { count: 0 },
    others: { count: 0, amountIls: 0, byRole: [] },
  };
  const run = (s: DeskState, ...actions: DeskAction[]) => actions.reduce(deskReducer, s);
  it('a candidate decided meanwhile (in flight) never joins, and the rollback leaves it decided', () => {
    const inFlight = run(initDeskState({ initial: [C, E1, E2], initialSummary: SUMMARY }), {
      type: 'decide/start',
      ids: ['C'],
      how: 'pointer',
      result: 'נוסף לבקשת הזיכוי',
    });
    // use-desk's decideBatch filters the candidates the same way before batch/start and before decideMany.
    const ids = [C, E1, E2].filter((r) => isOpenRow(inFlight, r.id)).map((r) => r.id);
    expect(ids).toEqual(['E1', 'E2']);
    expect(decideManyInput([E1, E2], 'cm-12345678').items.map((i) => i.discrepancyId)).toEqual(ids);
    const failed = run(
      inFlight,
      { type: 'batch/start', ids, origin: 'group', result: 'נוסף לבקשת הזיכוי' },
      { type: 'batch/fail', ids, origin: 'group', note: 'n' },
    );
    expect(failed.summary).toEqual(inFlight.summary);
    expect(failed.done.has('C')).toBe(true);
    expect(failed.inFlight.has('C')).toBe(true);
    expect(isOpenRow(failed, 'E1') && isOpenRow(failed, 'E2')).toBe(true);
  });
});
