'use client';

import { useRef } from 'react';
import { useDir } from '@/lib/i18n/client';
import { cnMerge as cn } from '../cn';

export interface SegmentOption<V extends string> {
  value: V;
  label: React.ReactNode;
}

/**
 * 2–5 mutually exclusive options (a11y-13): one `radiogroup`, ONE Tab stop
 * (roving tabindex), arrow keys move and select (RTL-aware), Home/End jump.
 * Sunken track, a raised `surface` thumb; heights 32/40/48.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  options: Array<SegmentOption<V>>;
  value: V;
  onChange: (value: V) => void;
  /** Accessible name of the group. */
  label: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dir = useDir();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  function move(to: number) {
    const i = (to + options.length) % options.length;
    onChange(options[i]!.value);
    refs.current[i]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const next = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const prev = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === next || e.key === 'ArrowDown') move(index + 1);
    else if (e.key === prev || e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(options.length - 1);
    else return;
    e.preventDefault();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('inline-flex max-w-full items-stretch gap-0.5 rounded-control bg-surface-2 p-0.5', className)}
    >
      {options.map((o, i) => {
        const checked = i === index;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex min-w-0 items-center justify-center whitespace-nowrap rounded-[6px] px-3 font-semibold transition-colors duration-micro',
              size === 'sm' ? 'min-h-7 text-caption' : size === 'md' ? 'min-h-9 text-body-sm' : 'min-h-11 text-body',
              checked ? 'bg-surface text-ink shadow-e1' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
