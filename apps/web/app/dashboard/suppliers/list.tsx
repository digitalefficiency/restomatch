'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Card, LoadMore, type BadgeTone } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';

type Scorecard = inferRouterOutputs<AppRouter>['owner']['suppliers'][number];

const PAGE = 9;

/**
 * Supplier scorecards grid with "load more". `owner.suppliers` has no createdAt
 * cursor — `limit` slices the (deterministically ordered) array — so we grow the
 * limit and replace the list each page.
 */
export function SuppliersList({ initial }: { initial: Scorecard[] }) {
  const t = useT(suppliersNs);
  const locale = useLocale();
  const [items, setItems] = useState<Scorecard[]>(initial);
  const [limit, setLimit] = useState(initial.length);
  const [hasMore, setHasMore] = useState(initial.length >= PAGE);
  const [loading, setLoading] = useState(false);

  const utils = trpc.useUtils();

  async function loadMore() {
    const nextLimit = limit + PAGE;
    setLoading(true);
    try {
      const next = await utils.owner.suppliers.fetch({ limit: nextLimit });
      const grew = next.length > items.length;
      setItems(next);
      setLimit(nextLimit);
      // If the array filled the requested limit it may still have more; if it
      // came back short of the limit (or didn't grow), we've reached the end.
      setHasMore(grew && next.length >= nextLimit);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((s) => (
          <Card key={s.supplierId} as="article" elevated flow>
            <header className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/dashboard/suppliers/${s.supplierId}`}
                  className="truncate text-lg font-bold tracking-tight text-ink underline-offset-4 hover:text-primary hover:underline"
                >
                  {locale === 'en' && s.supplierNameEn ? s.supplierNameEn : s.supplierName}
                </Link>
                <p className="mt-1 text-xs tabular-nums text-subtle">
                  {t('scores.runs', { count: formatNumber(s.matchRunsCount, locale) })}
                </p>
              </div>
              <TrendBadge trend={s.trend} label={t(`scores.trend.${s.trend}`)} />
            </header>
            <dl className="space-y-3 border-t border-line pt-4">
              <Row
                label={t('scores.cleanMatches')}
                value={formatPercent(s.cleanMatchPct / 100, locale)}
                tone={s.cleanMatchPct >= 80 ? 'good' : 'warning'}
              />
              <Row
                label={t('scores.avgPriceDelta')}
                value={formatPercent(s.avgPriceDeltaPct, locale)}
                tone={s.avgPriceDeltaPct > 0.03 ? 'warning' : 'default'}
              />
              <Row
                label={t('scores.duplicates')}
                value={formatNumber(s.duplicateInvoicesCount, locale)}
                tone={s.duplicateInvoicesCount > 0 ? 'danger' : 'default'}
              />
            </dl>
          </Card>
        ))}
      </div>
      <LoadMore onClick={loadMore} loading={loading} hasMore={hasMore} />
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'warning' | 'danger';
}) {
  const color =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warning'
        ? 'text-warn'
        : tone === 'good'
          ? 'text-primary'
          : 'text-ink';
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`font-mono text-base font-bold tabular-nums ${color}`} dir="ltr">
        {value}
      </dd>
    </div>
  );
}

function TrendBadge({ trend, label }: { trend: 'up' | 'down' | 'flat'; label: string }) {
  const map: Record<typeof trend, { tone: BadgeTone; icon: React.ReactNode }> = {
    up: { tone: 'accent', icon: <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> },
    down: { tone: 'danger', icon: <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" /> },
    flat: { tone: 'neutral', icon: <Minus className="h-3.5 w-3.5" aria-hidden="true" /> },
  };
  const { tone, icon } = map[trend];
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}
