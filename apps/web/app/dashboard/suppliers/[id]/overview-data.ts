import 'server-only';
import { cache } from 'react';
import { createServerCaller } from '@/lib/trpc/server';

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
