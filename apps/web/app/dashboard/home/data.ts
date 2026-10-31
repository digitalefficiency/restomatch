import { cache } from 'react';
import type { UserRole } from '@restomatch/db';
import { createServerCaller } from '@/lib/trpc/server';
import { enabledFeatures } from '@/lib/ingest/features';

/**
 * Request-scoped loaders for the finance homes. `cache` dedupes a source read by
 * two cards (the VAT row in "מחכה לך" and the VAT card in the rail) into one call.
 */

const caller = () => createServerCaller();

export const loadFeatures = cache(async (restaurantId: string) => enabledFeatures(restaurantId));

export const loadRecoveryFlags = cache(async () => (await caller()).recovery.flags());

/** Items routed to the viewer (owner: everyone's), newest first; capped like the queue's first page. */
export const QUEUE_CAP = 100;
export const loadMyQueue = cache(async () => (await caller()).approvals.myQueue({ limit: QUEUE_CAP }));

export const loadVatAtRisk = cache(async (restaurantId: string, role: UserRole) => {
  if (role !== 'owner' && role !== 'manager' && role !== 'bookkeeper') return null;
  if (!(await loadFeatures(restaurantId)).includes('vatAtRisk')) return null;
  return (await caller()).owner.vatAtRisk({ period: 'open' });
});

export const loadRecoverySummary = cache(async () => {
  if (!(await loadRecoveryFlags()).recovery) return null;
  return (await caller()).recovery.summary();
});

export const loadPayRun = cache(async () => {
  const c = await caller();
  if (!(await c.payRun.enabled())) return null;
  return c.payRun.month();
});

export const loadToday = cache(async () => (await caller()).receiving.todayExpectations({ includeLate: true }));

export const loadOpenCount = cache(async () => {
  const c = await caller();
  if (!(await c.inventory.enabled()).enabled) return null;
  return c.inventory.current();
});

export const loadSuppliers = cache(async () => (await caller()).suppliers.list());

/** Σ |Δ| of the queue, like the approvals summary strip ("סכום בסיכון"); PRICE_LOWER is never at risk. */
export function queueAtRisk(items: readonly { type: string; deltaAmount: string | number | null; severity: string }[]) {
  let agorot = 0;
  let blocking = 0;
  for (const d of items) {
    if (d.type !== 'PRICE_LOWER') agorot += Math.round(Math.abs(Number(d.deltaAmount ?? 0)) * 100);
    if (d.severity === 'block') blocking += 1;
  }
  return { count: items.length, atRiskIls: agorot / 100, blocking };
}

/** The leak trend for a view (keyed by its serialized input), shared by the toolbar CSV and the trend card. */
export const loadTrend = cache(async (viewInputJson: string, compare: 'off' | 'prev' | 'yoy') =>
  (await caller()).owner.leakTrend({ view: JSON.parse(viewInputJson), compare }),
);

/**
 * The hero's figures for a view (current) and the same day-span before it (aligned.previous).
 * The default view keeps owner.leakHero as the current figure (the number every other page repeats).
 */
export const loadHeroPair = cache(async (viewInputJson: string, compare: 'prev' | 'yoy', isDefault: boolean) => {
  const c = await caller();
  const view = JSON.parse(viewInputJson);
  const [current, aligned] = await Promise.all([
    isDefault ? c.owner.leakHero() : c.owner.leakSummary({ view, compare }).then((s) => s.current),
    c.owner.leakSummary({ view, compare }),
  ]);
  return { current, previous: aligned.previous };
});
