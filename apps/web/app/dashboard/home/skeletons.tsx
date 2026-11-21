import { Skeleton } from '@/lib/components';

/**
 * Layout-true placeholders: the same card, the same boxes and about the same heights as the
 * blocks they stand for, so nothing jumps when a block streams in. The shimmer bars appear only
 * when the wait passes one second (DS3 SPEC §9, `<Skeleton delayed>`); the card's frame holds the
 * space from the start. Decorative.
 */

const CARD = 'overflow-hidden rounded-card border border-line-rule bg-surface shadow-e1';

/** The leak card: label row · the number with the pace line beside it · the sentence and the change · the split · the foot. */
export function HeroSkeleton() {
  return (
    <div aria-hidden="true" data-testid="hero-skeleton" className={`${CARD} px-4 pt-4 sm:px-7 sm:pt-5`}>
      <Skeleton delayed className="h-5 w-40 rounded-control" />
      <div className="mt-2.5 flex flex-wrap items-end gap-x-6 gap-y-2 max-sm:flex-col max-sm:items-stretch">
        <Skeleton delayed className="h-11 w-36 rounded-control md:h-14 md:w-44" />
        <Skeleton delayed className="mb-3 h-20 rounded-control max-sm:max-w-md sm:ms-auto sm:w-64" />
      </div>
      <Skeleton delayed className="mt-1 h-5 w-72 max-w-full rounded-control" />
      <Skeleton delayed className="mt-2 h-4 w-56 max-w-full rounded-control" />
      <Skeleton delayed className="mt-5 h-3 w-full rounded-xs" />
      <div className="mt-2.5 grid grid-cols-2 gap-3">
        <Skeleton delayed className="h-16 rounded-control" />
        <Skeleton delayed className="h-16 rounded-control" />
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line-rule py-3">
        <Skeleton delayed className="h-4 w-52 max-w-full rounded-control" />
        <Skeleton delayed className="h-6 w-32 rounded-control max-sm:hidden" />
      </div>
    </div>
  );
}

/** "מחכה לך": the title row, then rows of a dot, a title and a count line, the amount and its verb. */
export function NeedsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" data-testid="needs-skeleton" className={CARD}>
      <div className="border-b border-line-rule px-5 pb-3 pt-4 max-sm:px-4">
        <Skeleton delayed className="h-6 w-24 rounded-control" />
      </div>
      <div className="divide-y divide-line-rule">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-5 py-3.5 max-sm:px-4">
            <Skeleton delayed className="mt-1.5 size-2 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton delayed className="h-4 w-40 max-w-full rounded-control" />
              <Skeleton delayed className="h-3.5 w-24 rounded-control" />
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Skeleton delayed className="h-6 w-16 rounded-control" />
              <Skeleton delayed className="h-8 w-20 rounded-control" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "הוחזר החודש": the round tick, the title and its line, the amount. */
export function GoodSkeleton() {
  return (
    <div aria-hidden="true" data-testid="good-skeleton" className={`${CARD} flex items-center gap-3 px-5 py-3.5 max-sm:px-4`}>
      <Skeleton delayed className="size-7 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton delayed className="h-4 w-24 rounded-control" />
        <Skeleton delayed className="h-3.5 w-44 max-w-full rounded-control max-sm:hidden" />
      </div>
      <Skeleton delayed className="h-7 w-20 shrink-0 rounded-control" />
    </div>
  );
}

export function CardSkeleton({ className = 'h-40' }: { className?: string }) {
  return <Skeleton delayed className={`rounded-card ${className}`} />;
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
