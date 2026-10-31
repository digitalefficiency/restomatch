import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { leaks } from '@/lib/i18n/messages/leaks';

/**
 * Layout-true skeleton of the proof sheet (title, the T1 card, the top catches).
 * Only here: a route-level loading.tsx above a page with same-route soft
 * navigations (the view bar, month links) stalls them in production builds —
 * scripts/check-soft-nav.mjs — so the hub, breakdown, claims and report have none.
 */
export default async function Loading() {
  const t = await getT(leaks);
  return (
    <div role="status" aria-label={t('hub.loadingLabel')} className="mx-auto max-w-3xl" data-testid="leaks-loading">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="mb-6 h-56 w-full" />
      <Skeleton className="mb-6 h-20 w-full" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
