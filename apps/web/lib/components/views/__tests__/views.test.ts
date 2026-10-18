import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW,
  delta,
  isDefaultData,
  parseView,
  serializeView,
  toViewInput,
} from '../state';
import { toCsv } from '../csv';
import { localDay } from '../labels';
import { deleteSavedView, listSavedViews, saveView } from '../savedViews';

const SUP = '11111111-2222-4333-8444-555555555555';

describe('view state ⇄ URL', () => {
  it('an empty URL is the default view, and the default view serializes to an empty URL', () => {
    const v = parseView(new URLSearchParams());
    expect(v).toEqual(DEFAULT_VIEW);
    expect(isDefaultData(v)).toBe(true);
    expect(serializeView(v).toString()).toBe('');
  });

  it('round-trips every control', () => {
    const q = `p=custom&from=2026-09-01&to=2026-09-30&cmp=yoy&g=type&chart=table&d=compact&tv=1&sup=${SUP}&cat=בשר&type=PRICE_HIGHER,QTY_SHORT&sev=block&st=open,escalated`;
    const v = parseView(new URLSearchParams(q));
    expect(v).toMatchObject({
      period: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
      compare: 'yoy',
      group: 'type',
      chart: 'table',
      density: 'compact',
      tv: true,
      filters: {
        supplierIds: [SUP],
        categories: ['בשר'],
        types: ['PRICE_HIGHER', 'QTY_SHORT'],
        severities: ['block'],
        statuses: ['open', 'escalated'],
      },
    });
    expect(parseView(serializeView(v))).toEqual(v);
    expect(isDefaultData(v)).toBe(false);
  });

  it('sanitizes junk: unknown enums, bad uuids, bad dates, reversed and half ranges', () => {
    const v = parseView({
      p: 'forever',
      cmp: 'x',
      chart: 'pie',
      sup: `not-a-uuid,${SUP},${SUP}`,
      type: "PRICE_HIGHER,DROP TABLE,'",
      sev: 'info',
    });
    expect(v.period).toBe('this_month');
    expect(v.compare).toBe('off');
    expect(v.chart).toBe('bar');
    expect(v.filters.supplierIds).toEqual([SUP]);
    expect(v.filters.types).toEqual(['PRICE_HIGHER']);
    expect(v.filters.severities).toEqual([]);
    expect(parseView({ p: 'custom', from: '2026-10-01' }).period).toBe('this_month');
    expect(parseView({ p: 'custom', from: '2026-13-45', to: '2026-10-01' }).period).toBe('this_month');
    expect(parseView({ p: 'custom', from: '2026-10-31', to: '2026-10-01' })).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    // Impossible days and out-of-range years fall back instead of crashing Postgres.
    expect(parseView({ p: 'custom', from: '2026-02-30', to: '2026-03-05' }).period).toBe('this_month');
    expect(parseView({ p: 'custom', from: '0000-01-01', to: '2026-01-01' }).period).toBe('this_month');
    // Longer than the router's 3-year cap → default view, not a BAD_REQUEST page.
    expect(parseView({ p: 'custom', from: '2000-01-01', to: '2026-01-01' }).period).toBe('this_month');
    // from/to are dropped for non-custom periods.
    expect(parseView({ p: 'ytd', from: '2026-10-01', to: '2026-10-02' }).from).toBeUndefined();
  });

  it('caps list filters at 50 entries', () => {
    const many = Array.from({ length: 80 }, (_, i) => `c${i}`).join(',');
    expect(parseView({ cat: many }).filters.categories).toHaveLength(50);
  });

  it('keeps unrelated params (lang, m) and drops stale view params', () => {
    const keep = new URLSearchParams('lang=en&p=ytd&m=-1');
    const out = serializeView({ ...DEFAULT_VIEW, compare: 'prev' }, keep);
    expect(out.get('lang')).toBe('en');
    expect(out.get('m')).toBe('-1');
    expect(out.get('p')).toBeNull();
    expect(out.get('cmp')).toBe('prev');
  });

  it('toViewInput sends only what the router needs', () => {
    expect(toViewInput(DEFAULT_VIEW)).toEqual({ period: 'this_month' });
    const v = parseView({ p: 'custom', from: '2026-01-01', to: '2026-03-31', sev: 'warn' });
    expect(toViewInput(v)).toEqual({
      period: 'custom',
      from: '2026-01-01',
      to: '2026-03-31',
      filters: { severities: ['warn'] },
    });
  });

  it('delta: relative change, null base, zero base', () => {
    expect(delta(120, 100)).toEqual({ diff: 20, pct: 0.2 });
    expect(delta(80, 100)).toEqual({ diff: -20, pct: -0.2 });
    expect(delta(50, 0)).toEqual({ diff: 50, pct: null });
    expect(delta(50, null)).toBeNull();
  });
});

describe('localDay', () => {
  it('formats the Israel calendar day, not the UTC one', () => {
    expect(localDay('2026-10-01T21:00:00.000Z')).toBe('2026-10-02'); // local midnight Oct 2
    expect(localDay('2026-09-30T21:00:00.000Z')).toBe('2026-10-01');
    expect(localDay('2026-01-15T23:30:00Z')).toBe('2026-01-16'); // winter UTC+2
  });
});

describe('CSV export', () => {
  const cols = [
    { key: 'name', label: 'שם' },
    { key: 'amount', label: 'Amount, ₪' },
  ];

  it('quotes commas, quotes and newlines; empty for null', () => {
    const csv = toCsv(cols, [
      { name: 'Tomato, cherry', amount: 12.5 },
      { name: 'He said "hi"\nbye', amount: null },
    ]);
    expect(csv.split('\r\n')).toEqual(['שם,"Amount, ₪"', '"Tomato, cherry",12.5', '"He said ""hi""\nbye",']);
  });

  it('neutralizes spreadsheet formulas (CSV injection) but not negative numbers', () => {
    const csv = toCsv(cols, [
      { name: '=HYPERLINK("http://evil")', amount: -5 },
      { name: '+1', amount: 0 },
      { name: '@SUM(A1)', amount: 1 },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil"")",-5`);
    expect(lines[2]).toBe(`'+1,0`);
    expect(lines[3]).toBe(`'@SUM(A1),1`);
  });
});

describe('saved views', () => {
  it('degrades to an empty list without localStorage (node / blocked storage)', () => {
    expect(listSavedViews('overview')).toEqual([]);
    expect(saveView('overview', 'Q3', 'p=quarter')[0]).toMatchObject({ name: 'Q3', query: 'p=quarter' });
    expect(deleteSavedView('overview', 'Q3')).toEqual([]);
  });

  it('persists, de-duplicates by name and deletes with a working storage', () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { window?: unknown };
    g.window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };
    try {
      saveView('leaks', 'Meat', '?cat=בשר');
      saveView('leaks', 'YTD', 'p=ytd');
      saveView('leaks', 'Meat', 'cat=בשר&cmp=prev');
      const list = listSavedViews('leaks');
      expect(list.map((v) => [v.name, v.query])).toEqual([
        ['Meat', 'cat=בשר&cmp=prev'],
        ['YTD', 'p=ytd'],
      ]);
      expect(listSavedViews('approvals')).toEqual([]);
      expect(deleteSavedView('leaks', 'Meat').map((v) => v.name)).toEqual(['YTD']);
      store.set('rm:views:leaks', '{corrupt');
      expect(listSavedViews('leaks')).toEqual([]);
    } finally {
      delete g.window;
    }
  });
});
