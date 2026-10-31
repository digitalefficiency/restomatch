'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { explain as explainNs } from '@/lib/i18n/messages/explain';
import { cn } from './cn';

/**
 * The in-place explanation fold (W2-16, docs/ux/wave2/copy-focus/MECHANISM.md §2).
 * A visible text toggle ("למה?" / "פרטים" / "איך חישבנו?") at the inline end of the line it
 * explains, with the panel inline below — never a popover, sheet or tooltip. Collapsed on the
 * server and the client (no CLS); focus stays on the toggle; the panel is a plain `hidden` div
 * (no role, not live, no aria-describedby). Body is text only: no ₪, links or buttons.
 * Never inside a ConfirmDialog, Toast, Banner, EmptyState, error, WhyLine, DeadlineChip or legal
 * block; ≤1 per card/row and ≤3 per screen.
 */
export type ExplainLabel = 'why' | 'details' | 'how';

/** React 19 `useId()` returns `«r0»`/`:r0:`-style ids; keep `[A-Za-z0-9_-]` only. */
export function explainId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '');
}

export interface DisclosureToggleProps {
  type: 'button';
  'aria-expanded': boolean;
  'aria-controls': string;
  onClick: () => void;
}
export interface DisclosurePanelProps {
  id: string;
  hidden: boolean;
  ref: React.RefObject<HTMLDivElement>;
}

/** Low-level disclosure: any layout. The panel MUST follow the toggle's row in DOM order. */
export function useDisclosure(idProp?: string): {
  open: boolean;
  toggleProps: DisclosureToggleProps;
  panelProps: DisclosurePanelProps;
} {
  const auto = explainId(useId());
  const id = idProp ? explainId(idProp) : `x-${auto}`;
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  useEffect(() => {
    // Only after user input: bring the panel out from under the sticky chrome; focus never moves.
    if (open && touched.current) panelRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);
  return {
    open,
    toggleProps: {
      type: 'button',
      'aria-expanded': open,
      'aria-controls': `${id}-panel`,
      onClick: () => {
        touched.current = true;
        setOpen((o) => !o);
      },
    },
    panelProps: { id: `${id}-panel`, hidden: !open, ref: panelRef },
  };
}

export function ExplainToggle({
  label = 'why',
  about,
  className,
  ...p
}: DisclosureToggleProps & { label?: ExplainLabel; about: string; className?: string }) {
  const t = useT(explainNs);
  return (
    <button
      {...p}
      data-explain-toggle=""
      className={cn(
        'group -mx-2 inline-flex min-h-11 min-w-11 items-center gap-1 rounded-control px-2 text-body-sm font-semibold text-primary hover:underline',
        '[[data-mode=field]_&]:min-h-12 print:hidden',
        className,
      )}
    >
      {t(`toggle.${label}`)}
      <span className="sr-only"> · {about}</span>
      <ChevronDown
        aria-hidden="true"
        className="h-4 w-4 motion-safe:transition-transform motion-safe:duration-micro group-aria-expanded:rotate-180"
      />
    </button>
  );
}

export function ExplainPanel({
  children,
  className,
  ref,
  ...p
}: DisclosurePanelProps & { children: string; className?: string }) {
  return (
    <div
      {...p}
      ref={ref}
      data-explain-panel=""
      className={cn('mt-1 max-w-prose border-s-2 border-line ps-3 text-body-sm text-muted print:!block', className)}
    >
      <p>{children}</p>
    </div>
  );
}

/** The common case: one visible line + its toggle on the same row, the panel below. */
export function Explain({
  line,
  body,
  about,
  label,
  id,
  testId,
  className,
}: {
  /** The visible status / number / heading this explains; omit to place the toggle alone. */
  line?: React.ReactNode;
  /** From a catalog key (`explain.*` or `<ns>.explain.*`); ≤40 words, no ₪. Empty → no toggle. */
  body: string;
  /** ≤4 words, unique on the page: the sr-only suffix of the toggle's name. */
  about: string;
  label?: ExplainLabel;
  /** Stable id → `${id}-panel`; default `useId()`. */
  id?: string;
  testId?: string;
  className?: string;
}) {
  const d = useDisclosure(id);
  if (!body.trim()) return line ? <>{line}</> : null;
  return (
    <div className={cn('min-w-0', className)} data-explain="" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {line ? <div className="min-w-0">{line}</div> : null}
        <ExplainToggle {...d.toggleProps} label={label} about={about} />
      </div>
      <ExplainPanel {...d.panelProps}>{body}</ExplainPanel>
    </div>
  );
}
