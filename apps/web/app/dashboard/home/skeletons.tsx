import { Skeleton } from '@/lib/components';

/** Layout-true placeholders: same boxes, same heights as the cards they stand for (no jump). */

export function HeroSkeleton() {
  return <Skeleton className="h-[17.5rem] rounded-2xl lg:h-60" />;
}

export function NeedsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 lg:h-[5.5rem]" />
      ))}
    </div>
  );
}

export function CardSkeleton({ className = 'h-40' }: { className?: string }) {
  return <Skeleton className={`rounded-2xl ${className}`} />;
}

export function BoardSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-12" />
      <Skeleton className="h-44 rounded-2xl" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  );
}
