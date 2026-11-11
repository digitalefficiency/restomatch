import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { nav } from '@/lib/i18n/messages/nav';
import { QueueSkeleton } from './queue-panel';

/** Layout-true loading state for /dashboard/contracts: title, tab strip, queue. */
export default async function ContractsLoading() {
  const t = await getT(nav);
  return (
    <div role="status" aria-label={t('loading')}>
      <Skeleton className="mb-2 h-8 w-64" />
      <Skeleton className="mb-6 h-4 w-96 max-w-full" />
      <div className="mb-6 flex gap-2 border-b border-line pb-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-20" />
      </div>
      <QueueSkeleton />
    </div>
  );
}
