import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { receiving } from '@/lib/i18n/messages/receiving';

export default async function Loading() {
  const t = await getT(receiving);
  return (
    <div role="status" aria-label={t('loading')}>
      <div className="mb-6 space-y-2">
        <div className="h-0.5 w-10 rounded-full flow-stream" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  );
}
