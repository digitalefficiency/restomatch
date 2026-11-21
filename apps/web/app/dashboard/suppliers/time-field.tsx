'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { TIME_CHIPS, maskTime, parseTime } from './time-logic';

/**
 * W2-11 · a 24 h time field: preset chips 06:00–14:00 every 30 min plus
 * "אחר" (a masked HH:MM, `inputMode=numeric`). Never a native `type=time`,
 * which renders 12 h AM/PM on some he-IL devices.
 */
export function TimeField({
  value,
  onChange,
  label,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  id: string;
}) {
  const t = useT(suppliersNs);
  const isChip = TIME_CHIPS.includes(value);
  const [other, setOther] = useState(!isChip && value !== '');
  const [draft, setDraft] = useState(isChip ? '' : value);
  useEffect(() => {
    if (TIME_CHIPS.includes(value)) setOther(false);
  }, [value]);
  const invalid = other && draft !== '' && parseTime(draft) === null;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {TIME_CHIPS.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={!other && value === c}
          onClick={() => {
            setOther(false);
            onChange(c);
          }}
          className={cn(
            'min-h-8 min-w-[3.25rem] rounded-full border px-2 text-xs tabular-nums [@media(pointer:coarse)]:min-h-11',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--c-focus))]',
            !other && value === c ? 'border-primary bg-primary text-on-primary' : 'border-line text-ink hover:border-primary/60',
          )}
        >
          {c}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={other}
        onClick={() => setOther(true)}
        className={cn(
          'min-h-8 rounded-full border px-3 text-xs [@media(pointer:coarse)]:min-h-11',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--c-focus))]',
          other ? 'border-primary bg-primary text-on-primary' : 'border-line text-ink hover:border-primary/60',
        )}
      >
        {t('time.other')}
      </button>
      {other ? (
        <span className="inline-flex flex-col">
          <input
            id={id}
            inputMode="numeric"
            dir="ltr"
            placeholder="HH:MM"
            maxLength={5}
            value={draft}
            aria-label={t('time.typed', { label })}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              const next = maskTime(e.target.value);
              setDraft(next);
              const ok = parseTime(next);
              if (ok) onChange(ok);
            }}
            className="h-9 w-20 rounded border border-line-strong bg-surface px-2 text-base text-ink tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--c-focus))]"
          />
          {invalid ? <span className="text-xs text-danger">{t('time.invalid')}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
