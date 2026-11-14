import { notFound } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { createServerCaller } from '@/lib/trpc/server';
import { Card, LinkButton, Money, SectionHeader } from '@/lib/components';
import { moneyText } from '@/lib/components/money/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { dayText } from '../inventory-ui';
import { CsvButton } from './count-actions';
import { ClosedCount } from './closed-count';

/**
 * A count, read-only: the snapshot (unit cost + value per line) as of its date,
 * every line including the uncounted ones, with the change since the previous
 * count. The chef sees quantities only (the server sends no ₪ key); the
 * bookkeeper reads closed counts (no write controls).
 */
export default async function InventoryCountDetailPage({ params }: { params: Promise<{ countId: string }> }) {
  const { countId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(countId)) notFound();
  const caller = await createServerCaller();
  const { enabled } = await caller.inventory.enabled();
  if (!enabled) notFound();
  const count = await caller.inventory.get({ countId }).catch((e: unknown) => {
    if (e instanceof TRPCError && (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN')) return null;
    throw e;
  });
  if (!count) notFound();
  const [t, locale] = await Promise.all([getT(inventoryNs), getLocale()]);
  return (
    <div>
      <LinkButton href="/dashboard/inventory" variant="ghost" size="sm" className="touch-target -ms-2 mb-2">
        {t('count.back')}
      </LinkButton>
      <SectionHeader
        level={1}
        title={t('detail.title', { date: dayText(count.countDate, locale) })}
        subtitle={count.status === 'completed' ? t('detail.lockedNote', { date: dayText(count.countDate, locale) }) : undefined}
      />
      <Card padding="md" className="mb-4 flex flex-wrap items-center gap-3">
        {count.showMoney && count.foodValueAgorot != null && count.totalValueAgorot != null ? (
          <div className="min-w-0">
            <p className="text-sm text-muted">{t('home.foodValue')}</p>
            <p className="text-2xl font-bold text-ink">
              <Money agorot={count.foodValueAgorot} context="tile" />
            </p>
            <p className="text-sm text-muted" data-testid="stock-line">
              {t('detail.stockLine', {
                food: moneyText(count.foodValueAgorot / 100, 'line', locale),
                total: moneyText(count.totalValueAgorot / 100, 'line', locale),
              })}
            </p>
          </div>
        ) : null}
        <span className="text-sm text-muted">{t('home.items', { counted: count.progress.counted })}</span>
        {count.showMoney && count.status === 'completed' ? (
          <span className="ms-auto">
            <CsvButton countId={count.id} />
          </span>
        ) : null}
      </Card>
      <ClosedCount count={count} />
    </div>
  );
}
