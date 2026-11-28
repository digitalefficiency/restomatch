import { Skeleton } from '@/lib/components/Skeleton';
import { cn } from '@/lib/components/cn';
import { getT } from '@/lib/i18n/server';
import { overview } from '@/lib/i18n/messages/overview';

/**
 * Every bar is DS3-01's delayed skeleton: nothing shows before the one-second wait (`--dur-skeleton-wait`), reduced
 * motion included — the global reduced-motion rule zeroes `transition-delay` for every element but
 * `.motion-essential` (globals.css), which would show a "delayed" skeleton at once — and it appears without a fade
 * (`duration-0` under reduced motion) (R12).
 */
const SK = 'motion-essential motion-reduce:duration-0';
const QUEUE_ROWS = [0, 1, 2, 3, 4, 5] as const;

/** The evidence of one gap: the pills, the title, the three-way table and the calculation line. */
function EvidenceBars() {
  return (
    <>
      <Skeleton delayed className={cn(SK, 'h-6 w-48')} />
      <Skeleton delayed className={cn(SK, 'mt-2.5 h-7 w-64')} />
      <Skeleton delayed className={cn(SK, 'mt-4 h-40 rounded-card')} />
      <Skeleton delayed className={cn(SK, 'mt-2.5 h-[3.75rem] rounded-card')} />
    </>
  );
}

/**
 * The approvals page's Suspense fallback (DS3-04 spec §4.7; page.tsx streams it on the first load only, there is no
 * approvals/loading.tsx). Server-safe and layout-true: the title and the head line, then at `xl` the desk's frame —
 * the queue column (six rows on the `--decision-row-h` dial) beside the evidence and its decision bar — and below
 * `xl` the evidence with the phone's bar. No `flow-stream`.
 */
export async function ApprovalsSkeleton() {
  const t = await getT(overview);
  return (
    <div role="status" aria-label={t('loading')} data-testid="approvals-loading">
      <Skeleton delayed className={cn(SK, 'mb-6 h-8 w-44')} />
      <Skeleton delayed className={cn(SK, 'mb-4 h-5 w-72')} />
      <div className="hidden xl:flex xl:h-[36rem] xl:overflow-hidden xl:rounded-card xl:border xl:border-line-rule">
        <div className="xl:flex xl:w-[22rem] xl:shrink-0 xl:flex-col xl:gap-1 xl:border-e xl:border-line-rule xl:px-2 xl:pt-3 2xl:w-[24.25rem]">
          {QUEUE_ROWS.map((i) => (
            <Skeleton key={i} delayed className={cn(SK, 'h-decision-row rounded-control')} />
          ))}
        </div>
        <div className="xl:flex xl:min-w-0 xl:flex-1 xl:flex-col">
          <div className="xl:flex-1 xl:px-7 xl:pt-5">
            <EvidenceBars />
          </div>
          <Skeleton delayed className={cn(SK, 'h-[4.5rem] rounded-none')} />
        </div>
      </div>
      <div className="xl:hidden">
        <EvidenceBars />
        <Skeleton delayed className={cn(SK, 'mt-4 h-40')} />
      </div>
    </div>
  );
}
