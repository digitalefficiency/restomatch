'use client';

import { useId, useState } from 'react';
import { Scale, TrendingDown } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { marketing } from '@/lib/i18n/messages/marketing';
import { formatIls } from '@/lib/money';
import { computeRoi, monthlyAgorotFromInput, ROI_MAX_MONTHLY_ILS } from './roi.logic';
import { SAMPLE_LEAK_PCT, SAMPLE_PURCHASING_ILS } from './sampleMonth';

/**
 * Leak / ROI calculator — kept deliberately honest (docs/COSTS.md, GTM §5.2):
 * the visitor supplies BOTH inputs (procurement and their own leak estimate);
 * we never claim a recovery rate. The only thing we add is the break-even:
 * the share of purchasing the Pro plan has to catch to pay for itself.
 *
 * `proPriceIls` comes from PLAN_SEED via the server page (single price source).
 * The math lives in roi.logic.ts (integer agorot, half-up); an empty or zero
 * amount shows a neutral prompt, never a danger-styled ₪0. While the inputs
 * still equal the sample month the card says so ("דוגמה"), on every page.
 */
export function RoiCalculator({ proPriceIls }: { proPriceIls: number }) {
  const t = useT(marketing);
  const locale = useLocale();
  const ids = { monthly: useId(), leak: useId() };
  const [monthlyRaw, setMonthlyRaw] = useState(String(SAMPLE_PURCHASING_ILS));
  const [leakPct, setLeakPct] = useState(SAMPLE_LEAK_PCT);

  const roi = computeRoi(monthlyRaw, leakPct, Math.round(proPriceIls * 100));
  const monthlyAgorot = roi.kind === 'ok' ? roi.monthlyAgorot : 0;
  const isSample = monthlyAgorot === SAMPLE_PURCHASING_ILS * 100 && leakPct === SAMPLE_LEAK_PCT;
  const pct = (v: number, digits = 1) => `${formatNumber(v, locale, { maximumFractionDigits: digits })}%`;
  const breakeven =
    roi.kind !== 'ok' ? '' : roi.breakevenBelowFloor ? `<${pct(0.01, 2)}` : pct(roi.breakevenHundredths / 100, 2);
  const onMonthly = (raw: string) => {
    const agorot = monthlyAgorotFromInput(raw);
    setMonthlyRaw(agorot !== null && agorot >= ROI_MAX_MONTHLY_ILS * 100 ? String(ROI_MAX_MONTHLY_ILS) : raw);
  };
  const sliderIls = Math.min(Math.max(Math.round(monthlyAgorot / 100), 30_000), 700_000);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="space-y-7">
        <div>
          <label htmlFor={ids.monthly} className="mb-1.5 block text-sm font-medium text-muted">
            {t('roi.monthly')}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted">
              ₪
            </span>
            <input
              id={ids.monthly}
              type="text"
              inputMode="decimal"
              dir="ltr"
              autoComplete="off"
              value={monthlyRaw}
              onChange={(e) => onMonthly(e.target.value)}
              className="w-full rounded-xl border border-line-strong bg-surface py-3 pe-3 ps-8 text-lg font-bold tabular-nums text-ink transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <input
            type="range"
            aria-label={t('roi.monthly')}
            aria-valuetext={formatIls(sliderIls, { locale })}
            min={30_000}
            max={700_000}
            step={5_000}
            value={sliderIls}
            onChange={(e) => setMonthlyRaw(e.target.value)}
            className="mt-3 w-full cursor-pointer accent-primary"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor={ids.leak} className="text-sm font-medium text-muted">
              {t('roi.leak')}
            </label>
            <span className="text-sm font-bold tabular-nums text-primary">{pct(leakPct)}</span>
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
          <div className="mt-1 flex justify-between text-xs tabular-nums text-muted">
            <span>{pct(0.5)}</span>
            <span>{pct(5, 0)}</span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">{t('roi.leakHint')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {isSample && (
          <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted" data-testid="roi-sample">
            <span className="me-2 rounded-full border border-line-strong px-2 py-0.5 text-xs font-semibold text-ink">
              {t('roi.sampleBadge')}
            </span>
            {t('roi.sample', {
              purchasing: formatIls(SAMPLE_PURCHASING_ILS, { locale }),
              pct: pct(SAMPLE_LEAK_PCT),
            })}
          </p>
        )}
        {roi.kind !== 'ok' ? (
          <p className="rounded-2xl border border-line bg-surface p-5 text-sm leading-relaxed text-muted" role="status" data-testid="roi-prompt">
            {t('roi.prompt')}
          </p>
        ) : (
          <>
            {/* One concise live summary for screen readers instead of re-reading the cards. */}
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {t('roi.srSummary', {
                month: formatIls(roi.monthlyLeakIls, { locale }),
                year: formatIls(roi.annualLeakIls, { locale }),
              })}
            </p>
            <div className="relative overflow-hidden rounded-2xl border border-danger/25 bg-danger/[0.08] p-5 shadow-glow-danger">
              <span aria-hidden="true" className="absolute inset-y-0 start-0 w-0.5 leak-gradient" />
              <div className="flex items-center gap-2 text-danger">
                <TrendingDown className="h-5 w-5" aria-hidden="true" />
                <span className="text-sm font-semibold">{t('roi.monthlyLeak')}</span>
              </div>
              <p className="mt-2 text-4xl font-extrabold tabular-nums tracking-tight text-danger drop-shadow-glow-danger">
                {formatIls(roi.monthlyLeakIls, { locale })}
              </p>
              <p className="mt-1 text-sm text-muted">
                <span className="font-semibold tabular-nums text-ink">{formatIls(roi.annualLeakIls, { locale })}</span>{' '}
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
                {t('roi.breakevenBody', { price: formatIls(proPriceIls, { locale }), pct: breakeven })}
              </p>
              {roi.showCovered ? (
                <p className="mt-1 text-sm leading-relaxed text-muted" data-testid="roi-ratio">
                  {t('roi.breakevenRatio', { ratio: pct(roi.coveredPct, 0) })}
                </p>
              ) : !roi.pays ? (
                <p className="mt-1 text-sm leading-relaxed text-muted">{t('roi.breakevenOver')}</p>
              ) : null}
            </div>
          </>
        )}

        <p className="text-xs leading-relaxed text-muted">{t('roi.disclaimer')}</p>
      </div>
    </div>
  );
}
