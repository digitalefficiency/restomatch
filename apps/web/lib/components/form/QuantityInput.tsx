'use client';

import { useEffect, useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cn } from '../cn';
import { fieldBase } from '../Input';
import { formatQuantityField, parseQuantityInput } from './parse';

type NativeProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'step' | 'min' | 'max'>;

/**
 * A quantity field: the same parsing as MoneyInput ("2,5" = 2.5), a unit
 * adornment and an optional − / + stepper (48 px; 56 px in field mode).
 * Replaces `type="number"` (no wheel/locale surprises).
 */
export function QuantityInput({
  value,
  defaultValue,
  onValueChange,
  unit,
  step = 1,
  min = 0,
  max,
  stepper = false,
  maxDecimals = 3,
  name,
  className,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...rest
}: NativeProps & {
  value?: number | null;
  defaultValue?: number | null;
  onValueChange?: (value: number | null) => void;
  unit?: React.ReactNode;
  step?: number;
  min?: number;
  max?: number;
  stepper?: boolean;
  maxDecimals?: number;
}) {
  const t = useT(components);
  const errorId = useId();
  const initial = value ?? defaultValue ?? null;
  const [text, setText] = useState(initial === null ? '' : formatQuantityField(initial, maxDecimals));
  const [qty, setQty] = useState<number | null>(initial);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (value === undefined || value === qty) return;
    setQty(value);
    setText(value === null ? '' : formatQuantityField(value, maxDecimals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(next: number | null) {
    const clamped = next === null ? null : Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, next));
    setQty(clamped);
    setText(clamped === null ? '' : formatQuantityField(clamped, maxDecimals));
    setInvalid(false);
    onValueChange?.(clamped);
  }

  const stepBtn =
    'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface text-ink transition-colors duration-micro hover:bg-surface-2 disabled:text-subtle [[data-mode=field]_&]:h-14 [[data-mode=field]_&]:w-14';

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center gap-2">
        {stepper ? (
          <button type="button" className={stepBtn} aria-label={t('ds.quantity.decrease')} disabled={qty !== null && qty <= min} onClick={() => commit((qty ?? 0) - step)}>
            <Minus className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-stretch">
          <input
            {...rest}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            dir="ltr"
            value={text}
            aria-invalid={invalid || ariaInvalid || undefined}
            aria-describedby={[describedBy, invalid ? errorId : null].filter(Boolean).join(' ') || undefined}
            className={cn(fieldBase, 'num w-full min-w-0 rtl:text-right', unit ? 'rounded-e-none' : '')}
            onChange={(e) => {
              setText(e.target.value);
              const parsed = parseQuantityInput(e.target.value, maxDecimals);
              setQty(parsed);
              onValueChange?.(parsed);
            }}
            onBlur={() => {
              const parsed = parseQuantityInput(text, maxDecimals);
              if (parsed !== null) setText(formatQuantityField(parsed, maxDecimals));
              setInvalid(text.trim() !== '' && parsed === null);
            }}
          />
          {unit ? (
            <span className="inline-flex items-center rounded-e-control border border-s-0 border-line-strong bg-surface-2 px-3 text-body-sm text-muted">
              {unit}
            </span>
          ) : null}
        </div>
        {stepper ? (
          <button type="button" className={stepBtn} aria-label={t('ds.quantity.increase')} disabled={max !== undefined && qty !== null && qty >= max} onClick={() => commit((qty ?? 0) + step)}>
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {name ? <input type="hidden" name={name} value={qty ?? ''} /> : null}
      {invalid ? (
        <p id={errorId} className="mt-1.5 text-sm text-danger">
          {t('ds.quantity.invalid')}
        </p>
      ) : null}
    </div>
  );
}
