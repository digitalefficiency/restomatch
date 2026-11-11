import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { nav } from '@/lib/i18n/messages/nav';

/** Pay-run shaped skeleton: header, filter, two tiles, one bucket table (no layout jump). */
export default async function Loading() {
  const t = await getT(nav);
  return (
    <div role="status" aria-label={t('loading')} data-testid="payrun-loading">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="mb-6 h-10 w-72" />
      <div className="hidden grid-cols-2 gap-4 sm:grid">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="mt-8 h-64" />
    </div>
  );
}
