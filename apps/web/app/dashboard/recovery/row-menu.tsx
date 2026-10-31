'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/components';

/**
 * A row's "⋯" menu (WAI-ARIA menu button): Enter/Space/↓ open it on the first
 * item, ↑/↓ move, Home/End jump, Esc closes and returns focus to the button.
 * Nothing fires on focus or on arrow keys — only an explicit activation.
 */
export function RowMenu({
  label,
  items,
  className,
}: {
  label: string;
  items: Array<{ key: string; label: string; onSelect: () => void; danger?: boolean }>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const focusItem = (i: number) => {
    const els = list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!els || els.length === 0) return;
    els[(i + els.length) % els.length]!.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    const onDoc = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (items.length === 0) return null;
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <div className={cn('relative inline-block', className)}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-line bg-surface text-muted hover:text-ink md:min-h-9 md:min-w-9"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <ul
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            const els = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
            const i = els.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              focusItem(i + 1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              focusItem(i - 1);
            } else if (e.key === 'Home') {
              e.preventDefault();
              focusItem(0);
            } else if (e.key === 'End') {
              e.preventDefault();
              focusItem(els.length - 1);
            } else if (e.key === 'Escape' || e.key === 'Tab') {
              e.preventDefault();
              close();
            }
          }}
          className="absolute end-0 top-full z-40 mt-1 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-card"
        >
          {items.map((it) => (
            <li key={it.key} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  // Focus returns to the ⋯ button BEFORE the action: a confirm dialog it opens
                  // then restores focus there on cancel (the menu item is about to unmount).
                  btn.current?.focus();
                  it.onSelect();
                }}
                className={cn(
                  'flex min-h-11 w-full items-center rounded-lg px-3 text-start text-sm hover:bg-surface-2 focus:bg-surface-2 md:min-h-9',
                  it.danger ? 'text-danger' : 'text-ink',
                )}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
