import { Skeleton } from '@/lib/components';

/** Layout-true loading for /dashboard/inventory: header, the count card, the period card, three history rows. */
export default function Loading() {
  return (
    <div aria-busy="true" data-testid="inventory-loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 space-y-6">
        <Skeleton className="h-[4.5rem] w-full rounded-card" />
        <Skeleton className="h-48 w-full rounded-card" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
