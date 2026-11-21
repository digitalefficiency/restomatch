import { describe, expect, it } from 'vitest';
import { legacyAnchor, resolveSupplierTab, supplierTabs } from '../[id]/tab-model';
import { formatLeft, rhythmParts } from '../[id]/rhythm';

describe('W2-11 · 5 supplier tabs, every old ?tab= resolves', () => {
  it('has 5 tabs with the ledger, 4 without', () => {
    expect(supplierTabs({ ledger: true })).toEqual(['overview', 'prices', 'orders', 'ledger', 'details']);
    expect(supplierTabs({ ledger: false })).toEqual(['overview', 'prices', 'orders', 'details']);
  });

  it.each([
    [undefined, 'overview'],
    ['bogus', 'overview'],
    ['leak', 'overview'],
    ['catalog', 'prices'],
    ['contract', 'prices'],
    ['schedule', 'details'],
    ['details', 'details'],
    ['orders', 'orders'],
    ['ledger', 'ledger'],
  ])('?tab=%s → %s', (raw, tab) => {
    expect(resolveSupplierTab(raw, { ledger: true })).toBe(tab);
  });

  it('the ledger falls back to the overview when it is off', () => {
    expect(resolveSupplierTab('ledger', { ledger: false })).toBe('overview');
  });

  it('legacy tabs scroll to their section', () => {
    expect(legacyAnchor('schedule')).toBe('days-and-times');
    expect(legacyAnchor('leak')).toBe('leak-card');
    expect(legacyAnchor('orders')).toBeNull();
  });
});

describe('W2-11 · the order-rhythm line (Asia/Jerusalem, 24 h)', () => {
  it('"הזמנה עד ב׳ 12:00 (בעוד 2:10) · משלוח ג׳ 09:30"', () => {
    // Mon 26.10.2026 12:00 IL (UTC+2) = 10:00Z; delivery Tue 27.10, local midnight = 26.10 22:00Z.
    const parts = rhythmParts(
      { cutoffAt: '2026-10-26T10:00:00.000Z', minutesLeft: 130, deliveryAt: '2026-10-26T22:00:00.000Z', deliveryTime: '09:30', tz: 'Asia/Jerusalem' },
      'he',
    );
    expect(parts).toEqual({ cutoff: 'ב׳ 12:00', left: '2:10', delivery: 'ג׳ 09:30' });
  });

  it('long waits read in days', () => {
    expect(formatLeft(3 * 24 * 60 + 5, 'he')).toBe('3 ימים');
    expect(formatLeft(59, 'en')).toBe('0:59');
  });
});

describe('W2-11 · deterministic delivery-day label (no ICU hydration mismatch)', () => {
  it('builds the same string from numeric parts on any runtime', async () => {
    const { deliveryDayLabel } = await import('../delivery-label');
    // Wed 11.11.2026, local midnight Asia/Jerusalem = 10.11 22:00Z.
    expect(deliveryDayLabel('2026-11-10T22:00:00.000Z', 'en')).toBe('Wed 11/11');
    expect(deliveryDayLabel('2026-11-10T22:00:00.000Z', 'he')).toBe('ד׳ 11/11');
  });
});
