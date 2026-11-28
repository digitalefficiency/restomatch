import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { approvals } from '@/lib/i18n/messages/approvals';
import {
  BATCH_KEY,
  PAGE,
  adjustSummary,
  askingRow,
  batchFailSel,
  batchMutationId,
  batchRefusalOf,
  deskReducer,
  failureOutcome,
  focusAfterDecision,
  initDeskState,
  isOpenRow,
  liveRows,
  nextOpenAfter,
  positionOf,
  resolveCurrent,
  rowStateOf,
  rowsView,
  stepOpen,
  type DeskAction,
  type DeskState,
} from '../desk-state';
import type { QueueItem, QueueSummary, UndoView } from '../desk-types';

/**
 * DS3-04 spec §2.6 / §7.1 (S3): the desk's pure state machine — every transition, the selectors, the summary's
 * optimistic moves and the CONFLICT / FORBIDDEN / error outcomes. No React, no tRPC: what the controller dispatches.
 */

const he = createTranslator('he', approvals);

const BASE: QueueItem = {
  id: 'x',
  type: 'PRICE_HIGHER',
  severity: 'warn',
  resolutionStatus: 'open',
  requiredRole: 'owner',
  deltaAmount: '10.00',
  expectedValue: '20.0000',
  actualValue: '22.0000',
  toleranceUsed: 'price: ±2% or ₪5',
  ruleName: null,
  ruleId: null,
  productName: 'פריט',
  productNameEn: null,
  supplierName: 'ספק',
  supplierNameEn: null,
  invoiceNumber: 'INV-1',
  invoiceDueDate: null,
  invoiceStatus: 'matched',
  invoiceDate: null,
  hasScan: false,
  message: null,
  createdAt: new Date('2026-10-20T08:00:00.000Z'),
  matchRunId: 'mr-1',
  invoiceId: 'inv-x',
  invoiceLineId: 'line-x',
  lineDescription: null,
  lineDescriptionEn: null,
  qtyBilled: '5.000',
  billedUnit: 'יח׳',
  unitPriceBilled: '22.0000',
  lineTotal: '110.00',
  qtyOrdered: '5.000',
  orderedUnit: 'יח׳',
  unitPriceExpected: '20.0000',
  qtyReceived: null,
  poId: 'po-1',
  poRef: null,
  poDate: null,
  claimable: true,
  claimAgorot: 1000,
  canAct: true,
  waitingOn: 'owner',
};
const row = (o: Partial<QueueItem>): QueueItem => ({ ...BASE, ...o });

// Server order: block → warn → info.
const A = row({ id: 'A', severity: 'block', claimAgorot: 14700, deltaAmount: '147.00', invoiceId: 'inv-A' });
const B = row({ id: 'B', type: 'QTY_OVER', severity: 'block', claimAgorot: 12450, deltaAmount: '124.50', invoiceId: 'inv-A' });
const D = row({ id: 'D', type: 'DUPLICATE_INVOICE', severity: 'block', claimAgorot: 118000, deltaAmount: '1180.00', invoiceId: 'inv-D' });
const C = row({ id: 'C', claimAgorot: 11800, deltaAmount: '150.00', invoiceId: 'inv-C' });
const E1 = row({ id: 'E1', claimAgorot: 3000, deltaAmount: '30.00', invoiceId: 'inv-E' });
const E2 = row({ id: 'E2', claimAgorot: 1500, deltaAmount: '15.00', invoiceId: 'inv-E' });
const V = row({ id: 'V', type: 'VAT_MISMATCH', claimAgorot: 170, deltaAmount: '1.70', invoiceId: 'inv-V' });
const R = row({ id: 'R', type: 'QTY_SHORT', severity: 'info', claimable: false, claimAgorot: 0, deltaAmount: '12.00', invoiceId: 'inv-R' });
const ITEMS = [A, B, D, C, E1, E2, V, R];

const SUMMARY: QueueSummary = {
  count: 8,
  blockers: 3,
  oldestAt: null,
  claimableIls: 434.5, // A 147 + B 124.50 + C 118 + E1 30 + E2 15 (D and V are reported apart)
  duplicateIls: 1180,
  vatIls: 1.7,
  toDecide: { count: 7, amountIls: 434.5 },
  toReview: { count: 1 },
  others: { count: 0, amountIls: 0, byRole: [] },
};

const s0 = (): DeskState => initDeskState({ initial: ITEMS, initialSummary: SUMMARY });
const run = (s: DeskState, ...actions: DeskAction[]): DeskState => actions.reduce(deskReducer, s);
const undoOf = (ids: string[], sentAt = 1_000, bulk = false): UndoView => ({
  text: 'נוסף לבקשת הזיכוי',
  sentAt,
  capAt: sentAt + 12_000,
  instant: false,
  failed: false,
  busy: false,
  ids,
  bulk,
});
const start = (id: string, how: 'pointer' | 'keyboard' | 'key' = 'pointer'): DeskAction => ({
  type: 'decide/start',
  ids: [id],
  how,
  result: 'נוסף לבקשת הזיכוי',
});
const ok = (id: string, sentAt = 1_000): DeskAction => ({ type: 'decide/ok', ids: [id], undo: undoOf([id], sentAt) });
const stateOf = (s: DeskState, id: string) => rowsView(s, null).find((v) => v.row.id === id)?.state ?? 'hidden';

describe('init', () => {
  it('server order, the server summary, "has more" from the page size', () => {
    const s = s0();
    expect(s.items.map((x) => x.id)).toEqual(['A', 'B', 'D', 'C', 'E1', 'E2', 'V', 'R']);
    expect(s.summary).toBe(SUMMARY);
    expect(s.hasMore).toBe(false);
    const full = initDeskState({ initial: Array.from({ length: PAGE }, (_, i) => row({ id: `p${i}` })), initialSummary: SUMMARY });
    expect(full.hasMore).toBe(true);
  });
});

describe('a decision: start → ok → undo/expire', () => {
  it('the row turns done at once and leaves the totals; its undo opens; expiry hides it', () => {
    let s = run(s0(), start('A'));
    expect(stateOf(s, 'A')).toBe('done');
    expect(rowsView(s, null).find((v) => v.row.id === 'A')?.result).toBe('נוסף לבקשת הזיכוי');
    expect(s.inFlight.has('A')).toBe(true);
    expect(liveRows(s).map((x) => x.id)).not.toContain('A');
    expect(s.summary.count).toBe(7);
    expect(s.summary.blockers).toBe(2);
    expect(s.summary.claimableIls).toBe(287.5);
    expect(s.summary.toDecide.count).toBe(6);
    expect(s.motion).toBe('next'); // a pointer decision animates (§4.10)
    s = run(s, ok('A'));
    expect(s.inFlight.size).toBe(0);
    expect(s.undo?.ids).toEqual(['A']);
    expect(stateOf(s, 'A')).toBe('done'); // done while its undo lives (Q4)
    s = run(s, { type: 'undo/expire' });
    expect(stateOf(s, 'A')).toBe('hidden');
    expect(s.done.size).toBe(0);
    expect(s.undo).toBeNull();
  });
  it('a key or keyboard decision does not animate', () => {
    expect(run(s0(), start('A', 'key')).motion).toBeNull();
    expect(run(s0(), start('A', 'keyboard')).motion).toBeNull();
  });
  it('a newer decision hides the older done row (its undo is gone)', () => {
    const s = run(s0(), start('A'), ok('A', 1_000), start('C'), ok('C', 2_000));
    expect(stateOf(s, 'A')).toBe('hidden');
    expect(stateOf(s, 'C')).toBe('done');
    expect(s.undo?.ids).toEqual(['C']);
  });
  it('a row still in flight is never hidden by another decision’s success', () => {
    const s = run(s0(), start('A'), start('C'), ok('A', 1_000));
    expect(stateOf(s, 'C')).toBe('done');
    expect(s.inFlight.has('C')).toBe(true);
    expect(s.undo?.ids).toEqual(['A']);
  });
  it('responses out of order: an older success never replaces a newer undo', () => {
    const s = run(s0(), start('A'), start('C'), ok('C', 2_000), ok('A', 1_000));
    expect(s.undo?.ids).toEqual(['C']);
    expect(stateOf(s, 'A')).toBe('hidden');
    expect(stateOf(s, 'C')).toBe('done');
  });
  it('undo/expire of another (older) undo changes nothing', () => {
    const s = run(s0(), start('A'), ok('A', 1_000));
    expect(run(s, { type: 'undo/expire', sentAt: 999 })).toBe(s);
  });
  it('a row that is not open cannot start again', () => {
    const s = run(s0(), start('A'));
    expect(run(s, start('A'))).toBe(s);
  });
});

describe('decide/fail: every outcome puts the row back and adds back exactly what it took', () => {
  it('amountChanged → open, claimAgorot patched, the note with the new figure', () => {
    const s = run(s0(), start('C'), {
      type: 'decide/fail',
      ids: ['C'],
      outcome: { kind: 'amountChanged', nowAgorot: 9_000 },
    });
    expect(stateOf(s, 'C')).toBe('open');
    expect(s.items.find((x) => x.id === 'C')?.claimAgorot).toBe(9_000);
    expect(s.notes.C).toEqual({ kind: 'amountChanged', amountAgorot: 9_000 });
    expect(s.summary).toEqual(SUMMARY);
    expect(s.inFlight.size).toBe(0);
  });
  it('escalatedToYou → open, patched in place to the owner, buttons kept', () => {
    const s = run(s0(), start('A'), { type: 'decide/fail', ids: ['A'], outcome: { kind: 'escalatedToYou' } });
    const a = s.items.find((x) => x.id === 'A');
    expect(a).toMatchObject({ resolutionStatus: 'escalated', requiredRole: 'owner', canAct: true });
    expect(s.notes.A).toEqual({ kind: 'escalatedToYou' });
    expect(stateOf(s, 'A')).toBe('open');
    expect(s.summary).toEqual(SUMMARY);
  });
  it('elsewhere → the done look with its result, kept as the current gap', () => {
    const s = run(s0(), start('A'), {
      type: 'decide/fail',
      ids: ['A'],
      outcome: { kind: 'elsewhere', text: 'כבר הוחלט ע״י מנהל', result: 'הועבר לבעלים' },
    });
    expect(stateOf(s, 'A')).toBe('elsewhere');
    expect(rowsView(s, 'A').find((v) => v.row.id === 'A')).toMatchObject({ state: 'elsewhere', result: 'הועבר לבעלים' });
    expect(s.elsewhere.get('A')?.text).toBe('כבר הוחלט ע״י מנהל');
    expect(resolveCurrent(s, 'A')?.id).toBe('A');
    expect(liveRows(s).map((x) => x.id)).not.toContain('A');
    expect(s.summary).toEqual(SUMMARY);
  });
  it('error → the note and a retry that repeats the same decision', () => {
    const retry = { action: { procedure: 'approve' as const }, doneLabel: 'נוסף לבקשת הזיכוי', amountKind: 'claim' as const };
    const s = run(s0(), start('A'), { type: 'decide/fail', ids: ['A'], outcome: { kind: 'error' }, retry });
    expect(s.notes.A).toEqual({ kind: 'error' });
    expect(s.retry.A).toEqual(retry);
    expect(stateOf(s, 'A')).toBe('open');
    expect(s.summary).toEqual(SUMMARY);
    // Deciding the row again clears both.
    const again = run(s, start('A'));
    expect(again.notes.A).toBeUndefined();
    expect(again.retry.A).toBeUndefined();
  });
  it('forbidden → the note, no retry', () => {
    const s = run(s0(), start('A'), { type: 'decide/fail', ids: ['A'], outcome: { kind: 'forbidden' }, retry: null });
    expect(s.notes.A).toEqual({ kind: 'forbidden' });
    expect(s.retry.A).toBeUndefined();
    expect(s.summary).toEqual(SUMMARY);
  });
});

describe('undo', () => {
  it('undo/start marks it busy; undo/ok reopens the rows and adds them back', () => {
    let s = run(s0(), start('A'), ok('A', 1_000), { type: 'undo/start', sentAt: 1_000 });
    expect(s.undo?.busy).toBe(true);
    expect(run(s, { type: 'undo/start', sentAt: 1_000 })).toBe(s); // already busy
    s = run(s, { type: 'undo/ok', ids: ['A'], sentAt: 1_000, how: 'pointer' });
    expect(stateOf(s, 'A')).toBe('open');
    expect(s.summary).toEqual(SUMMARY);
    expect(s.undo).toBeNull();
    expect(s.motion).toBe('prev');
  });
  it('a bulk undo reopens every id', () => {
    const s = run(
      s0(),
      { type: 'batch/start', ids: ['E1', 'E2'], origin: 'group', result: 'נוסף לבקשת הזיכוי' },
      { type: 'batch/ok', ids: ['E1', 'E2'], undo: undoOf(['E1', 'E2'], 1_000, true) },
      { type: 'undo/ok', ids: ['E1', 'E2'], sentAt: 1_000, how: 'key' },
    );
    expect(stateOf(s, 'E1')).toBe('open');
    expect(stateOf(s, 'E2')).toBe('open');
    expect(s.summary).toEqual(SUMMARY);
    expect(s.motion).toBeNull();
  });
  it('an undo that lands after a newer decision reopens its row and keeps the newer undo', () => {
    let s = run(s0(), start('A'), ok('A', 1_000), { type: 'undo/start', sentAt: 1_000 }, start('C'), ok('C', 2_000));
    expect(stateOf(s, 'A')).toBe('hidden');
    s = run(s, { type: 'undo/ok', ids: ['A'], sentAt: 1_000, how: 'pointer' });
    expect(stateOf(s, 'A')).toBe('open');
    expect(s.undo?.ids).toEqual(['C']);
    expect(s.summary.count).toBe(SUMMARY.count - 1); // C is still decided
  });
  it('undo/fail shows the failure on its own undo only', () => {
    const s = run(s0(), start('A'), ok('A', 1_000), { type: 'undo/start', sentAt: 1_000 });
    const failed = run(s, { type: 'undo/fail', sentAt: 1_000, text: 'כבר אי אפשר לבטל.' });
    expect(failed.undo).toMatchObject({ failed: true, busy: false, text: 'כבר אי אפשר לבטל.' });
    expect(run(s, { type: 'undo/fail', sentAt: 5, text: 'x' })).toBe(s);
    // The failed toast expires: the decision stands, the row is hidden.
    const gone = run(failed, { type: 'undo/expire' });
    expect(stateOf(gone, 'A')).toBe('hidden');
    expect(gone.undo).toBeNull();
  });
});

describe('paging and reload', () => {
  it('rows/append de-duplicates by id and keeps server order', () => {
    const X = row({ id: 'X', severity: 'info' });
    const s = run(s0(), { type: 'rows/append', rows: [R, X], hasMore: false });
    expect(s.items.map((x) => x.id)).toEqual(['A', 'B', 'D', 'C', 'E1', 'E2', 'V', 'R', 'X']);
    expect(s.hasMore).toBe(false);
  });
  it('rows/reset clears hidden, done, elsewhere and checked', () => {
    const s = run(
      s0(),
      start('A'),
      ok('A'),
      { type: 'undo/expire' },
      start('B'),
      { type: 'decide/fail', ids: ['B'], outcome: { kind: 'elsewhere', text: 't', result: 'r' } },
      start('E1'),
      ok('E1', 2_000),
      { type: 'check/toggle', id: 'C' },
    );
    expect(s.hidden.size + s.done.size + s.elsewhere.size + s.checked.size).toBe(4);
    const fresh = [C, E2];
    const r = run(s, { type: 'rows/reset', rows: fresh, hasMore: true });
    expect(r.items).toBe(fresh);
    expect(r.hidden.size).toBe(0);
    expect(r.done.size).toBe(0);
    expect(r.elsewhere.size).toBe(0);
    expect(r.checked.size).toBe(0);
    expect(r.hasMore).toBe(true);
  });
  it('rows/reset keeps the done mark of a decision still in flight', () => {
    const r = run(s0(), start('C'), { type: 'rows/reset', rows: ITEMS, hasMore: false });
    expect(stateOf(r, 'C')).toBe('done');
  });
  it('loadMore/busy', () => {
    const s = run(s0(), { type: 'loadMore/busy', busy: true });
    expect(s.loadingMore).toBe(true);
    expect(run(s, { type: 'loadMore/busy', busy: true })).toBe(s);
  });
});

describe('bulk selection (R6, §5.7)', () => {
  it('check/toggle refuses block rows and VAT gaps', () => {
    const s = s0();
    expect(run(s, { type: 'check/toggle', id: 'A' })).toBe(s);
    expect(run(s, { type: 'check/toggle', id: 'D' })).toBe(s);
    expect(run(s, { type: 'check/toggle', id: 'V' })).toBe(s);
    expect(batchRefusalOf(A)).toBe('block');
    expect(batchRefusalOf(V)).toBe('vat');
    expect(batchRefusalOf(C)).toBeNull();
  });
  it('check/toggle refuses rows not mine and rows not open', () => {
    const mine = initDeskState({ initial: [C, row({ id: 'N', canAct: false })], initialSummary: SUMMARY });
    expect(run(mine, { type: 'check/toggle', id: 'N' })).toBe(mine);
    const done = run(s0(), start('C'));
    expect(run(done, { type: 'check/toggle', id: 'C' })).toBe(done);
  });
  it('toggles, and check/clear empties (a no-op when already empty)', () => {
    let s = run(s0(), { type: 'check/toggle', id: 'C' }, { type: 'check/toggle', id: 'E1' });
    expect([...s.checked].sort()).toEqual(['C', 'E1']);
    expect(rowsView(s, null).find((v) => v.row.id === 'C')?.checked).toBe(true);
    s = run(s, { type: 'check/toggle', id: 'C' });
    expect([...s.checked]).toEqual(['E1']);
    s = run(s, { type: 'check/clear' });
    expect(s.checked.size).toBe(0);
    expect(run(s, { type: 'check/clear' })).toBe(s);
  });
});

describe('bulk and group decisions are optimistic, with an exact rollback (R11)', () => {
  it('batch/start marks every id done and lowers the summary at once', () => {
    const s = run(
      s0(),
      { type: 'check/toggle', id: 'E1' },
      { type: 'check/toggle', id: 'E2' },
      { type: 'ask/open', id: 'C', origin: 'bar' },
      { type: 'batch/start', ids: ['E1', 'E2'], origin: 'selection', result: 'נוסף לבקשת הזיכוי' },
    );
    expect(stateOf(s, 'E1')).toBe('done');
    expect(stateOf(s, 'E2')).toBe('done');
    expect(s.summary.count).toBe(6);
    expect(s.summary.claimableIls).toBe(389.5);
    expect(s.checked.size).toBe(0);
    expect(s.asking).toBeNull();
    expect(s.inFlight.has(BATCH_KEY)).toBe(true);
  });
  it('batch/ok opens a bulk undo and clears the in-flight mark', () => {
    const s = run(
      s0(),
      { type: 'batch/start', ids: ['E1', 'E2'], origin: 'group', result: 'נוסף לבקשת הזיכוי' },
      { type: 'batch/ok', ids: ['E1', 'E2'], undo: undoOf(['E1', 'E2'], 1_000, true) },
    );
    expect(s.undo).toMatchObject({ bulk: true, ids: ['E1', 'E2'] });
    expect(s.inFlight.size).toBe(0);
    expect(stateOf(s, 'E1')).toBe('done');
  });
  it('batch/fail (selection) restores rows and summary exactly and re-checks the ids with the note', () => {
    const before = run(s0(), { type: 'check/toggle', id: 'E1' }, { type: 'check/toggle', id: 'E2' });
    const s = run(
      before,
      { type: 'batch/start', ids: ['E1', 'E2'], origin: 'selection', result: 'נוסף לבקשת הזיכוי' },
      { type: 'batch/fail', ids: ['E1', 'E2'], origin: 'selection', note: 'מישהו כבר החליט' },
    );
    expect(stateOf(s, 'E1')).toBe('open');
    expect(stateOf(s, 'E2')).toBe('open');
    expect(s.summary).toEqual(SUMMARY);
    expect([...s.checked].sort()).toEqual(['E1', 'E2']);
    expect(s.batchNote).toBe('מישהו כבר החליט');
    expect(s.inFlight.size).toBe(0);
    // A new choice clears the stale note.
    expect(run(s, { type: 'check/toggle', id: 'C' }).batchNote).toBeNull();
  });
  it('batch/fail (group) restores the rows and puts the batchError note on them', () => {
    const s = run(
      s0(),
      { type: 'batch/start', ids: ['E1', 'E2'], origin: 'group', result: 'נוסף לבקשת הזיכוי' },
      { type: 'batch/fail', ids: ['E1', 'E2'], origin: 'group', note: 'השרת סירב לאישור ודבר לא השתנה' },
    );
    expect(s.summary).toEqual(SUMMARY);
    expect(s.notes.E1).toEqual({ kind: 'batchError', text: 'השרת סירב לאישור ודבר לא השתנה' });
    expect(s.notes.E1?.kind).toBe('batchError');
    expect(s.notes.E2?.kind).toBe('batchError');
    expect(s.batchNote).toBeNull();
    expect(isOpenRow(s, 'E1')).toBe(true);
    // …and the current gap returns to the group's first gap while the user has not moved (use-desk applies it).
    const target = nextOpenAfter(s0(), 'E2', new Set(['E1', 'E2']));
    expect(target).toBe('V');
    expect(batchFailSel({ origin: 'group', advance: true, sel: target, target, ids: ['E1', 'E2'] })).toBe('E1');
    expect(batchFailSel({ origin: 'group', advance: true, sel: 'R', target, ids: ['E1', 'E2'] })).toBeNull();
    expect(batchFailSel({ origin: 'selection', advance: true, sel: target, target, ids: ['E1', 'E2'] })).toBeNull();
  });
});

describe('the reasons row follows its gap (R9)', () => {
  it('select / move / prev-next (nav) close it', () => {
    const asking = run(s0(), { type: 'ask/open', id: 'A', origin: 'queue' });
    expect(asking.asking).toEqual({ id: 'A', origin: 'queue' });
    expect(run(asking, { type: 'nav', motion: null }).asking).toBeNull(); // select(B)
    expect(run(asking, { type: 'nav', motion: null, focus: { to: 'row', id: 'B' } }).asking).toBeNull(); // J/K
    const nav = run(asking, { type: 'nav', motion: 'next', focus: { to: 'navFallback', from: 'next' } }); // the next button
    expect(nav.asking).toBeNull();
    expect(nav.motion).toBe('next');
    expect(nav.focus).toEqual({ to: 'navFallback', from: 'next' });
  });
  it('a decision closes it too', () => {
    const s = run(s0(), { type: 'ask/open', id: 'A', origin: 'bar' }, start('A'));
    expect(s.asking).toBeNull();
  });
  it('pay() decides asking.id only: with no reasons row open there is nothing to decide', () => {
    expect(askingRow(s0())).toBeNull();
    const s = run(s0(), { type: 'ask/open', id: 'C', origin: 'bar' });
    expect(askingRow(s)?.id).toBe('C');
    expect(askingRow(run(s, { type: 'nav', motion: null }))).toBeNull();
  });
  it('a done row never opens it', () => {
    const s = run(s0(), start('A'));
    expect(run(s, { type: 'ask/open', id: 'A', origin: 'queue' })).toBe(s);
  });
  it('nav without a focus keeps the pending intent', () => {
    const s = run(s0(), { type: 'focus/set', focus: { to: 'primary' } }, { type: 'nav', motion: null });
    expect(s.focus).toEqual({ to: 'primary' });
  });
});

describe('small transitions', () => {
  it('escalate/open (open rows only) and escalate/close', () => {
    const s = run(s0(), { type: 'escalate/open', id: 'C', origin: 'queue' });
    expect(s.escalateFor).toEqual({ id: 'C', origin: 'queue' });
    expect(run(s, { type: 'escalate/close' }).escalateFor).toBeNull();
    const done = run(s0(), start('C'));
    expect(run(done, { type: 'escalate/open', id: 'C', origin: 'bar' })).toBe(done);
  });
  it('elsewhere/hide hides a row decided elsewhere', () => {
    const s = run(
      s0(),
      start('A'),
      { type: 'decide/fail', ids: ['A'], outcome: { kind: 'elsewhere', text: 't', result: 'r' } },
      { type: 'elsewhere/hide', id: 'A' },
    );
    expect(stateOf(s, 'A')).toBe('hidden');
    expect(s.elsewhere.size).toBe(0);
    expect(run(s, { type: 'elsewhere/hide', id: 'C' })).toBe(s);
  });
  it('keys/open, focus/set, announce, summary/set', () => {
    const s = run(
      s0(),
      { type: 'keys/open', open: true },
      { type: 'focus/set', focus: { to: 'empty' } },
      { type: 'announce', text: 'פער מע״מ לא מאושר בקבוצה' },
      { type: 'summary/set', summary: { ...SUMMARY, count: 3 } },
    );
    expect(s.keysOpen).toBe(true);
    expect(s.focus).toEqual({ to: 'empty' });
    expect(s.announcement).toBe('פער מע״מ לא מאושר בקבוצה');
    expect(s.summary.count).toBe(3);
  });
});

describe('selectors', () => {
  it('resolveCurrent: sel open → it; hidden or done → the first live row; elsewhere → it; never a write', () => {
    expect(resolveCurrent(s0(), 'C')?.id).toBe('C');
    expect(resolveCurrent(s0(), null)?.id).toBe('A');
    expect(resolveCurrent(s0(), 'nope')?.id).toBe('A');
    const hidden = run(s0(), start('A'), ok('A'), { type: 'undo/expire' });
    expect(resolveCurrent(hidden, 'A')?.id).toBe('B');
    const done = run(s0(), start('C'));
    expect(resolveCurrent(done, 'C')?.id).toBe('A');
    const away = run(s0(), start('C'), { type: 'decide/fail', ids: ['C'], outcome: { kind: 'elsewhere', text: 't', result: 'r' } });
    expect(resolveCurrent(away, 'C')?.id).toBe('C');
    const empty = initDeskState({ initial: [], initialSummary: SUMMARY });
    expect(resolveCurrent(empty, null)).toBeNull();
  });
  it('nextOpenAfter: the next open row in server order, wrapping to the first open row before it', () => {
    const s = s0();
    expect(nextOpenAfter(s, 'A')).toBe('B');
    expect(nextOpenAfter(s, 'R')).toBe('A'); // the last row wraps
    const some = run(s, start('B'), start('D'));
    expect(nextOpenAfter(some, 'A')).toBe('C'); // done rows skipped
    expect(nextOpenAfter(s, 'E1', new Set(['E1', 'E2']))).toBe('V');
    const one = initDeskState({ initial: [A], initialSummary: SUMMARY });
    expect(nextOpenAfter(one, 'A')).toBeNull();
  });
  it('stepOpen: no wrap, done and elsewhere rows skipped', () => {
    const s = run(s0(), start('B'), { type: 'decide/fail', ids: ['B'], outcome: { kind: 'elsewhere', text: 't', result: 'r' } }, start('D'));
    expect(stepOpen(s, 'A', 1)).toBe('C');
    expect(stepOpen(s, 'C', -1)).toBe('A');
    expect(stepOpen(s, 'A', -1)).toBeNull();
    expect(stepOpen(s, 'R', 1)).toBeNull();
    expect(stepOpen(s, 'B', 1)).toBe('C'); // from an elsewhere current
    expect(stepOpen(s, null, 1)).toBe('A');
    expect(stepOpen(s, null, -1)).toBe('R');
  });
  it('positionOf: 1-based in the live rows; total = max(summary.count, live.length)', () => {
    expect(positionOf(s0(), 'C')).toEqual({ index: 4, total: 8 });
    const more = run(s0(), { type: 'summary/set', summary: { ...SUMMARY, count: 40 } });
    expect(positionOf(more, 'C')).toEqual({ index: 4, total: 40 });
    const fewer = run(s0(), { type: 'summary/set', summary: { ...SUMMARY, count: 1 } });
    expect(positionOf(fewer, 'R')).toEqual({ index: 8, total: 8 });
    const away = run(s0(), start('C'), { type: 'decide/fail', ids: ['C'], outcome: { kind: 'elsewhere', text: 't', result: 'r' } });
    expect(positionOf(away, 'C')).toBeNull();
    expect(positionOf(s0(), null)).toBeNull();
  });
  it('rowsView: exactly one roving summary cell — the current open row, else the first open row', () => {
    const roving = (s: DeskState, cur: string | null) => rowsView(s, cur).filter((v) => v.roving).map((v) => v.row.id);
    expect(roving(s0(), 'C')).toEqual(['C']);
    expect(roving(s0(), null)).toEqual(['A']);
    const away = run(s0(), start('A'), { type: 'decide/fail', ids: ['A'], outcome: { kind: 'elsewhere', text: 't', result: 'r' } });
    expect(roving(away, 'A')).toEqual(['B']);
    expect(rowsView(s0(), 'C').filter((v) => v.current).map((v) => v.row.id)).toEqual(['C']);
  });
  it('rowStateOf', () => {
    const s = run(s0(), start('A'), start('B'), { type: 'decide/fail', ids: ['B'], outcome: { kind: 'elsewhere', text: 't', result: 'r' } });
    expect(rowStateOf(s, 'A')).toBe('done');
    expect(rowStateOf(s, 'B')).toBe('elsewhere');
    expect(rowStateOf(s, 'C')).toBe('open');
    expect(rowStateOf(s, 'nope')).toBeNull();
  });
});

describe('adjustSummary (D32)', () => {
  it('a claimable row moves claimableIls by its claim, in integer agorot', () => {
    const s = adjustSummary(SUMMARY, C, -1);
    expect(s.claimableIls).toBe(316.5);
    expect(s.count).toBe(7);
    expect(s.toDecide.count).toBe(6);
    expect(s.toReview).toBe(SUMMARY.toReview);
    expect(adjustSummary(s, C, 1)).toEqual(SUMMARY);
    // 0.1 + 0.2 style drift never shows: 0.30 − 0.10 is 0.2 exactly.
    expect(adjustSummary({ ...SUMMARY, claimableIls: 0.3 }, row({ claimAgorot: 10 }), -1).claimableIls).toBe(0.2);
  });
  it('DUPLICATE_INVOICE and VAT_MISMATCH never touch claimableIls', () => {
    const dup = adjustSummary(SUMMARY, D, -1);
    expect(dup.claimableIls).toBe(SUMMARY.claimableIls);
    expect(dup.blockers).toBe(2);
    expect(dup.count).toBe(7);
    expect(adjustSummary(SUMMARY, V, -1).claimableIls).toBe(SUMMARY.claimableIls);
  });
  it('a row without ₪ counts as "to review"; nothing goes below 0', () => {
    const r = adjustSummary(SUMMARY, R, -1);
    expect(r.toReview.count).toBe(0);
    expect(r.toDecide).toBe(SUMMARY.toDecide);
    const zero = { ...SUMMARY, count: 0, blockers: 0, claimableIls: 0.5, toDecide: { count: 0, amountIls: 0 }, toReview: { count: 0 } };
    const low = adjustSummary(zero, A, -1);
    expect(low).toMatchObject({ count: 0, blockers: 0, claimableIls: 0, toDecide: { count: 0 } });
    expect(adjustSummary(zero, R, -1).toReview.count).toBe(0);
  });
});

describe('batchMutationId', () => {
  it('the same sorted ids keep the replay id; other ids get a fresh one', () => {
    let n = 0;
    const fresh = () => `cm-${++n}-abcdefgh`;
    const first = batchMutationId(null, ['E2', 'E1'], fresh);
    expect(first).toEqual({ key: 'E1,E2', id: 'cm-1-abcdefgh' });
    expect(batchMutationId(first, ['E1', 'E2'], fresh)).toBe(first);
    expect(n).toBe(1);
    expect(batchMutationId(first, ['E1'], fresh)).toEqual({ key: 'E1', id: 'cm-2-abcdefgh' });
  });
});

describe('focusAfterDecision (§5.3)', () => {
  it('no next gap → the empty state', () => {
    expect(focusAfterDecision({ how: 'pointer', origin: 'bar', nextId: null })).toEqual({ to: 'empty' });
    expect(focusAfterDecision({ how: 'key', origin: 'queue', nextId: null })).toEqual({ to: 'empty' });
  });
  it('a keyboard-activated bar button, or a key pressed on the bar (R15) → the next primary', () => {
    expect(focusAfterDecision({ how: 'keyboard', origin: 'bar', nextId: 'B' })).toEqual({ to: 'primary' });
    expect(focusAfterDecision({ how: 'key', origin: 'bar', nextId: 'B' })).toEqual({ to: 'primary' });
  });
  it('a pointer decision, or a key in the queue → the next row', () => {
    expect(focusAfterDecision({ how: 'pointer', origin: 'bar', nextId: 'B' })).toEqual({ to: 'row', id: 'B' });
    expect(focusAfterDecision({ how: 'key', origin: 'queue', nextId: 'B' })).toEqual({ to: 'row', id: 'B' });
    expect(focusAfterDecision({ how: 'keyboard', origin: 'queue', nextId: 'B' })).toEqual({ to: 'row', id: 'B' });
  });
});

describe('failureOutcome: today’s order of the checks (list.tsx:279-309)', () => {
  const decided = (o: Record<string, unknown>) =>
    `approvals.decided:${JSON.stringify({ status: 'accepted', role: 'manager', name: null, at: null, self: false, ...o })}`;
  const conflict = (message: string) => ({ data: { code: 'CONFLICT' }, message });

  it('amountChanged comes first', () => {
    const err = conflict('approvals.amountChanged:{"seenAgorot":11800,"nowAgorot":9000}');
    expect(failureOutcome(err, C, 'owner', he, 'he')).toEqual({ kind: 'amountChanged', nowAgorot: 9000 });
  });
  it('escalated to me (owner) comes before decided elsewhere', () => {
    const err = conflict(decided({ status: 'escalated' }));
    expect(failureOutcome(err, A, 'owner', he, 'he')).toEqual({ kind: 'escalatedToYou' });
    const manager = failureOutcome(err, A, 'manager', he, 'he');
    expect(manager.kind).toBe('elsewhere');
    expect(manager).toMatchObject({ result: 'הועבר לבעלים' });
  });
  it('decided elsewhere: the who / time / status sentence and the row result', () => {
    const out = failureOutcome(conflict(decided({ name: 'דנה' })), A, 'owner', he, 'he');
    expect(out).toEqual({ kind: 'elsewhere', text: 'כבר הוחלט ע״י דנה ·  · נוסף לבקשת הזיכוי', result: 'נוסף לבקשת הזיכוי' });
    const byRole = failureOutcome(conflict(decided({})), A, 'owner', he, 'he');
    expect(byRole).toMatchObject({ kind: 'elsewhere' });
    expect(byRole.kind === 'elsewhere' && byRole.text.startsWith('כבר הוחלט ע״י מנהל')).toBe(true);
    const self = failureOutcome(conflict(decided({ self: true })), A, 'owner', he, 'he');
    expect(self.kind === 'elsewhere' && self.text.startsWith('כבר החלטת על הפער הזה')).toBe(true);
  });
  it('FORBIDDEN → forbidden; a network error, a 500 or an unparsable CONFLICT → error', () => {
    expect(failureOutcome({ data: { code: 'FORBIDDEN' }, message: 'no' }, A, 'manager', he, 'he')).toEqual({ kind: 'forbidden' });
    expect(failureOutcome({ message: 'Failed to fetch' }, A, 'owner', he, 'he')).toEqual({ kind: 'error' });
    expect(failureOutcome({ data: { code: 'INTERNAL_SERVER_ERROR' } }, A, 'owner', he, 'he')).toEqual({ kind: 'error' });
    expect(failureOutcome(conflict('something else'), A, 'owner', he, 'he')).toEqual({ kind: 'error' });
    expect(failureOutcome(null, A, 'owner', he, 'he')).toEqual({ kind: 'error' });
  });
});
