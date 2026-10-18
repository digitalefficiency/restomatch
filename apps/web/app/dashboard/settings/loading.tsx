import { Skeleton } from '@/lib/components';
import { settings } from '@/lib/i18n/messages/settings';
import { getT } from '@/lib/i18n/server';

export default async function Loading() {
  const t = await getT(settings);
  return (
    <div role="status" aria-label={t('loading')}>
      <div className="mb-6 space-y-2">
        <div className="h-0.5 w-10 rounded-full flow-stream" />
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    </div>
  );
}
