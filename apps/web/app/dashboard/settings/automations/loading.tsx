import { Skeleton } from '@/lib/components';
import { settings } from '@/lib/i18n/messages/settings';
import { getT } from '@/lib/i18n/server';

export default async function Loading() {
  const t = await getT(settings);
  return (
    <div role="status" aria-label={t('loading')}>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  );
}
