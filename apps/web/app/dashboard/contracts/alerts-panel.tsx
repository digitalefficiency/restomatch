'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, RefreshCw, TrendingUp, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, EmptyState, Skeleton, displayName, friendlyError, useToast } from '@/lib/components';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { components } from '@/lib/i18n/messages/components';
import { periodParts } from './logic';

/**
 * Price-trend alerts as cards: "{product} +18% over 3 weeks at {supplier}:
 * ₪6.20 → ₪7.32", the cheaper-supplier hint when the sweep found one, dismiss
 * (owner/manager) and "check now" (re-run detection). A toggle shows the
 * dismissed history instead of the open alerts.
 */
export function AlertsPanel({ canManage }: { canManage: boolean }) {
  const t = useT(contractsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [showDismissed, setShowDismissed] = useState(false);

  const status = showDismissed ? 'dismissed' : 'open';
  const list = trpc.priceAlerts.list.useQuery({ status });
  const dismiss = trpc.priceAlerts.dismiss.useMutation();
  const refresh = trpc.priceAlerts.refresh.useMutation();

  const money = (v: string | number) => formatIls(Number(v), { locale, maximumFractionDigits: 2 });
  const day = (d: Date | string) => formatDate(d, locale, { day: '2-digit', month: '2-digit' });

  function invalidate() {
    void utils.priceAlerts.list.invalidate();
    void utils.priceAlerts.openCount.invalidate();
    // Nav badge + overview card are server-rendered.
    router.refresh();
  }

  async function onDismiss(id: string) {
    try {
      await dismiss.mutateAsync({ id });
      toast.success(t('alerts.dismissedToast'));
      invalidate();
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  async function onRefresh() {
    try {
      const res = await refresh.mutateAsync();
      toast.success(t('alerts.checked', { count: formatNumber(res.created, locale) }));
      invalidate();
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line bg-surface-2 accent-primary"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
          />
          {t('alerts.showDismissed')}
        </label>
        {canManage ? (
          <Button size="sm" variant="secondary" loading={refresh.isPending} onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('alerts.checkNow')}
          </Button>
        ) : (
          <p className="text-xs text-subtle">{t('readOnly')}</p>
        )}
      </div>

      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" role="status" aria-label={t('alerts.loading')}>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : list.error ? (
        <p role="alert" className="text-sm text-danger">
          {friendlyError(list.error, tc)}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<BellRing className="h-6 w-6" />}
          title={showDismissed ? t('alerts.emptyDismissed') : t('alerts.emptyTitle')}
          description={showDismissed ? undefined : t('alerts.emptyBody')}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rows.map((a) => {
            const pct = Number(a.pctChange);
            const period = periodParts(a.windowDays);
            const product = displayName(a.productName, a.productNameEn, locale).primary;
            const supplier = displayName(a.supplierName, a.supplierNameEn, locale).primary;
            const pctText = `${pct > 0 ? '+' : ''}${formatPercent(pct, locale, 0)}`;
            return (
              <li key={a.id}>
                <Card elevated flow className="h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-start gap-2 font-semibold text-ink">
                        <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                        <span>
                          {t('alerts.headline', {
                            product,
                            pct: pctText,
                            period: t(`alerts.period.${period.unit}`, { count: formatNumber(period.count, locale) }),
                            supplier,
                          })}
                        </span>
                      </p>
                      <p className="mt-2 font-mono text-lg font-bold tabular-nums text-danger">
                        {/* Each amount is bidi-isolated (FSI…PDI) so the he-IL ₪ marks can't
                            reorder the pair; the arrow follows the reading direction. */}
                        {t('alerts.priceMove', {
                          from: `\u2068${money(a.startPrice)}\u2069`,
                          to: `\u2068${money(a.endPrice)}\u2069`,
                        })}
                      </p>
                    </div>
                    {a.status === 'dismissed' ? (
                      <Badge tone="neutral">{t('alerts.dismissedBadge')}</Badge>
                    ) : canManage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title={t('alerts.dismiss')}
                        aria-label={t('alerts.dismiss')}
                        disabled={dismiss.isPending}
                        onClick={() => onDismiss(a.id)}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-subtle">
                    <bdi>{t('alerts.range', { from: day(a.startAt), to: day(a.endAt) })}</bdi>
                    <span aria-hidden="true"> · </span>
                    {t('alerts.observations', { count: formatNumber(a.observations, locale) })}
                    <span aria-hidden="true"> · </span>
                    {t('alerts.window', {
                      days: formatNumber(a.windowDays, locale),
                      threshold: formatPercent(Number(a.thresholdPct), locale, 1),
                    })}
                  </p>
                  {a.cheaperSupplierName && a.cheaperPrice != null ? (
                    <p className="mt-3 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-primary">
                      {t('alerts.cheaper', {
                        supplier: displayName(a.cheaperSupplierName, a.cheaperSupplierNameEn, locale).primary,
                        price: money(a.cheaperPrice),
                      })}
                    </p>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
