import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { nav } from '@/lib/i18n/messages/nav';

/** Layout-true inbox skeleton: header, tabs, message cards. */
export default async function Loading() {
  const t = await getT(nav);
  return (
    <div role="status" aria-label={t('loading')}>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 flex gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-28" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
