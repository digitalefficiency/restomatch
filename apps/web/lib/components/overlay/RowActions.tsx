'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { Button } from '../Button';
import { cnMerge as cn } from '../cn';

export interface RowAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

/**
 * Row actions (C2): at most two inline (the first can be the row's primary),
 * the rest in a "⋯" menu — always visible, so touch users can reach them.
 * Destructive actions belong in the menu, never next to edit.
 */
export function RowActions({ actions, inline = 2, className }: { actions: RowAction[]; inline?: 0 | 1 | 2; className?: string }) {
  const shown = actions.slice(0, inline);
  const rest = actions.slice(inline);
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {shown.map((a, i) =>
        a.href ? (
          <Link key={a.label} href={a.href} className="inline-flex min-h-8 items-center gap-1 rounded-control px-2 text-body-sm font-semibold text-primary hover:underline [@media(pointer:coarse)]:min-h-11">
            {a.icon}
            {a.label}
          </Link>
        ) : (
          <Button key={a.label} size="sm" variant={i === 0 ? 'secondary' : 'ghost'} icon={a.icon} onClick={a.onClick} disabled={a.disabled}>
            {a.label}
          </Button>
        ),
      )}
      {rest.length ? <Menu items={rest} /> : null}
    </div>
  );
}

/** "⋯" menu button + `role="menu"` popover: arrows move, Esc closes and returns focus, outside click closes. */
export function Menu({ items, label }: { items: RowAction[]; label?: string }) {
  const t = useT(components);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') els[(i + 1) % els.length]?.focus();
    else if (e.key === 'ArrowUp') els[(i - 1 + els.length) % els.length]?.focus();
    else if (e.key === 'Home') els[0]?.focus();
    else if (e.key === 'End') els[els.length - 1]?.focus();
    else if (e.key === 'Tab') setOpen(false);
    else return;
    if (e.key !== 'Tab') e.preventDefault();
  }

  const name = label ?? t('ds.rowActions.more');
  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={name}
        title={name}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors duration-micro hover:bg-surface-2 hover:text-ink [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={name}
          onKeyDown={onKeyDown}
          className="absolute end-0 top-full z-sheet mt-1 min-w-44 rounded-card border border-line bg-surface p-1 shadow-e2"
        >
          {items.map((a) =>
            a.href ? (
              <Link
                key={a.label}
                href={a.href}
                role="menuitem"
                tabIndex={-1}
                className="flex min-h-9 items-center gap-2 rounded-control px-3 text-body-sm text-ink hover:bg-surface-2"
              >
                {a.icon}
                {a.label}
              </Link>
            ) : (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={a.disabled || undefined}
                onClick={() => {
                  if (a.disabled) return;
                  a.onClick?.();
                  close();
                }}
                className={cn(
                  'flex min-h-9 w-full items-center gap-2 rounded-control px-3 text-start text-body-sm hover:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:text-subtle',
                  a.tone === 'danger' ? 'text-danger' : 'text-ink',
                )}
              >
                {a.icon}
                {a.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
