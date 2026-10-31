import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';

/** Layout-true wizard skeleton: task bar, title, supplier rows. */
export default async function Loading() {
  const t = await getT(ordersNs);
  return (
    <div role="status" aria-label={t('reorder.loading')} className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-4 h-4 w-72 max-w-full" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    </div>
  );
}
