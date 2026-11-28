'use client';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Badge, Card } from '@/lib/components';
import { Money } from '@/lib/components/money';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';

type Diff = inferRouterOutputs<AppRouter>['catalog']['parsePreview']['diff'];

/** Price units (1/100 agorot) → agorot for <Money>, half away from zero. */
const unitsToAgorot = (u: number) => Math.sign(u) * Math.round(Math.abs(u) / 100);

/**
 * W3-10 · "מה ישתנה" — the import's effect before anything is written: rises
 * and falls with ₪/month (integer agorot from the server, the last 30 days'
 * quantity in the same unit), new items, items the file drops (never turned
 * off automatically) and unclear rows. A rise is T2 only when it moves ₪;
 * unclear rows are T4 (neutral).
 */
export function WhatChanges({ diff, stale }: { diff: Diff; stale: boolean }) {
  const t = useT(catalogNs);
  const locale = useLocale();
  const n = (v: number) => formatNumber(v, locale);
  const { counts } = diff;
  const moved = counts.up + counts.down > 0;

  return (
    <Card className="mt-4 space-y-3 p-4" aria-busy={stale}>
      <h3 className="text-base font-semibold text-ink">{t('import.diff.title')}</h3>
      {stale && <p className="text-sm text-subtle">{t('import.diff.checking')}</p>}
      {!moved && <p className="text-sm text-muted">{t('import.diff.none')}</p>}
      {moved && (
        <div className="flex flex-wrap items-center gap-2">
          {counts.up > 0 && (
            <Badge tone={diff.upAgorot > 0 ? 'warning-solid' : 'neutral'} icon={<ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />}>
              {t('import.diff.up', { count: n(counts.up) })}
              {diff.upAgorot > 0 && (
                <>
                  {' · +'}
                  <Money agorot={diff.upAgorot} />
                </>
              )}
            </Badge>
          )}
          {counts.down > 0 && (
            <Badge tone="neutral" icon={<ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />}>
              {t('import.diff.down', { count: n(counts.down) })}
              {diff.downAgorot > 0 && (
                <>
                  {' · −'}
                  <Money agorot={diff.downAgorot} />
                </>
              )}
            </Badge>
          )}
          <span className="text-xs text-subtle">
            {diff.upAgorot + diff.downAgorot > 0 ? t('import.diff.perMonth') : t('import.diff.noMonthly')}
          </span>
        </div>
      )}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {counts.new > 0 && <li>{t('import.diff.newRows', { count: n(counts.new) })}</li>}
        {counts.missing > 0 && (
          <li>
            {t('import.diff.missing', { count: n(counts.missing) })}{' '}
            <span className="text-xs text-subtle">{t('import.diff.missingHint')}</span>
          </li>
        )}
        {counts.unclear > 0 && <li>{t('import.diff.unclear', { count: n(counts.unclear) })}</li>}
      </ul>
      {moved && (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {diff.lines
            .filter((l) => l.kind === 'up' || l.kind === 'down')
            .slice(0, 10)
            .map((l) => (
              <li key={`${l.rowNumber}-${l.supplierSku ?? l.name}`} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate" lang="he">
                  {l.kind === 'up' ? '↑' : '↓'} {l.name}
                </span>
                <span className="shrink-0 text-end">
                  {l.beforeUnits != null && <Money agorot={unitsToAgorot(l.beforeUnits)} />} →{' '}
                  {l.afterUnits != null && <Money agorot={unitsToAgorot(l.afterUnits)} className="font-semibold" />}
                  {l.monthlyImpactAgorot !== 0 && (
                    <span className="ms-2 text-xs text-subtle">
                      ({l.monthlyImpactAgorot > 0 ? '+' : '−'}
                      <Money agorot={Math.abs(l.monthlyImpactAgorot)} />)
                    </span>
                  )}
                </span>
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}
