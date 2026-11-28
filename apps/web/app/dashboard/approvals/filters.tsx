'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import { cn } from '@/lib/components/cn';

/**
 * Phone: the view toolbar folds into one chip ("סינון ותצוגה (N)") so the first
 * decision is above the fold (approvals-03). From `sm` up it is always shown.
 */
export function FiltersDisclosure({
  active,
  children,
}: {
  active: number;
  children: React.ReactNode;
}) {
  const t = useT(approvals);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="approvals-filters"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'mb-3 inline-flex h-12 items-center rounded-full border px-4 text-sm font-semibold sm:hidden outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20',
          active > 0 ? 'border-primary text-primary' : 'border-line-strong text-ink',
        )}
        data-testid="approvals-filters-toggle"
      >
        {active > 0 ? t('filters.toggleActive', { count: active }) : t('filters.toggle')}
      </button>
      <div id="approvals-filters" className={open ? 'block' : 'hidden sm:block'}>
        {children}
      </div>
    </div>
  );
}
