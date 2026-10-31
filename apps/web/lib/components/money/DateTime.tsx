'use client';

import { useLocale } from '@/lib/i18n/client';
import { formatRelative } from '@/lib/i18n/format';
import { cnMerge as cn } from '../cn';
import { formatClock, formatDay } from './format';

export type DateTimeVariant = 'date' | 'datetime' | 'time' | 'relative';

/**
 * A date in Heebo `.num` (not mono): `dd.MM.yyyy · HH:mm` in Hebrew (Israel
 * time). `relative` ("לפני 3 ימים") always carries the absolute value in `title`.
 */
export function DateTime({
  value,
  variant = 'date',
  now,
  className,
}: {
  value: Date | string | number;
  variant?: DateTimeVariant;
  /** Reference time for `relative` (tests, lab seed). */
  now?: Date;
  className?: string;
}) {
  const locale = useLocale();
  const d = new Date(value);
  const absolute = `${formatDay(d, locale)} · ${formatClock(d, locale)}`;
  const text =
    variant === 'date'
      ? formatDay(d, locale)
      : variant === 'time'
        ? formatClock(d, locale)
        : variant === 'relative'
          ? formatRelative(d, locale, now)
          : absolute;
  return (
    <time
      dateTime={d.toISOString()}
      title={variant === 'relative' || variant === 'date' ? absolute : undefined}
      className={cn('num whitespace-nowrap', className)}
    >
      {text}
    </time>
  );
}
