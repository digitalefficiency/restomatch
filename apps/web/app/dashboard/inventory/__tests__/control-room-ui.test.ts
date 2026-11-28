import { describe, expect, it } from 'vitest';
import { drillHref, sparkGeometry } from '../control-room-ui';

describe('drillHref (W3-02b)', () => {
  const now = new Date('2026-11-14T10:00:00Z');
  it('a count and manual sales open the count; credits open recovery', () => {
    expect(drillHref({ kind: 'count', countId: 'c1' }, now)).toBe('/dashboard/inventory/c1');
    expect(drillHref({ kind: 'sales', countId: 'c2', source: 'manual' }, now)).toBe('/dashboard/inventory/c2');
    expect(drillHref({ kind: 'credits', from: '2026-09-30', to: '2026-10-24' }, now)).toBe('/dashboard/recovery');
  });
  it("purchases open the register on the closing count's month (offset ≤ 0, floored at −24)", () => {
    expect(drillHref({ kind: 'invoices', from: '2026-09-30', to: '2026-10-24' }, now)).toBe('/dashboard/invoices?month=-1');
    expect(drillHref({ kind: 'invoices', from: '2026-10-30', to: '2026-11-12' }, now)).toBe('/dashboard/invoices?month=0');
    expect(drillHref({ kind: 'invoices', from: '2020-01-01', to: '2020-02-01' }, now)).toBe('/dashboard/invoices?month=-24');
  });
});

describe('sparkGeometry (W3-02b)', () => {
  it('a null breaks the line (a gap, never a 0% point); lone points still get a dot', () => {
    const g = sparkGeometry(
      [
        { closingDate: 'a', bp: 2800 },
        { closingDate: 'b', bp: 2700 },
        { closingDate: 'c', bp: null },
        { closingDate: 'd', bp: 2650 },
      ],
      3000,
      2650,
      2800,
    );
    expect(g.segments).toHaveLength(1);
    expect(g.dots.map((d) => d.closingDate)).toEqual(['a', 'b', 'd']);
  });
  it('a higher % sits higher; the target line falls inside the box', () => {
    const g = sparkGeometry([{ closingDate: 'a', bp: 2000 }, { closingDate: 'b', bp: 3500 }], 3000, 2000, 3500);
    expect(g.dots[1]!.cy).toBeLessThan(g.dots[0]!.cy);
    expect(g.targetY).toBeGreaterThan(0);
    expect(g.targetY).toBeLessThan(g.h);
  });
});
