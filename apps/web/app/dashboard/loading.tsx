import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { nav } from '@/lib/i18n/messages/nav';

export default async function Loading() {
  const t = await getT(nav);
  return (
    <div role="status" aria-label={t('loading')}>
      <div className="mb-6 space-y-2">
        <div className="h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    </div>
  );
}
