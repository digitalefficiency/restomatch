/**
 * Pure section builder for the command palette (W3-04). No React, no network:
 * the caller passes the role-filtered screens, actions and waiting items, and
 * the `search.global` records it already fetched. Sections render in this
 * order: מחכה לך → מסכים → רשומות → פעולות → שאלו. At 0 characters the
 * palette shows מחכה לך and the frecency recents only (nothing is fetched).
 *
 * Prefixes narrow the query: `#` invoices and orders (numbers), `@` suppliers,
 * `>` actions.
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
  | 'ask';

export interface PaletteItem {
  kind: PaletteKind;
  id: string;
  label: string;
  secondary?: string;
  href: string;
}

export type SectionKey = 'waiting' | 'recents' | 'screens' | 'records' | 'actions' | 'ask';

export interface PaletteSection {
  key: SectionKey;
  items: PaletteItem[];
}

export interface PaletteScreen {
  key: string;
  href: string;
  label: string;
  aliases: readonly string[];
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
  limits?: { screens?: number; actions?: number; waiting?: number };
}

export function buildPaletteSections(input: BuildInput): PaletteSection[] {
  const { mode, query } = parsePrefix(input.raw);
  const out: PaletteSection[] = [];
  const push = (key: SectionKey, items: PaletteItem[]) => {
    if (items.length) out.push({ key, items });
  };

  if (!query && mode === 'all') {
    push('waiting', input.waiting.slice(0, input.limits?.waiting ?? 5));
    push('recents', input.recents.slice());
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
      ).map((s) => ({
        kind: 'screen' as const,
        id: s.key,
        label: s.label,
        href: s.href,
      })),
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
  }
  if (mode === 'all' && input.ask && query.length >= 2) push('ask', [input.ask(query)]);
  return out;
}

/** The flat keyboard order of a section list (↑/↓ walk this). */
export function flatItems(sections: readonly PaletteSection[]): PaletteItem[] {
  return sections.flatMap((s) => s.items);
}

/** `search.global` output (any subset of kinds) → palette record items. */
export interface GlobalResults {
  suppliers?: ReadonlyArray<{ id: string; name: string; nameEn?: string | null }>;
  products?: ReadonlyArray<{ id: string; canonicalName: string; nameEn?: string | null }>;
  invoices?: ReadonlyArray<{ id: string; invoiceNumber: string | null }>;
  orders?: ReadonlyArray<{ id: string; supplierName: string; customerRef: string | null }>;
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
): PaletteItem[] {
  if (!data) return [];
  const en = opts.locale === 'en';
  const name = (he: string, nameEn?: string | null) =>
    en && nameEn ? { label: nameEn, secondary: he } : { label: he, secondary: undefined };
  const out: PaletteItem[] = [];
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
