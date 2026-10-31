import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { recovery } from '@/lib/i18n/messages/recovery';

/** Layout-true skeleton of the ₪-back tracker: the T1 + funnel card, the follow-ups, the claims list. */
export default async function Loading() {
  const t = await getT(recovery);
  return (
    <div role="status" aria-label={t('tracker.loading')} className="space-y-6" data-testid="recovery-loading">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
