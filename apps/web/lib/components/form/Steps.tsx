'use client';

import { Check } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cn } from '../cn';

/**
 * Wizard progress. From md: numbered items, the current one `primary-subtle`
 * with `aria-current="step"`, completed ones ✓. Below md (and in field mode):
 * "שלב 2 מתוך 4 · פריטים" plus a 4 px bar that fills from the inline start
 * (the right in Hebrew).
 */
export function Steps({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  const t = useT(components);
  const total = steps.length;
  const at = Math.min(Math.max(current, 0), total - 1);
  return (
    <div className={className}>
      <div className="md:hidden">
        <p className="text-body-sm font-semibold text-ink">
          {t('ds.steps.progress', { current: at + 1, total })} · {steps[at]}
        </p>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-pill bg-surface-2" aria-hidden="true">
          <div className="h-full rounded-pill bg-primary" style={{ width: `${((at + 1) / total) * 100}%` }} />
        </div>
      </div>
      <ol className="hidden items-center gap-2 md:flex">
        {steps.map((label, i) => {
          const done = i < at;
          const isCurrent = i === at;
          return (
            <li key={label} aria-current={isCurrent ? 'step' : undefined} className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex min-h-8 items-center gap-2 rounded-pill px-3 text-body-sm font-semibold',
                  isCurrent ? 'bg-primary-subtle text-primary' : done ? 'text-ink' : 'text-muted',
                )}
              >
                <span
                  className={cn(
                    'num inline-flex h-5 w-5 items-center justify-center rounded-full text-caption',
                    done ? 'bg-primary-bold text-on-bold' : isCurrent ? 'bg-primary-bold text-on-bold' : 'border border-line-strong',
                  )}
                >
                  {done ? <Check className="h-3 w-3" aria-hidden="true" /> : i + 1}
                </span>
                {label}
                {done ? <span className="sr-only">({t('ds.steps.done')})</span> : null}
              </span>
              {i < total - 1 ? <span aria-hidden="true" className="h-px w-6 bg-line-strong" /> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
