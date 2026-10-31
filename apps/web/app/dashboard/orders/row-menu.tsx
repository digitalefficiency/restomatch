'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/components';

export interface RowMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  tone?: 'danger';
}

/**
 * "⋯" overflow menu (menu button pattern): opens below the trigger at the inline
 * end, arrow keys move between items, Esc / outside click close and focus returns
 * to the trigger. Sits above a stretched row link (`relative z-10`).
 */
export function RowMenu({ label, items, className }: { label: string; items: RowMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const first = root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  return (
    <div ref={root} className={cn('relative z-10 inline-block', className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              items[(i + 1) % items.length]?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              items[(i - 1 + items.length) % items.length]?.focus();
            } else if (e.key === 'Tab') {
              close(false);
            }
          }}
          className="absolute end-0 top-full z-30 mt-1 min-w-48 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-card"
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => {
                // Focus goes back to the trigger first, so a dialog the action opens
                // returns focus there when it closes (not to <body>).
                close(true);
                it.onSelect();
              }}
              className={cn(
                'flex min-h-12 w-full items-center gap-2 px-4 text-start text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none',
                it.tone === 'danger' ? 'text-danger' : 'text-ink',
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
