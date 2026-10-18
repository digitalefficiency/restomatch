/**
 * Dashboard view state ⇄ URL searchParams. Pure and isomorphic: server pages
 * parse it to render, client controls serialize it to navigate, so every view
 * is shareable and server-rendered. Unknown / malformed values fall back to the
 * defaults (the server re-validates with zod before anything reaches SQL).
 *
 *   p      period      this_month | last_month | quarter | ytd | last_12m | custom
 *   from   YYYY-MM-DD  (custom)          to   YYYY-MM-DD (custom)
 *   cmp    compare     off | prev | yoy
 *   g      group-by    supplier | category | product | type
 *   chart  chart type  bar | line | table
 *   d      density     comfortable | compact
 *   tv     TV mode     1
 *   sup, cat, type, sev, st   comma-separated filters
 */

export const PERIODS = ['this_month', 'last_month', 'quarter', 'ytd', 'last_12m', 'custom'] as const;
export const COMPARES = ['off', 'prev', 'yoy'] as const;
export const GROUPS = ['supplier', 'category', 'product', 'type'] as const;
export const CHARTS = ['bar', 'line', 'table'] as const;
export const DENSITIES = ['comfortable', 'compact'] as const;
export const DISCREPANCY_TYPES = [
  'PRICE_HIGHER',
  'PRICE_LOWER',
  'QTY_SHORT',
  'QTY_OVER',
  'UNORDERED_ITEM',
  'MISSING_ON_INVOICE',
  'UNIT_MISMATCH',
  'UNORDERED_ARRIVAL',
  'DUPLICATE_INVOICE',
  'DATE_ANOMALY',
  'VAT_MISMATCH',
  'TOTAL_MISMATCH',
] as const;
export const SEVERITIES = ['warn', 'block'] as const;
export const STATUSES = ['open', 'escalated', 'accepted', 'rejected', 'resolved'] as const;

export type Period = (typeof PERIODS)[number];
export type Compare = (typeof COMPARES)[number];
export type Group = (typeof GROUPS)[number];
export type ChartType = (typeof CHARTS)[number];
export type Density = (typeof DENSITIES)[number];
export type DiscrepancyType = (typeof DISCREPANCY_TYPES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Status = (typeof STATUSES)[number];

export interface ViewFilters {
  supplierIds: string[];
  categories: string[];
  types: DiscrepancyType[];
  severities: Severity[];
  statuses: Status[];
}

export interface ViewState {
  period: Period;
  from?: string;
  to?: string;
  compare: Compare;
  group: Group;
  chart: ChartType;
  density: Density;
  tv: boolean;
  filters: ViewFilters;
}

export const DEFAULT_VIEW: ViewState = {
  period: 'this_month',
  compare: 'off',
  group: 'supplier',
  chart: 'bar',
  density: 'comfortable',
  tv: false,
  filters: { supplierIds: [], categories: [], types: [], severities: [], statuses: [] },
};

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIST = 50;

function get(sp: ParamSource, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

function oneOf<T extends string>(allowed: readonly T[], v: string | undefined, fallback: T): T {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function list<T extends string>(v: string | undefined, accept: (x: string) => x is T): T[] {
  if (!v) return [];
  const out: T[] = [];
  for (const raw of v.split(',')) {
    const x = raw.trim();
    if (x && accept(x) && !out.includes(x)) out.push(x);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

const isIn =
  <T extends string>(allowed: readonly T[]) =>
  (x: string): x is T =>
    (allowed as readonly string[]).includes(x);
const isUuid = (x: string): x is string => UUID_RE.test(x);
const isCategory = (x: string): x is string => x.length <= 100;

const validDate = (v: string | undefined): string | undefined =>
  v && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined;

/** Parse (and sanitize) a view from searchParams. */
export function parseView(sp: ParamSource): ViewState {
  let period = oneOf(PERIODS, get(sp, 'p'), DEFAULT_VIEW.period);
  let from = validDate(get(sp, 'from'));
  let to = validDate(get(sp, 'to'));
  if (period === 'custom') {
    if (!from || !to) period = DEFAULT_VIEW.period;
    else if (from > to) [from, to] = [to, from];
  }
  if (period !== 'custom') {
    from = undefined;
    to = undefined;
  }
  return {
    period,
    from,
    to,
    compare: oneOf(COMPARES, get(sp, 'cmp'), DEFAULT_VIEW.compare),
    group: oneOf(GROUPS, get(sp, 'g'), DEFAULT_VIEW.group),
    chart: oneOf(CHARTS, get(sp, 'chart'), DEFAULT_VIEW.chart),
    density: oneOf(DENSITIES, get(sp, 'd'), DEFAULT_VIEW.density),
    tv: get(sp, 'tv') === '1',
    filters: {
      supplierIds: list(get(sp, 'sup'), isUuid),
      categories: list(get(sp, 'cat'), isCategory),
      types: list(get(sp, 'type'), isIn(DISCREPANCY_TYPES)),
      severities: list(get(sp, 'sev'), isIn(SEVERITIES)),
      statuses: list(get(sp, 'st'), isIn(STATUSES)),
    },
  };
}

/** Serialize a view; defaults are omitted so the plain URL stays the default view. */
export function serializeView(v: ViewState, keep?: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  // Preserve unrelated params (e.g. lang) when given.
  if (keep) {
    for (const [k, val] of keep) {
      if (!VIEW_KEYS.has(k)) out.set(k, val);
    }
  }
  if (v.period !== DEFAULT_VIEW.period) out.set('p', v.period);
  if (v.period === 'custom' && v.from && v.to) {
    out.set('from', v.from);
    out.set('to', v.to);
  }
  if (v.compare !== DEFAULT_VIEW.compare) out.set('cmp', v.compare);
  if (v.group !== DEFAULT_VIEW.group) out.set('g', v.group);
  if (v.chart !== DEFAULT_VIEW.chart) out.set('chart', v.chart);
  if (v.density !== DEFAULT_VIEW.density) out.set('d', v.density);
  if (v.tv) out.set('tv', '1');
  const f = v.filters;
  if (f.supplierIds.length) out.set('sup', f.supplierIds.join(','));
  if (f.categories.length) out.set('cat', f.categories.join(','));
  if (f.types.length) out.set('type', f.types.join(','));
  if (f.severities.length) out.set('sev', f.severities.join(','));
  if (f.statuses.length) out.set('st', f.statuses.join(','));
  return out;
}

export const VIEW_KEYS = new Set(['p', 'from', 'to', 'cmp', 'g', 'chart', 'd', 'tv', 'sup', 'cat', 'type', 'sev', 'st']);

export function hasFilters(v: ViewState): boolean {
  const f = v.filters;
  return !!(f.supplierIds.length || f.categories.length || f.types.length || f.severities.length || f.statuses.length);
}

/** The default view renders the classic hero (this month, no compare, no filters). */
export function isDefaultData(v: ViewState): boolean {
  return v.period === 'this_month' && v.compare === 'off' && !hasFilters(v);
}

/** The tRPC `ViewInput` for this state (the server re-validates). */
export function toViewInput(v: ViewState): {
  period: Period;
  from?: string;
  to?: string;
  filters?: Partial<ViewFilters>;
} {
  const f = v.filters;
  const filters: Partial<ViewFilters> = {};
  if (f.supplierIds.length) filters.supplierIds = f.supplierIds;
  if (f.categories.length) filters.categories = f.categories;
  if (f.types.length) filters.types = f.types;
  if (f.severities.length) filters.severities = f.severities;
  if (f.statuses.length) filters.statuses = f.statuses;
  return {
    period: v.period,
    ...(v.period === 'custom' ? { from: v.from, to: v.to } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
  };
}

/** Relative change; null when there is nothing to compare against. */
export function delta(current: number, previous: number | null | undefined): { pct: number | null; diff: number } | null {
  if (previous == null) return null;
  const diff = current - previous;
  return { diff, pct: previous === 0 ? null : diff / Math.abs(previous) };
}
