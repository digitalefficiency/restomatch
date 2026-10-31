import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { receiving } from '@/lib/i18n/messages/receiving';

/** Wizard-shaped (RCV-28): the list's card grid used to stand in for the Delivery Check. */
export default async function Loading() {
  const t = await getT(receiving);
  return (
    <div role="status" aria-label={t('loading')} className="mx-auto max-w-3xl px-1 py-2">
      <Skeleton className="mb-2 h-6 w-40" />
      <Skeleton className="mb-1 h-8 w-56" />
      <Skeleton className="mb-4 h-5 w-64" />
      <Skeleton className="mx-auto mb-4 h-[min(40vh,20rem)] max-w-md rounded-2xl" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
