import { cache } from 'react';
import type { UserRole } from '@restomatch/db';
import { createServerCaller } from '@/lib/trpc/server';
import { enabledFeatures } from '@/lib/ingest/features';
import { db } from '@/lib/db';
import { decideSummary } from './queue-summary';

/**
 * Request-scoped loaders for the finance homes. `cache` dedupes a source read by
 * two cards (the VAT row in "מחכה לך" and the VAT card in the rail) into one call.
 */

const caller = () => createServerCaller();

export const loadFeatures = cache(async (restaurantId: string) => enabledFeatures(restaurantId));

export const loadRecoveryFlags = cache(async () => (await caller()).recovery.flags());

/**
 * The viewer's whole decision queue (owner: everyone's) in ₪ and count — one SQL
 * aggregate under the restaurant GUC, see queue-summary.ts.
 * TODO(W2-08): switch to approvals.queueSummary.
 */
export const loadDecide = cache(async (restaurantId: string, role: UserRole) => decideSummary(db, restaurantId, role));

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
