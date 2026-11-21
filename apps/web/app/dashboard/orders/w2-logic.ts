/**
 * W2-06 pure logic (unit-tested in __tests__/w2-06-logic.test.ts): cut-off chip
 * thresholds, day groups for the phone list, the order guide's fill/undo, and
 * Σ over the visible rows.
 */

/** ≤ 3 h → warn; ≤ 30 min → danger (the only T2 on the board); passed → closed. */
export const CUTOFF_WARN_MS = 3 * 60 * 60 * 1000;
export const CUTOFF_DANGER_MS = 30 * 60 * 1000;

export type CutoffTone = 'danger' | 'warn' | 'neutral' | 'closed';

export function cutoffTone(cutoffAt: string | Date | null | undefined, now: Date = new Date()): CutoffTone | null {
  if (!cutoffAt) return null;
  const left = new Date(cutoffAt).getTime() - now.getTime();
  if (left < 0) return 'closed';
  if (left <= CUTOFF_DANGER_MS) return 'danger';
  if (left <= CUTOFF_WARN_MS) return 'warn';
  return 'neutral';
}

/** "2:15" — hours:minutes left (minutes floored; never negative). */
export function countdown(cutoffAt: string | Date, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((new Date(cutoffAt).getTime() - now.getTime()) / 60_000));
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

/** The restaurant-local calendar day 'YYYY-MM-DD' of an instant. */
export function dayKey(at: string | Date, tz = 'Asia/Jerusalem'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(at),
  );
}

export type DayGroup = 'past' | 'today' | 'tomorrow' | 'week' | 'later';

/** Phone list groups: היום / מחר / השבוע (the next 7 days) / בהמשך, and קודם for the past. */
export function dayGroupOf(at: string | Date | null | undefined, now: Date = new Date(), tz = 'Asia/Jerusalem'): DayGroup {
  if (!at) return 'later';
  const d = dayKey(at, tz);
  const today = dayKey(now, tz);
  if (d < today) return 'past';
  if (d === today) return 'today';
  const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 1) return 'tomorrow';
  if (diff <= 7) return 'week';
  return 'later';
}

export const DAY_GROUP_ORDER: DayGroup[] = ['today', 'tomorrow', 'week', 'later', 'past'];

export function groupByDay<T>(rows: T[], at: (r: T) => string | Date | null | undefined, now = new Date(), tz?: string) {
  const out = new Map<DayGroup, T[]>();
  for (const r of rows) {
    const g = dayGroupOf(at(r), now, tz);
    out.set(g, [...(out.get(g) ?? []), r]);
  }
  return DAY_GROUP_ORDER.filter((g) => out.has(g)).map((g) => ({ group: g, rows: out.get(g)! }));
}

/** Σ of the visible rows' totals, in integer agorot (unknown totals are skipped, never ₪0). */
export function sumVisibleAgorot(rows: Array<{ totalEstimated?: string | number | null }>): { agorot: number; counted: number } {
  let agorot = 0;
  let counted = 0;
  for (const r of rows) {
    if (r.totalEstimated == null || r.totalEstimated === '') continue;
    const n = Number(r.totalEstimated);
    if (!Number.isFinite(n)) continue;
    agorot += Math.round(n * 100);
    counted += 1;
  }
  return { agorot, counted };
}

/** A guide row as the wizard consumes it (subset of orders.orderGuide rows). */
export interface GuideItem {
  key: string;
  productId: string | null;
  name: string;
  nameEn: string | null;
  unit: string;
  usualQty: number;
  lastQty: number;
  unitPrice?: number | null;
}

export interface GuideLine {
  key: string;
  productId?: string;
  rawDescription: string;
  nameEn?: string | null;
  qty: number;
  unit: string;
  unitPriceExpected?: number;
}

const sameItem = (l: GuideLine, g: GuideItem) =>
  g.productId ? l.productId === g.productId : !l.productId && l.rawDescription.trim() === g.name.trim();

/** Set one guide item's qty: updates its line, or adds it. qty 0 removes it. Never invents a qty. */
export function setGuideQty<L extends GuideLine>(lines: L[], g: GuideItem, qty: number, makeKey: () => string): L[] {
  const idx = lines.findIndex((l) => sameItem(l, g));
  if (qty <= 0) return idx < 0 ? lines : lines.filter((_, i) => i !== idx);
  if (idx >= 0) return lines.map((l, i) => (i === idx ? { ...l, qty } : l));
  return [
    ...lines,
    {
      key: makeKey(),
      productId: g.productId ?? undefined,
      rawDescription: g.name,
      nameEn: g.nameEn,
      qty,
      unit: g.unit,
      unitPriceExpected: g.unitPrice ?? undefined,
    } as L,
  ];
}

/**
 * "כמו בפעם הקודמת": every guide item gets its last qty, except items the user
 * already set (their qty stands). Returns the new lines and the snapshot for undo.
 */
export function fillLikeLastTime<L extends GuideLine>(
  lines: L[],
  guide: GuideItem[],
  makeKey: () => string,
): { lines: L[]; undo: L[]; filled: number } {
  let next = lines;
  let filled = 0;
  for (const g of guide) {
    const cur = next.find((l) => sameItem(l, g));
    if (cur && cur.qty > 0) continue;
    if (!(g.lastQty > 0)) continue;
    next = setGuideQty(next, g, g.lastQty, makeKey);
    filled += 1;
  }
  return { lines: next, undo: lines, filled };
}

/** The qty a guide item currently has in the cart (0 = not ordered yet → the ghost shows). */
export function guideQtyOf(lines: GuideLine[], g: GuideItem): number {
  return lines.find((l) => sameItem(l, g))?.qty ?? 0;
}

/** wa.me must open INSIDE the tap (iOS blocks window.open after an await): the text is already in memory. */
export function openWhatsappNow(url: string, open: (u: string) => Window | null = (u) => window.open(u, '_blank')): boolean {
  const w = open(url);
  return w !== null;
}
