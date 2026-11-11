/**
 * Frecency recents for the palette (W3-04): what the viewer opened, ranked by
 * count × recency (half-life 7 days). Local to the browser, so the palette at
 * 0 characters needs no network. Storage is wrapped: private mode or a full
 * quota just means no recents.
 */
import type { PaletteItem } from './sections';

export interface RecentEntry {
  kind: PaletteItem['kind'];
  id: string;
  label: string;
  secondary?: string;
  href: string;
  count: number;
  /** Last opened, ms since epoch. */
  last: number;
}

export const RECENTS_KEY = 'rm.palette.recents.v1';
export const RECENTS_MAX = 30;
const HALF_LIFE_MS = 7 * 24 * 3600 * 1000;

export function frecencyScore(e: RecentEntry, now: number): number {
  return e.count * Math.pow(0.5, Math.max(0, now - e.last) / HALF_LIFE_MS);
}

/** Add or bump one opened item; keeps at most `RECENTS_MAX`, lowest score dropped. */
export function recordVisit(
  list: readonly RecentEntry[],
  item: PaletteItem,
  now: number,
): RecentEntry[] {
  if (item.kind === 'ask' || item.kind === 'recent') return list.slice();
  const key = `${item.kind}:${item.id}`;
  const prev = list.find((e) => `${e.kind}:${e.id}` === key);
  const next: RecentEntry = {
    kind: item.kind,
    id: item.id,
    label: item.label,
    secondary: item.secondary,
    href: item.href,
    count: (prev?.count ?? 0) + 1,
    last: now,
  };
  const rest = list.filter((e) => `${e.kind}:${e.id}` !== key);
  return [next, ...rest]
    .sort((a, b) => frecencyScore(b, now) - frecencyScore(a, now))
    .slice(0, RECENTS_MAX);
}

/**
 * The recents section: top `limit` by score, filtered by `allow` (the caller
 * passes the role's route check, so a role change never shows a stale link).
 */
export function rankRecents(
  list: readonly RecentEntry[],
  now: number,
  allow: (href: string) => boolean,
  limit = 6,
): PaletteItem[] {
  return list
    .filter((e) => allow(e.href))
    .slice()
    .sort((a, b) => frecencyScore(b, now) - frecencyScore(a, now))
    .slice(0, limit)
    .map((e) => ({
      kind: 'recent' as const,
      id: `${e.kind}:${e.id}`,
      label: e.label,
      secondary: e.secondary,
      href: e.href,
    }));
}

export function loadRecents(storage: Pick<Storage, 'getItem'> | undefined): RecentEntry[] {
  try {
    const raw = storage?.getItem(RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentEntry =>
        !!e &&
        typeof e.id === 'string' &&
        typeof e.href === 'string' &&
        e.href.startsWith('/dashboard') &&
        typeof e.label === 'string' &&
        typeof e.count === 'number' &&
        typeof e.last === 'number',
    );
  } catch {
    return [];
  }
}

export function saveRecents(
  storage: Pick<Storage, 'setItem'> | undefined,
  list: readonly RecentEntry[],
): void {
  try {
    storage?.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota: no recents */
  }
}
