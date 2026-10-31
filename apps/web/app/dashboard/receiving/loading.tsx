import { getT } from '@/lib/i18n/server';
import { receiving } from '@/lib/i18n/messages/receiving';
import { Skeleton } from '@/lib/components';
import { BoardSkeleton } from '../home/skeletons';

/** Layout-true: header, then the board's summary line, next-truck card and rows. */
export default async function Loading() {
  const t = await getT(receiving);
  return (
    <div role="status" aria-label={t('loading')}>
      <div className="mb-6 space-y-2">
        <div className="h-0.5 w-10 rounded-full flow-stream" />
        <Skeleton className="h-8 w-44" />
      </div>
      <BoardSkeleton />
    </div>
  );
}
