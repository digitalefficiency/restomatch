import { Skeleton } from '@/lib/components';
import { PacePlaceholder } from '@/lib/components/hero';

/**
 * Layout-true placeholders: the same card, the same boxes and about the same heights as the
 * blocks they stand for, at the desk and on a phone, so nothing jumps when a block streams in. The
 * shimmer bars appear only when the wait passes one second (DS3 SPEC §9, `<Skeleton delayed>`); the
 * card's frame and its boxes hold the space from the start. Decorative.
 */

const CARD = 'overflow-hidden rounded-card border border-line-rule bg-surface shadow-e1';
/** A hero link's box: 24 px, 44 on a coarse pointer (as globals.css lifts every link of the leak card). */
const HERO_LINK_BOX = 'flex h-6 items-center [@media(pointer:coarse)]:h-11';

/**
 * The leak card in its leak state, box for box (LeakHero): the label row with its ⋯ menu · the number
 * with the pace line beside it at the desk and under it on a phone (the pace's own placeholder, so
 * its height is the line's) · the scale sentence and the change (two lines each on a phone) · the
 * split's bar and its two legend items (a figure, two lines of words on a phone, a link) · the foot
 * row. Measured against the lab's leak card: within a pixel at 1440 and at 390.
 */
export function HeroSkeleton() {
  return (
    <div aria-hidden="true" data-testid="hero-skeleton" className={`${CARD} px-4 pt-4 sm:px-7 sm:pt-5`}>
      {/* The ⋯ menu's box sets the row: 32 px, 44 on a coarse pointer. */}
      <div className="flex h-8 items-center [@media(pointer:coarse)]:h-11">
        <Skeleton delayed className="h-4 w-40 rounded-control" />
      </div>
      <div className="mt-2.5 flex flex-wrap items-end gap-x-6 gap-y-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-y-1.5">
        {/* The number's line as <Money context="display"> lays it out — the display role and its raised
            glyph's box (globals.css), held open by a no-break space — so it is as tall as the figure. */}
        <div className="relative w-36 shrink-0 md:w-44">
          <div className="invisible text-money-hero">
            <span className="money-glyph">{'\u00a0'}</span>
          </div>
          <Skeleton delayed className="absolute inset-x-0 inset-y-3 rounded-control" />
        </div>
        <div className="relative mb-3 min-w-0 max-sm:max-w-md sm:ms-auto sm:max-w-64 sm:grow sm:basis-40">
          <PacePlaceholder />
          <Skeleton delayed className="absolute inset-0 rounded-control" />
        </div>
      </div>
      <div className="mt-1 flex h-6 items-center max-sm:h-12">
        <Skeleton delayed className="h-4 w-72 max-w-full rounded-control" />
      </div>
      <div className="mt-1.5 flex h-5 items-center max-sm:h-10">
        <Skeleton delayed className="h-3.5 w-56 max-w-full rounded-control" />
      </div>
      <Skeleton delayed className="mt-5 h-3 w-full rounded-xs" />
      <div className="mt-2.5 grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="min-w-0 pe-2 sm:pe-3">
            <div className="flex h-7 items-center">
              <Skeleton delayed className="h-5 w-16 rounded-control" />
            </div>
            <div className="flex h-5 items-center max-sm:h-10">
              <Skeleton delayed className="h-3.5 w-32 max-w-full rounded-control" />
            </div>
            <div className={`mt-1 ${HERO_LINK_BOX}`}>
              <Skeleton delayed className="h-3.5 w-24 max-w-full rounded-control" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line-rule py-3">
        <div className="flex h-5 min-w-0 basis-full items-center sm:flex-1 sm:basis-auto">
          <Skeleton delayed className="h-3.5 w-52 max-w-full rounded-control" />
        </div>
        <div className="flex h-8 items-center [@media(pointer:coarse)]:h-11">
          <Skeleton delayed className="h-4 w-32 rounded-control" />
        </div>
      </div>
    </div>
  );
}

/**
 * One "מחכה לך" row: a dot, a title and a count line, the amount (with its VAT basis under it on a
 * money row) and its verb, as tall as the filled one (32 px; 44 on a phone).
 */
function NeedsSkeletonRow({ basis }: { basis: boolean }) {
  return (
    <div className="flex items-start gap-3 px-5 py-3.5 max-sm:px-4">
      <Skeleton delayed className="mt-1.5 size-2 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton delayed className="h-4 w-40 max-w-full rounded-control" />
        <Skeleton delayed className="h-3.5 w-24 rounded-control" />
      </div>
      <div className="flex w-28 shrink-0 flex-col items-end gap-1.5">
        <div className="flex h-7 items-center">
          <Skeleton delayed className="h-6 w-16 rounded-control" />
        </div>
        {basis ? (
          <div className="-mt-1.5 flex h-4 items-center">
            <Skeleton delayed className="h-3 w-14 rounded-control" />
          </div>
        ) : null}
        <Skeleton delayed className="h-8 w-20 rounded-control max-sm:h-11" />
      </div>
    </div>
  );
}

/** "מחכה לך": the title row, then rows of a dot, a title and a count line, the amount, its basis and its verb. */
export function NeedsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" data-testid="needs-skeleton" className={CARD}>
      <div className="border-b border-line-rule px-5 pb-3 pt-4 max-sm:px-4">
        <Skeleton delayed className="h-6 w-24 rounded-control" />
      </div>
      <div className="divide-y divide-line-rule">
        {Array.from({ length: rows }).map((_, i) => (
          <NeedsSkeletonRow key={i} basis />
        ))}
      </div>
    </div>
  );
}

/**
 * The chef's strip (StaffNeeds): chef-sized — one row of counts in the same card, its title row
 * hidden at the desk as the strip's own is, and the strip's bottom margin. With nothing to show the
 * strip renders nothing, so the placeholder stays as small as the strip can be.
 */
export function StaffNeedsSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div aria-hidden="true" data-testid="staff-needs-skeleton" className="mb-4">
      <div className={CARD}>
        <div className="border-b border-line-rule px-5 pb-3 pt-4 max-sm:px-4 lg:hidden">
          <Skeleton delayed className="h-6 w-24 rounded-control" />
        </div>
        <div className="divide-y divide-line-rule">
          {Array.from({ length: rows }).map((_, i) => (
            <NeedsSkeletonRow key={i} basis={false} />
          ))}
        </div>
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
