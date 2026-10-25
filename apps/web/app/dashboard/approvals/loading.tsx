import { Skeleton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { overview } from '@/lib/i18n/messages/overview';

/**
 * Layout-true skeleton (approvals-19): the same header, the phone summary line /
 * desktop 4 tiles, and decision cards at the real card height with the 50/50
 * 48 px button row — so nothing jumps when the queue paints.
 */
export default async function Loading() {
  const t = await getT(overview);
  return (
    <div role="status" aria-label={t('loading')} data-testid="approvals-loading">
      <div className="mb-6 space-y-2">
        <div className="h-0.5 w-10 rounded-full flow-stream" />
        <Skeleton className="h-8 w-44" />
      </div>
      <Skeleton className="mb-3 h-12 w-40 rounded-full sm:hidden" />
      <Skeleton className="mb-4 h-5 w-64 sm:hidden" />
      <div className="mb-5 hidden gap-3 sm:grid sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px]" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-4 ps-5">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-56" />
              </div>
              <Skeleton className="h-12 w-12 sm:h-10 sm:w-10" />
            </div>
            <Skeleton className="mt-3 h-7 w-40" />
            <Skeleton className="mt-2 h-10 w-full sm:h-6" />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
              <Skeleton className="h-12 sm:w-44" />
              <Skeleton className="h-12 sm:w-44" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
