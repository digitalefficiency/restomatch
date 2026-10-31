import { cnMerge as cn } from './cn';

export type SkeletonVariant = 'block' | 'text' | 'metric' | 'hero' | 'kpiRow' | 'row' | 'card' | 'table' | 'form' | 'wizardStep';

const bar = 'rm-shimmer rounded-control bg-surface-2';

/**
 * Loading placeholder. `className` alone keeps the v1 behaviour (one box you
 * size yourself). Variants draw the same boxes as the final layout so nothing
 * jumps (perf-states-18). The shimmer is motion-safe: reduced motion gets a
 * static fill. Put `aria-busy` on the region that is loading, not on this.
 */
export function Skeleton({
  className,
  variant = 'block',
  rows = 5,
}: {
  className?: string;
  variant?: SkeletonVariant;
  /** Rows for `table` / `form`. */
  rows?: number;
}) {
  switch (variant) {
    case 'block':
      return <div aria-hidden="true" className={cn(bar, 'rounded-xl', className)} />;
    case 'text':
      return <div aria-hidden="true" className={cn(bar, 'h-4 w-3/4', className)} />;
    case 'metric':
      return <div aria-hidden="true" className={cn(bar, 'h-10 w-32 max-w-full', className)} />;
    case 'hero':
      return (
        <div aria-hidden="true" className={cn('space-y-3 rounded-overlay border border-line bg-surface p-6', className)}>
          <div className={cn(bar, 'h-3 w-40')} />
          <div className={cn(bar, 'h-4 w-56')} />
          <div className={cn(bar, 'h-14 w-64')} />
          <div className={cn(bar, 'h-4 w-48')} />
        </div>
      );
    case 'kpiRow':
      return (
        <div aria-hidden="true" className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="min-w-0 space-y-2 rounded-card border border-line bg-surface p-4">
              <div className={cn(bar, 'h-3 w-1/2')} />
              <div className={cn(bar, 'h-8 w-3/4')} />
            </div>
          ))}
        </div>
      );
    case 'row':
      return (
        <div aria-hidden="true" className={cn('flex min-h-12 items-center gap-3 border-b border-line px-4', className)}>
          <div className={cn(bar, 'h-4 flex-1')} />
          <div className={cn(bar, 'h-4 w-20')} />
        </div>
      );
    case 'card':
      return (
        <div aria-hidden="true" className={cn('space-y-3 rounded-card border border-line bg-surface p-5', className)}>
          <div className={cn(bar, 'h-4 w-1/3')} />
          <div className={cn(bar, 'h-4 w-2/3')} />
          <div className={cn(bar, 'h-4 w-1/2')} />
        </div>
      );
    case 'table':
      return (
        <div aria-hidden="true" className={cn('overflow-hidden rounded-card border border-line bg-surface', className)}>
          <div className="flex h-10 items-center gap-3 border-b border-line px-4">
            <div className={cn(bar, 'h-3 w-24')} />
            <div className={cn(bar, 'ms-auto h-3 w-16')} />
          </div>
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} variant="row" />
          ))}
        </div>
      );
    case 'form':
      return (
        <div aria-hidden="true" className={cn('space-y-5', className)}>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="space-y-2">
              <div className={cn(bar, 'h-3 w-24')} />
              <div className={cn(bar, 'h-10 w-full')} />
            </div>
          ))}
        </div>
      );
    case 'wizardStep':
      return (
        <div aria-hidden="true" className={cn('space-y-4', className)}>
          <div className={cn(bar, 'h-1 w-full rounded-pill')} />
          <div className={cn(bar, 'h-6 w-48')} />
          <div className={cn(bar, 'h-24 w-full')} />
          <div className={cn(bar, 'h-14 w-full')} />
        </div>
      );
  }
}
