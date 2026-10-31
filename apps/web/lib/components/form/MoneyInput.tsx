'use client';

import { useEffect, useId, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from '../cn';
import { fieldBase } from '../Input';
import { formatMoneyField, parseMoneyInput } from './parse';

type NativeProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type'>;

/**
 * A ₪ amount field (C7). `type="text" inputMode="decimal"` (never
 * `type="number"`), typed LTR and right-aligned in Hebrew; the ₪ adornment
 * sits outside the value at the visual left. Accepts "7,5", "7.5" and
 * "1,250.50"; formats thousands on blur. The value is integer AGOROT (or null
 * while empty/invalid); with `name`, a hidden input posts the shekel decimal
 * ("1250.50") for plain forms. Parsing never touches `formatIls`.
 */
export function MoneyInput({
  value,
  defaultValue,
  onValueChange,
  name,
  className,
  onBlur,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...rest
}: NativeProps & {
  /** Controlled value in agorot. */
  value?: number | null;
  defaultValue?: number | null;
  onValueChange?: (agorot: number | null) => void;
}) {
  const t = useT(components);
  const errorId = useId();
  const initial = value ?? defaultValue ?? null;
  const [text, setText] = useState(initial === null ? '' : formatMoneyField(initial));
  const [agorot, setAgorot] = useState<number | null>(initial);
  const [invalid, setInvalid] = useState(false);

  // A controlled value changed from outside (reset, server data).
  useEffect(() => {
    if (value === undefined || value === agorot) return;
    setAgorot(value);
    setText(value === null ? '' : formatMoneyField(value));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className={cn('w-full', className)}>
      <div dir="ltr" className="flex items-stretch">
        <span
          aria-hidden="true"
          className="inline-flex items-center rounded-s-control border border-e-0 border-line-strong bg-surface-2 px-3 text-muted"
        >
          ₪
        </span>
        <input
          {...rest}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          dir="ltr"
          value={text}
          aria-invalid={invalid || ariaInvalid || undefined}
          aria-describedby={[describedBy, invalid ? errorId : null].filter(Boolean).join(' ') || undefined}
          className={cn(fieldBase, 'num w-full min-w-0 rounded-s-none text-right')}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const parsed = parseMoneyInput(next);
            setAgorot(parsed);
            if (invalid && (parsed !== null || next.trim() === '')) setInvalid(false);
            onValueChange?.(parsed);
          }}
          onBlur={(e) => {
            const parsed = parseMoneyInput(text);
            if (parsed !== null) setText(formatMoneyField(parsed));
            setInvalid(text.trim() !== '' && parsed === null);
            onBlur?.(e);
          }}
        />
      </div>
      {name ? <input type="hidden" name={name} value={agorot === null ? '' : (agorot / 100).toFixed(2)} /> : null}
      {invalid ? (
        <p id={errorId} className="mt-1.5 text-sm text-danger">
          {t('ds.moneyInput.invalid')}
        </p>
      ) : null}
    </div>
  );
}
