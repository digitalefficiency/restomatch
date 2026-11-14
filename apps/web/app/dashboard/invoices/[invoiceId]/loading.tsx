import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { nav } from '@/lib/i18n/messages/nav';

/** Layout-true cockpit skeleton: back link, title, chain, then document | lines (44/56). */
export default async function Loading() {
  const t = await getT(nav);
  return (
    <div role="status" aria-label={t('loading')}>
      <Skeleton className="mb-3 h-4 w-24" />
      <div className="mb-4 space-y-2">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-5 w-96 max-w-full" />
        <Skeleton className="h-8 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[44fr_56fr]">
        <Skeleton className="hidden h-[70dvh] lg:block" />
        <div className="space-y-2">
          <Skeleton className="h-10 w-full lg:hidden" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
