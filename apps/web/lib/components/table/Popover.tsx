'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../cn';

/**
 * Small disclosure popover for the table toolbar (columns, export, density).
 * Esc or an outside click closes it and focus returns to the trigger. The panel
 * is pinned to the trigger's inline-end edge (the toolbar sits at the table's
 * end), so it grows back over the table and never off the page.
 */
export function ToolbarPopover({
  label,
  icon,
  children,
  className,
  iconOnly = false,
  disabled = false,
}: {
  label: string;
  icon?: React.ReactNode;
  /** Show only the icon; `label` becomes the accessible name. */
  iconOnly?: boolean;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      ref={root}
      className={cn('relative', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={iconOnly ? label : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg text-sm text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info',
          iconOnly ? 'h-7 w-7 justify-center' : 'h-8 border border-line-strong bg-surface px-2.5',
        )}
      >
        {icon}
        {iconOnly ? null : label}
      </button>
      {open ? (
        <div
          id={id}
          className="absolute end-0 top-full z-[46] mt-1 min-w-56 rounded-xl border border-line bg-surface p-2 shadow-card"
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}
