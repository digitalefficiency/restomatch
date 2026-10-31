import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';

/** Layout-true detail skeleton: crumb, title, object header, five lines. */
export default async function Loading() {
  const t = await getT(ordersNs);
  return (
    <div role="status" aria-label={t('list.loading')}>
      <Skeleton className="mb-3 h-4 w-40" />
      <Skeleton className="mb-6 h-8 w-64 max-w-full" />
      <Skeleton className="mb-6 h-40" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    </div>
  );
}
