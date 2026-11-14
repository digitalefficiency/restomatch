import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { formatIls } from '@/lib/money';
import type { Locale } from '@/lib/i18n/config';
import { formatNumber } from '@/lib/i18n/format';

/**
 * Pure model of the W2-08 nav badges and bell (unit-tested, no React). The
 * figures come from the server task spine (`nav.badges`, `tasks.mine`): this
 * file only decides how they read.
 */
type Out = inferRouterOutputs<AppRouter>;
export type Task = Out['tasks']['mine']['tasks'][number];
export type ServerBadges = Out['nav']['badges']['badges'];
export type NavBadgeValue = NonNullable<ServerBadges[keyof ServerBadges]>;
/** Route key → badge value (what the sidebar, the bottom bar and "עוד" read). */
export type NavBadges = Partial<Record<string, NavBadgeValue>>;

/** Server badge keys → registry route keys (`routeBadgeMap()` from lib/nav). */
export function toRouteBadges(server: ServerBadges | undefined, routeMap: Record<string, string>): NavBadges {
  const out: NavBadges = {};
  if (!server) return out;
  for (const [routeKey, badgeKey] of Object.entries(routeMap)) {
    const b = (server as Record<string, NavBadgeValue | undefined>)[badgeKey];
    if (b && b.count > 0) out[routeKey] = b;
  }
  return out;
}

/** "99+" past 99 (he-IL numerals). */
export function cappedCount(count: number, locale: Locale): string {
  return count > 99 ? `${formatNumber(99, locale)}+` : formatNumber(count, locale);
}

export interface BadgeWords {
  items: (count: string) => string;
  atRisk: (amount: string) => string;
  /** Claims: the recovery page's "זיכויים פתוחים" figure. */
  owed: (amount: string) => string;
  /** Link (W3-10): spend not price-checked yet: neither at risk nor owed. */
  unchecked: (amount: string) => string;
  blocking: string;
}

/** "אישורים, 4 פריטים, ‏296 ₪ בסיכון" — the link's accessible name with its badge. */
export function badgeAria(label: string, b: NavBadgeValue | undefined, locale: Locale, w: BadgeWords): string {
  if (!b || b.count <= 0) return label;
  const parts = [label, w.items(cappedCount(b.count, locale))];
  if (b.ilsAgorot !== null && b.ilsAgorot > 0) {
    const amount = formatIls(b.ilsAgorot / 100, { locale });
    parts.push(b.money === 'owed' ? w.owed(amount) : b.money === 'unchecked' ? w.unchecked(amount) : w.atRisk(amount));
  }
  if (b.block) parts.push(w.blocking);
  return parts.join(', ');
}

/* ───────────── bell seen-state (localStorage, best-effort) ───────────── */

export const SEEN_KEY = 'rm.bell.seen.v1';

/** What makes a task "new again": its id plus its count and ₪ (a grown queue is news). */
export function taskSig(t: Pick<Task, 'entityId' | 'count' | 'ilsAgorot'>): string {
  return `${t.entityId}:${t.count}:${t.ilsAgorot ?? '-'}`;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** The seen set; any storage error (private mode, blocked, throwing) reads as "nothing seen". */
export function readSeen(storage: StorageLike | null | undefined): Set<string> {
  try {
    const raw = storage?.getItem(SEEN_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeSeen(storage: StorageLike | null | undefined, sigs: Iterable<string>): void {
  try {
    storage?.setItem(SEEN_KEY, JSON.stringify([...sigs].slice(-200)));
  } catch {
    /* the bell works without storage */
  }
}

/** My tasks the viewer has not seen in their current shape. */
export function unseenCount(tasks: readonly Pick<Task, 'entityId' | 'count' | 'ilsAgorot' | 'scope'>[], seen: ReadonlySet<string>): number {
  return tasks.filter((t) => t.scope === 'mine' && !seen.has(taskSig(t))).length;
}
