import { cn } from './cn';

/** Shimmer placeholder for loading states. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('animate-pulse rounded-xl bg-stone-200/70', className)} />
  );
}
