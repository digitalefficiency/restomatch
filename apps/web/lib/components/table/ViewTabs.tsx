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
 * (a view filters the same table; it is not a separate tab panel). DS3: the
 * count is a quiet number shown even at 0; the active view has an ink underline.
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
    <div role="group" aria-label={copy.views} className={cn('flex items-end gap-5 overflow-x-auto border-b border-line-rule md:flex-wrap md:overflow-visible', className)}>
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
              '-mb-px inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 pb-2.5 pt-2 text-body-sm font-medium transition-colors duration-micro ease-standard [@media(pointer:coarse)]:min-h-11',
              'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-info',
              on ? 'border-fg text-fg' : 'border-transparent text-fg-secondary hover:text-fg',
            )}
          >
            {v.label}
            {v.count != null ? (
              <span className="num font-normal text-fg-tertiary">
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
