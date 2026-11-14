import { describe, expect, it } from 'vitest';
import { parseView } from '@/lib/components/views/state';
import { legacyPeriodRedirect, monthParams } from '../period-url';

const NOW = new Date('2026-10-25T12:00:00+03:00');
const R = (sp: Record<string, string | string[]>, path = '/dashboard/leaks/breakdown') => legacyPeriodRedirect(path, sp, NOW);

describe('legacy period params → the p grammar (308 targets)', () => {
  it('m=-1 → p=last_month; m=0 → this month (no p)', () => {
    expect(R({ m: '-1' })).toBe('/dashboard/leaks/breakdown?p=last_month');
    expect(R({ m: '0' })).toBe('/dashboard/leaks/breakdown');
  });

  it('m=-3 → a custom range covering that whole month', () => {
    expect(R({ m: '-3' })).toBe('/dashboard/leaks/breakdown?p=custom&from=2026-07-01&to=2026-07-31');
  });

  it('month=YYYY-MM → custom from–to with the right last day (incl. February)', () => {
    expect(R({ month: '2026-09' }, '/dashboard/leaks/report')).toBe('/dashboard/leaks/report?p=last_month');
    expect(R({ month: '2026-02' }, '/dashboard/leaks/report')).toBe('/dashboard/leaks/report?p=custom&from=2026-02-01&to=2026-02-28');
    expect(R({ month: '2028-02' }, '/dashboard/leaks/report')).toMatch(/to=2028-02-29$/);
    expect(R({ month: '2026-10' }, '/dashboard/leaks/report')).toBe('/dashboard/leaks/report');
  });

  it('keeps the other params, drops a conflicting p/from/to', () => {
    expect(R({ m: '-1', sup: 'abc', type: ['PRICE_HIGHER', 'QTY_SHORT'], p: 'ytd' })).toBe(
      '/dashboard/leaks/breakdown?sup=abc&type=PRICE_HIGHER&type=QTY_SHORT&p=last_month',
    );
  });

  it('no legacy param → no redirect; an invalid one is dropped', () => {
    expect(R({ p: 'last_month' })).toBeNull();
    expect(R({ m: 'abc', sup: 'x' })).toBe('/dashboard/leaks/breakdown?sup=x');
    expect(R({ month: '2026-13' })).toBe('/dashboard/leaks/breakdown');
  });

  it('every target parses back through parseView to the same month', () => {
    for (const m of ['-1', '-2', '-11']) {
      const url = new URL(`http://x${R({ m })}`);
      const v = parseView(Object.fromEntries(url.searchParams));
      expect(v.period === 'last_month' || (v.period === 'custom' && v.from!.endsWith('-01'))).toBe(true);
    }
    expect(monthParams(2026, 8, NOW)).toEqual({ p: 'custom', from: '2026-08-01', to: '2026-08-31' });
  });
});
