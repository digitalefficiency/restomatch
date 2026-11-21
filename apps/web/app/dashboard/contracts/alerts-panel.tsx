'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { EmptyState, Menu, Skeleton, friendlyError, useToast } from '@/lib/components';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { components } from '@/lib/i18n/messages/components';
import { AlertCard } from './queue-panel';

/**
 * Price-trend alerts ("מחירים שעלו"). W2-12: the same card as the queue — the
 * baseline via PriceMove, the contract and 90-day median, ≈₪/month, T2 only at
 * ≥3 % and ≥₪50/month (otherwise neutral), the cheaper offer as an order
 * action, dismiss with a 10 s undo. "בדיקה עכשיו" lives in the overflow menu.
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
  const refresh = trpc.priceAlerts.refresh.useMutation();

  async function onRefresh() {
    try {
      const res = await refresh.mutateAsync();
      toast.success(t('alerts.checked', { count: formatNumber(res.created, locale) }));
      void utils.priceAlerts.list.invalidate();
      void utils.contracts.queue.invalidate();
      router.refresh();
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-line bg-surface-2 accent-primary"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
          />
          {t('alerts.showDismissed')}
        </label>
        {canManage ? (
          <Menu label={t('alerts.more')} items={[{ label: t('alerts.checkNow'), onClick: () => void onRefresh(), disabled: refresh.isPending }]} />
        ) : (
          <p className="text-xs text-subtle">{t('readOnly')}</p>
        )}
      </div>

      {list.isLoading ? (
        <div className="space-y-3" role="status" aria-label={t('alerts.loading')}>
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
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
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.id}>
              <AlertCard item={{ alert: a, impact: a.impact }} canManage={canManage} dismissReasons={false} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
