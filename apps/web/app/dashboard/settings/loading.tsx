import { Skeleton } from '@/lib/components';
import { settings } from '@/lib/i18n/messages/settings';
import { getT } from '@/lib/i18n/server';

/** A section loading inside the settings frame (the title, search and section list stay in place). */
export default async function Loading() {
  const t = await getT(settings);
  return (
    <div role="status" aria-label={t('loading')}>
      <div className="mb-4 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
