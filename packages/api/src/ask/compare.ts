/**
 * G-12b — the ONE leak comparison Ask uses (the `leak_change` tool and the
 * offline `leakChange` answer). Like for like: this month from the 1st to today
 * against the same days of the previous month, in the restaurant's time zone —
 * never a partial month against a full one. Both spans and their coverage ship
 * with the delta, plus the span label the answer must quote.
 *
 * INTERIM(W2-09): the windows are computed here and passed to charts as custom
 * spans (charts' own 'prev' shift cuts 30.10 at 1–29.09). Swap to
 * `computeLeakComparison` / `resolveWindow` when W2-09 lands.
 */
import { computeLeakGrouped, computeLeakSummary } from '@restomatch/charts';
import type { Database } from '@restomatch/db';
import {
  alignedWindows,
  comparisonLabel,
  restaurantTimezone,
  spanLabel,
  type Period,
} from './periods';
import { clip } from './tools';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface LeakComparison {
  cur: Period & { leakIls: number };
  prev: Period & { leakIls: number };
  deltaIls: number;
  /** "1–25 באוק׳ מול 1–25 בספט׳" (he) — the answer must name it. */
  spanLabel: string;
  curSpanLabel: string;
  prevSpanLabel: string;
  topSupplier: { id: string | null; name: string | null; deltaIls: number } | null;
  topType: { type: string; deltaIls: number } | null;
}

export async function leakComparison(
  db: Database,
  restaurantId: string,
  now: Date,
  locale: 'he' | 'en',
  monthOffset = 0,
): Promise<LeakComparison> {
  const tz = await restaurantTimezone(db, restaurantId);
  const w = alignedWindows(now, tz, monthOffset);
  const spec = (p: Period) => ({ period: 'custom' as const, from: p.from, to: p.through, now });
  const [curH, prevH, curSup, prevSup, curType, prevType] = await Promise.all([
    computeLeakSummary(db, restaurantId, spec(w.cur)),
    computeLeakSummary(db, restaurantId, spec(w.prev)),
    computeLeakGrouped(db, restaurantId, spec(w.cur), 'supplier', 'off', 200),
    computeLeakGrouped(db, restaurantId, spec(w.prev), 'supplier', 'off', 200),
    computeLeakGrouped(db, restaurantId, spec(w.cur), 'type', 'off', 200),
    computeLeakGrouped(db, restaurantId, spec(w.prev), 'type', 'off', 200),
  ]);
  // Biggest movers over the FULL lists (a supplier outside last month's top 8 is not "new").
  const supName = (r: { label: string | null; labelEn: string | null }) =>
    clip(locale === 'en' ? (r.labelEn ?? r.label) : (r.label ?? r.labelEn));
  const sup = new Map<string, { name: string | null; id: string | null; delta: number }>();
  for (const r of curSup)
    sup.set(r.key || '?', { name: supName(r), id: r.key || null, delta: r.leakIls });
  for (const r of prevSup) {
    const e = sup.get(r.key || '?') ?? { name: supName(r), id: r.key || null, delta: 0 };
    e.delta -= r.leakIls;
    sup.set(r.key || '?', e);
  }
  const types = new Map<string, number>();
  for (const r of curType) types.set(r.key, (types.get(r.key) ?? 0) + r.leakIls);
  for (const r of prevType) types.set(r.key, (types.get(r.key) ?? 0) - r.leakIls);
  const topSup = [...sup.values()].sort((a, b) => b.delta - a.delta)[0];
  const topType = [...types.entries()].sort((a, b) => b[1] - a[1])[0];

  // Agorot inside: the delta is exact to the agora.
  const curA = Math.round(curH.leakIls * 100);
  const prevA = Math.round(prevH.leakIls * 100);
  return {
    cur: { ...w.cur, leakIls: curA / 100 },
    prev: { ...w.prev, leakIls: prevA / 100 },
    deltaIls: (curA - prevA) / 100,
    spanLabel: comparisonLabel(w.cur, w.prev, locale),
    curSpanLabel: spanLabel(w.cur, locale),
    prevSpanLabel: spanLabel(w.prev, locale),
    topSupplier:
      topSup && topSup.delta > 0
        ? { id: topSup.id, name: topSup.name, deltaIls: r2(topSup.delta) }
        : null,
    topType: topType && topType[1] > 0 ? { type: topType[0], deltaIls: r2(topType[1]) } : null,
  };
}
