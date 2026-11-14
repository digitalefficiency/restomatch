import type { Database } from '@restomatch/db';
import { computeLeakGrouped, type ViewSpec } from './leak-views';
import { computeLeakComparison, type LeakComparison } from './period';

/**
 * W2-09c · what moved the leak (exec-desktop-19): the top contributors to the
 * change between the view's window and the same span before it, in agorot,
 * plus an "אחר" remainder so the chips always sum to the hero's Δ to the agora
 * (the remainder also absorbs the per-invoice cap, which group sums don't see).
 */

export const DRIVER_DIMENSIONS = ['supplier', 'product', 'type'] as const;
export type DriverDimension = (typeof DRIVER_DIMENSIONS)[number];

export interface LeakDriver {
  key: string;
  label: string | null;
  labelEn: string | null;
  currentAgorot: number;
  previousAgorot: number;
  /** current − previous (signed): up is worse. */
  deltaAgorot: number;
  /** Relative to the previous amount; null when it was 0. */
  deltaPct: number | null;
}

export interface LeakDrivers {
  by: DriverDimension;
  comparison: LeakComparison;
  drivers: LeakDriver[];
  /** Δ not explained by `drivers` (the rest, and the cap): Σ drivers + other = comparison.deltaAgorot. */
  otherAgorot: number;
}

const agorot = (ils: number) => Math.round(ils * 100);

export async function computeLeakDrivers(
  db: Database,
  restaurantId: string,
  view: ViewSpec,
  opts: { by?: DriverDimension; top?: number; tz?: string } = {},
): Promise<LeakDrivers> {
  const by = opts.by ?? 'supplier';
  const top = Math.min(Math.max(opts.top ?? 3, 1), 10);
  const spec = { ...view, now: view.now ?? new Date() };
  const [comparison, cur, prev] = await Promise.all([
    computeLeakComparison(db, restaurantId, spec, opts.tz),
    computeLeakGrouped(db, restaurantId, spec, by, 'off', 200),
    computeLeakGrouped(db, restaurantId, spec, by, 'prev', 200),
  ]);
  const map = new Map<string, LeakDriver>();
  const row = (key: string, label: string | null, labelEn: string | null) => {
    let d = map.get(key);
    if (!d) {
      d = { key, label, labelEn, currentAgorot: 0, previousAgorot: 0, deltaAgorot: 0, deltaPct: null };
      map.set(key, d);
    }
    d.label ??= label;
    d.labelEn ??= labelEn;
    return d;
  };
  for (const r of cur) row(r.key, r.label, r.labelEn).currentAgorot = agorot(r.leakIls);
  for (const r of prev) row(r.key, r.label, r.labelEn).previousAgorot = agorot(r.leakIls);
  const all = [...map.values()].map((d) => ({
    ...d,
    deltaAgorot: d.currentAgorot - d.previousAgorot,
    deltaPct: d.previousAgorot > 0 ? (d.currentAgorot - d.previousAgorot) / d.previousAgorot : null,
  }));
  const drivers = all
    .filter((d) => d.deltaAgorot !== 0)
    .sort((a, b) => Math.abs(b.deltaAgorot) - Math.abs(a.deltaAgorot) || a.key.localeCompare(b.key))
    .slice(0, top);
  const otherAgorot = comparison.deltaAgorot - drivers.reduce((s, d) => s + d.deltaAgorot, 0);
  return { by, comparison, drivers, otherAgorot };
}
