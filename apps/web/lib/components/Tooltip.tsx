'use client';

import { useState } from 'react';
import { cnMerge as cn } from './cn';
import { Kbd } from './Kbd';

/**
 * The dark tooltip of icon-only controls (DS3 SPEC §10.4, reference `.mn-tip`): the control's
 * name in white on ink, an optional key cap and a one-line description. It appears after a rest
 * of the pointer (≈½ s) and at once on keyboard focus, beside the control and never over it; it
 * stays while the pointer is on it (WCAG 1.4.13 hoverable) and Escape dismisses it. Pure CSS
 * show/hide, so nothing renders late; it is decorative (`aria-hidden`): the control keeps its own
 * accessible name (IconButton's `label`). Anchor positioning is not relied on (SPEC §9).
 */
export function Tooltip({
  label,
  kbd,
  description,
  side = 'top',
  children,
  className,
}: {
  label: React.ReactNode;
  kbd?: string;
  description?: React.ReactNode;
  side?: 'top' | 'bottom';
  /** One focusable control (usually an IconButton). */
  children: React.ReactNode;
  className?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  return (
    <span
      className={cn('group/tip relative inline-flex', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setDismissed(true);
      }}
      onPointerLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
      data-tooltip=""
    >
      {children}
      {/* The outer box carries the gap as padding, so the pointer can travel onto the tip and keep it open. */}
      <span
        aria-hidden="true"
        hidden={dismissed}
        className={cn(
          'invisible absolute left-1/2 z-snackbar w-max max-w-xs -translate-x-1/2 opacity-0',
          'transition-[opacity,visibility] duration-micro ease-standard',
          'group-hover/tip:visible group-hover/tip:opacity-100 group-hover/tip:delay-500',
          'group-has-[:focus-visible]/tip:visible group-has-[:focus-visible]/tip:opacity-100 group-has-[:focus-visible]/tip:delay-0',
          side === 'top' ? 'bottom-full pb-2' : 'top-full pt-2',
        )}
      >
        <span data-tooltip-box="" className="block rounded-control bg-fg px-2.5 py-2 text-start text-on-bold shadow-e2">
          <span className="flex items-center gap-2 text-body-sm font-semibold">
            {label}
            {kbd ? (
              <Kbd tone="onBold" className="border-transparent">
                {kbd}
              </Kbd>
            ) : null}
          </span>
          {description ? <span className="mt-0.5 block text-caption text-line">{description}</span> : null}
        </span>
      </span>
    </span>
  );
}
