'use client';

import { useId, useState } from 'react';
import { Building2, Minus, Plus } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { growth } from '@/lib/i18n/messages/growth';
import type { Locale } from '@/lib/i18n/config';
import { formatIls } from '@/lib/money';

/** One plan quote in integer agorot (computed server-side by @restomatch/billing). */
export interface QuoteView {
  monthlyAgorot: number;
  chargeAgorot: number;
  perMonthDisplayAgorot: number;
  annualSavingsAgorot: number;
}

export interface ChainPricingProps {
  /** Chain quotes indexed by branch count − 1 (1..N branches). */
  chain: Array<{ branches: number; monthly: QuoteView; annual: QuoteView }>;
  perBranchAgorot: number;
  includedBranches: number;
  basic: { monthly: QuoteView; annual: QuoteView } | null;
  pro: { monthly: QuoteView; annual: QuoteView } | null;
  ctaHref: string;
}

/** Agorot → ₪ text; shows agorot only when the amount is not whole shekels. */
function ils(agorot: number, locale: Locale): string {
  return formatIls(agorot / 100, { locale, maximumFractionDigits: agorot % 100 === 0 ? 0 : 2 });
}

/**
 * Chain per-branch price + monthly/annual toggle (wave 1, S15 — `growth`).
 * Pure display: every number arrives pre-computed in agorot; this component
 * only picks the row for the chosen branch count and cycle.
 */
export function ChainPricing({ chain, perBranchAgorot, includedBranches, basic, pro, ctaHref }: ChainPricingProps) {
  const t = useT(growth);
  const locale = useLocale();
  const ids = { cycle: useId(), branches: useId() };
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [branches, setBranches] = useState(Math.min(includedBranches, chain.length));
  const row = chain[branches - 1] ?? chain[0]!;
  const q = cycle === 'annual' ? row.annual : row.monthly;
  // What THIS chain pays per branch (display only, half-up to the agora) — the
  // ₪298 list price is only reached at the included branch count, so never
  // show it as the per-branch price of a smaller chain.
  const effectivePerBranchAgorot = Math.round(q.perMonthDisplayAgorot / branches);
  const branchesText = branches === 1 ? t('pricing.branchOne') : t('pricing.branchesValue', { n: formatNumber(branches, locale) });

  return (
    <section aria-labelledby="growth-chain-title" className="mx-auto mt-14 max-w-4xl rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
      <p className="mb-2 text-xs font-semibold uppercase text-gold ltr:font-mono ltr:tracking-[0.2em] rtl:text-sm">{t('pricing.eyebrow')}</p>
      <h2 id="growth-chain-title" className="text-2xl font-extrabold tracking-tight text-ink">{t('pricing.title')}</h2>
      <p className="mt-2 text-sm text-muted">{t('pricing.lead')}</p>

      <div className="mt-6 flex flex-wrap items-center gap-6">
        <div role="radiogroup" aria-labelledby={ids.cycle} className="inline-flex rounded-xl border border-line bg-surface-2 p-1">
          <span id={ids.cycle} className="sr-only">{t('pricing.cycleLabel')}</span>
          {(['monthly', 'annual'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={
                'min-h-[44px] rounded-lg px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
                (cycle === c ? 'bg-primary text-on-primary' : 'text-muted hover:text-ink')
              }
            >
              {t(`pricing.${c}`)}
              {c === 'annual' ? (
                <span className="ms-2 rounded-full bg-gold/15 px-2 py-0.5 text-xs text-gold">{t('pricing.annualBadge')}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span id={ids.branches} className="text-sm text-muted">{t('pricing.branchesLabel')}</span>
          <div role="group" aria-labelledby={ids.branches} className="inline-flex items-center rounded-xl border border-line bg-surface-2">
            <button
              type="button"
              aria-label={t('pricing.decrease')}
              disabled={branches <= 1}
              onClick={() => setBranches((b) => Math.max(1, b - 1))}
              className="flex h-11 w-11 items-center justify-center text-ink disabled:opacity-40"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <output aria-live="polite" className="min-w-[6.5rem] text-center font-mono text-sm tabular-nums text-ink rtl:font-sans">
              {branchesText}
            </output>
            <button
              type="button"
              aria-label={t('pricing.increase')}
              disabled={branches >= chain.length}
              onClick={() => setBranches((b) => Math.min(chain.length, b + 1))}
              className="flex h-11 w-11 items-center justify-center text-ink disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 rounded-2xl border border-primary/30 bg-surface-2 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
            {t('pricing.chainTotal', { branches: branchesText })}
          </p>
          <p className="mt-2 flex items-baseline gap-1">
            <span data-testid="chain-price" className="font-mono text-3xl font-extrabold tabular-nums text-ink">
              {ils(q.perMonthDisplayAgorot, locale)}
            </span>
            <span className="text-sm text-muted">
              {cycle === 'annual' ? t('pricing.perMonthBilledAnnually') : t('pricing.perMonth')}
            </span>
          </p>
          {cycle === 'annual' ? (
            <p className="mt-1 text-sm text-muted">
              {t('pricing.billedAnnually', { price: ils(q.chargeAgorot, locale) })} ·{' '}
              <span className="text-gold">{t('pricing.youSave', { price: ils(q.annualSavingsAgorot, locale) })}</span>
            </p>
          ) : null}
          <p className="mt-3 text-sm text-muted">
            <span data-testid="per-branch" className="font-semibold text-ink">{t('pricing.perBranch', { price: ils(effectivePerBranchAgorot, locale) })}</span>
            {' · '}
            {t('pricing.chainIncluded', { n: formatNumber(includedBranches, locale), price: ils(perBranchAgorot, locale) })}
          </p>
        </div>
        <a
          href={ctaHref}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-on-primary shadow-glow-primary hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {t('pricing.cta')}
        </a>
      </div>

      {basic && pro ? (
        <p className="mt-4 text-sm text-muted">
          {t('pricing.plansNote', {
            basic: ils(basic.monthly.monthlyAgorot, locale),
            pro: ils(pro.monthly.monthlyAgorot, locale),
            basicAnnual: ils(basic.annual.perMonthDisplayAgorot, locale),
            proAnnual: ils(pro.annual.perMonthDisplayAgorot, locale),
          })}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted">{t('pricing.vatNote')}</p>
    </section>
  );
}
