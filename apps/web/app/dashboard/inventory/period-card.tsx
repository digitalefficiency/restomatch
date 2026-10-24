'use client';

import { useState } from 'react';
import { Calculator } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, Input, LinkButton, Spinner, friendlyError, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { ils, pct } from '../recipes/recipe-ui';
import { dayText } from './inventory-ui';

/**
 * Actual food cost for the period between the last two completed counts
 * (flag `inventoryCount`): opening + purchases − closing, as a % of food sales.
 * Its own KPI — never added into the invoice leak hero. "Unexplained usage"
 * (actual − theoretical) is T2 (solid badge + ₪ + one CTA) only above 2 points
 * of sales; otherwise it is calm.
 */
export function PeriodCard({ compact = false }: { compact?: boolean }) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();
  const q = trpc.inventory.period.useQuery(undefined, { staleTime: 30_000 });
  const [sales, setSales] = useState('');
  const [salesError, setSalesError] = useState<string | null>(null);
  const setMeta = trpc.inventory.setMeta.useMutation({
    onSuccess: () => void utils.inventory.period.invalidate(),
    onError: (e) => toast.error(friendlyError(e, tc)),
  });

  if (q.isLoading) {
    return (
      <Card padding="md" className="flex items-center justify-center" data-testid="food-cost-period">
        <Spinner />
      </Card>
    );
  }
  const p = q.data;
  if (!p) return null;

  if (!p.available) {
    return (
      <Card padding="md" data-testid="food-cost-period">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <Calculator className="h-4 w-4 text-muted" aria-hidden="true" />
          {t('period.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{p.reason === 'needOpening' ? t('period.needOpening') : t('period.noCounts')}</p>
        {compact ? (
          <LinkButton href="/dashboard/inventory" size="sm" variant="secondary" className="touch-target mt-3">
            {t('period.open')}
          </LinkButton>
        ) : null}
      </Card>
    );
  }

  const saveSales = (e: React.FormEvent) => {
    e.preventDefault();
    const v = sales.trim().replace(/,/g, '');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(v)) {
      setSalesError(t('period.salesInvalid'));
      return;
    }
    setSalesError(null);
    setMeta.mutate({ countId: p.closing.id, foodSalesExVat: v });
  };

  const overTarget = p.actualBp != null && p.actualBp > p.targetBp;
  return (
    <Card padding="md" data-testid="food-cost-period">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Calculator className="h-4 w-4 text-muted" aria-hidden="true" />
            {t('period.title')}
          </h2>
          <p className="text-xs text-muted">
            {t('period.range', { from: dayText(p.opening.countDate, locale), to: dayText(p.closing.countDate, locale) })} · {t('period.separateNote')}
          </p>
        </div>
        {compact ? (
          <LinkButton href="/dashboard/inventory" size="sm" variant="ghost" className="touch-target">
            {t('period.open')}
          </LinkButton>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-bold tabular-nums text-ink" data-testid="food-cost-actual">
          {p.actualBp != null ? pct(p.actualBp, locale) : ils(p.actualAgorot, locale, 0)}
        </span>
        {p.actualBp != null ? (
          <span className="text-sm text-muted">
            {t('period.ofSales')} · <bdi dir="ltr" className="tabular-nums">{ils(p.actualAgorot, locale, 0)}</bdi> ·{' '}
            <span className={overTarget ? 'font-semibold text-warn' : ''}>{t('period.target', { target: pct(p.targetBp, locale) })}</span>
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted">
        {t('period.formula', {
          opening: ils(p.opening.valueAgorot, locale, 0),
          purchases: ils(p.purchases.purchasesAgorot, locale, 0),
          closing: ils(p.closing.valueAgorot, locale, 0),
        })}
      </p>
      {!compact ? (
        <p className="mt-1 text-xs text-subtle">
          {t('period.purchasesNote', {
            count: p.purchases.invoiceCount,
            nonFood: ils(p.purchases.nonFoodAgorot, locale, 0),
            dups: ils(p.purchases.duplicatesAgorot, locale, 0),
            credits: ils(p.purchases.creditsAgorot, locale, 0),
          })}
          {p.purchases.accruedNotes > 0 ? (
            <> {t('period.accruedNote', { count: p.purchases.accruedNotes, value: ils(p.purchases.accruedAgorot, locale, 0) })}</>
          ) : null}
        </p>
      ) : null}

      <div className="mt-3 border-t border-line pt-3 text-sm">
        {p.salesAgorot != null ? (
          <p className="text-muted">
            {t('period.sales')}: <bdi dir="ltr" className="tabular-nums font-semibold text-ink">{ils(p.salesAgorot, locale, 0)}</bdi>{' '}
            <span className="text-xs">({p.salesSource === 'pos' ? t('period.salesPos') : t('period.salesManual')})</span>
          </p>
        ) : (
          <form onSubmit={saveSales} className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-xs text-muted" htmlFor="period-sales">
              {t('period.salesMissing')}
              <Input
                id="period-sales"
                inputMode="decimal"
                autoComplete="off"
                dir="ltr"
                className="mt-1"
                value={sales}
                aria-invalid={salesError ? true : undefined}
                aria-describedby={salesError ? 'period-sales-error' : undefined}
                placeholder={t('period.sales')}
                onChange={(e) => setSales(e.target.value)}
              />
            </label>
            <Button type="submit" size="sm" variant="secondary" loading={setMeta.isPending}>
              {t('period.salesSave')}
            </Button>
            {salesError ? (
              <p id="period-sales-error" role="alert" className="w-full text-xs text-danger">
                {salesError}
              </p>
            ) : null}
          </form>
        )}
      </div>

      {p.theoreticalAgorot != null && p.varianceAgorot != null ? (
        <div className="mt-3 border-t border-line pt-3 text-sm" data-testid="food-cost-variance">
          <p className="text-muted">
            {t('period.theoretical')}: <bdi dir="ltr" className="tabular-nums text-ink">{ils(p.theoreticalAgorot, locale, 0)}</bdi>
            {p.theoreticalBp != null ? <> ({pct(p.theoreticalBp, locale)})</> : null}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{t('period.variance')}:</span>
            <bdi dir="ltr" className={p.varianceAlert ? 'font-bold tabular-nums text-ink' : 'tabular-nums text-ink'}>
              {ils(p.varianceAgorot, locale, 0)}
            </bdi>
            {p.varianceBp != null ? <span className="text-muted">({pct(p.varianceBp, locale)})</span> : null}
            {p.varianceAlert ? <Badge tone="warning-solid">{t('period.varianceAlert')}</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-subtle">{t('period.varianceHint')}</p>
          {p.varianceAlert ? (
            <LinkButton href="/dashboard/recipes" size="sm" className="touch-target mt-2">
              {t('period.investigate')}
            </LinkButton>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
