import { Skeleton } from '@/lib/components';

export default function Loading() {
  return (
    <div role="status" aria-label="טוען">
      <div className="mb-6 space-y-2">
        <div className="h-0.5 w-10 rounded-full bg-stone-200" />
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    </div>
  );
}
