import { describe, expect, it } from 'vitest';
import {
  amountsClose,
  checkPreflightClear,
  dayDiff,
  israelDateKey,
  parseAgorot,
  preflightFlags,
  summarize,
  type BankChange,
  type PreflightFacts,
  type PreflightInvoice,
} from '../payRun/preflight';
import { renderReason } from '../payRun/remittanceText';

/** AU-14 · the pure pre-flight rules (integer agorot, Israel days). */

const NOW = new Date('2026-12-10T08:00:00Z');
let seq = 0;
function inv(p: Partial<PreflightInvoice> = {}): PreflightInvoice {
  seq += 1;
  return {
    id: p.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    supplierId: 'sup-1',
    supplierName: 'שטראוס',
    invoiceNumber: `MF-${24900 + seq}`,
    invoiceDate: '2026-11-28T10:00:00Z',
    totalAgorot: 736_320,
    status: 'matched',
    source: 'email',
    paidAt: null,
    duplicateOf: null,
    heldAsDuplicate: false,
    checked: true,
    ...p,
  };
}
function facts(candidates: PreflightInvoice[], others: PreflightInvoice[] = [], p: Partial<PreflightFacts> = {}): PreflightFacts {
  return {
    candidates,
    history: [...candidates, ...others],
    bankChanges: [],
    confirmedChangeIds: new Set(),
    now: NOW,
    ...p,
  };
}
const kinds = (f: PreflightFacts, id: string) => (preflightFlags(f).get(id) ?? []).map((x) => x.kind);
/** A paid peer so first_payment stays quiet in the other rules' tests. */
const paidPeer = () => inv({ status: 'paid', invoiceDate: '2026-06-01T10:00:00Z', totalAgorot: 1_000 });

describe('boundary helpers', () => {
  it('parses NUMERIC strings to integer agorot, half-up', () => {
    expect(parseAgorot('7363.20')).toBe(736_320);
    expect(parseAgorot('0.005')).toBe(1);
    expect(parseAgorot('0.004')).toBe(0);
    expect(parseAgorot('-12.5')).toBe(-1_250);
    expect(parseAgorot(null)).toBe(0);
    expect(parseAgorot('1.1')).toBe(110);
  });
  it('Israel day keys flip at Israel midnight, not UTC', () => {
    expect(israelDateKey('2026-11-27T21:59:00Z')).toBe('2026-11-27'); // 23:59 IL
    expect(israelDateKey('2026-11-27T22:00:00Z')).toBe('2026-11-28'); // 00:00 IL
    expect(dayDiff('2026-11-28', '2026-12-01')).toBe(3);
  });
  it('₪1.00 absolute, 0.5% relative', () => {
    expect(amountsClose(10_000, 10_100)).toBe(true); // ₪1.00
    expect(amountsClose(10_000, 10_101)).toBe(false); // ₪1.01 and > 0.5%
    expect(amountsClose(1_000_000, 1_005_000)).toBe(true); // exactly 0.5% of the larger? 5000/1005000 < 0.5%
    expect(amountsClose(1_000_000, 1_005_026)).toBe(false);
  });
});

describe('possible_duplicate (soft)', () => {
  it('a same-supplier twin from another channel, ±3 Israel days, within ₪1.00', () => {
    const a = inv({ totalAgorot: 736_320, source: 'email' });
    const b = inv({ totalAgorot: 736_400, source: 'whatsapp', invoiceDate: '2026-11-25T10:00:00Z', status: 'paid', invoiceNumber: 'MF-24950' });
    const f = preflightFlags(facts([a], [b])).get(a.id)!;
    const dup = f.find((x) => x.kind === 'possible_duplicate')!;
    expect(dup).toMatchObject({ severity: 'soft', atRiskAgorot: 736_320, vars: { otherNumber: 'MF-24950', otherDate: '2026-11-25', otherTotalAgorot: 736_400, otherSource: 'whatsapp' } });
    expect(renderReason(dup, 'he')).toContain('ייתכן כפל: דומה ל-MF-24950 מ-25.11');
    expect(renderReason(dup, 'he')).toContain('נשלחה בוואטסאפ');
  });
  it('₪1.00 at 100 agorot flags; 101 agorot (and > 0.5%) does not', () => {
    const a = inv({ totalAgorot: 10_000 });
    expect(kinds(facts([a], [inv({ totalAgorot: 10_100 }), paidPeer()]), a.id)).toContain('possible_duplicate');
    const c = inv({ totalAgorot: 10_000 });
    expect(kinds(facts([c], [inv({ totalAgorot: 10_101 }), paidPeer()]), c.id)).not.toContain('possible_duplicate');
  });
  it('the 0.5% boundary', () => {
    const a = inv({ totalAgorot: 2_000_000 });
    expect(kinds(facts([a], [inv({ totalAgorot: 2_010_000 }), paidPeer()]), a.id)).toContain('possible_duplicate'); // 10000*1000 = 5*2010000? 1e7 ≤ 1.005e7
    const c = inv({ totalAgorot: 2_000_000 });
    expect(kinds(facts([c], [inv({ totalAgorot: 2_010_100 }), paidPeer()]), c.id)).not.toContain('possible_duplicate');
  });
  it('±3 Israel days at midnight', () => {
    const a = inv({ invoiceDate: '2026-11-28T10:00:00Z' });
    // 2026-11-24 23:59 IL = 4 days before → not a twin
    expect(kinds(facts([a], [inv({ invoiceDate: '2026-11-24T21:59:00Z' }), paidPeer()]), a.id)).not.toContain('possible_duplicate');
    // 2026-11-25 00:00 IL = 3 days before → a twin
    const c = inv({ invoiceDate: '2026-11-28T10:00:00Z' });
    expect(kinds(facts([c], [inv({ invoiceDate: '2026-11-24T22:00:00Z' }), paidPeer()]), c.id)).toContain('possible_duplicate');
  });
  it('another supplier is never a twin', () => {
    const a = inv();
    expect(kinds(facts([a], [inv({ supplierId: 'sup-2' }), paidPeer()]), a.id)).not.toContain('possible_duplicate');
  });
  it('excluded: an already-linked pair, a held DUPLICATE_INVOICE copy (or note_billed_twice), a credit note', () => {
    const a = inv();
    const linked = inv({ duplicateOf: { invoiceId: a.id, basis: null } });
    expect(kinds(facts([a], [linked, paidPeer()]), a.id)).not.toContain('possible_duplicate');
    const c = inv();
    expect(kinds(facts([c], [inv({ heldAsDuplicate: true }), paidPeer()]), c.id)).not.toContain('possible_duplicate');
    const held = inv({ heldAsDuplicate: true });
    expect(kinds(facts([held], [inv(), paidPeer()]), held.id)).not.toContain('possible_duplicate');
    const credit = inv({ totalAgorot: -736_320 });
    expect(kinds(facts([credit], [inv({ totalAgorot: -736_320 }), paidPeer()]), credit.id)).toEqual([]);
  });
});

describe('confirmed_copy (hold)', () => {
  it('AU-10 cross_channel verdict holds; a same-number marker without basis does not', () => {
    const orig = inv({ invoiceNumber: 'MF-1', status: 'paid' });
    const copy = inv({ duplicateOf: { invoiceId: orig.id, basis: 'cross_channel' } });
    const f = preflightFlags(facts([copy], [orig])).get(copy.id)!;
    expect(f[0]).toMatchObject({ kind: 'confirmed_copy', severity: 'hold', vars: { originalNumber: 'MF-1' } });
    expect(f.map((x) => x.kind)).not.toContain('possible_duplicate');
    const other = inv({ duplicateOf: { invoiceId: orig.id, basis: null } });
    expect(kinds(facts([other], [orig]), other.id)).not.toContain('confirmed_copy');
  });
});

describe('first_payment (soft)', () => {
  it('no paid invoice → flagged; a seeded paid row with paid_at NULL counts as paid before', () => {
    const a = inv();
    expect(kinds(facts([a]), a.id)).toEqual(['first_payment']);
    const b = inv();
    expect(kinds(facts([b], [inv({ status: 'paid', paidAt: null, invoiceDate: '2026-01-01T10:00:00Z', totalAgorot: 5 })]), b.id)).toEqual([]);
    const c = inv();
    expect(kinds(facts([c], [inv({ status: 'matched', paidAt: '2026-09-01T10:00:00Z', invoiceDate: '2026-01-01T10:00:00Z', totalAgorot: 5 })]), c.id)).toEqual([]);
  });
  it('a supplier-less invoice is never flagged', () => {
    const a = inv({ supplierId: null });
    expect(kinds(facts([a]), a.id)).toEqual([]);
  });
});

describe('unusual_amount (soft)', () => {
  const hist = (n: number, total: number) =>
    Array.from({ length: n }, (_, i) => inv({ status: 'paid', totalAgorot: total, invoiceDate: `2026-0${(i % 9) + 1}-10T10:00:00Z` }));
  it('needs ≥ 3 samples: 2 samples → quiet', () => {
    const a = inv({ totalAgorot: 1_000_000 });
    expect(kinds(facts([a], hist(2, 305_000)), a.id)).not.toContain('unusual_amount');
  });
  it('3 samples, > 2× median → flagged with the ratio and the median', () => {
    const a = inv({ totalAgorot: 732_000 });
    const f = preflightFlags(facts([a], hist(3, 305_000))).get(a.id)!.find((x) => x.kind === 'unusual_amount')!;
    expect(f.vars).toMatchObject({ ratio: 2.4, medianAgorot: 305_000 });
    expect(renderReason(f, 'he')).toMatch(/^סכום חריג: פי 2\.4 מהרגיל לספק \(חציון /);
  });
  it('exactly 2× is not unusual', () => {
    const a = inv({ totalAgorot: 610_000 });
    expect(kinds(facts([a], hist(3, 305_000)), a.id)).not.toContain('unusual_amount');
  });
  it('only CHECKED invoices (a match ran) are samples', () => {
    const a = inv({ totalAgorot: 732_000 });
    const unchecked = hist(3, 305_000).map((h) => ({ ...h, checked: false }));
    expect(kinds(facts([a], unchecked), a.id)).not.toContain('unusual_amount');
  });
  it('only the last 12 count', () => {
    const old = Array.from({ length: 5 }, () => inv({ status: 'paid', totalAgorot: 10_000_000, invoiceDate: '2025-01-01T10:00:00Z' }));
    const a = inv({ totalAgorot: 700_000 });
    expect(kinds(facts([a], [...hist(12, 300_000), ...old]), a.id)).toContain('unusual_amount');
  });
});

describe('bank_changed (HARD, AD12)', () => {
  const change = (p: Partial<BankChange> = {}): BankChange => ({
    id: 'chg-1',
    supplierId: 'sup-1',
    changedAt: '2026-12-03T09:00:00Z',
    accountLast4: '4821',
    ...p,
  });
  it('a change after the last paid_at → hard, with last4 only', () => {
    const a = inv();
    const paid = inv({ status: 'paid', paidAt: '2026-11-15T10:00:00Z', invoiceDate: '2026-11-01T10:00:00Z', totalAgorot: 5 });
    const f = preflightFlags(facts([a], [paid], { bankChanges: [change()] })).get(a.id)!;
    expect(f[0]).toMatchObject({ kind: 'bank_changed', severity: 'hard', vars: { accountLast4: '4821', changedOn: '2026-12-03' } });
    expect(renderReason(f[0]!, 'he')).toBe('פרטי הבנק של שטראוס השתנו ב-03.12 (חשבון ‎…4821) · אמתו בטלפון מול הספק לפני תשלום');
  });
  it('a change before the last payment → quiet', () => {
    const a = inv();
    const paid = inv({ status: 'paid', paidAt: '2026-12-05T10:00:00Z', invoiceDate: '2026-11-01T10:00:00Z', totalAgorot: 5 });
    expect(kinds(facts([a], [paid], { bankChanges: [change()] }), a.id)).not.toContain('bank_changed');
  });
  it('never paid (or paid_at unknown) → the last 90 days', () => {
    const a = inv();
    const seededPaid = inv({ status: 'paid', paidAt: null, invoiceDate: '2026-01-01T10:00:00Z', totalAgorot: 5 });
    expect(kinds(facts([a], [seededPaid], { bankChanges: [change({ changedAt: '2026-09-20T10:00:00Z' })] }), a.id)).toContain('bank_changed');
    const b = inv();
    expect(kinds(facts([b], [seededPaid], { bankChanges: [change({ changedAt: '2026-09-01T10:00:00Z' })] }), b.id)).not.toContain('bank_changed');
  });
  it('owner confirmation clears it; a newer change after the confirmation → hard again', () => {
    const a = inv();
    expect(kinds(facts([a], [paidPeer()], { bankChanges: [change()], confirmedChangeIds: new Set(['chg-1']) }), a.id)).toEqual([]);
    const newer = change({ id: 'chg-2', changedAt: '2026-12-08T09:00:00Z', accountLast4: '9911' });
    const f = preflightFlags(facts([a], [paidPeer()], { bankChanges: [change(), newer], confirmedChangeIds: new Set(['chg-1']) })).get(a.id)!;
    expect(f[0]).toMatchObject({ kind: 'bank_changed', vars: { changeId: 'chg-2', accountLast4: '9911' } });
  });
});

describe('summary + the markPaid guard core', () => {
  const change: BankChange = { id: 'c', supplierId: 'sup-1', changedAt: '2026-12-03T09:00:00Z', accountLast4: '1' };
  it('counts per kind, ₪ at risk once per invoice', () => {
    const a = inv({ totalAgorot: 100_000 }); // first_payment + bank_changed
    const s = summarize(preflightFlags(facts([a], [], { bankChanges: [change] })));
    expect(s).toMatchObject({ flags: 2, invoices: 1, atRiskAgorot: 100_000, blocked: 1 });
    expect(s.counts).toMatchObject({ bank_changed: 1, first_payment: 1, possible_duplicate: 0 });
  });
  it('a hard flag refuses the whole batch, even with the option off and everything acknowledged', () => {
    const ok = inv({ supplierId: 'sup-2' });
    const bad = inv();
    const flags = preflightFlags(facts([ok, bad], [paidPeer(), inv({ supplierId: 'sup-2', status: 'paid', invoiceDate: '2025-01-01T00:00:00Z', totalAgorot: 1 })], { bankChanges: [change] }));
    const v = checkPreflightClear(flags, [ok.id, bad.id], [{ invoiceId: bad.id, kinds: ['bank_changed'] }], { softChecks: false });
    expect(v).toEqual({ ok: false, reason: 'preflight_hold', invoiceId: bad.id, kind: 'bank_changed' });
  });
  it('soft flags need an acknowledgment per invoice; with it → ok and the kinds are returned for the audit', () => {
    const a = inv();
    const flags = preflightFlags(facts([a]));
    expect(checkPreflightClear(flags, [a.id], [])).toEqual({ ok: false, reason: 'preflight_unacknowledged', invoiceId: a.id, missing: ['first_payment'] });
    const v = checkPreflightClear(flags, [a.id], [{ invoiceId: a.id, kinds: ['first_payment'] }]);
    expect(v.ok && v.acknowledged.get(a.id)).toEqual(['first_payment']);
    // Option off → soft flags need nothing.
    expect(checkPreflightClear(flags, [a.id], [], { softChecks: false })).toMatchObject({ ok: true });
    // Acknowledging another invoice's flag does not count.
    expect(checkPreflightClear(flags, [a.id], [{ invoiceId: 'x', kinds: ['first_payment'] }])).toMatchObject({ ok: false });
  });
});
