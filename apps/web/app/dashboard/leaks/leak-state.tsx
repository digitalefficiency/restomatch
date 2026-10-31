import Link from 'next/link';
import { Camera, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/components';

import type { LeakState } from './states';

export { leakStateOf, type LeakState } from './states';

/**
 * The calm notes of the two non-money states: no checked invoice yet (T4,
 * neutral, one CTA) and clean (T3, with how many invoices were checked).
 */
export function LeakStateNote({
  state,
  labels,
  cta,
  className,
}: {
  state: Exclude<LeakState, 'leak'>;
  labels: { title: string; hint: string };
  /** The one CTA of the noData state (noDataCtaFor: role-aware, never a flag-gated page); none = the hint alone. */
  cta?: { label: string; href: string };
  className?: string;
}) {
  if (state === 'noData') {
    return (
      <div
        className={cn('rounded-2xl border border-line bg-surface-2 px-5 py-6 text-center', className)}
        data-testid="leak-state"
        data-state="noData"
      >
        <p className="text-base font-bold text-ink">{labels.title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">{labels.hint}</p>
        {cta ? (
          <Link
            href={cta.href}
            data-testid="leak-state-cta"
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:brightness-90"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            {cta.label}
          </Link>
        ) : null}
      </div>
    );
  }
  return (
    <div
      className={cn('flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-5 py-4', className)}
      data-testid="leak-state"
      data-state="clean"
    >
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <p className="font-bold text-ink">{labels.title}</p>
        <p className="mt-0.5 text-sm text-muted">{labels.hint}</p>
      </div>
    </div>
  );
}
