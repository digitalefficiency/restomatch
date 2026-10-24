'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { Check, ExternalLink, FileImage, Plus, Receipt, ShieldCheck } from 'lucide-react';
import { useRef } from 'react';
import type { ReconciliationResult } from '../_mock';
import type { CapturedImage } from '../_state';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatDate } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import { formatIls } from '@/lib/money';

interface Props {
  supplierName: string;
  result: ReconciliationResult | null;
  confirmedAt: string | null;
  capturedImage: CapturedImage | null;
  onReset: () => void;
  /** Label of the reset button (defaults to "another receipt"). */
  resetLabel?: string;
}

export function Confirmed({
  supplierName,
  result,
  confirmedAt,
  capturedImage,
  onReset,
  resetLabel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT(receiving);
  const locale = useLocale();
  const dir = useDir();

  useGSAP(
    () => {
      gsap.from('.confirm-check', {
        scale: 0,
        opacity: 0,
        duration: 0.6,
        ease: 'back.out(2)',
      });
      gsap.from('.confirm-content', {
        y: 16,
        opacity: 0,
        stagger: 0.08,
        duration: 0.5,
        ease: 'power3.out',
        delay: 0.2,
      });
    },
    { scope: ref },
  );

  const time = confirmedAt ? formatDate(confirmedAt, locale, { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div ref={ref} dir={dir} className="max-w-md mx-auto text-center py-8" data-testid="receipt-confirmed">
      <div className="confirm-check w-24 h-24 rounded-full bg-primary text-on-primary mx-auto mb-6 flex items-center justify-center shadow-glow-primary">
        <Check className="w-12 h-12" strokeWidth={3} />
      </div>

      <h1 className="confirm-content text-3xl font-extrabold tracking-tight text-ink mb-2">
        {t('steps.confirmed.title')}
      </h1>
      <p className="confirm-content text-muted mb-8">
        {t('steps.confirmed.subtitle', { time, supplier: supplierName })}
      </p>

      <div className="confirm-content relative overflow-hidden rounded-2xl border border-line bg-surface p-5 mb-6 text-start space-y-3 shadow-card">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
        <RowItem
          icon={<Receipt className="w-4 h-4" />}
          label={t('steps.confirmed.invoice')}
          value={result?.invoiceMeta.invoiceNumber ?? '—'}
        />
        <RowItem
          icon={<ShieldCheck className="w-4 h-4" />}
          label={t('steps.confirmed.verified')}
          value={t('steps.confirmed.verifiedValue', {
            matched: result?.summary.matchedCount ?? 0,
            manual:
              (result?.summary.qtyDiffCount ?? 0) +
              (result?.summary.priceDiffCount ?? 0) +
              (result?.summary.unorderedCount ?? 0) +
              (result?.summary.missingCount ?? 0) +
              (result?.summary.pendingCount ?? 0),
          })}
        />
        {result && result.summary.headlineDelta > 0 ? (
          <RowItem
            icon={<Plus className="w-4 h-4" />}
            label={t('steps.confirmed.savings')}
            value={formatIls(result.summary.headlineDelta, { locale, maximumFractionDigits: 2 })}
            valueClass="text-gold font-bold font-mono tabular-nums"
          />
        ) : null}
      </div>

      {capturedImage?.scanRouteUrl ? (
        <div className="confirm-content mb-4 rounded-2xl border border-primary/25 bg-primary/8 px-4 py-3 text-start">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-surface border border-primary/25 flex items-center justify-center shrink-0">
              <FileImage className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink">
                {t('steps.confirmed.scanSaved')}
              </div>
              <div className="text-[11px] font-mono text-muted truncate">
                {capturedImage.invoiceId}
              </div>
            </div>
            {/* Showcase demo: link straight to the uploaded object URL. The
                in-app /scans route is auth-gated tenant data, so it would
                dead-end at /login for an anonymous demo visitor. */}
            <a
              href={capturedImage.publicUrl ?? capturedImage.scanRouteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 bg-primary hover:brightness-110 text-on-primary text-xs font-semibold px-3 py-2 rounded-lg shadow-glow-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary"
            >
              {t('steps.confirmed.viewScan')}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onReset}
        className="confirm-content inline-flex min-h-12 items-center gap-2 bg-primary hover:brightness-110 text-on-primary rounded-xl px-5 py-3 font-medium shadow-glow-primary transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary"
      >
        <Plus className="w-4 h-4" strokeWidth={3} />
        {resetLabel ?? t('steps.confirmed.another')}
      </button>
    </div>
  );
}

function RowItem({
  icon,
  label,
  value,
  valueClass = 'text-ink font-semibold',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="text-subtle">{icon}</span>
        <span>{label}</span>
      </div>
      <span className={`text-sm ${valueClass}`}>{value}</span>
    </div>
  );
}
