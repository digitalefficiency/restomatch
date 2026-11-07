import { describe, expect, it } from 'vitest';
import {
  contractFileErrorKey,
  contractStatus,
  contractWriteErrorKey,
  approvalsDeepLink,
  daysUntil,
  matchesSearch,
  parsePrice,
  waDraftLink,
  todayIso,
  percentToFraction,
  periodParts,
  resolveTab,
  visibleTabs,
} from '../contracts/logic';

describe('contracts screen logic', () => {
  it('shows tabs per feature flag; "לטיפול" (queue) is first (W2-12)', () => {
    expect(visibleTabs({ contracts: true, priceAlerts: true })).toEqual(['queue', 'contracts', 'alerts', 'thresholds']);
    expect(visibleTabs({ contracts: false, priceAlerts: true })).toEqual(['alerts', 'thresholds']);
    expect(visibleTabs({ contracts: true, priceAlerts: false })).toEqual(['queue', 'contracts']);
    expect(visibleTabs({ contracts: false, priceAlerts: false })).toEqual([]);
  });

  it('resolves ?tab= against the visible tabs', () => {
    expect(resolveTab('alerts', ['contracts', 'alerts'])).toBe('alerts');
    expect(resolveTab('alerts', ['contracts'])).toBe('contracts');
    expect(resolveTab(undefined, ['alerts', 'thresholds'])).toBe('alerts');
    expect(resolveTab('x', [])).toBeNull();
  });

  it('defaults to the queue and keeps the legacy ?tab= keys (home teaser, e-mail links)', () => {
    const all = visibleTabs({ contracts: true, priceAlerts: true });
    expect(resolveTab(undefined, all)).toBe('queue');
    expect(resolveTab('queue', all)).toBe('queue');
    for (const legacy of ['contracts', 'alerts', 'thresholds'] as const) expect(resolveTab(legacy, all)).toBe(legacy);
  });

  it('builds the interim approvals deep link and a wa.me draft', () => {
    expect(approvalsDeepLink('abc-1')).toBe('/dashboard/approvals?invoice=abc-1');
    expect(waDraftLink('שלום ₪10', '050-1234567')).toBe(`https://wa.me/972501234567?text=${encodeURIComponent('שלום ₪10')}`);
    expect(waDraftLink('x', null)).toBe('https://wa.me/?text=x');
  });

  it('expiry and search helpers', () => {
    expect(daysUntil(null, '2026-11-08')).toBeNull();
    expect(daysUntil('2026-11-30', '2026-11-08')).toBe(22);
    expect(daysUntil('2026-11-01', '2026-11-08')).toBe(-7);
    expect(matchesSearch('סלמ', 'פילה סלמון', null)).toBe(true);
    expect(matchesSearch('SALM', 'פילה', 'Salmon fillet')).toBe(true);
    expect(matchesSearch('', 'x')).toBe(true);
    expect(matchesSearch('בקר', 'פילה סלמון')).toBe(false);
  });

  it('classifies contract validity', () => {
    expect(contractStatus('2026-01-01', null, '2026-05-01')).toBe('active');
    expect(contractStatus('2026-06-01', null, '2026-05-01')).toBe('upcoming');
    expect(contractStatus('2026-01-01', '2026-04-30', '2026-05-01')).toBe('expired');
    expect(contractStatus('2026-01-01', '2026-05-01', '2026-05-01')).toBe('active');
  });

  it('words alert windows as weeks when whole', () => {
    expect(periodParts(21)).toEqual({ unit: 'weeks', count: 3 });
    expect(periodParts(7)).toEqual({ unit: 'days', count: 7 });
    expect(periodParts(30)).toEqual({ unit: 'days', count: 30 });
  });

  it('maps server error tokens to translated keys', () => {
    expect(contractFileErrorKey(new Error('CATALOG_FILE_LEGACY_XLS: old'))).toBe('LEGACY_XLS');
    expect(contractFileErrorKey(new Error('CONTRACT_MAPPING: x'))).toBe('MAPPING');
    expect(contractFileErrorKey(new Error('boom'))).toBeNull();
    expect(contractWriteErrorKey(new Error('CONTRACT_DUPLICATE: x'))).toBe('duplicate');
    expect(contractWriteErrorKey(new Error('CONTRACT_RANGE: x'))).toBe('range');
    expect(contractWriteErrorKey(new Error('nope'))).toBeNull();
  });

  it('parses typed prices and percentages', () => {
    expect(parsePrice(' 12,5 ')).toBe(12.5);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('-1')).toBeNull();
    // stored as NUMERIC(12,4): anything that rounds to 0.0000 is not a price
    expect(parsePrice('0.00004')).toBeNull();
    expect(parsePrice('0.0001')).toBe(0.0001);
    // money cross-QA F1: comma = thousands for groups of 3, decimal for 1–2 digits
    expect(parsePrice('1,250')).toBe(1250);
    expect(parsePrice('1,234.50')).toBe(1234.5);
    expect(parsePrice('12,5')).toBe(12.5);
    expect(parsePrice('₪ 1,250')).toBe(1250);
    expect(parsePrice('1.250,5')).toBeNull();
    expect(parsePrice('1,2345')).toBeNull();
    expect(parsePrice('1e3')).toBeNull();
    // F2: ₪0 is not a contract price
    expect(parsePrice('0')).toBeNull();
    expect(parsePrice('0.00')).toBeNull();
    expect(percentToFraction('18')).toBe(0.18);
    expect(percentToFraction('12.5')).toBe(0.125);
    expect(percentToFraction('0')).toBeNull();
    expect(percentToFraction('600')).toBeNull();
  });
});

describe('todayIso (money cross-QA F8)', () => {
  it('is the Asia/Jerusalem calendar date, not the UTC one', () => {
    // 22:30Z on Mar 31 is already April 1st in Israel (UTC+3).
    expect(todayIso(new Date('2026-03-31T22:30:00Z'))).toBe('2026-04-01');
    expect(todayIso(new Date('2026-03-31T12:00:00Z'))).toBe('2026-03-31');
  });
});
