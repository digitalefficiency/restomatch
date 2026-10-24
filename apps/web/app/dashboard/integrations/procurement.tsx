'use client';

import { useState } from 'react';
import { PlugZap } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, Spinner } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatDateTime, formatNumber } from '@/lib/i18n/format';
import { integrations as integrationsNs } from '@/lib/i18n/messages/integrations';
import { formatIls } from '@/lib/money';

type Platform = 'marketman' | 'zester';

/** MarketMan / Zester: connection state + "what a sync would bring" on sample data. */
export function ProcurementProviders() {
  const t = useT(integrationsNs);
  const locale = useLocale();
  const providers = trpc.integrations.procurementProviders.useQuery();
  const [open, setOpen] = useState<Platform | null>(null);
  const preview = trpc.integrations.procurementPreview.useQuery({ platform: open ?? 'marketman' }, { enabled: open !== null });

  return (
    <section aria-labelledby="int-proc-title">
      <h2 id="int-proc-title" className="mb-1 flex items-center gap-2 text-lg font-bold text-ink">
        <PlugZap className="h-5 w-5 text-primary" aria-hidden="true" /> {t('procurement.title')}
      </h2>
      <p className="mb-3 text-sm text-muted">{t('procurement.body')}</p>
      {providers.isLoading ? (
        <Spinner className="h-4 w-4" />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(providers.data ?? []).map((p) => (
            <li key={p.platform}>
              <Card elevated className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-base font-bold text-ink">{p.displayName}</p>
                  <Badge tone={p.connected ? 'accent' : 'neutral'}>
                    {p.connected ? (p.mode === 'sample' ? t('procurement.sample') : t('procurement.live')) : t('procurement.notConnected')}
                  </Badge>
                </div>
                {p.lastSyncAt ? (
                  <p className="text-xs text-subtle">
                    {t('procurement.lastSync', { when: formatDateTime(p.lastSyncAt, locale) })}
                  </p>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-auto self-start"
                  aria-expanded={open === p.platform}
                  aria-controls={`proc-preview-${p.platform}`}
                  onClick={() => setOpen(open === p.platform ? null : (p.platform as Platform))}
                >
                  {open === p.platform ? t('procurement.hide') : t('procurement.preview')}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <Card elevated padding="none" className="mt-3 overflow-hidden" id={`proc-preview-${open}`}>
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-bold text-ink">{t('procurement.previewTitle')}</p>
            {preview.data ? (
              <p className="text-xs text-subtle">
                {t('procurement.counts', {
                  suppliers: formatNumber(preview.data.suppliers, locale),
                  products: formatNumber(preview.data.products, locale),
                  orders: formatNumber(preview.data.orders.length, locale),
                })}
              </p>
            ) : null}
          </div>
          {preview.isLoading || !preview.data ? (
            <div className="px-4 py-4">
              <Spinner className="h-4 w-4" />
            </div>
          ) : (
            <ul className="divide-y divide-line/60 text-sm">
              {preview.data.orders.map((o) => (
                <li key={o.externalId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                  <span className="font-mono text-xs text-subtle" dir="ltr">
                    {o.externalId}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink" lang="he" dir="auto">
                    {o.supplierName}
                  </span>
                  <Badge tone="info">{t(`procurement.statuses.${o.status}`)}</Badge>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {o.expectedDeliveryAt
                      ? formatDate(o.expectedDeliveryAt, locale, { day: '2-digit', month: '2-digit' })
                      : '—'}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-ink">
                    {o.totalEstimated != null ? formatIls(o.totalEstimated, { locale, maximumFractionDigits: 2 }) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line px-4 py-3 text-xs text-subtle">{t('procurement.activate')}</p>
        </Card>
      ) : null}
    </section>
  );
}
