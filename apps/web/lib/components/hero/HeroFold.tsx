'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '../cn';
import { useDisclosure } from '../Explain';

/**
 * "איך הגענו לסכום?" (DS3 SPEC §10.1, §8): the hero's foot row — a line of context and the toggle —
 * and the calculation that opens in place under it. The shared disclosure hook drives it (focus stays
 * on the toggle; the panel follows the toggle in DOM order); the panel opens with grid rows 0fr → 1fr
 * over the panel duration, no measured heights, and is `inert` while closed so nothing inside is
 * focusable or read. Closed on the server and on the client's first paint: no layout shift.
 */
export function HeroFold({
  line,
  label,
  testId,
  toggleTestId,
  panelLabel,
  panelClassName,
  children,
}: {
  /** The context at the start of the foot row ("35 חשבוניות נבדקו, ב־13 מהן נמצא פער"). */
  line?: React.ReactNode;
  /** The toggle's words. */
  label: string;
  testId?: string;
  toggleTestId?: string;
  /** Accessible name of the opened region. */
  panelLabel: string;
  /** The panel's surface (it may bleed to the card's edges). */
  panelClassName?: string;
  children: React.ReactNode;
}) {
  const d = useDisclosure();
  return (
    <div data-testid={testId} data-open={d.open ? 'true' : 'false'}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-rule py-3 text-body-sm text-muted">
        <div className="min-w-0 flex-1">{line}</div>
        <button
          {...d.toggleProps}
          data-testid={toggleTestId}
          className="-me-2 inline-flex min-h-8 items-center gap-1 rounded-control px-2 font-medium text-ink transition-colors duration-micro ease-standard hover:bg-surface-2 [@media(pointer:coarse)]:min-h-11"
        >
          {label}
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 transition-transform duration-short ease-standard', d.open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className={cn('grid transition-[grid-template-rows] duration-medium ease-enter', d.open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div
          id={d.panelProps.id}
          ref={d.panelProps.ref}
          role="region"
          aria-label={panelLabel}
          inert={!d.open}
          className={cn(
            'min-h-0 overflow-hidden',
            // Closing: the content stays visible while the rows shrink, then leaves the accessibility tree.
            d.open ? 'visible' : 'invisible transition-[visibility] delay-[var(--dur-medium)]',
          )}
        >
          <div className={panelClassName}>{children}</div>
        </div>
      </div>
    </div>
  );
}
