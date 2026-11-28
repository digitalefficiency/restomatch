import { Skeleton } from '@/lib/components';

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
