import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';

/** Layout-true list skeleton: header, search, filter chips, rows. */
export default async function Loading() {
  const t = await getT(ordersNs);
  return (
    <div role="status" aria-label={t('list.loading')}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>
      <Skeleton className="mb-4 h-12 w-full max-w-md" />
      <div className="mb-4 flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-16" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    </div>
  );
}
