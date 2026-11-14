'use client';

import type { UserRole } from '@restomatch/db';
import { Badge, cn } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDateTime, formatNumber } from '@/lib/i18n/format';
import { automations as ns } from '@/lib/i18n/messages/automations';
import { labelForRole } from '@/lib/roles';

/** One row of automations.list / listForAdmin (dates arrive serialised). */
export interface AutomationRowView {
  id: string;
  key: string;
  kind: 'flag' | 'option' | 'always';
  controlKey: string | null;
  audience: ReadonlyArray<UserRole>;
  carriesIls: boolean;
  on: boolean;
  controllable: boolean;
  killed: boolean;
  blockedBy: string | null;
  measured: boolean;
  lastRunAt: Date | string | null;
  countThisWeek: number | null;
}

type T = ReturnType<typeof useT<typeof ns.he>>;

/** Typed access to the per-row copy (keys come from the server registry). */
export function itemText(t: T, key: string, part: 'name' | 'what' | 'when'): string {
  return t(`items.${key}.${part}` as Parameters<T>[0]);
}

export function rolesText(audience: ReadonlyArray<UserRole>, locale: 'he' | 'en'): string {
  return audience.map((r) => labelForRole(r, locale)).join(', ');
}

/**
 * The read-only part of a row: name, what / when / who, ₪ note, last run and
 * the count this week. The switch (owner only) is passed in as `control`.
 */
export function AutomationRowBody({ row, control }: { row: AutomationRowView; control?: React.ReactNode }) {
  const t = useT(ns);
  const locale = useLocale();
  const status = row.killed
    ? t('row.killed')
    : row.blockedBy
      ? t('row.blocked')
      : row.kind === 'always'
        ? t('row.always')
        : !row.controllable
          ? t('row.adminOnly')
          : null;
  const lastRun = !row.measured
    ? t('row.notMeasured')
    : row.lastRunAt
      ? t('row.lastRun', { when: formatDateTime(row.lastRunAt, locale) })
      : t('row.neverRan');

  return (
    <li data-automation={row.key} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">{itemText(t, row.key, 'name')}</h3>
          <Badge tone={row.on ? 'accent' : 'neutral'}>{row.on ? t('row.on') : t('row.off')}</Badge>
          <Badge tone="neutral">{row.carriesIls ? t('row.withIls') : t('row.noIls')}</Badge>
        </div>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-subtle">{t('row.what')}</dt>
          <dd className="text-ink">{itemText(t, row.key, 'what')}</dd>
          <dt className="text-subtle">{t('row.when')}</dt>
          <dd className="text-ink">{itemText(t, row.key, 'when')}</dd>
          <dt className="text-subtle">{t('row.who')}</dt>
          <dd className="text-ink">{rolesText(row.audience, locale)}</dd>
        </dl>
        <p className="flex flex-wrap gap-x-4 text-xs text-muted">
          <span>{lastRun}</span>
          {row.measured && row.countThisWeek !== null ? (
            <span>{t('row.week', { count: formatNumber(row.countThisWeek, locale) })}</span>
          ) : null}
        </p>
        {status ? <p className={cn('text-xs', row.killed ? 'text-warn' : 'text-muted')}>{status}</p> : null}
      </div>
      {control ? <div className="shrink-0">{control}</div> : null}
    </li>
  );
}
