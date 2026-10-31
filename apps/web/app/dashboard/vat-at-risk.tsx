'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, FileWarning } from 'lucide-react';
import { Badge, Button, cn } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { originalProps } from '@/lib/i18n/original';
import { vat } from '@/lib/i18n/messages/vat';
import { formatIls } from '@/lib/money';
import { supplierRequestText } from '@/lib/vat/requestText';

export interface VatAtRiskRowView {
  invoiceId: string;
  invoiceNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoiceDate: string;
  totalExclVat: number;
  vatAtRisk: number;
  allocationNumber: string | null;
  daysLeft: number;
}

const SHOWN = 3;

/**
 * "VAT at risk" card (flag vatAtRisk), next to — never inside — the leak hero.
 * A separate figure in the warn family: it is not a leak and is never summed
 * into one. T2 when there is something to act on (solid warn badge + ₪ + one
 * CTA that opens the Hebrew request text to copy); T3 calm when all clear.
 */
export function VatAtRiskCard({
  rows,
  total,
  thresholdIls,
  restaurantName,
}: {
  rows: VatAtRiskRowView[];
  total: number;
  thresholdIls: number;
  restaurantName: string;
}) {
  const t = useT(vat);
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const threshold = formatIls(thresholdIls, { locale });
  const supplierLabel = (r: Pick<VatAtRiskRowView, 'supplierName' | 'supplierNameEn'>) =>
    (locale === 'en' && r.supplierNameEn ? r.supplierNameEn : r.supplierName) ?? '—';

  // One request per supplier, listing all of that supplier's invoices.
  const requests = useMemo(() => {
    const by = new Map<string, VatAtRiskRowView[]>();
    for (const r of rows) {
      const k = r.supplierId ?? `none:${r.invoiceId}`;
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by.entries()].map(([key, list]) => ({
      key,
      supplier: list[0]!.supplierName ?? 'ספק',
      shown: supplierLabel(list[0]!),
      text: supplierRequestText({ supplierName: list[0]!.supplierName ?? 'ספק', restaurantName, invoices: list }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, restaurantName, locale]);

  if (rows.length === 0) {
    return (
      <section
        data-testid="vat-at-risk-card"
        data-state="clear"
        className="mt-4 flex items-start gap-3 rounded-2xl border border-line bg-surface p-5 shadow-card"
      >
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="font-bold text-ink">{t('card.clear', { threshold })}</h2>
          <p className="mt-1 text-sm text-muted">{t('card.clearHint')}</p>
        </div>
      </section>
    );
  }

  // H8: the deadline sets the tone — neutral while far, warn inside 30 days, danger inside 7.
  const minDays = Math.min(...rows.map((r) => r.daysLeft));
  const urgency: 'neutral' | 'warn' | 'danger' = minDays <= 7 ? 'danger' : minDays <= 30 ? 'warn' : 'neutral';
  const tone = {
    neutral: { border: 'border-line', rail: 'bg-line-strong', icon: 'text-muted', badge: 'neutral' as const, amount: 'text-ink' },
    warn: { border: 'border-warn/40', rail: 'bg-warn', icon: 'text-warn', badge: 'warning-solid' as const, amount: 'text-warn' },
    danger: { border: 'border-danger/40', rail: 'bg-danger', icon: 'text-danger', badge: 'danger-solid' as const, amount: 'text-danger' },
  }[urgency];

  return (
    <section
      data-testid="vat-at-risk-card"
      data-state="at-risk"
      data-urgency={urgency}
      className={cn('relative mt-4 overflow-hidden rounded-2xl border bg-surface p-5 shadow-card', tone.border)}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 start-0 w-1', tone.rail)} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-bold text-ink">
            <FileWarning className={cn('h-5 w-5 shrink-0', tone.icon)} aria-hidden="true" />
            {t('card.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('card.subtitle', { threshold })}</p>
        </div>
        <Badge tone={tone.badge}>
          {rows.length === 1 ? t('card.countOne') : t('card.count', { count: formatNumber(rows.length, locale) })}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-1">
        <div>
          <p className="text-xs font-semibold text-muted">{t('card.amountLabel')}</p>
          <p className={cn('text-2xl font-bold tabular-nums', tone.amount)} data-testid="vat-at-risk-total">
            {formatIls(total, { locale })}
          </p>
        </div>
        <p className="text-xs text-subtle">{t('card.separate')}</p>
      </div>

      <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
        {rows.slice(0, SHOWN).map((r) => {
          const name = supplierLabel(r);
          return (
            <li key={r.invoiceId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <Link
                href={`/dashboard/invoices/${r.invoiceId}`}
                className="touch-target w-full min-w-0 font-semibold text-ink hover:text-primary hover:underline"
              >
                <span {...originalProps(name)}>{name}</span>
                <span className="text-muted">
                  {' · '}
                  {r.invoiceNumber ? t('card.invoiceNo', { number: r.invoiceNumber }) : t('card.noInvoiceNo')}
                  {' · '}
                  {formatDate(r.invoiceDate, locale)}
                </span>
              </Link>
              <span className="text-xs text-muted">{r.allocationNumber ? t('card.badNumber') : t('card.noNumber')}</span>
              <span className="whitespace-nowrap text-xs font-semibold text-ink">
                {r.daysLeft === 0 ? t('card.lastDay') : t('card.daysLeft', { days: formatNumber(r.daysLeft, locale) })}
              </span>
              <span className="ms-auto whitespace-nowrap font-semibold tabular-nums text-ink">
                {formatIls(r.vatAtRisk, { locale })}
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > SHOWN ? (
        <p className="mt-2 text-xs text-muted">{t('card.more', { count: formatNumber(rows.length - SHOWN, locale) })}</p>
      ) : null}

      <div className="mt-5">
        <Button className="min-h-12 w-full sm:w-auto" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="vat-request-cta">
          {t('card.cta')}
        </Button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4" data-testid="vat-request-panel">
          <p className="text-sm text-muted">{t('request.hint')}</p>
          {requests.map((q) => (
            <div key={q.key} className="rounded-xl border border-line bg-surface-2 p-4">
              <p className="mb-2 text-sm font-semibold text-ink">
                {t('request.title')} — <span {...originalProps(q.shown)}>{q.shown}</span>
              </p>
              <textarea
                readOnly
                dir="rtl"
                lang="he"
                rows={Math.min(12, q.text.split('\n').length + 1)}
                value={q.text}
                aria-label={`${t('request.title')} — ${q.shown}`}
                className="w-full resize-y rounded-lg border border-line-strong bg-surface p-3 text-sm text-ink"
                data-testid="vat-request-text"
              />
              <Button
                variant="secondary"
                size="sm"
                className={cn('mt-2 min-h-11')}
                onClick={async () => {
                  await navigator.clipboard?.writeText(q.text).catch(() => null);
                  setCopied(q.key);
                }}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {copied === q.key ? t('request.copied') : t('request.copy')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
