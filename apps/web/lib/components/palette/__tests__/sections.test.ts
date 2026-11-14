import { describe, expect, it } from 'vitest';
import type { HotkeyDef } from '@/lib/hotkeys';
import { GLOSSARY } from '../../../i18n/glossary';
import { lint } from '../../../i18n/__tests__/copyGate';
import {
  buildPaletteSections,
  chordsByHref,
  flatItems,
  parsePrefix,
  recordItems,
  SECTION_ORDER,
  withoutMoney,
  type BuildInput,
  type PaletteCommand,
  type PaletteItem,
  type PaletteSection,
} from '../sections';
import { defaultActions } from '../actions';
import { paletteCopy } from '../copy';
import {
  browserStorage,
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

describe('owner decision 7.11: "בקשות זיכוי"', () => {
  it('labels the claims action with the new word and still finds it by the old one', () => {
    const acts = defaultActions(paletteCopy.he);
    expect(acts.find((a) => a.id === 'claims')?.label).toBe('בקשות זיכוי לשליחה');
    const found = (q: string) => flatItems(buildPaletteSections(base(`>${q}`))).map((i) => i.id);
    expect(found('דרישה')).toContain('claims');
    expect(found('בקשות')).toContain('claims');
  });
});

/* ── DS3-02: מעבר אל, תצוגה, הגדרות, command items, chord chips (sidebar spec §1.6, DS3 §10.5) ── */

const runs: string[] = [];
const commands: PaletteCommand[] = [
  {
    id: 'rail',
    label: 'כיווץ התפריט',
    keywords: ['תפריט', 'collapse', 'menu'],
    keys: ['Mod', 'B'],
    run: () => void runs.push('rail'),
  },
  {
    id: 'singleKeys',
    label: 'כיבוי קיצורים בתו אחד',
    keywords: ['קיצורים', 'shortcuts'],
    secondary: 'פועל',
    run: () => void runs.push('singleKeys'),
  },
];
const settings = [
  {
    key: 'profile',
    href: '/dashboard/settings',
    label: 'פרופיל המסעדה',
    aliases: ['ח״פ', 'VAT', 'profile'],
  },
  {
    key: 'letterhead',
    href: '/dashboard/settings#letterhead',
    label: 'נייר מכתבים',
    aliases: ['letterhead'],
  },
];
const chords = { '/dashboard/invoices': ['G', 'I'], '/dashboard/orders': ['G', 'O'] };
const full = (raw: string, over: Partial<BuildInput> = {}) =>
  base(raw, { commands, settings, chords, ...over });
const keysOf = (raw: string, over: Partial<BuildInput> = {}) =>
  buildPaletteSections(full(raw, over)).map((s) => s.key);
const section = (raw: string, key: string, over: Partial<BuildInput> = {}) =>
  buildPaletteSections(full(raw, over)).find((s) => s.key === key)?.items ?? [];
const isCommand = (i: PaletteItem | undefined): i is Extract<PaletteItem, { kind: 'command' }> =>
  i?.kind === 'command';

describe('DS3-02 · section order and the new sections', () => {
  it('one order: מחכה לך → אחרונים → מעבר אל → רשומות → פעולות → תצוגה → הגדרות, Ask last', () => {
    expect(SECTION_ORDER).toEqual([
      'waiting',
      'recents',
      'screens',
      'records',
      'actions',
      'display',
      'settings',
      'ask',
    ]);
    // One query that every section matches: each one appears, in that order.
    const word = 'בדיקה';
    const keys = buildPaletteSections({
      raw: word,
      waiting: [
        { kind: 'waiting', id: 'w', label: `${word} ממתינה`, href: '/dashboard/approvals' },
      ],
      recents: [{ kind: 'recent', id: 'screen:x', label: word, href: '/dashboard/x' }],
      screens: [{ key: 'x', href: '/dashboard/x', label: word, aliases: [] }],
      records: [{ kind: 'supplier', id: 's', label: word, href: '/dashboard/suppliers/s' }],
      actions: [{ id: 'a', label: `${word} חדשה`, href: '/dashboard/x/new' }],
      commands: [{ id: 'c', label: `${word} בתצוגה`, run: () => undefined }],
      settings: [{ key: 's', href: '/dashboard/settings', label: `${word} בהגדרות`, aliases: [] }],
      ask: (q) => ({ kind: 'ask', id: 'ask', label: q, href: `/dashboard/ask?q=${q}` }),
    }).map((s) => s.key);
    expect(keys).toEqual([
      'waiting',
      'screens',
      'records',
      'actions',
      'display',
      'settings',
      'ask',
    ]);
    expect(keys).toEqual(SECTION_ORDER.filter((k) => keys.includes(k)));
  });

  it('0 characters: waiting, recents, then the display commands (short); no screens, records or settings', () => {
    expect(keysOf('')).toEqual(['waiting', 'recents', 'display']);
    expect(section('', 'display').map((i) => i.id)).toEqual(['rail', 'singleKeys']);
    expect(keysOf('   ')).toEqual(['waiting', 'recents', 'display']);
  });

  it('תצוגה with a query: only the commands that match, through keywords and finals; no section when none does', () => {
    expect(section('תפריט', 'display').map((i) => i.id)).toEqual(['rail']);
    expect(section('collapse', 'display').map((i) => i.id)).toEqual(['rail']);
    expect(section('קיצורימ', 'display').map((i) => i.id)).toEqual(['singleKeys']);
    expect(keysOf('ספקים')).not.toContain('display');
  });

  it('הגדרות: listed only once the viewer types, matched like screens (finals, aliases, wrong layout)', () => {
    expect(keysOf('')).not.toContain('settings');
    const ids = (raw: string) => section(raw, 'settings').map((i) => i.id);
    expect(ids('פרופיל')).toEqual(['profile']);
    expect(ids('vat')).toEqual(['profile']);
    expect(ids('pruphk')).toEqual(['profile']); // "פרופיל" typed on EN
    expect(ids('מכתבימ')).toEqual(['letterhead']); // a regular mem where the label has a final
    expect(section('נייר', 'settings')[0]).toEqual({
      kind: 'setting',
      id: 'letterhead',
      label: 'נייר מכתבים',
      href: '/dashboard/settings#letterhead',
    });
    expect(ids('zzz')).toEqual([]);
  });

  it('> keeps actions and the display commands; # and @ list neither, nor settings', () => {
    expect(keysOf('>')).toEqual(['actions', 'display']);
    expect(new Set(flatItems(buildPaletteSections(full('>כיווץ'))).map((i) => i.kind))).toEqual(
      new Set(['command']),
    );
    for (const raw of ['#10', '@תנו', '#פרופיל', '@כיווץ']) {
      const keys = keysOf(raw);
      expect(keys, raw).not.toContain('display');
      expect(keys, raw).not.toContain('settings');
    }
  });

  it("a command item has no href; choosing it is the caller's run(), with its keys and state", () => {
    const items = flatItems(buildPaletteSections(full('')));
    const rail = items.find((i) => i.id === 'rail');
    expect(isCommand(rail)).toBe(true);
    expect(rail).not.toHaveProperty('href');
    expect(rail).toMatchObject({ kind: 'command', label: 'כיווץ התפריט', keys: ['Mod', 'B'] });
    expect(items.find((i) => i.id === 'singleKeys')).toMatchObject({ secondary: 'פועל' });
    if (!isCommand(rail)) throw new Error('rail is a command');
    rail.run();
    expect(runs).toEqual(['rail']);
    for (const i of items.filter((x) => x.kind === 'command')) expect(i).not.toHaveProperty('href');
  });

  it('"מעבר אל" items carry their G-chord keys when given, and none otherwise', () => {
    const orders = section('הזמנ', 'screens').find((i) => i.id === 'orders');
    expect(orders).toMatchObject({ kind: 'screen', href: '/dashboard/orders', keys: ['G', 'O'] });
    expect(section('jacubh', 'screens')[0]).toMatchObject({ id: 'invoices', keys: ['G', 'I'] });
    // A screen with no chord, and the same screen with no `chords` at all: no keys property.
    expect(section('ספק', 'screens').find((i) => i.id === 'suppliers')).not.toHaveProperty('keys');
    expect(section('הזמנ', 'screens', { chords: undefined })[0]).not.toHaveProperty('keys');
    // Only "מעבר אל" items take chord chips: records and recents for the same href do not.
    expect(section('הזמנ', 'records').some((i) => i.keys)).toBe(false);
    expect(section('', 'recents').some((i) => i.keys)).toBe(false);
  });

  it('chordsByHref maps each G-chord destination to its keys (first per href wins); HOTKEYS fits it', () => {
    expect(
      chordsByHref([
        { keys: ['Mod', 'K'] },
        { keys: ['G', 'A'], chord: { href: '/dashboard/approvals' } },
        { keys: ['G', 'X'], chord: { href: '/dashboard/approvals' } },
        { keys: ['G', 'I'], chord: { href: '/dashboard/invoices' } },
      ]),
    ).toEqual({ '/dashboard/approvals': ['G', 'A'], '/dashboard/invoices': ['G', 'I'] });
    // Compile-time: the shell can pass the registry as is (`chordsByHref(HOTKEYS)`).
    const fromRegistry: (defs: readonly HotkeyDef[]) => Record<string, readonly string[]> =
      chordsByHref;
    expect(fromRegistry([])).toEqual({});
  });
});

describe('DS3-02 · no ₪ for chef or receiver (second guard)', () => {
  const sections: PaletteSection[] = [
    {
      key: 'waiting',
      items: [
        { kind: 'waiting', id: 'w1', label: '3 פערים · ‏104.80 ₪', href: '/dashboard/approvals' },
        {
          kind: 'waiting',
          id: 'w2',
          label: 'המשלוח הבא: ירקות השרון',
          secondary: '‏52.50 ₪',
          href: '/dashboard/receiving',
        },
      ],
    },
    {
      key: 'recents',
      items: [{ kind: 'recent', id: 'x', label: '‏451 ₪ לשליחה', href: '/dashboard/recovery' }],
    },
    {
      key: 'display',
      items: [{ kind: 'command', id: 'rail', label: 'כיווץ התפריט', run: () => undefined }],
    },
  ];

  it('drops an option whose label carries ₪, blanks a ₪ secondary line, and drops emptied sections', () => {
    const out = withoutMoney(sections);
    expect(out.map((s) => s.key)).toEqual(['waiting', 'display']);
    expect(out[0]!.items).toEqual([
      {
        kind: 'waiting',
        id: 'w2',
        label: 'המשלוח הבא: ירקות השרון',
        secondary: undefined,
        href: '/dashboard/receiving',
      },
    ]);
    expect(JSON.stringify(out)).not.toContain('₪');
  });

  it('leaves ₪-free sections as they are', () => {
    const clean = buildPaletteSections(full('הזמנ'));
    expect(withoutMoney(clean)).toEqual(clean);
  });
});

describe('DS3-02 · frecency and storage', () => {
  it('a command never becomes a recent (it has no href to reopen)', () => {
    const cmd: PaletteItem = {
      kind: 'command',
      id: 'rail',
      label: 'כיווץ התפריט',
      run: () => undefined,
    };
    expect(recordVisit([], cmd, 0)).toEqual([]);
    const settingVisit = recordVisit(
      [],
      { kind: 'setting', id: 'profile', label: 'פרופיל המסעדה', href: '/dashboard/settings' },
      0,
    );
    expect(rankRecents(settingVisit, 0, () => true).map((r) => r.id)).toEqual(['setting:profile']);
  });

  it('browserStorage() is undefined on the server instead of throwing', () => {
    expect(browserStorage()).toBeUndefined();
    expect(loadRecents(browserStorage())).toEqual([]);
  });
});

describe('DS3-02 · copy (sidebar spec §1.6)', () => {
  it('the screens section is "מעבר אל" / "Go to"; תצוגה and הגדרות exist in both languages', () => {
    expect(paletteCopy.he.sections).toMatchObject({
      screens: 'מעבר אל',
      display: 'תצוגה',
      settings: 'הגדרות',
    });
    expect(paletteCopy.en.sections).toMatchObject({
      screens: 'Go to',
      display: 'Display',
      settings: 'Settings',
    });
    for (const k of SECTION_ORDER) {
      expect(paletteCopy.he.sections[k], k).toBeTruthy();
      expect(paletteCopy.en.sections[k], k).toBeTruthy();
    }
  });

  it('the zero-result copy names the query inside „…" and says what to try; the footer adds the money line', () => {
    expect(paletteCopy.he.noResults).toBe('אין תוצאות ל„{q}". נסו שם ספק, מספר חשבונית או מסך.');
    expect(paletteCopy.en.noResults).toBe(
      'No results for “{q}”. Try a supplier name, an invoice number or a screen.',
    );
    expect(paletteCopy.he.noResultsScreens).toContain('ל„{q}".');
    expect(paletteCopy.he.footerMoney).toBe('פעולת כסף נפתחת במסך שלה · לא מאשרים מכאן');
    expect(paletteCopy.en.footerMoney).toBe(
      'A money action opens on its own screen · nothing is approved here',
    );
  });

  /** Every Hebrew string of the palette copy, functions called with sample arguments. */
  function heStrings(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'string') out.push([path, v]);
      else if (typeof v === 'function')
        out.push([path, String((v as (...a: string[]) => unknown)('תנובה', '77'))]);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(paletteCopy.he, '');
    return out;
  }

  it('house style (copy gate rules): plural imperatives, no gendered "you"; only the spec-pinned quotes around {q}', () => {
    const findings = heStrings().flatMap(([where, text]) =>
      lint(text, 'he')
        // The spec pins „{q}" verbatim (sidebar spec §1.6), like the gate's own ALLOW for pinned quotes.
        .filter((f) => !(f.rule === 'sign-next-to-placeholder' && where.startsWith('noResults')))
        .map((f) => `${where} ${f.rule}: ${f.match}`),
    );
    expect(findings).toEqual([]);
  });

  it('never the retired claims words in visible copy (owner 7.11)', () => {
    const retired = GLOSSARY.find((g) => g.concept === 'creditClaim')!.retireHe;
    const offenders = heStrings().filter(([, text]) => retired.some((t) => text.includes(t)));
    expect(offenders).toEqual([]);
  });
});
