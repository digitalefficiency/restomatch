import 'server-only';
import { cache } from 'react';
import { createServerCaller } from '@/lib/trpc/server';
import { loadSupplierLeakCard } from './leak-card-data';

type Caller = Awaited<ReturnType<typeof createServerCaller>>;
export type SupplierOverview = Awaited<ReturnType<Caller['suppliers']['overview']>>;

/**
 * W2-11 · ONE load of `suppliers.overview` per request, shared by the header
 * (layout) and the overview tab, so both show the same 90-day ₪. Finance
 * roles only; null when the caller can't read it or it failed (the UI then
 * says "unavailable" — never ₪0).
 */
export const loadSupplierOverview = cache(async (supplierId: string): Promise<SupplierOverview | null> => {
  try {
    const caller = await createServerCaller();
    return await caller.suppliers.overview({ supplierId });
  } catch {
    return null;
  }
});

/**
 * The leak card (W2-09's loader, consumed read-only), loaded once per request:
 * the overview's "open to claim" card names the card's letter ₪ — the claims
 * page's own model — and the leak card under the overview reuses this load.
 */
export const loadLeakCardOnce = cache((supplierId: string) => loadSupplierLeakCard(supplierId));
