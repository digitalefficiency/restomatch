'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Card, Skeleton } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { formatIls } from '@/lib/money';

/**
 * Ordered · received · billed · gap ₪ per line (W2-06 §5.5). Numbers are
 * right-aligned in both locales (owner); the ₪ column exists only when the
 * server sent ₪ (the receiver's payload has none). Unknown is "—", never ₪0.
 */
export function ThreeWayCard({ poId }: { poId: string }) {
  const t = useT(ordersNs);
  const locale = useLocale();
  const [why, setWhy] = useState(false);
  const q = trpc.orders.threeWay.useQuery({ poId }, { retry: false });
  if (q.isLoading) return <Skeleton className="mt-6 h-40" />;
  if (q.isError || !q.data) return null;
  const d = q.data;
  if (!d.hasReceipt && !d.hasInvoice) {
    return (
      <Card className="mt-6" data-testid="three-way">
        <p className="text-sm text-muted">{t('w2.threeWay.none')}</p>
      </Card>
    );
  }
  const showMoney = d.lines.some((l) => 'gapIls' in l);
  const num = (n: number | null | undefined) => (n == null ? t('w2.threeWay.unknown') : formatNumber(n, locale, { maximumFractionDigits: 3 }));
  const ils = (n: number | null | undefined) => (n == null ? t('w2.threeWay.unknown') : formatIls(n, { locale, maximumFractionDigits: 2 }));
  return (
    <Card className="mt-6 overflow-x-auto" data-testid="three-way">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-bold text-ink">{t('w2.threeWay.title')}</h2>
        <button
          type="button"
          aria-expanded={why}
          onClick={() => setWhy((v) => !v)}
          className="min-h-11 rounded px-1 text-sm text-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('w2.why')}
        </button>
      </div>
      {why ? <p className="mb-3 text-sm text-muted">{t('w2.threeWay.why')}</p> : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-subtle">
            <th scope="col" className="py-2 text-start font-medium">{t('w2.threeWay.item')}</th>
            <th scope="col" className="py-2 text-right font-medium">{t('w2.threeWay.ordered')}</th>
            <th scope="col" className="py-2 text-right font-medium">{t('w2.threeWay.received')}</th>
            <th scope="col" className="py-2 text-right font-medium">{t('w2.threeWay.billed')}</th>
            {showMoney ? <th scope="col" className="py-2 text-right font-medium">{t('w2.threeWay.gap')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.poLineId} className="border-b border-line/60 last:border-0" data-testid="three-way-row">
              <td className="py-2 text-ink">{l.name || t('w2.threeWay.unknown')}</td>
              <td className="py-2 text-right tabular-nums">{num(l.ordered)}</td>
              <td className="py-2 text-right tabular-nums">{num(l.received)}</td>
              <td className="py-2 text-right tabular-nums">{num(l.billed)}</td>
              {showMoney ? (
                <td className={`py-2 text-right tabular-nums ${(l as { gapIls?: number | null }).gapIls ? 'font-semibold text-ink' : 'text-muted'}`}>
                  {ils((l as { gapIls?: number | null }).gapIls)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
        {showMoney ? (
          <tfoot>
            <tr className="text-sm font-semibold text-ink">
              <td className="pt-2" colSpan={4}>{t('w2.threeWay.total')}</td>
              <td className="pt-2 text-right tabular-nums" data-testid="three-way-total">
                {ils((d as { gapTotalIls?: number | null }).gapTotalIls)}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </Card>
  );
}
