'use client';

import { CalendarClock } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { StatusChip } from '../feedback/StatusChip';
import { daysUntil, deadlineTone, formatDay } from './format';

/** "נותרו 6 ימים · עד 31.10.2026": neutral above 7 days, warn ≤ 7, danger only when late (H8). */
export function DeadlineChip({ due, today, className }: { due: Date | string; today?: Date; className?: string }) {
  const locale = useLocale();
  const t = useT(components);
  const days = daysUntil(due, today);
  const date = formatDay(due, locale);
  const label =
    days < 0
      ? t('ds.deadline.late', { days: -days, date })
      : days === 0
        ? t('ds.deadline.today', { date })
        : t('ds.deadline.left', { days, date });
  const tone = deadlineTone(days);
  return (
    <StatusChip
      tone={tone}
      emphasis={tone === 'neutral' ? 'subtle' : 'bold'}
      icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />}
      label={label}
      className={className}
    />
  );
}
