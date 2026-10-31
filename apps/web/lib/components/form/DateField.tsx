'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from '../cn';
import { fieldBase } from '../Input';
import { addDays, dateFieldValue, formatDateField, monthGrid } from './parse';

type NativeProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type'>;

/**
 * A date field that reads dd.mm.yyyy in Hebrew (dd/mm/yyyy in English)
 * whatever the browser's locale — a native `type="date"` shows MM/DD/YYYY on
 * an English Chrome (design-system-12). Typed text (25.10.2026, 25/10/26,
 * 25102026) or a Sunday-first (א׳) calendar popover. The value is ISO
 * 'yyyy-mm-dd' (or null); with `name`, a hidden input posts the ISO date.
 */
export function DateField({
  value,
  defaultValue,
  onValueChange,
  name,
  min,
  max,
  className,
  onBlur,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...rest
}: NativeProps & {
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (iso: string | null) => void;
  /** ISO bounds for the calendar and typed input. */
  min?: string;
  max?: string;
}) {
  const locale = useLocale();
  const t = useT(components);
  const errorId = useId();
  const popId = useId();
  const initial = value ?? defaultValue ?? null;
  const [iso, setIso] = useState<string | null>(initial);
  const [text, setText] = useState(initial ? formatDateField(initial, locale) : '');
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (value === undefined || value === iso) return;
    setIso(value);
    setText(value ? formatDateField(value, locale) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(next: string | null) {
    setIso(next);
    setText(next ? formatDateField(next, locale) : '');
    setInvalid(false);
    onValueChange?.(next);
  }

  return (
    <div className={cn('relative w-full', className)}>
      <div className="flex items-stretch gap-2">
        <input
          {...rest}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          placeholder={rest.placeholder ?? t('ds.dateField.placeholder')}
          value={text}
          aria-invalid={invalid || ariaInvalid || undefined}
          aria-describedby={[describedBy, invalid ? errorId : null].filter(Boolean).join(' ') || undefined}
          className={cn(fieldBase, 'num w-full min-w-0 rtl:text-right')}
          onChange={(e) => {
            setText(e.target.value);
            // Only a whole, real, in-range date is held; anything else posts "" (never a stale date).
            const next = dateFieldValue(e.target.value, { min, max }).iso;
            if (next !== iso) {
              setIso(next);
              onValueChange?.(next);
            }
            if (next) setInvalid(false);
          }}
          onBlur={(e) => {
            const { iso: next, invalid: bad } = dateFieldValue(text, { min, max });
            if (next) commit(next);
            setInvalid(bad);
            onBlur?.(e);
          }}
        />
        <button
          type="button"
          aria-label={t('ds.dateField.open')}
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-10 w-10 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface text-muted transition-colors duration-micro hover:bg-surface-2 hover:text-ink [@media(pointer:coarse)]:w-11"
        >
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {name ? <input type="hidden" name={name} value={iso ?? ''} /> : null}
      {invalid ? (
        <p id={errorId} className="mt-1.5 text-sm text-danger">
          {t('ds.dateField.invalid')}
        </p>
      ) : null}
      {open ? (
        <Calendar
          id={popId}
          selected={iso}
          min={min}
          max={max}
          onPick={(d) => {
            commit(d);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

/** Sunday-first month grid with arrow-key navigation (RTL-aware), Enter/Space picks, Esc closes. Exported for tests. */
export function Calendar({
  id,
  selected,
  min,
  max,
  onPick,
  onClose,
}: {
  id: string;
  selected: string | null;
  min?: string;
  max?: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const t = useT(components);
  const [focusDay, setFocusDay] = useState(selected ?? todayIso());
  const grid = useRef<HTMLDivElement>(null);
  const year = Number(focusDay.slice(0, 4));
  const month0 = Number(focusDay.slice(5, 7)) - 1;
  const days = monthGrid(year, month0);
  const intl = locale === 'he' ? 'he-IL' : 'en-GB';
  const title = new Intl.DateTimeFormat(intl, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month0, 1)),
  );
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(intl, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 4 + i))),
  ); // 4 Oct 2026 is a Sunday
  const rtl = locale === 'he';
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max);
  // "Today" obeys min/max like every other day: out of range, it is disabled and picks nothing.
  const today = todayIso();

  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay]);

  function onKeyDown(e: React.KeyboardEvent) {
    const step: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: 7,
      ArrowUp: -7,
    };
    if (e.key in step) {
      e.preventDefault();
      setFocusDay((d) => addDays(d, step[e.key]!));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      setFocusDay((d) => addDays(d, e.key === 'PageDown' ? 30 : -30));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  const PrevIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;
  return (
    <div
      id={id}
      role="dialog"
      aria-label={title}
      className="absolute start-0 top-full z-sheet mt-2 w-[19rem] rounded-card border border-line bg-surface p-3 shadow-e2"
      onKeyDown={onKeyDown}
    >
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label={t('ds.dateField.prev')} onClick={() => setFocusDay(addDays(`${focusDay.slice(0, 8)}01`, -1))} className="inline-flex h-8 w-8 items-center justify-center rounded-control text-muted hover:bg-surface-2">
          <PrevIcon className="h-4 w-4" aria-hidden="true" />
        </button>
        <p className="text-body-sm font-semibold text-ink" aria-live="polite">
          {title}
        </p>
        <button type="button" aria-label={t('ds.dateField.next')} onClick={() => setFocusDay(addDays(`${focusDay.slice(0, 8)}28`, 7))} className="inline-flex h-8 w-8 items-center justify-center rounded-control text-muted hover:bg-surface-2">
          <NextIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div role="grid" ref={grid} aria-label={title} className="grid grid-cols-7 gap-0.5 text-center">
        <div role="row" className="contents">
          {weekdays.map((w, i) => (
            <span key={i} role="columnheader" className="py-1 text-caption font-semibold text-muted">
              {w}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, r) => (
          <div role="row" key={r} className="contents">
            {days.slice(r * 7, r * 7 + 7).map((d) => {
              const outside = Number(d.slice(5, 7)) - 1 !== month0;
              const isSel = d === selected;
              const isToday = d === todayIso();
              return (
                <span role="gridcell" key={d} aria-selected={isSel || undefined}>
                  <button
                    type="button"
                    data-day={d}
                    tabIndex={d === focusDay ? 0 : -1}
                    disabled={!allowed(d)}
                    aria-label={formatDateField(d, locale)}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => onPick(d)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (allowed(d)) onPick(d);
                      }
                    }}
                    className={cn(
                      'num inline-flex h-9 w-9 items-center justify-center rounded-control text-body-sm transition-colors duration-micro',
                      isSel ? 'bg-primary-bold font-semibold text-on-bold' : 'hover:bg-surface-2',
                      outside && !isSel ? 'text-subtle' : !isSel ? 'text-ink' : '',
                      isToday && !isSel ? 'border border-primary' : '',
                      'disabled:cursor-not-allowed disabled:text-line-strong',
                    )}
                  >
                    {Number(d.slice(8, 10))}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={!allowed(today)}
          onClick={() => allowed(today) && onPick(today)}
          className="rounded-control px-2 py-1 text-body-sm font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:text-subtle disabled:no-underline"
        >
          {t('ds.dateField.today')}
        </button>
      </div>
    </div>
  );
}
