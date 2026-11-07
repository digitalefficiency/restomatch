'use client';

import { useState } from 'react';
import { Calculator } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, Input, LinkButton, Money, Spinner, friendlyError, useToast } from '@/lib/components';
import { moneyText } from '@/lib/components/money/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatPercent } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import { components } from '@/lib/i18n/messages/components';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { dayText } from './inventory-ui';

/** Basis points → "31.4%". */
function pct(bp: number | null | undefined, locale: Locale): string {
  return bp == null ? '—' : formatPercent(bp / 10_000, locale, 1);
}
/** Agorot → ₪ text for a sentence (the frozen formatIls via moneyText). */
function ils(agorot: number | null | undefined, locale: Locale, digits = 2): string {
  return agorot == null ? '—' : moneyText(agorot / 100, digits === 0 ? 'tile' : 'line', locale);
}

/**
 * Actual food cost for the period between the last two completed counts
 * (flag `inventoryCount`): opening + purchases − closing, as a % of food sales.
 * Its own KPI — never added into the invoice leak hero. "Unexplained usage"
 * (actual − theoretical) is T2 (solid badge + ₪ + one CTA) only above 2 points
 * of sales; otherwise it is calm.
 */
export function PeriodCard({
  compact = false,
  percentOnly = false,
  canEditSales = true,
}: {
  compact?: boolean;
  /** The chef (owner decision): the food cost % only — reads `foodCostPercent`, which carries no ₪ key. */
  percentOnly?: boolean;
  /** Food sales are a manager+ write (`setSales`, audited); the bookkeeper reads them. */
  canEditSales?: boolean;
}) {
  if (percentOnly) return <PercentCard compact={compact} />;
  return <MoneyPeriodCard compact={compact} canEditSales={canEditSales} />;
}

/** The chef's card: % and dates only. */
function PercentCard({ compact }: { compact: boolean }) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const locale = useLocale();
  const q = trpc.inventory.foodCostPercent.useQuery(undefined, { staleTime: 30_000 });
  const p = q.data;
  return (
    <Card padding="md" data-testid="food-cost-percent">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
        <Calculator className="h-4 w-4 text-muted" aria-hidden="true" />
        {t('period.title')}
      </h2>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <p className="mt-1 text-sm text-muted" role="status">
          {friendlyError(q.error, tc)}
        </p>
      ) : !p ? null : p.available ? (
        <>
          <p className="text-sm text-muted">{t('period.range', { from: dayText(p.openingDate, locale), to: dayText(p.closingDate, locale) })}</p>
          {p.implausible ? (
            <p className="mt-2 text-sm text-muted">
              <span className="font-semibold text-ink">{t('period.implausibleTitle')}</span> {t('period.implausibleBody')}
            </p>
          ) : (
            <p className="mt-2 text-3xl font-bold tabular-nums text-ink" data-testid="food-cost-actual">
              {pct(p.actualBp, locale)}
            </p>
          )}
          <p className="text-sm text-muted">
            {t('period.percentOnly')} {t('period.target', { target: pct(p.targetBp, locale) })}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">{p.reason === 'needOpening' ? t('period.needOpening') : t('period.noCounts')}</p>
      )}
      {compact ? (
        <LinkButton href="/dashboard/inventory" size="sm" variant="secondary" className="touch-target mt-3">
          {t('period.open')}
        </LinkButton>
      ) : null}
    </Card>
  );
}

function MoneyPeriodCard({ compact, canEditSales }: { compact: boolean; canEditSales: boolean }) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();
  const q = trpc.inventory.period.useQuery(undefined, { staleTime: 30_000 });
  const [sales, setSales] = useState('');
  const [editingSales, setEditingSales] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const setMeta = trpc.inventory.setSales.useMutation({
    onSuccess: () => {
      setEditingSales(false);
      void utils.inventory.period.invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });

  if (q.isLoading) {
    return (
      <Card padding="md" className="flex items-center justify-center" data-testid="food-cost-period">
        <Spinner />
      </Card>
    );
  }
  if (q.isError) {
    return (
      <Card padding="md" data-testid="food-cost-period">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <Calculator className="h-4 w-4 text-muted" aria-hidden="true" />
          {t('period.title')}
        </h2>
        <p className="mt-1 text-sm text-muted" role="status">
          {friendlyError(q.error, tc)}
        </p>
        <Button size="sm" variant="secondary" className="touch-target mt-2" onClick={() => void q.refetch()}>
          {t('count.retry')}
        </Button>
      </Card>
    );
  }
  const p = q.data;
  if (!p) return null;

  const closingId = 'closing' in p && p.closing ? p.closing.id : null;
  const saveSales = (e: React.FormEvent) => {
    e.preventDefault();
    // "12345,50" (decimal comma, as on a Hebrew keypad) vs "12,345.50" / "12,345" (thousands).
    const raw = sales.trim().replace(/[\s₪]/g, '');
    const v = /^\d+,\d{1,2}$/.test(raw) ? raw.replace(',', '.') : raw.replace(/,/g, '');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(v)) {
      setSalesError(t('period.salesInvalid'));
      return;
    }
    setSalesError(null);
    if (closingId) setMeta.mutate({ countId: closingId, foodSalesExVat: v });
  };
  const salesBy = p.salesEntry ? (
    <p className="text-sm text-muted" data-testid="sales-by">
      {t('period.salesBy', { name: p.salesEntry.by ?? '—', date: dayText(p.salesEntry.at.slice(0, 10), locale) })}
    </p>
  ) : null;
  const salesForm = !canEditSales ? null : (
    <form onSubmit={saveSales} className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-xs text-muted" htmlFor="period-sales">
        {t('period.salesMissing')}
        <Input
          id="period-sales"
          inputMode="decimal"
          autoComplete="off"
          dir="ltr"
          className="mt-1 text-base"
          value={sales}
          aria-invalid={salesError ? true : undefined}
          aria-describedby={salesError ? 'period-sales-error' : undefined}
          placeholder={t('period.sales')}
          onChange={(e) => setSales(e.target.value)}
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" className="touch-target" loading={setMeta.isPending}>
        {t('period.salesSave')}
      </Button>
      {salesError ? (
        <p id="period-sales-error" role="alert" className="w-full text-xs text-danger">
          {salesError}
        </p>
      ) : null}
    </form>
  );

  if (!p.available) {
    return (
      <Card padding="md" data-testid="food-cost-period">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <Calculator className="h-4 w-4 text-muted" aria-hidden="true" />
          {t('period.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{p.reason === 'needOpening' ? t('period.needOpening') : t('period.noCounts')}</p>
        {'purchaseFoodCost' in p && p.purchaseFoodCost ? (
          <div className="mt-3 border-t border-line pt-3" data-testid="purchase-food-cost">
            <p className="text-xs font-semibold text-muted">{t('period.purchaseFoodCost')}</p>
            <p className="text-2xl font-bold tabular-nums text-ink">
              {p.purchaseFoodCost.bp != null ? pct(p.purchaseFoodCost.bp, locale) : <Money agorot={p.purchaseFoodCost.purchasesAgorot} context="tile" />}
            </p>
            <p className="text-xs text-muted">
              {p.purchaseFoodCost.salesAgorot != null
                ? t('period.purchaseFoodCostHint', {
                    purchases: ils(p.purchaseFoodCost.purchasesAgorot, locale, 0),
                    sales: ils(p.purchaseFoodCost.salesAgorot, locale, 0),
                    from: dayText(p.purchaseFoodCost.from, locale),
                    to: dayText(p.purchaseFoodCost.to, locale),
                  })
                : null}
            </p>
            {p.purchaseFoodCost.salesAgorot == null ? <div className="mt-2">{salesForm}</div> : salesBy}
          </div>
        ) : null}
        {compact ? (
          <LinkButton href="/dashboard/inventory" size="sm" variant="secondary" className="touch-target mt-3">
            {t('period.open')}
          </LinkButton>
        ) : null}
      </Card>
    );
  }


  // Amber only on a full, plausible count: a partial or implausible one never reads as over target.
  const overTarget = p.actualBp != null && p.actualBp > p.targetBp && p.coverageComplete && !p.implausible;
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

      {p.implausible ? (
        <p className="mt-3 text-sm text-muted" data-testid="food-cost-implausible">
          <span className="font-semibold text-ink">{t('period.implausibleTitle')}</span> {t('period.implausibleBody')}
        </p>
      ) : null}
      <div className={p.implausible ? 'hidden' : 'mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1'}>
        <span className="text-3xl font-bold tabular-nums text-ink" data-testid="food-cost-actual">
          {p.actualBp != null ? pct(p.actualBp, locale) : <Money agorot={p.actualAgorot} context="tile" />}
        </span>
        {p.actualBp != null ? (
          <span className="text-sm text-muted">
            {t('period.ofSales')} · <Money agorot={p.actualAgorot} context="tile" /> ·{' '}
            <span className={overTarget ? 'font-semibold text-warn' : ''}>{t('period.target', { target: pct(p.targetBp, locale) })}</span>
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted" data-testid="food-cost-formula">
        {t('period.formula', {
          opening: ils(p.opening.valueAgorot, locale),
          purchases: ils(p.purchases.purchasesAgorot, locale),
          credits: ils(p.purchases.creditsAgorot, locale),
          closing: ils(p.closing.valueAgorot, locale),
          total: ils(p.actualAgorot, locale),
        })}
      </p>
      {!p.coverageComplete ? (
        <p className="mt-1 text-xs text-muted" data-testid="food-cost-coverage">
          {t('period.coverageCaveat', {
            parts: [p.opening, p.closing]
              .filter((e) => !e.coverage.complete)
              .map((e) => t('period.coveragePart', { date: dayText(e.countDate, locale), counted: e.coverage.counted - e.coverage.unpriced, lines: e.coverage.lines }))
              .join(' · '),
          })}
        </p>
      ) : null}
      {p.purchases.creditsToReceiveAgorot > 0 ? (
        <p className="mt-1 text-xs text-muted" data-testid="credits-to-receive">
          {t('period.creditsToReceive', { value: ils(p.purchases.creditsToReceiveAgorot, locale, 0) })}
        </p>
      ) : null}
      {!compact ? (
        <p className="mt-1 text-xs text-subtle">
          {t('period.purchasesNote', {
            count: p.purchases.invoiceCount,
            nonFood: ils(p.purchases.nonFoodAgorot, locale, 0),
            beverages: ils(p.purchases.beverageAgorot, locale, 0),
            dups: ils(p.purchases.duplicatesAgorot, locale, 0),
          })}
          {p.purchases.missingTotalCount > 0 ? <> {t('period.missingTotal', { count: p.purchases.missingTotalCount })}</> : null}
        </p>
      ) : null}
      {!compact && (p.purchases.accruedAgorot > 0 || p.purchases.reversedAgorot > 0) ? (
        <div className="mt-2 text-xs text-muted" data-testid="receipt-basis">
          <p className="font-semibold">{t('period.receiptBasis')}</p>
          <ul className="mt-0.5 space-y-0.5">
            {p.purchases.accruedAgorot > 0 ? (
              <li>
                + <Money agorot={p.purchases.accruedAgorot} /> · {t('period.accruedLine', { count: p.purchases.accruedNotes })}
              </li>
            ) : null}
            {p.purchases.reversedAgorot > 0 ? (
              <li>
                − <Money agorot={p.purchases.reversedAgorot} /> · {t('period.reversedLine')}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 border-t border-line pt-3 text-sm">
        {p.salesAgorot != null && !(editingSales && p.salesSource === 'manual') ? (
          <p className="flex flex-wrap items-center gap-x-2 text-muted">
            {t('period.sales')}: <Money agorot={p.salesAgorot} context="tile" className="font-semibold text-ink" />{' '}
            <span className="text-sm">({p.salesSource === 'pos' ? t('period.salesPos') : t('period.salesManual')})</span>
            {p.salesSource === 'manual' && canEditSales ? (
              <Button
                size="sm"
                variant="ghost"
                className="touch-target"
                onClick={() => {
                  setSales(String((p.salesAgorot ?? 0) / 100));
                  setEditingSales(true);
                }}
              >
                {t('period.salesEdit')}
              </Button>
            ) : null}
          </p>
        ) : (
          salesForm
        )}
        {p.salesSource === 'manual' && !editingSales ? salesBy : null}
      </div>

      {p.theoreticalAgorot == null && p.theoreticalCoverageBp != null ? (
        <p className="mt-3 border-t border-line pt-3 text-xs text-muted" data-testid="food-cost-theory-partial">
          {p.theoreticalIncomplete && p.theoreticalCoverageBp >= 9000
            ? t('period.theoryIncomplete')
            : t('period.theoryPartial', { coverage: pct(p.theoreticalCoverageBp, locale) })}
        </p>
      ) : null}
      {p.theoreticalAgorot != null && p.varianceAgorot != null ? (
        <div className="mt-3 border-t border-line pt-3 text-sm" data-testid="food-cost-variance">
          <p className="text-muted">
            {t('period.theoretical')}: <Money agorot={p.theoreticalAgorot} context="tile" className="text-ink" />
            {p.theoreticalBp != null ? <> ({pct(p.theoreticalBp, locale)})</> : null}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{t('period.variance')}:</span>
            <Money agorot={p.varianceAgorot} context="tile" className={p.varianceAlert ? 'font-bold text-ink' : 'text-ink'} />
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
