'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { cn, Spinner } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { chain } from '@/lib/i18n/messages/chain';

/**
 * Simple local period control: this month / last month / any past month.
 * (The shared advanced view controls land later; this is intentionally small.)
 */
export function MonthSelector({
  month,
  currentMonth,
  previousMonth,
}: {
  month: string;
  currentMonth: string;
  previousMonth: string;
}) {
  const t = useT(chain);
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (m: string) =>
    start(() => router.push(m === currentMonth ? '/dashboard/chain' : `/dashboard/chain?month=${m}`));
  const chip = (active: boolean) =>
    cn(
      'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
      active ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : 'text-muted hover:bg-surface-2 hover:text-ink',
    );
  return (
    <div
      role="group"
      aria-label={t('dashboard.period.label')}
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface p-1"
    >
      <button type="button" className={chip(month === currentMonth)} onClick={() => go(currentMonth)} aria-pressed={month === currentMonth}>
        {t('dashboard.period.current')}
      </button>
      <button type="button" className={chip(month === previousMonth)} onClick={() => go(previousMonth)} aria-pressed={month === previousMonth}>
        {t('dashboard.period.previous')}
      </button>
      <label className="flex items-center gap-1.5 px-1 text-xs text-muted">
        <span className="sr-only">{t('dashboard.period.pick')}</span>
        <input
          type="month"
          value={month}
          max={currentMonth}
          min="2020-01"
          data-testid="chain-month"
          onChange={(e) => {
            if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) go(e.target.value);
          }}
          className="rounded-lg border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-ink [color-scheme:dark] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
      </label>
      {pending ? <Spinner className="h-4 w-4" /> : null}
    </div>
  );
}
