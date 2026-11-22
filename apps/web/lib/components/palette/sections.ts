/**
 * Pure section builder for the command palette (W3-04, DS3-02). No React, no
 * network: the caller passes the role-filtered screens, actions, settings,
 * display commands and waiting items, and the `search.global` records it
 * already fetched. Sections render in `SECTION_ORDER`:
 * מחכה לך → אחרונים → מעבר אל → רשומות → פעולות → תצוגה → הגדרות → שאלו
 * (sidebar spec §1.6; DS3 spec §10.5 adds תצוגה and הגדרות).
 *
 * At 0 characters the palette shows מחכה לך, the frecency recents and the
 * display commands (a short list), and nothing is fetched. Settings are listed
 * only once the viewer types: the list is long and would bury the rest.
 *
 * Prefixes narrow the query: `#` invoices and orders (numbers), `@` suppliers,
 * `>` actions and display commands.
 *
 * The palette's other rules live here too, pure, so they are unit-tested
 * without a DOM: when the record search runs (`recordSearch`), which status
 * line shows (`paletteStatus`) and what choosing an option does
 * (`chooseOption`).
 */
import { normalizeHe, searchVariants } from './normalizeHe';

export type PaletteKind =
  | 'waiting'
  | 'recent'
  | 'screen'
  | 'supplier'
  | 'product'
  | 'invoice'
  | 'order'
  | 'recipe'
  | 'action'
  | 'setting'
  | 'command'
  | 'ask';

/** Every kind that opens a page: all but `command`. */
export type PaletteLinkKind = Exclude<PaletteKind, 'command'>;

interface PaletteItemBase {
  id: string;
  label: string;
  secondary?: string;
  /**
   * Shortcut keys shown as one chip at the row's end (`<kbd dir="ltr">G A</kbd>`)
   * and read out with the option's name, so the palette teaches the chord.
   * `Mod` renders ⌘ on Apple and Ctrl elsewhere, as in `HOTKEYS`.
   */
  keys?: readonly string[];
}

/** An option that opens a page (`onNavigate(href)`). */
export interface PaletteLinkItem extends PaletteItemBase {
  kind: PaletteLinkKind;
  href: string;
}

/**
 * An option that runs in place (a display command). It has no href on purpose:
 * choosing it closes the palette and then calls `run()`, and it never navigates.
 */
export interface PaletteCommandItem extends PaletteItemBase {
  kind: 'command';
  run: () => void;
}

/** One palette option: a page to open, or a display command to run in place. */
export type PaletteItem = PaletteLinkItem | PaletteCommandItem;

/** A section of the list; its visible name is `paletteCopy[locale].sections[key]`. */
export type SectionKey =
  | 'waiting'
  | 'recents'
  | 'screens'
  | 'records'
  | 'actions'
  | 'display'
  | 'settings'
  | 'ask';

/**
 * The one section order (sidebar spec §1.6 + DS3 spec §10.5). The Ask fallback
 * ("שאלו: …") closes the list: it is what is left when nothing else fits.
 */
export const SECTION_ORDER: readonly SectionKey[] = [
  'waiting',
  'recents',
  'screens',
  'records',
  'actions',
  'display',
  'settings',
  'ask',
];

export interface PaletteSection {
  key: SectionKey;
  items: PaletteItem[];
}

/**
 * A destination matched by its name and aliases through `normalizeHe`: a
 * registry screen ("מעבר אל") or a settings section ("הגדרות").
 */
export interface PaletteScreen {
  key: string;
  href: string;
  label: string;
  aliases: readonly string[];
  /** A short second line (a setting's section, e.g. "תצוגה"). */
  secondary?: string;
}

/**
 * A command. Money moves (`money: true`) only open their confirm screen: the
 * href is that screen, never a mutation, so the palette never moves ₪ itself.
 */
export interface PaletteAction {
  id: string;
  label: string;
  href: string;
  keywords?: readonly string[];
  money?: boolean;
}

/**
 * A display command for "תצוגה" (DS3 spec §10.5: collapse the menu, density,
 * text size, single-key shortcuts). It changes how the app looks or listens,
 * never data, which is why it may run straight from the palette (a money move
 * stays a `PaletteAction` link to its own screen). The caller words the label
 * for the current state ("כיווץ התפריט" / "הרחבת התפריט").
 */
export interface PaletteCommand {
  id: string;
  label: string;
  run: () => void;
  /** Extra search words in both languages; the label always matches. */
  keywords?: readonly string[];
  /** The current state or a short hint at the row's end (e.g. "פועל"). */
  secondary?: string;
  /** Its shortcut, shown as a chip (e.g. ['Mod', 'B']). */
  keys?: readonly string[];
}

export type PrefixMode = 'all' | 'numbers' | 'suppliers' | 'actions';

export function parsePrefix(raw: string): { mode: PrefixMode; query: string } {
  const t = raw.trimStart();
  const rest = t.slice(1).trim();
  if (t.startsWith('#')) return { mode: 'numbers', query: rest };
  if (t.startsWith('@')) return { mode: 'suppliers', query: rest };
  if (t.startsWith('>')) return { mode: 'actions', query: rest };
  return { mode: 'all', query: raw.trim() };
}

/** Which record kinds a prefix mode keeps. */
const RECORD_KINDS: Record<PrefixMode, readonly PaletteKind[]> = {
  all: ['supplier', 'product', 'invoice', 'order', 'recipe'],
  numbers: ['invoice', 'order'],
  suppliers: ['supplier'],
  actions: [],
};

/**
 * Score a label/aliases against the query variants (lower is better, -1 = no
 * match): label prefix 0, word prefix 1, alias prefix 2, anywhere 3.
 */
export function scoreText(label: string, aliases: readonly string[], query: string): number {
  const variants = searchVariants(query);
  if (variants.length === 0) return -1;
  const l = normalizeHe(label);
  const as = aliases.map(normalizeHe);
  let best = -1;
  for (const v of variants) {
    let s = -1;
    if (l.startsWith(v)) s = 0;
    else if (l.split(' ').some((w) => w.startsWith(v))) s = 1;
    else if (as.some((a) => a.startsWith(v))) s = 2;
    else if (l.includes(v) || as.some((a) => a.includes(v))) s = 3;
    if (s >= 0 && (best < 0 || s < best)) best = s;
  }
  return best;
}

function rank<T>(items: readonly T[], score: (t: T) => number, limit: number): T[] {
  return items
    .map((t, i) => ({ t, i, s: score(t) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.t);
}

export interface BuildInput {
  raw: string;
  waiting: readonly PaletteItem[];
  recents: readonly PaletteItem[];
  screens: readonly PaletteScreen[];
  /** Already role-filtered records from `search.global` (see `recordItems`). */
  records: readonly PaletteItem[];
  actions: readonly PaletteAction[];
  /** The Ask entry ("שאלו: …"), or null when the role cannot ask. */
  ask: ((query: string) => PaletteItem) | null;
  /** "תצוגה": display commands. Listed at 0 characters too (the list is short). */
  commands?: readonly PaletteCommand[];
  /** "הגדרות": the role's settings sections, matched like screens, listed once the viewer types. */
  settings?: readonly PaletteScreen[];
  /** G-chord keys by href ('/dashboard/approvals' → ['G', 'A']): chips on "מעבר אל" options. */
  chords?: Readonly<Record<string, readonly string[]>>;
  limits?: {
    screens?: number;
    actions?: number;
    waiting?: number;
    settings?: number;
    display?: number;
  };
}

function screenItem(s: PaletteScreen, keys: readonly string[] | undefined): PaletteLinkItem {
  return {
    kind: 'screen',
    id: s.key,
    label: s.label,
    href: s.href,
    ...(keys && keys.length > 0 ? { keys } : {}),
  };
}

function commandItem(c: PaletteCommand): PaletteCommandItem {
  return {
    kind: 'command',
    id: c.id,
    label: c.label,
    run: c.run,
    ...(c.secondary ? { secondary: c.secondary } : {}),
    ...(c.keys && c.keys.length > 0 ? { keys: c.keys } : {}),
  };
}

export function buildPaletteSections(input: BuildInput): PaletteSection[] {
  const { mode, query } = parsePrefix(input.raw);
  const out: PaletteSection[] = [];
  const push = (key: SectionKey, items: PaletteItem[]) => {
    if (items.length) out.push({ key, items });
  };
  const commands = input.commands ?? [];
  const displayLimit = input.limits?.display ?? commands.length;
  // Short by design: all of it without a query; with one, only what matches (else no section).
  const display = (): PaletteItem[] =>
    (query
      ? rank(commands, (c) => scoreText(c.label, c.keywords ?? [], query), displayLimit)
      : commands.slice(0, displayLimit)
    ).map(commandItem);

  if (!query && mode === 'all') {
    push('waiting', input.waiting.slice(0, input.limits?.waiting ?? 5));
    push('recents', input.recents.slice());
    push('display', display());
    return out;
  }

  if (mode === 'all') {
    push(
      'waiting',
      rank(input.waiting, (w) => scoreText(w.label, [w.secondary ?? ''], query), 3),
    );
    push(
      'screens',
      rank(
        input.screens,
        (s) => scoreText(s.label, s.aliases, query),
        input.limits?.screens ?? 6,
      ).map((s) => screenItem(s, input.chords?.[s.href])),
    );
  }
  const keep = RECORD_KINDS[mode];
  push(
    'records',
    input.records.filter((r) => keep.includes(r.kind)),
  );
  if (mode === 'all' || mode === 'actions') {
    const acts = query
      ? rank(
          input.actions,
          (a) => scoreText(a.label, a.keywords ?? [], query),
          input.limits?.actions ?? 4,
        )
      : input.actions.slice(0, input.limits?.actions ?? 4);
    push(
      'actions',
      acts.map((a) => ({ kind: 'action' as const, id: a.id, label: a.label, href: a.href })),
    );
    push('display', display());
  }
  if (mode === 'all') {
    push(
      'settings',
      rank(
        input.settings ?? [],
        (s) => scoreText(s.label, s.aliases, query),
        input.limits?.settings ?? 5,
      ).map((s) => ({
        kind: 'setting' as const,
        id: s.key,
        label: s.label,
        href: s.href,
        ...(s.secondary ? { secondary: s.secondary } : {}),
      })),
    );
    if (input.ask && query.length >= 2) push('ask', [input.ask(query)]);
  }
  return out;
}

/** The flat keyboard order of a section list (↑/↓ walk this). */
export function flatItems(sections: readonly PaletteSection[]): PaletteItem[] {
  return sections.flatMap((s) => s.items);
}

/** `search.global` takes 2 characters or more (its input is `min(2)`); shorter terms match locally only. */
const RECORD_SEARCH_MIN = 2;

/**
 * The record search for one input state. `run`: `search.global` runs for the
 * debounced term. `due`: a search will run for what is typed, but the 200 ms
 * debounce has not caught up yet, so the palette says "searching" instead of
 * claiming no results for a term nobody has searched. Neither for the `>`
 * prefix (actions and display commands only) nor for a role whose palette
 * finds screens only (`findsRecords` false; the caller also passes false while
 * the palette is closed).
 */
export function recordSearch(
  raw: string,
  debounced: string,
  findsRecords: boolean,
): { run: boolean; due: boolean } {
  const { mode, query } = parsePrefix(raw);
  const can = findsRecords && mode !== 'actions';
  return {
    run: can && debounced.length >= RECORD_SEARCH_MIN,
    due: can && query.length >= RECORD_SEARCH_MIN && debounced !== query,
  };
}

/** The line under the list (`role="status"`); null when the options speak for themselves. */
export type PaletteStatus = 'error' | 'searching' | 'noResults' | null;

/**
 * Which status line the palette shows. "No results" is a claim about a search
 * that ran: while a record search is due or in flight the line says
 * "searching", and a bare prefix (`#`, `@`) names no term that could have
 * missed, so the line stays empty. A failed record search is said even beside
 * local matches, since records may be missing from the list.
 */
export function paletteStatus(s: {
  /** The term after any prefix (`parsePrefix(raw).query`). */
  query: string;
  /** How many options the list shows. */
  count: number;
  /** A record search is due (`recordSearch(…).due`) or in flight. */
  pending: boolean;
  /** The record search failed. */
  failed: boolean;
}): PaletteStatus {
  if (s.failed) return 'error';
  if (s.count > 0) return null;
  if (s.pending) return 'searching';
  return s.query ? 'noResults' : null;
}

/**
 * Choosing an option (Enter or a click). A display command closes the palette
 * first, so focus is back on the opener before the command moves anything
 * (the menu, the cheat sheet), and then runs in place: it never navigates and
 * is never remembered, since it has no page to reopen. A link is remembered
 * for "אחרונים" (`recordVisit` skips Ask and recents), then the palette closes
 * and the page opens.
 */
export function chooseOption(
  item: PaletteItem,
  fx: {
    close: () => void;
    navigate: (href: string) => void;
    remember: (item: PaletteLinkItem) => void;
  },
): void {
  if (item.kind === 'command') {
    fx.close();
    item.run();
    return;
  }
  fx.remember(item);
  fx.close();
  fx.navigate(item.href);
}

/**
 * The `chords` map (href → keys) from the shortcut registry: every G-chord's
 * destination with its keys (['G', 'A']). Structural, so this pure module
 * needs no import of `lib/hotkeys`; pass `HOTKEYS`. First chord per href wins.
 */
export function chordsByHref(
  defs: ReadonlyArray<{ keys: readonly string[]; chord?: { href: string } }>,
): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const d of defs) {
    if (d.chord && !Object.prototype.hasOwnProperty.call(out, d.chord.href)) {
      out[d.chord.href] = d.keys;
    }
  }
  return out;
}

/** The shekel sign, U+20AA. */
const ILS = '₪';

/**
 * The second ₪ guard for chef and receiver (sidebar spec §15: never emit,
 * render or announce ₪ for them; §14.13 checks the palette). The server
 * already strips money from their search and waiting items are built ₪-free;
 * this drops any option whose label carries ₪ and blanks a ₪ secondary line,
 * so a stale recent from another membership or a caller slip still cannot
 * show them money. Sections left empty are dropped.
 */
export function withoutMoney(sections: readonly PaletteSection[]): PaletteSection[] {
  return sections
    .map((s) => ({
      key: s.key,
      items: s.items
        .filter((i) => !i.label.includes(ILS))
        .map((i) => (i.secondary?.includes(ILS) ? { ...i, secondary: undefined } : i)),
    }))
    .filter((s) => s.items.length > 0);
}

/** `search.global` output (any subset of kinds) → palette record items. */
export interface GlobalResults {
  suppliers?: ReadonlyArray<{ id: string; name: string; nameEn?: string | null }>;
  products?: ReadonlyArray<{ id: string; canonicalName: string; nameEn?: string | null }>;
  invoices?: ReadonlyArray<{ id: string; invoiceNumber: string | null }>;
  orders?: ReadonlyArray<{
    id: string;
    supplierName: string;
    customerRef: string | null;
    expectedDeliveryAt?: Date | string | null;
  }>;
  recipes?: ReadonlyArray<{ id: string; name: string; nameEn?: string | null }>;
}

export function recordItems(
  data: GlobalResults | undefined,
  opts: {
    locale: 'he' | 'en';
    canSee: (sectionHref: string) => boolean;
    noInvoiceNumber: string;
    orderLabel: (supplierName: string, ref: string | null) => string;
  },
): PaletteLinkItem[] {
  if (!data) return [];
  const en = opts.locale === 'en';
  const name = (he: string, nameEn?: string | null) =>
    en && nameEn ? { label: nameEn, secondary: he } : { label: he, secondary: undefined };
  const out: PaletteLinkItem[] = [];
  if (opts.canSee('/dashboard/suppliers'))
    for (const s of data.suppliers ?? [])
      out.push({
        kind: 'supplier',
        id: s.id,
        ...name(s.name, s.nameEn),
        href: `/dashboard/suppliers/${s.id}`,
      });
  if (opts.canSee('/dashboard/catalog'))
    for (const p of data.products ?? [])
      out.push({
        kind: 'product',
        id: p.id,
        ...name(p.canonicalName, p.nameEn),
        href: `/dashboard/products/${p.id}`,
      });
  if (opts.canSee('/dashboard/invoices'))
    for (const i of data.invoices ?? [])
      out.push({
        kind: 'invoice',
        id: i.id,
        label: i.invoiceNumber ?? opts.noInvoiceNumber,
        href: `/dashboard/invoices/${i.id}`,
      });
  if (opts.canSee('/dashboard/orders'))
    for (const o of data.orders ?? [])
      out.push({
        kind: 'order',
        id: o.id,
        label: opts.orderLabel(o.supplierName, o.customerRef),
        // Same-supplier orders differ by date: show the expected delivery (d.m).
        secondary: o.expectedDeliveryAt ? shortDate(o.expectedDeliveryAt) : undefined,
        href: `/dashboard/orders/${o.id}`,
      });
  if (opts.canSee('/dashboard/recipes'))
    for (const r of data.recipes ?? [])
      out.push({
        kind: 'recipe',
        id: r.id,
        ...name(r.name, r.nameEn),
        href: `/dashboard/recipes/${r.id}`,
      });
  return out;
}

/** d.m (he-IL numerals, no year): enough to tell same-supplier orders apart. */
function shortDate(d: Date | string): string | undefined {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? undefined : `${t.getDate()}.${t.getMonth() + 1}`;
}
