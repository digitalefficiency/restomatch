'use client';

import type { ComponentProps } from 'react';
import { trpc } from '@/lib/trpc/client';
import type { ReconciliationLine } from '@/app/showcase/receiver/_mock';
import type { Reconciliation } from '@/app/showcase/receiver/_steps/Reconciliation';
import { DockPriceHint } from '../dock-price-hint';

/**
 * Flag `dockPriceContext` at the dock: a per-line renderer for the review step
 * that adds "your usual price" under PRICE-HIGHER lines (invoice price above
 * the order price). `undefined` when the flag is off or there is no invoice —
 * the review then renders exactly as before.
 *
 * Typed as Reconciliation's own `lineExtra` prop: that file types JSX through the
 * GLOBAL React namespace, which on a fresh install (shamefully-hoist → the root
 * @types/react is apps/mobile's 18.x) is not the module's React 19 `ReactNode`.
 */
type LineExtra = ComponentProps<typeof Reconciliation>['lineExtra'];

export function useDockPriceLineExtra(enabled: boolean, invoiceId: string | null): LineExtra {
  const q = trpc.receiving.priceContext.useQuery(
    { invoiceId: invoiceId ?? undefined },
    { enabled: enabled && !!invoiceId, staleTime: 60_000, retry: false },
  );
  if (!enabled || !invoiceId || !q.data?.enabled || q.data.lines.length === 0) return undefined;
  const byKey = new Map(q.data.lines.map((l) => [`${l.productId}|${l.unit}`, l]));
  return function lineExtra(line: ReconciliationLine) {
    if (line.status !== 'price_diff' || !line.productId || !line.invoiceUnit) return null;
    if (line.invoiceUnitPrice === null || line.poUnitPrice === null || line.invoiceUnitPrice <= line.poUnitPrice) {
      return null;
    }
    const ctx = byKey.get(`${line.productId}|${line.invoiceUnit}`);
    return ctx ? <DockPriceHint data={ctx} /> : null;
  };
}
