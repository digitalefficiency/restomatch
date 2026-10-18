'use client';

import { useId, useState } from 'react';
import { Scale, TrendingDown } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { marketing } from '@/lib/i18n/messages/marketing';
import { formatIls } from '@/lib/money';

/**
 * Leak / ROI calculator — kept deliberately honest (docs/COSTS.md, GTM §5.2):
 * the visitor supplies BOTH inputs (procurement and their own leak estimate);
 * we never claim a recovery rate. The only thing we add is the break-even:
 * the share of purchasing the Pro plan has to catch to pay for itself.
 *
 * `proPriceIls` comes from PLAN_SEED via the server page (single price source).
 */
export function RoiCalculator({ proPriceIls }: { proPriceIls: number }) {
  const t = useT(marketing);
  const locale = useLocale();
  const ids = { monthly: useId(), leak: useId() };
  const [monthly, setMonthly] = useState(150_000);
  const [leakPct, setLeakPct] = useState(1.5);

  const monthlyLeak = monthly * (leakPct / 100);
  const annualLeak = monthlyLeak * 12;
  const breakevenPct = monthly > 0 ? (proPriceIls / monthly) * 100 : 0;
  const coveredRatio = monthlyLeak > 0 ? proPriceIls / monthlyLeak : Infinity;
  const pays = monthlyLeak > proPriceIls;
  const pct = (v: number, digits = 1) => `${formatNumber(v, locale, { maximumFractionDigits: digits })}%`;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="space-y-7">
        <div>
          <label htmlFor={ids.monthly} className="mb-1.5 block text-sm font-medium text-muted">
            {t('roi.monthly')}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center font-mono text-muted">
              ₪
            </span>
            <input
              id={ids.monthly}
              type="number"
              inputMode="numeric"
              min={0}
              step={5000}
              value={monthly}
              onChange={(e) => setMonthly(Math.max(0, Number(e.target.value) || 0))}
              className="w-full rounded-xl border border-line bg-surface-2 py-3 pe-3 ps-8 font-mono text-lg font-bold tabular-nums text-ink transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <input
            type="range"
            aria-label={t('roi.monthly')}
            aria-valuetext={formatIls(monthly, { locale })}
            min={30_000}
            max={700_000}
            step={5_000}
            value={Math.min(Math.max(monthly, 30_000), 700_000)}
            onChange={(e) => setMonthly(Number(e.target.value))}
            className="mt-3 w-full cursor-pointer accent-primary"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor={ids.leak} className="text-sm font-medium text-muted">
              {t('roi.leak')}
            </label>
            <span className="font-mono text-sm font-bold tabular-nums text-primary">{pct(leakPct)}</span>
          </div>
          <input
            id={ids.leak}
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={leakPct}
            onChange={(e) => setLeakPct(Number(e.target.value))}
            className="w-full cursor-pointer accent-primary"
            aria-valuetext={t('roi.leakValue', { pct: leakPct.toFixed(1) })}
          />
          <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-muted">
            <span>{pct(0.5)}</span>
            <span>{pct(5, 0)}</span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">{t('roi.leakHint')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* One concise live summary for screen readers instead of re-reading the cards. */}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {t('roi.srSummary', { month: formatIls(monthlyLeak, { locale }), year: formatIls(annualLeak, { locale }) })}
        </p>
        <div className="relative overflow-hidden rounded-2xl border border-danger/25 bg-danger/[0.08] p-5 shadow-glow-danger">
          <span aria-hidden="true" className="absolute inset-y-0 start-0 w-0.5 leak-gradient" />
          <div className="flex items-center gap-2 text-danger">
            <TrendingDown className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-semibold">{t('roi.monthlyLeak')}</span>
          </div>
          <p className="mt-2 font-mono text-4xl font-extrabold tabular-nums tracking-tight text-danger drop-shadow-glow-danger">
            {formatIls(monthlyLeak, { locale })}
          </p>
          <p className="mt-1 text-sm text-muted">
            <span className="font-mono font-semibold tabular-nums text-ink">{formatIls(annualLeak, { locale })}</span>{' '}
            {t('roi.annualLeak')} · {t('roi.annualSub')}
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-gold/25 bg-gold/[0.08] p-5 shadow-glow-gold">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
          <div className="flex items-center gap-2 text-gold">
            <Scale className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-semibold">{t('roi.breakevenTitle')}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink">
            {t('roi.breakevenBody', { price: formatIls(proPriceIls, { locale }), pct: pct(breakevenPct, 2) })}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {pays
              ? t('roi.breakevenRatio', { ratio: `${formatNumber(coveredRatio * 100, locale, { maximumFractionDigits: 0 })}%` })
              : t('roi.breakevenOver')}
          </p>
        </div>

        <p className="text-xs leading-relaxed text-muted">{t('roi.disclaimer')}</p>
      </div>
    </div>
  );
}
