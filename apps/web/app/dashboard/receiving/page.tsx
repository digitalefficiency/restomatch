import Link from 'next/link';
import { ArrowLeft, Clock, PackageCheck, Truck } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge, Card, EmptyState, SectionHeader, type BadgeTone } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import type { Translator } from '@/lib/i18n/translate';

export const dynamic = 'force-dynamic';

/** Label + tone for the (optional) in-progress goods_receipt status. */
function receiptBadge(
  status: string | null,
  t: Translator<typeof receiving.he>,
): { label: string; tone: BadgeTone } | null {
  if (!status) return null;
  const map: Record<string, { label: string; tone: BadgeTone }> = {
    pending: { label: t('inbox.badge.pending'), tone: 'warning' },
    partial: { label: t('inbox.badge.partial'), tone: 'warning' },
    completed: { label: t('inbox.badge.completed'), tone: 'accent' },
  };
  return map[status] ?? { label: status, tone: 'info' };
}

export default async function ReceivingPage() {
  const caller = await createServerCaller();
  const [expectations, locale, t] = await Promise.all([
    caller.receiving.todayExpectations(),
    getLocale(),
    getT(receiving),
  ]);

  return (
    <div>
      <SectionHeader title={t('inbox.title')} subtitle={t('inbox.subtitle')} />

      {expectations.length === 0 ? (
        <EmptyState
          icon={<PackageCheck className="h-6 w-6" />}
          title={t('inbox.emptyTitle')}
          description={t('inbox.emptyDescription')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {expectations.map((e) => {
            const badge = receiptBadge(e.receiptStatus, t);
            const supplierName = locale === 'en' && e.supplierNameEn ? e.supplierNameEn : e.supplierName;
            const expectedTime = e.hasDeliveryDate
              ? formatDate(e.expectedAt, locale, { hour: '2-digit', minute: '2-digit' })
              : t('inbox.noDeliveryDate');
            return (
              <Link
                key={e.poId}
                href={`/dashboard/receiving/${e.poId}`}
                data-testid="receiving-po-card"
                className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              ><Card
                elevated
                flow
                padding="md"
                className="block h-full transition-all group-hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/12 text-primary">
                      <Truck className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-ink">{supplierName}</h3>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        <span className={e.hasDeliveryDate ? 'font-mono tabular-nums' : 'text-warn'}>
                          {expectedTime}
                        </span>
                        <span className="text-subtle">·</span>
                        <span className="tabular-nums">
                          {t('inbox.items', { count: formatNumber(e.lineCount, locale) })}
                        </span>
                      </div>
                    </div>
                  </div>
                  {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
                  {/* The label matches what the receipt page will open: a closed
                      (partial / completed) receipt opens read-only, not a count. */}
                  <span className="text-muted" data-testid="receiving-po-state">
                    {!e.receiptId
                      ? t('inbox.openReceipt')
                      : e.receiptStatus === 'pending'
                        ? t('inbox.continueReceipt')
                        : t('inbox.closedReceipt')}
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-primary">
                    {e.receiptId && e.receiptStatus !== 'pending' ? t('inbox.viewReceipt') : t('inbox.receiveGoods')}
                    <ArrowLeft
                      className="h-4 w-4 transition-transform ltr:-scale-x-100 rtl:group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </div>
              </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
