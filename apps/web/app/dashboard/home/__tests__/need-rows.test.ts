import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { overview } from '@/lib/i18n/messages/overview';
import { leaks } from '@/lib/i18n/messages/leaks';
import type { Task } from '@/lib/components/notifications/model';
import { needDotOf, needRowsOf, staffNeedRowsOf } from '../need-rows';

/**
 * DS3-03 · "מחכה לך" rows (SPEC §10.1; v2 B1–B3): the dot by meaning, the solid "חוסמים תשלום"
 * pill from the task itself, and the VAT basis — once beside the title only when every amount in
 * the card is before VAT by construction, otherwise under each amount that has a known basis.
 */

const t = createTranslator('he', overview);
const tl = createTranslator('he', leaks);
const BASIS = { excl: tl('claims.basis.excl'), incl: tl('claims.basis.incl'), vat: tl('claims.basis.vat') };
const side = (agorot: number) => `₪${agorot / 100}`;
const rowsOf = (tasks: Task[], chipAllowed?: boolean) => needRowsOf(tasks, { t, locale: 'he', sideMoney: side, basis: BASIS, chipAllowed });

const task = (p: Partial<Task>): Task =>
  ({
    type: 'decision',
    entityId: 'decision:mine',
    title: 'decision',
    ilsAgorot: 29_600,
    count: 5,
    blocking: 2,
    tier: 'T2',
    tone: 'danger',
    due: null,
    ageDays: 3,
    verb: 'decide',
    deepLink: '/dashboard/approvals',
    scope: 'mine',
    detail: { toReview: 1, duplicateAgorot: 0, vatAgorot: 0 },
    ...p,
  }) as Task;

const decision = task({});
// The tones the task spine really sends (packages/api/src/tasks/sources): requests to send are not late yet (neutral), an overdue follow-up is amber.
const claims = task({ type: 'claim_to_send', entityId: 'claims:unsent', ilsAgorot: 47_899, count: 10, blocking: 0, tone: 'neutral', deepLink: '/dashboard/recovery' });
const followUp = task({ type: 'credit_to_match', entityId: 'claims:waiting', ilsAgorot: 12_000, count: 2, blocking: 0, tone: 'warn', deepLink: '/dashboard/recovery' });
const payRun = task({ type: 'payment_due', entityId: 'payrun:month', ilsAgorot: 929_646, count: 10, blocking: 0, tone: 'neutral', deepLink: '/dashboard/approvals/pay-run' });
const vat = task({ type: 'allocation_missing', entityId: 'vat:open', ilsAgorot: 1_300, count: 3, blocking: 0, tone: 'danger', detail: { daysLeft: 5 } });
const docs = task({ type: 'doc_review', entityId: 'docs:lines', ilsAgorot: null, count: 2, blocking: 0, tone: 'warn', deepLink: '/dashboard/invoices' });

describe('the dot says what the row means (v2 B3)', () => {
  it('red only for a decision whose gaps block a payment', () => {
    expect(needDotOf(decision)).toBe('leak');
    expect(needDotOf(task({ blocking: 0, tone: 'warn' }))).toBe('warn');
  });
  it('VAT within 7 days of its deadline is urgent but blocks nothing: amber, never the leak red', () => {
    expect(needDotOf(vat)).toBe('warn');
  });
  it('what merely waits is grey; everything else that waits for handling is amber', () => {
    expect(needDotOf(payRun)).toBe('neutral');
    expect(needDotOf(claims)).toBe('neutral');
    expect(needDotOf(followUp)).toBe('warn');
    expect(rowsOf([claims, followUp]).rows.map((r) => r.dot)).toEqual(['neutral', 'warn']);
  });
});

describe('the decision row: the blockers become the solid pill inside its sub line (v2 B2)', () => {
  it('sub = the gaps and the review part, pill = the blockers (an ICU plural on a number)', () => {
    const [row] = rowsOf([decision]).rows;
    expect(row!.sub).toBe('5 פערים · 1 לבדיקה (ללא ₪)');
    expect(row!.pill).toBe('2 חוסמים תשלום');
    // W2-08 reads the count of gaps from the start of the same element.
    expect(/(\d+)\s*פערים/.exec(row!.sub!)?.[1]).toBe('5');
  });
  it('one blocker reads in the singular; no blocker, no pill and the count line alone', () => {
    expect(rowsOf([task({ blocking: 1 })]).rows[0]!.pill).toBe('1 חוסם תשלום');
    const calm = rowsOf([task({ blocking: 0, tone: 'warn', detail: {} })]).rows[0]!;
    expect(calm.pill).toBeUndefined();
    expect(calm.sub).toBe('5 פערים');
  });
  it('the count of gaps is an ICU plural on a number: one gap reads "פער אחד", never "1 פערים"', () => {
    expect(rowsOf([task({ count: 1, blocking: 0, detail: {} })]).rows[0]!.sub).toBe('פער אחד');
    expect(rowsOf([task({ count: 1, blocking: 1, detail: { toReview: 1 } })]).rows[0]!.sub).toBe('פער אחד · 1 לבדיקה (ללא ₪)');
    expect(rowsOf([task({ count: 2, blocking: 0, detail: {} })]).rows[0]!.sub).toBe('2 פערים');
    const en = (count: number) => needRowsOf([task({ count, blocking: 0, detail: {} })], { t: createTranslator('en', overview), locale: 'en', sideMoney: side, basis: BASIS }).rows[0]!.sub;
    expect([en(1), en(3)]).toEqual(['1 discrepancy', '3 discrepancies']);
  });
  it('the figures are the task’s own, untouched; formatted counts keep their separators', () => {
    const [row] = rowsOf([task({ count: 1234, ilsAgorot: 123_456_78 })]).rows;
    expect(row!.agorot).toBe(123_456_78);
    expect(row!.sub).toContain('1,234 פערים');
  });
  it('English: the same pill from the same key', () => {
    const en = needRowsOf([decision], { t: createTranslator('en', overview), locale: 'en', sideMoney: side, basis: BASIS });
    expect(en.rows[0]!.pill).toBe('2 blocking payment');
  });
});

describe('the VAT basis is said beside every amount, never two bases under one label (v2 B1)', () => {
  it('only decision amounts (count rows aside): one chip beside the title, no row captions', () => {
    const { rows, chip } = rowsOf([decision, docs]);
    expect(chip).toBe('לפני מע״מ');
    expect(rows.map((r) => r.basis)).toEqual([undefined, undefined]);
  });
  it('a pay run in the card (incl. VAT): no chip, each amount says its own basis', () => {
    const { rows, chip } = rowsOf([decision, payRun]);
    expect(chip).toBeNull();
    expect(rows.map((r) => r.basis)).toEqual(['לפני מע״מ', 'כולל מע״מ']);
  });
  it('VAT at risk is a VAT amount', () => {
    expect(rowsOf([vat]).rows[0]!.basis).toBe('סכום המע״מ');
    expect(rowsOf([vat]).chip).toBeNull();
  });
  it('credit requests mix bases (until request R2): their amount says so, and there is no chip', () => {
    const { rows, chip } = rowsOf([decision, claims, followUp]);
    expect(chip).toBeNull();
    expect(rows.map((r) => r.basis)).toEqual(['לפני מע״מ', 'לפי בסיס המע״מ של כל בקשה', 'לפי בסיס המע״מ של כל בקשה']);
    // Alone in the card they still are no single basis: no chip, the caption under the amount.
    expect(rowsOf([claims]).chip).toBeNull();
    expect(rowsOf([claims]).rows[0]!.basis).toBe('לפי בסיס המע״מ של כל בקשה');
  });
  it('the rows behind "עוד" count too: the chip is decided over every row', () => {
    const many = [decision, docs, task({ type: 'doc_review', entityId: 'docs:b', ilsAgorot: null }), payRun];
    expect(rowsOf(many).chip).toBeNull();
  });
  it('a card whose title is screen-reader-only at the desk (manager, bookkeeper) never uses the chip', () => {
    const { rows, chip } = rowsOf([decision], false);
    expect(chip).toBeNull();
    expect(rows[0]!.basis).toBe('לפני מע״מ');
  });
  it('no money at all: no chip and no caption', () => {
    const { rows, chip } = rowsOf([docs]);
    expect(chip).toBeNull();
    expect(rows[0]!.basis).toBeUndefined();
  });
});

describe('rows come from the spine in its order, mine only', () => {
  it('"others" tasks are the one waiting-on-others line, never a row', () => {
    const { rows } = rowsOf([decision, task({ type: 'waiting_on_others', entityId: 'others', scope: 'others', withRole: 'owner' }), claims]);
    expect(rows.map((r) => r.key)).toEqual(['decide', 'claimsUnsent']);
  });
});

describe('staff rows (the chef): counts only, dots by meaning', () => {
  it('no ₪, no notes, the homed task left out', () => {
    const order = task({ type: 'order_due', entityId: 'orders:today', ilsAgorot: 50_000, count: 2, blocking: 0, tone: 'warn', detail: { supplier: 'ירקות השרון', time: '14:00' } });
    const count = task({ type: 'close_step', entityId: 'count:open', ilsAgorot: null, count: 1, blocking: 0, tone: 'neutral', detail: { counted: 3, lines: 9 } });
    const rows = staffNeedRowsOf([order, count], ['close_step'], t, 'he');
    expect(rows.map((r) => r.key)).toEqual(['cutoffs']);
    expect(rows[0]!.agorot).toBeNull();
    expect(rows[0]!.notes).toBeUndefined();
    expect(rows[0]!.dot).toBe('warn');
  });
});
