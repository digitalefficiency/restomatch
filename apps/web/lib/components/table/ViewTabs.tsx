'use client';

import { useLocale } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { formatIls } from '@/lib/money';
import { cn } from '../cn';
import { deskCopy } from './copy';
import type { TableView } from './types';

/**
 * Built-in views above a DataTable with live counts and ₪ (exec-desktop-15):
 * "חוסמים (2 · ₪143.50)". The active view is `?view=` — shareable, and Back
 * returns to the previous one. Rendered as toggle buttons in a labelled group
 * (a view filters the same table; it is not a separate tab panel).
 */
export function ViewTabs({
  views,
  active,
  onChange,
  className,
}: {
  views: TableView[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const locale = useLocale();
  const copy = deskCopy(locale);
  return (
    <div role="group" aria-label={copy.views} className={cn('flex items-end gap-1 overflow-x-auto border-b border-line md:flex-wrap md:overflow-visible', className)}>
      {views.map((v) => {
        const on = v.id === active;
        return (
          <button
            key={v.id}
            type="button"
            aria-pressed={on}
            data-view={v.id}
            onClick={() => onChange(v.id)}
            className={cn(
              '-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-info',
              on ? 'border-primary font-semibold text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {v.label}
            {v.count != null ? (
              <span className={cn('rounded-full px-1.5 text-xs tabular-nums', on ? 'bg-primary/10 text-ink' : 'bg-surface-2 text-muted')}>
                {formatNumber(v.count, locale)}
                {v.sumAgorot != null ? (
                  <>
                    {' · '}
                    <bdi>{formatIls(v.sumAgorot / 100, { maximumFractionDigits: 2, locale })}</bdi>
                  </>
                ) : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
