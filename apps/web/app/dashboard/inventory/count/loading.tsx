import { Skeleton } from '@/lib/components';

/** Layout-true loading for the count: the sticky top (date chip, search, area chips), lines, and the pinned bar. */
export default function Loading() {
  return (
    <div data-mode="field" aria-busy="true" data-testid="count-loading">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-12 w-24" />
        <Skeleton className="h-12 w-44" />
      </div>
      <Skeleton className="mt-1 h-7 w-32" />
      <Skeleton className="mt-2 h-12 w-full" />
      <div className="mt-2 flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-28 rounded-full" />
        ))}
      </div>
      <Skeleton className="mt-3 h-10 w-full" />
      <div className="mt-2 space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-card" />
        ))}
      </div>
    </div>
  );
}
