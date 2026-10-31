'use client';

import { ArrowLeft, Check, Clock, Package } from 'lucide-react';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import { formatIls } from '@/lib/money';
import { localTime } from '../../_lib/time';
import { MOCK_SUPPLIERS, type MockSupplierExpectation } from '../_mock';

interface Props {
  selected: MockSupplierExpectation | null;
  onSelect: (supplier: MockSupplierExpectation) => void;
  onContinue: () => void;
}

export function SupplierSelect({ selected, onSelect, onContinue }: Props) {
  const t = useT(receiving);
  const locale = useLocale();
  const dir = useDir();

  return (
    <div dir={dir}>
      <StepHeader
        eyebrow={t('steps.stepOf', { current: 1, total: 5 })}
        title={t('steps.supplier.title')}
        subtitle={t('steps.supplier.subtitle')}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
        {MOCK_SUPPLIERS.map((s) => {
          const isSelected = selected?.supplierId === s.supplierId;
          return (
            <button
              key={s.supplierId}
              type="button"
              onClick={() => onSelect(s)}
              className={`supplier-card group relative overflow-hidden text-start rounded-2xl border p-5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                isSelected
                  ? 'border-primary/50 bg-primary/8 shadow-glow-primary'
                  : 'border-line bg-surface hover:border-primary/40 shadow-card'
              }`}
            >
              {isSelected ? (
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
              ) : null}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    aria-hidden="true"
                    className="w-12 h-12 rounded-xl bg-primary/12 border border-primary/25 flex items-center justify-center font-bold text-primary"
                  >
                    {locale === 'en' && s.supplierNameEn ? initialsOf(s.supplierNameEn) : s.supplierInitials}
                  </div>
                  <div>
                    <div className="font-semibold text-ink text-base">
                      {locale === 'en' && s.supplierNameEn ? s.supplierNameEn : s.supplierName}
                    </div>
                    <div className="text-sm text-muted flex items-center gap-2 mt-0.5">
                      <Clock className="w-3 h-3" />
                      <span className="tabular-nums">
                        {localTime(s.expectedAt)}
                      </span>
                      <span className="text-subtle">·</span>
                      <Package className="w-3 h-3" />
                      <span className="tabular-nums">
                        {t('steps.supplier.items', { count: formatNumber(s.totalLines, locale) })}
                      </span>
                    </div>
                  </div>
                </div>
                {isSelected ? (
                  <div className="w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-glow-primary">
                    <Check className="w-4 h-4" strokeWidth={3} />
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">
                  {s.hasActiveReceipt ? (
                    <span className="text-warn font-medium">{t('steps.supplier.receiptStarted')}</span>
                  ) : (
                    <span>
                      {s.poIds.length === 1
                        ? t('steps.supplier.expectedOnePo')
                        : t('steps.supplier.expectedPos', { count: s.poIds.length })}
                    </span>
                  )}
                </span>
                <span className="font-semibold text-ink tabular-nums">
                  {formatIls(s.totalEstimated, { locale })}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="text-sm text-muted hover:text-ink underline underline-offset-4 decoration-line"
        >
          {t('steps.supplier.notListed')}
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={onContinue}
          className="inline-flex items-center gap-2 bg-primary hover:brightness-110 disabled:bg-surface-2 disabled:text-subtle text-on-primary min-h-12 rounded-xl px-5 py-3 font-medium shadow-glow-primary disabled:shadow-none transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary"
        >
          {t('steps.supplier.continue')}
          <ArrowLeft className="w-4 h-4 ltr:-scale-x-100" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * A wizard step's heading. The h1 is focusable (tabIndex -1) so the wizard can
 * move focus to it on every step change (a11y-06). The eyebrow is letter-spaced
 * and upper-cased in English only — never on Hebrew (RCV-25, mkt-27).
 */
export function StepHeader({
  eyebrow,
  title,
  subtitle,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Field screens: a smaller heading so the work starts higher on a phone. */
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'mb-4' : 'mb-8'}>
      {eyebrow ? (
        <p className="mb-1 text-sm font-semibold text-primary ltr:uppercase ltr:tracking-[0.18em] ltr:text-xs">
          {eyebrow}
        </p>
      ) : null}
      <h1
        tabIndex={-1}
        data-step-heading=""
        className={`${compact ? 'text-2xl' : 'text-3xl'} mb-1 font-extrabold text-ink outline-none ltr:tracking-tight`}
      >
        {title}
      </h1>
      {subtitle ? <p className="max-w-2xl text-base text-muted">{subtitle}</p> : null}
    </div>
  );
}

/** "Avi's Greengrocer" → "AG" — the avatar follows the name shown beside it. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
