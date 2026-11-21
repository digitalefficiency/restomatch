'use client';

import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cnMerge as cn } from '@/lib/components/cn';
import { useFold } from '@/lib/components/hero/HeroFold';

/**
 * "עוד משימה אחת" at the foot of the "מחכה לך" card (DS3 SPEC §10.1, §8; v2 B6, v4 H4): the rows
 * beyond the first ones unfold in place ABOVE this bottom button — as the reference draws it — with
 * the same animated fold as the calculation (grid rows 0fr → 1fr, inert while closed). Because the
 * revealed rows come before the button in the page, opening moves focus to the first of them;
 * closing leaves it on the button. Beside the button, outside it, the hidden rows' titles as a
 * quiet preview (row data, hence `data-record`), gone once open and on a phone.
 *
 * Serialisable props only: the label is resolved on the server, the rows are server-rendered
 * children (their own `ul[data-record]`).
 */
export function NeedsMore({ label, preview, children }: { label: string; preview?: string; children: React.ReactNode }) {
  const fold = useFold();
  const { ref, ...panel } = fold.panelProps;
  const wasOpen = useRef(false);

  useEffect(() => {
    if (fold.open && !wasOpen.current) {
      // The panel is no longer inert in this commit. No scroll here: the fold brings the rows into
      // view once they have grown (a focus scroll would move a panel that is still 0 px tall).
      ref.current?.querySelector<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]')?.focus({ preventScroll: true });
    }
    wasOpen.current = fold.open;
  }, [fold.open, ref]);

  return (
    <div data-testid="needs-you-more" data-open={fold.open ? 'true' : 'false'}>
      <div {...fold.gridProps}>
        <div {...panel} ref={ref}>
          {children}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2.5 border-t border-line-rule py-1.5 pe-5 ps-3 max-sm:pe-4">
        <button
          {...fold.buttonProps}
          data-focus="inset"
          className="inline-flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-control px-2 text-body-sm font-medium text-fg-secondary transition-colors duration-micro ease-standard hover:bg-surface-hover hover:text-fg max-sm:min-h-11"
        >
          {label}
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform duration-short ease-standard', fold.open && 'rotate-180')} aria-hidden="true" />
        </button>
        {preview ? (
          <span data-record="" className={cn('min-w-0 truncate text-caption text-fg-tertiary max-sm:hidden', fold.open && 'hidden')}>
            {preview}
          </span>
        ) : null}
      </div>
    </div>
  );
}
