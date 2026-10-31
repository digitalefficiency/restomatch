import type { Density, SortSpec } from './types';
import { DENSITIES } from './types';

/**
 * DataTable state ⇄ URL (lens-exec-desktop §3.8). Pure and isomorphic, like
 * `views/state.ts`; unknown or malformed values fall back to the defaults.
 *
 *   sort  col:asc|desc       cols  visible column ids, comma-separated, in order
 *   sel   selected row id    peek  peeked row id
 *   view  built-in view id   page  1-based page        d  density override
 *
 * Keys a table does not own are left untouched, so a table sits beside
 * `views/state.ts` params (p, cmp, sup…) on the same URL.
 */

export interface TableUrlState {
  sort: SortSpec | null;
  cols: string[] | null;
  sel: string | null;
  peek: string | null;
  view: string | null;
  page: number;
  density: Density | null;
}

export const TABLE_URL_KEYS = ['sort', 'cols', 'sel', 'peek', 'view', 'page', 'd'] as const;

export const EMPTY_TABLE_STATE: TableUrlState = {
  sort: null,
  cols: null,
  sel: null,
  peek: null,
  view: null,
  page: 1,
  density: null,
};

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

function read(src: ParamSource, key: string): string | undefined {
  if (src instanceof URLSearchParams) return src.get(key) ?? undefined;
  const v = src[key];
  return Array.isArray(v) ? v[0] : v;
}

function id(v: string | undefined): string | null {
  return v && ID_RE.test(v) ? v : null;
}

export function parseSort(v: string | undefined): SortSpec | null {
  if (!v) return null;
  const [col, dir] = v.split(':');
  if (!id(col) || (dir !== 'asc' && dir !== 'desc')) return null;
  return { id: col!, desc: dir === 'desc' };
}

export function parseTableState(src: ParamSource): TableUrlState {
  const cols = read(src, 'cols');
  const page = Number(read(src, 'page'));
  const d = read(src, 'd');
  return {
    sort: parseSort(read(src, 'sort')),
    cols: cols ? cols.split(',').filter((c) => ID_RE.test(c)) : null,
    sel: id(read(src, 'sel')),
    peek: id(read(src, 'peek')),
    view: id(read(src, 'view')),
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
    density: d && (DENSITIES as readonly string[]).includes(d) ? (d as Density) : null,
  };
}

/** Writes the table keys onto `base` (other params kept); defaults are omitted. */
export function writeTableState(state: TableUrlState, base?: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base);
  for (const k of TABLE_URL_KEYS) out.delete(k);
  if (state.sort) out.set('sort', `${state.sort.id}:${state.sort.desc ? 'desc' : 'asc'}`);
  if (state.cols) out.set('cols', state.cols.join(','));
  if (state.sel) out.set('sel', state.sel);
  if (state.peek) out.set('peek', state.peek);
  if (state.view) out.set('view', state.view);
  if (state.page > 1) out.set('page', String(state.page));
  if (state.density) out.set('d', state.density);
  return out;
}
