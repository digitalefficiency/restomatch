import { describe, expect, it } from 'vitest';
import {
  buildPaletteSections,
  flatItems,
  parsePrefix,
  recordItems,
  type BuildInput,
} from '../sections';
import { defaultActions } from '../actions';
import { paletteCopy } from '../copy';
import {
  loadRecents,
  rankRecents,
  recordVisit,
  RECENTS_KEY,
  RECENTS_MAX,
  saveRecents,
} from '../frecency';

const screens = [
  {
    key: 'invoices',
    href: '/dashboard/invoices',
    label: 'חשבוניות',
    aliases: ['invoices', 'חשבונית'],
  },
  { key: 'suppliers', href: '/dashboard/suppliers', label: 'ספקים', aliases: ['suppliers'] },
  { key: 'orders', href: '/dashboard/orders', label: 'הזמנות', aliases: ['orders', 'po'] },
];
const base = (raw: string, over: Partial<BuildInput> = {}): BuildInput => ({
  raw,
  waiting: [
    { kind: 'waiting', id: 'w1', label: '3 פערים מחכים להחלטה', href: '/dashboard/approvals' },
  ],
  recents: [{ kind: 'recent', id: 'screen:orders', label: 'הזמנות', href: '/dashboard/orders' }],
  screens,
  records: [
    { kind: 'supplier', id: 's1', label: 'תנובה', href: '/dashboard/suppliers/s1' },
    { kind: 'invoice', id: 'i1', label: '1024', href: '/dashboard/invoices/i1' },
    { kind: 'order', id: 'o1', label: 'הזמנה · תנובה', href: '/dashboard/orders/o1' },
  ],
  actions: defaultActions(paletteCopy.he),
  ask: (q) => ({ kind: 'ask', id: 'ask', label: `שאלו: ${q}`, href: `/dashboard/ask?q=${q}` }),
  ...over,
});

describe('buildPaletteSections', () => {
  it('0 characters: waiting then recents only', () => {
    expect(buildPaletteSections(base('')).map((s) => s.key)).toEqual(['waiting', 'recents']);
  });
  it('sections keep the fixed order', () => {
    const keys = buildPaletteSections(base('הזמנ')).map((s) => s.key);
    expect(keys).toEqual(['screens', 'records', 'actions', 'ask']);
  });
  it('finds screens through finals, aliases and wrong layout', () => {
    const scr = (raw: string) =>
      buildPaletteSections(base(raw))
        .find((s) => s.key === 'screens')
        ?.items.map((i) => i.id);
    expect(scr('ספקימ')).toEqual(['suppliers']);
    expect(scr('po')).toEqual(['orders']);
    expect(scr('jacubh')).toEqual(['invoices']); // "חשבוני" typed on EN
  });
  it('# keeps invoices and orders; @ keeps suppliers; > keeps actions', () => {
    const kinds = (raw: string) => flatItems(buildPaletteSections(base(raw))).map((i) => i.kind);
    expect(new Set(kinds('#10'))).toEqual(new Set(['invoice', 'order']));
    expect(kinds('@תנו')).toEqual(['supplier']);
    expect(new Set(kinds('>הזמנה'))).toEqual(new Set(['action']));
    expect(parsePrefix('  @ תנובה')).toEqual({ mode: 'suppliers', query: 'תנובה' });
  });
  it('no Ask entry when the role cannot ask', () => {
    expect(buildPaletteSections(base('הזמנ', { ask: null })).map((s) => s.key)).not.toContain(
      'ask',
    );
  });
  it('money actions only link to their confirm screen', () => {
    for (const a of defaultActions(paletteCopy.he).filter((x) => x.money))
      expect(a.href).toMatch(/^\/dashboard\/(approvals|approvals\/pay-run|recovery)$/);
  });
});

describe('recordItems', () => {
  const data = {
    suppliers: [{ id: 's1', name: 'תנובה', nameEn: 'Tnuva' }],
    invoices: [{ id: 'i1', invoiceNumber: null }],
    orders: [
      {
        id: 'o1',
        supplierName: 'תנובה',
        customerRef: '77',
        expectedDeliveryAt: '2026-10-25T06:00:00Z',
      },
    ],
    recipes: [{ id: 'r1', name: 'שקשוקה' }],
  };
  const opts = { locale: 'en' as const, noInvoiceNumber: 'n/a', orderLabel: paletteCopy.en.order };
  it('drops groups the role cannot open (chef: orders + recipes)', () => {
    const chef = (href: string) => href === '/dashboard/orders' || href === '/dashboard/recipes';
    expect(recordItems(data, { ...opts, canSee: chef }).map((i) => i.kind)).toEqual([
      'order',
      'recipe',
    ]);
  });
  it('labels in English with the Hebrew original, and orders by ref', () => {
    const all = recordItems(data, { ...opts, canSee: () => true });
    expect(all[0]).toMatchObject({ label: 'Tnuva', secondary: 'תנובה' });
    expect(all.find((i) => i.kind === 'invoice')?.label).toBe('n/a');
    expect(all.find((i) => i.kind === 'order')).toMatchObject({
      label: 'Order 77 · תנובה',
      secondary: '25.10',
    });
  });
});

describe('frecency', () => {
  const item = (id: string) => ({
    kind: 'screen' as const,
    id,
    label: id,
    href: `/dashboard/${id}`,
  });
  it('bumps a repeat, ranks by count × recency, filters by role', () => {
    let list = recordVisit([], item('a'), 0);
    list = recordVisit(list, item('b'), 1_000);
    list = recordVisit(list, item('b'), 2_000);
    expect(rankRecents(list, 3_000, () => true).map((r) => r.id)).toEqual(['screen:b', 'screen:a']);
    expect(rankRecents(list, 3_000, (h) => h !== '/dashboard/b').map((r) => r.id)).toEqual([
      'screen:a',
    ]);
    const week = 7 * 24 * 3600 * 1000;
    const old = recordVisit(recordVisit(recordVisit([], item('x'), 0), item('x'), 0), item('x'), 0);
    const fresh = recordVisit(old, item('y'), 3 * week);
    expect(rankRecents(fresh, 3 * week, () => true)[0]!.id).toBe('screen:y');
  });
  it('caps the list and ignores Ask entries', () => {
    let list: ReturnType<typeof recordVisit> = [];
    for (let i = 0; i < RECENTS_MAX + 5; i++) list = recordVisit(list, item(`s${i}`), i);
    expect(list).toHaveLength(RECENTS_MAX);
    expect(
      recordVisit([], { kind: 'ask', id: 'ask', label: 'q', href: '/dashboard/ask' }, 0),
    ).toEqual([]);
  });
  it('storage round-trips and survives garbage or a throwing store', () => {
    const mem = new Map<string, string>();
    const store = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const list = recordVisit([], item('a'), 1);
    saveRecents(store, list);
    expect(loadRecents(store)).toEqual(list);
    mem.set(RECENTS_KEY, '{bad');
    expect(loadRecents(store)).toEqual([]);
    mem.set(RECENTS_KEY, JSON.stringify([{ ...list[0], href: 'https://evil.example' }]));
    expect(loadRecents(store)).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(loadRecents(throwing)).toEqual([]);
    expect(() => saveRecents(throwing, list)).not.toThrow();
  });
});
