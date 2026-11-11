import Link from 'next/link';
import { Badge, Card, LinkButton } from '@/lib/components';
import { Money } from '@/lib/components/money';
import { createServerCaller } from '@/lib/trpc/server';
import { getLocale, getT } from '@/lib/i18n/server';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { formatIls } from '@/lib/money';
import { loadLeakCardOnce, loadSupplierOverview } from './overview-data';
import { deliveryText, rhythmParts } from './rhythm';

/**
 * W2-11 · "what do I do with this supplier now, in ₪". The leak ₪ itself lives
 * in the header (one home per number); this tab carries the act-now cards
 * (₪-ranked, at most 3), the order rhythm, 6 months of spend and the last 5
 * invoices. The WHY (the leak card) renders below it, on demand.
 */
export async function SupplierOverviewTab({ supplierId, leakCard }: { supplierId: string; leakCard: boolean }) {
  const caller = await createServerCaller();
  const [overview, queue, card, t, locale] = await Promise.all([
    loadSupplierOverview(supplierId),
    caller.approvals.queueSummary({ supplierIds: [supplierId] }).catch(() => null),
    leakCard ? loadLeakCardOnce(supplierId).catch(() => null) : Promise.resolve(null),
    getT(suppliersNs),
    getLocale(),
  ]);

  type Card = { key: string; label: string; agorot: number; count: number | null; href: string; cta: string; tone: 'danger' | 'warn' };
  const cards: Card[] = [];
  if (queue && queue.toDecide.count > 0) {
    cards.push({
      key: 'awaiting',
      label: t('overview.awaiting'),
      agorot: Math.round(queue.toDecide.amountIls * 100),
      count: queue.toDecide.count,
      href: `/dashboard/approvals?sup=${supplierId}`,
      cta: t('overview.awaitingCta'),
      tone: 'danger',
    });
  }
  // The credit-request letter ₪ (the claims page's own model) — never the open
  // leak, which would count the lines still awaiting a decision twice.
  if (card && card.letterAgorot != null && card.letterAgorot > 0) {
    cards.push({
      key: 'claim',
      label: t('overview.openToClaim'),
      agorot: card.letterAgorot,
      count: null,
      href: `/dashboard/leaks/claims?sup=${supplierId}`,
      cta: t('overview.openToClaimCta'),
      tone: 'warn',
    });
  }
  // TODO(W2-12): the over-contract card ("מעל חוזה") once findOverContractLines is on the base.
  cards.sort((a, b) => b.agorot - a.agorot);

  const rhythm = overview?.rhythm ? rhythmParts(overview.rhythm, locale) : null;
  // No order schedule: still name the next delivery (an open order or a saved delivery day).
  const next = !rhythm && overview?.nextDelivery ? deliveryText(overview.nextDelivery, locale) : null;
  const spend = overview?.spend ?? [];
  const spendAria =
    spend.length > 1
      ? t('overview.spendAria', {
          from: spend[0]!.month,
          to: spend[spend.length - 1]!.month,
          values: spend.map((s) => formatIls(s.agorot / 100, { locale })).join(', '),
        })
      : undefined;

  return (
    <div className="space-y-6" data-testid="supplier-overview">
      <section aria-labelledby="act-now" className="space-y-3">
        <h2 id="act-now" className="text-lg font-bold text-ink">
          {t('overview.actNowTitle')}
        </h2>
        {cards.length === 0 ? (
          <p className="text-sm text-muted">{overview ? t('overview.allClear') : t('overview.unavailable')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.slice(0, 3).map((c) => (
              <li key={c.key}>
                <Card padding="md" className="flex h-full flex-col gap-2" data-testid={`act-now-${c.key}`}>
                  <Badge tone={c.tone === 'danger' ? 'danger-solid' : 'warning-solid'} className="self-start">
                    {c.label}
                  </Badge>
                  <Money agorot={c.agorot} context="tile" locale={locale} className="text-2xl font-bold" />
                  {c.count != null ? (
                    <span className="text-xs text-subtle">
                      {c.count === 1 ? t('overview.lineOne') : t('overview.lines', { count: c.count })}
                    </span>
                  ) : null}
                  <LinkButton href={c.href} size="sm" variant={c.tone === 'danger' ? 'primary' : 'secondary'} className="mt-auto self-start">
                    {c.cta}
                  </LinkButton>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rhythm" className="space-y-1">
        <h2 id="rhythm" className="text-sm font-semibold text-muted">
          {t('overview.rhythmTitle')}
        </h2>
        {rhythm ? (
          <p className="text-base text-ink tabular-nums" data-testid="order-rhythm">
            {t('overview.rhythm', rhythm)}
          </p>
        ) : next ? (
          <p className="text-base text-ink tabular-nums" data-testid="next-delivery">
            {t('overview.nextDelivery', { delivery: next })}
          </p>
        ) : (
          <p className="text-sm text-muted">
            {t('overview.rhythmNone')}{' '}
            <Link className="font-semibold text-primary underline-offset-2 hover:underline" href={`/dashboard/suppliers/${supplierId}?tab=details#days-and-times`}>
              {t('overview.rhythmSet')}
            </Link>
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-2">
          <h2 className="text-sm font-semibold text-muted">{t('overview.spendTitle')}</h2>
          {overview ? (
            <SpendBars spend={spend} locale={locale} label={spendAria} />
          ) : (
            <p className="text-sm text-muted">{t('overview.unavailable')}</p>
          )}
        </Card>
        <Card padding="md" className="space-y-2">
          <h2 className="text-sm font-semibold text-muted">{t('overview.lastInvoicesTitle')}</h2>
          {!overview ? (
            <p className="text-sm text-muted">{t('overview.unavailable')}</p>
          ) : overview.lastInvoices.length === 0 ? (
            <p className="text-sm text-muted">{t('overview.noInvoices')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {overview.lastInvoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/dashboard/invoices/${inv.id}`} className="flex min-h-11 min-w-0 items-center gap-3 text-ink hover:underline [@media(pointer:fine)]:min-h-6">
                    <span className="truncate">
                      {inv.invoiceNumber ? t('overview.invoiceNo', { number: inv.invoiceNumber }) : t('overview.invoiceNoNumber')}
                    </span>
                    <span className="shrink-0 text-xs text-subtle tabular-nums">
                      {new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit' }).format(new Date(inv.at))}
                    </span>
                  </Link>
                  <Money value={inv.totalAgorot == null ? null : inv.totalAgorot / 100} context="line" locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * Six months of checked spend as labelled bars: each month with its ₪ (0 dp),
 * oldest first in reading order. A real axis, not a bare line (lab finding).
 */
function SpendBars({ spend, locale, label }: { spend: { month: string; agorot: number }[]; locale: 'he' | 'en'; label?: string }) {
  const max = Math.max(1, ...spend.map((s) => s.agorot));
  const monthName = (m: string) =>
    new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
  return (
    <figure aria-label={label} className="m-0">
      <ol className="grid grid-cols-6 items-end gap-2" data-testid="spend-bars">
        {spend.map((s) => (
          <li key={s.month} className="flex flex-col items-center gap-1">
            <span className="text-[11px] text-ink tabular-nums">{formatIls(s.agorot / 100, { locale })}</span>
            <span aria-hidden="true" className="block w-full rounded-t bg-primary/60" style={{ height: `${Math.max(2, Math.round((s.agorot / max) * 64))}px` }} />
            <span className="text-[11px] text-muted">{monthName(s.month)}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
