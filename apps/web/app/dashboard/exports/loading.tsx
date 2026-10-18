import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { nav } from '@/lib/i18n/messages/nav';

export default async function Loading() {
  const t = await getT(nav);
  return (
    <div role="status" aria-label={t('loading')}>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-56 max-w-2xl" />
    </div>
  );
}
