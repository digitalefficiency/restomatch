import { Skeleton } from '@/lib/components';

export default function Loading() {
  return (
    <div role="status" aria-label="טוען">
      <div className="mb-6 space-y-2">
        <div className="h-0.5 w-10 rounded-full bg-stone-200" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  );
}
