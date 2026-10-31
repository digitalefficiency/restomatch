import { notFound } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge, Card, LinkButton, SectionHeader } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { originalProps } from '@/lib/i18n/original';
import { ils, priceText } from '../../recipes/recipe-ui';
import { AREAS, dayText, qtyText } from '../inventory-ui';
import { PriceSourceText } from '../count/count-screen';
import { AmendButton, CsvButton } from './count-actions';

/**
 * A finished count, read-only: the snapshot (unit cost + value per line) as of
 * its date. The chef sees quantities only (owner decision: no ₪; the server
 * sends none, `showMoney: false`).
 */
export default async function InventoryCountDetailPage({ params }: { params: Promise<{ countId: string }> }) {
  const { countId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(countId)) notFound();
  const caller = await createServerCaller();
  const { enabled } = await caller.inventory.enabled();
  if (!enabled) notFound();
  const count = await caller.inventory.get({ countId }).catch((e: unknown) => {
    if (e instanceof TRPCError && e.code === 'NOT_FOUND') return null;
    throw e;
  });
  if (!count) notFound();
  const [t, locale] = await Promise.all([getT(inventoryNs), getLocale()]);
  const name = (he: string, en: string | null) => {
    const text = locale === 'en' && en ? en : he;
    return <span {...originalProps(text)}>{text}</span>;
  };
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
      <Card padding="md" className="mb-4 flex flex-wrap items-baseline gap-3">
        {count.showMoney ? (
          <>
            <span className="text-sm text-muted">{t('home.value')}</span>
            <bdi dir="ltr" className="text-2xl font-bold tabular-nums text-ink">
              {ils(count.totalValueAgorot, locale, 0)}
            </bdi>
          </>
        ) : null}
        <span className="text-xs text-muted">{t('home.items', { counted: count.progress.counted })}</span>
        {count.showMoney && count.status === 'completed' ? (
          <span className="ms-auto">
            <CsvButton countId={count.id} />
          </span>
        ) : null}
      </Card>
      {AREAS.map((a) => {
        const ls = count.lines.filter((l) => l.storageArea === a && l.qty != null);
        if (ls.length === 0) return null;
        return (
          <section key={a} className="mb-5">
            <h2 className="mb-2 text-sm font-semibold text-muted">{t(`areas.${a}`)}</h2>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {ls.map((l) => (
                <li key={l.productId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block text-ink">{name(l.name, l.nameEn)}</span>
                    {l.priceSource && l.unitCost ? (
                      <span className="block text-[11px] text-subtle" data-testid="price-source">
                        <PriceSourceText unitCost={l.unitCost} unit={l.unit} source={l.priceSource} />
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3 tabular-nums text-muted">
                    <span>
                      <bdi dir="ltr">{qtyText(l.qty)}</bdi> {l.unit}
                    </span>
                    {!count.showMoney ? null : l.status === 'ok' ? (
                      <>
                        <span className="hidden sm:inline">
                          × <bdi dir="ltr">{priceText(l.unitCost, locale)}</bdi>
                        </span>
                        <bdi dir="ltr" className="font-semibold text-ink">
                          {ils(l.valueAgorot, locale)}
                        </bdi>
                      </>
                    ) : (
                      <Badge tone="neutral">{t('count.noPrice')}</Badge>
                    )}
                    {count.canAmend && count.status === 'completed' ? (
                      <AmendButton countId={count.id} productId={l.productId} unit={l.unit} qty={l.qty} />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
