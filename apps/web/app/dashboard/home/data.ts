import { cache } from 'react';
import type { UserRole } from '@restomatch/db';
import { createServerCaller } from '@/lib/trpc/server';
import { enabledFeatures } from '@/lib/ingest/features';
import { ALL_CLAIMS } from '../recovery/logic';
import { decideNeed } from './queue-summary';

/**
 * Request-scoped loaders for the finance homes. `cache` dedupes a source read by
 * two cards (the VAT row in "מחכה לך" and the VAT card in the rail) into one call.
 */

const caller = () => createServerCaller();

export const loadFeatures = cache(async (restaurantId: string) => enabledFeatures(restaurantId));

export const loadRecoveryFlags = cache(async () => (await caller()).recovery.flags());

/** The viewer's decision queue, exactly as the approvals tiles show it (approvals.queueSummary). */
export const loadDecide = cache(async () => decideNeed(await (await caller()).approvals.queueSummary()));

export const loadVatAtRisk = cache(async (restaurantId: string, role: UserRole) => {
  if (role !== 'owner' && role !== 'manager' && role !== 'bookkeeper') return null;
  if (!(await loadFeatures(restaurantId)).includes('vatAtRisk')) return null;
  return (await caller()).owner.vatAtRisk({ period: 'open' });
});

/** Every claim, as the recovery page reads them, for its follow-up queues (recovery/logic followUps). */
export const loadRecoveryClaims = cache(async () => {
  if (!(await loadRecoveryFlags()).recovery) return null;
  return (await caller()).recovery.list({ limit: ALL_CLAIMS });
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

/** PILOT (W2-02): invoices waiting for a person to complete their lines. */
export const loadNeedsLines = cache(async () => (await caller()).invoices.needsLines());

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
