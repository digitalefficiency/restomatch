import { describe, expect, it } from 'vitest';
import { buildSteps, defaultMonth, progress, resolveMonth, shiftMonth, STEP_ORDER, type CloseSources } from '../steps';

const zero = { count: 0, amountIls: 0 };
const clean: CloseSources = {
  monthOffset: -1,
  unchecked: zero,
  consolidated: { ...zero, firstInvoiceId: null },
  deliveryNotes: zero,
  gaps: zero,
  claims: zero,
  vat: zero,
};

describe('close checklist steps', () => {
  it('keeps the close order: check → decide → claim → consolidated → notes → VAT → export', () => {
    expect(buildSteps(clean).map((s) => s.key)).toEqual([...STEP_ORDER]);
    expect(STEP_ORDER).toEqual(['unchecked', 'gaps', 'claims', 'consolidated', 'deliveryNotes', 'vat', 'exports']);
  });

  it('a clean month is calm: done steps, no primary CTA, nothing alarming', () => {
    const steps = buildSteps(clean);
    expect(steps.filter((s) => s.key !== 'exports').every((s) => s.state === 'done')).toBe(true);
    expect(steps.some((s) => s.primary)).toBe(false);
    expect(progress(steps)).toEqual({ done: 6, total: 7, open: 0 }); // the header counts every step shown
  });

  it('no data source (flag off / failed read) is T4 "off", never todo', () => {
    const steps = buildSteps({ ...clean, deliveryNotes: null, gaps: null, claims: null, vat: null });
    for (const k of ['deliveryNotes', 'gaps', 'claims', 'vat'] as const) {
      expect(steps.find((s) => s.key === k)).toMatchObject({ state: 'off', count: null, amountIls: null, primary: false, href: null });
    }
    expect(progress(steps)).toEqual({ done: 2, total: 7, open: 0 }); // unchecked + consolidated
  });

  it('consolidated invoices waiting are T4 pending, never todo, and never take the primary CTA', () => {
    const steps = buildSteps({ ...clean, consolidated: { count: 2, amountIls: 1250.5, firstInvoiceId: 'inv-1' } });
    expect(steps.find((s) => s.key === 'consolidated')).toMatchObject({
      state: 'pending',
      primary: false,
      href: '/dashboard/invoices/inv-1',
    });
    expect(steps.some((s) => s.primary)).toBe(false);
  });

  it('the export step is not tracked until the logged runs (slice b): pending, linked to exports', () => {
    expect(buildSteps(clean).find((s) => s.key === 'exports')).toMatchObject({
      state: 'pending',
      href: '/dashboard/exports',
      count: null,
    });
  });

  it('ONE primary CTA, on the first step with items', () => {
    const steps = buildSteps({ ...clean, claims: { count: 1, amountIls: 40 }, vat: { count: 3, amountIls: 900 } });
    expect(steps.filter((s) => s.primary).map((s) => s.key)).toEqual(['claims']);
    expect(steps.filter((s) => s.state === 'todo').map((s) => s.key)).toEqual(['claims', 'vat']);
    expect(progress(steps)).toEqual({ done: 4, total: 7, open: 2 });
  });

  it('each step links to the queue where its number lives (VAT: the AU-08 card below the checklist)', () => {
    const href = Object.fromEntries(buildSteps(clean).map((s) => [s.key, s.href]));
    expect(href).toEqual({
      unchecked: '/dashboard/invoices?month=-1&view=awaiting',
      gaps: '/dashboard/approvals',
      claims: '/dashboard/recovery',
      consolidated: '/dashboard/suppliers/ledger',
      deliveryNotes: '/dashboard/suppliers/ledger',
      vat: '#vat-at-risk',
      exports: '/dashboard/exports',
    });
  });

  it('marks the figures that are all-open-now, not month-scoped', () => {
    expect(buildSteps(clean).filter((s) => s.openNow).map((s) => s.key)).toEqual(['gaps', 'claims', 'vat']);
  });
});

describe('close month', () => {
  it('defaults to the previous month during days 1–10 (Israel time), else the current month', () => {
    expect(defaultMonth(new Date('2026-11-07T10:00:00Z'))).toBe('2026-10');
    expect(defaultMonth(new Date('2026-11-10T21:30:00Z'))).toBe('2026-10'); // 10.11 23:30 in Israel (IST +2)
    expect(defaultMonth(new Date('2026-11-10T22:30:00Z'))).toBe('2026-11'); // 11.11 00:30
    expect(defaultMonth(new Date('2026-10-25T09:30:00Z'))).toBe('2026-10');
    expect(defaultMonth(new Date('2027-01-03T09:00:00Z'))).toBe('2026-12');
  });

  it('accepts a valid past ?month= and refuses the future or junk', () => {
    const now = new Date('2026-11-20T09:00:00Z');
    expect(resolveMonth('2026-09', now)).toBe('2026-09');
    expect(resolveMonth('2026-11', now)).toBe('2026-11');
    expect(resolveMonth('2026-12', now)).toBe('2026-11');
    expect(resolveMonth('2026-13', now)).toBe('2026-11');
    expect(resolveMonth('x', now)).toBe('2026-11');
    expect(resolveMonth('2024-11', now)).toBe('2024-11'); // 24 back: the register's limit
    expect(resolveMonth('2024-10', now)).toBe('2026-11'); // older: the API would reject it
  });

  it('steps across the year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});
