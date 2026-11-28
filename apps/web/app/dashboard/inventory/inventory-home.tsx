'use client';

import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ClipboardList } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, LinkButton, Money, Spinner, friendlyError, useToast } from '@/lib/components';
import { moneyText } from '@/lib/components/money/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { dayText } from './inventory-ui';
import { PeriodCard } from './period-card';
import { ControlRoomCard } from './control-room';

type Outputs = inferRouterOutputs<AppRouter>['inventory'];
export type InventoryRole = 'owner' | 'manager' | 'chef' | 'bookkeeper';

/**
 * Start / continue a count, the period's food cost, and past counts. Per role:
 * owner/manager — everything, plus "count ready to close" when the chef handed
 * one off; chef — counts, the food cost as a % only, no ₪; bookkeeper — read
 * only (no open count, no start). `current` and `history` arrive from the server
 * as initial data: no spinner-then-fetch on first paint.
 */
export function InventoryHome({
  role,
  initialCurrent,
  initialHistory,
}: {
  role: InventoryRole;
  initialCurrent?: Outputs['current'];
  initialHistory?: Outputs['history'];
}) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const utils = trpc.useUtils();
  const reader = role === 'bookkeeper';
  const money = role !== 'chef';
  const closer = role === 'owner' || role === 'manager';
  const current = trpc.inventory.current.useQuery(undefined, {
    enabled: !reader,
    ...(initialCurrent !== undefined ? { initialData: initialCurrent } : {}),
  });
  const history = trpc.inventory.history.useQuery(undefined, initialHistory !== undefined ? { initialData: initialHistory } : {});
  const start = trpc.inventory.start.useMutation({
    // The count screen reads this same `inventory.current` entry: load the new draft first, then navigate.
    onSuccess: async () => {
      await utils.inventory.current.invalidate();
      router.push('/dashboard/inventory/count');
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const draft = current.data;
  const ils2 = (agorot: number) => moneyText(agorot / 100, 'line', locale);

  return (
    <div className="space-y-6">
      {reader ? null : (
        <Card padding="md" className="flex min-h-[4.5rem] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ClipboardList className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-muted">
                {draft
                  ? t('home.draftNote', { date: dayText(draft.countDate, locale), counted: draft.progress.counted, lines: draft.progress.lines })
                  : t('home.startHint')}
              </p>
              {draft?.submittedAt && closer ? (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm" data-testid="ready-to-close">
                  <Badge tone="warning-solid">{t('home.readyToClose', { counted: draft.progress.counted, lines: draft.progress.lines })}</Badge>
                  <span className="text-muted">{t('home.readyToCloseBy', { name: draft.submittedBy ?? t('home.teamMember') })}</span>
                </p>
              ) : null}
            </div>
          </div>
          {current.isLoading ? (
            <Spinner />
          ) : current.isError ? (
            <Button variant="secondary" className="touch-target" onClick={() => void current.refetch()}>
              {t('count.retry')}
            </Button>
          ) : draft ? (
            <LinkButton href="/dashboard/inventory/count" className="touch-target">
              {t('home.continue')}
            </LinkButton>
          ) : (
            <Button className="touch-target" loading={start.isPending} onClick={() => start.mutate()}>
              {t('home.start')}
            </Button>
          )}
        </Card>
      )}

      <PeriodCard percentOnly={!money} canEditSales={closer} />
      {/* W3-02b: the control room is all ₪ — owner / manager / bookkeeper only (the chef never mounts it). */}
      {money ? <ControlRoomCard /> : null}

      <section aria-labelledby="history-title">
        <h2 id="history-title" className="mb-3 text-sm font-semibold text-muted">
          {t('home.historyTitle')}
        </h2>
        {history.isLoading ? (
          <Spinner />
        ) : history.isError ? (
          <div className="text-sm text-muted" role="status">
            {friendlyError(history.error, tc)}{' '}
            <Button size="sm" variant="secondary" className="touch-target" onClick={() => void history.refetch()}>
              {t('count.retry')}
            </Button>
          </div>
        ) : (history.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t('home.historyEmpty')}</p>
        ) : (
          <ul className="space-y-2" data-testid="count-history">
            {history.data!.map((h) => (
              <li key={h.id}>
                <Link
                  href={`/dashboard/inventory/${h.id}`}
                  className="touch-target flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{dayText(h.countDate, locale)}</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                      {t('home.items', { counted: h.counted })}
                      {money && h.unpriced > 0 ? <Badge tone="neutral">{t('home.unpriced', { count: h.unpriced })}</Badge> : null}
                    </span>
                    {money && h.foodValueAgorot != null && h.totalValueAgorot != null ? (
                      <span className="block text-sm text-muted" data-testid="history-stock-line">
                        {t('home.stockLine', { food: ils2(h.foodValueAgorot), total: ils2(h.totalValueAgorot) })}
                      </span>
                    ) : null}
                  </span>
                  {money && h.foodValueAgorot != null ? (
                    <span className="text-end">
                      <span className="block text-sm text-muted">{t('home.foodValue')}</span>
                      <Money agorot={h.foodValueAgorot} context="tile" className="font-semibold text-ink" />
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
