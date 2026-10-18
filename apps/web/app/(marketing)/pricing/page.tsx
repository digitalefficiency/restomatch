import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Scale, Sparkles } from 'lucide-react';
import { PLAN_SEED_LIST } from '@restomatch/db';
import { createServerCaller } from '@/lib/trpc/server';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatNumber } from '@/lib/i18n/format';
import { marketing } from '@/lib/i18n/messages/marketing';
import { formatIls } from '@/lib/money';
import { ChainPricingSection } from '@/lib/growth/ChainPricingSection';
import { alternatesFor, metadataBase } from '../_components/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(marketing);
  return {
    title: t('pricing.metaTitle'),
    description: t('pricing.metaDescription'),
    metadataBase,
    alternates: alternatesFor('/pricing', t.locale),
    openGraph: { title: t('pricing.metaTitle'), description: t('pricing.metaDescription'), url: '/pricing' },
  };
}

type PlanKey = 'trial' | 'basic' | 'pro' | 'chain';
type FeatureKey = 'integrations' | 'whatsapp_alerts' | 'advanced_analytics' | 'accounting_export';
const PLAN_KEYS: readonly string[] = ['trial', 'basic', 'pro', 'chain'];
const FEATURE_KEYS: readonly string[] = ['integrations', 'whatsapp_alerts', 'advanced_analytics', 'accounting_export'];

export default async function PricingPage() {
  const t = await getT(marketing);
  const locale = await getLocale();

  // The `plans` table is the live source; if the DB is unreachable the page
  // still renders from the same seed the table is built from (never a blank page).
  let plans: { key: string; priceAgorotMonthly: number; limits: (typeof PLAN_SEED_LIST)[number]['limits']; features: string[] }[];
  try {
    const caller = await createServerCaller();
    plans = await caller.plans.list();
  } catch {
    plans = PLAN_SEED_LIST;
  }

  // The "pro" tier reads as the recommended default for a single growing venue.
  const highlightKey = plans.some((p) => p.key === 'pro') ? 'pro' : plans[1]?.key;

  const limitLabel = (value: number | null, one: string, many: string) =>
    value === null
      ? t('pricing.unlimited', { plural: many })
      : t('pricing.upTo', { n: formatNumber(value, locale), unit: value === 1 ? one : many });

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto mb-14 max-w-2xl text-center">
        <p className="mb-3 text-xs font-semibold uppercase text-gold ltr:font-mono ltr:tracking-[0.2em] rtl:text-sm">{t('pricing.eyebrow')}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-5xl">{t('pricing.title')}</h1>
        <p className="mt-4 text-base text-muted">{t('pricing.lead')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const key = (PLAN_KEYS.includes(plan.key) ? plan.key : 'basic') as PlanKey;
          const isHighlight = plan.key === highlightKey;
          const priceIls = plan.priceAgorotMonthly / 100;
          return (
            <div
              key={plan.key}
              className={
                'relative flex flex-col rounded-3xl p-6 ' +
                (isHighlight
                  ? 'border-2 border-primary/60 bg-surface shadow-glow-primary'
                  : 'border border-line bg-surface shadow-card')
              }
            >
              {isHighlight ? (
                <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
              ) : null}
              {isHighlight ? (
                <span className="absolute -top-3 start-6 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-on-primary shadow-glow-primary">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('pricing.recommended')}
                </span>
              ) : null}

              <h2 className="text-lg font-bold text-ink">{t(`pricing.plans.${key}.name`)}</h2>
              <p className="mt-1 min-h-[2.5rem] text-sm text-muted">{t(`pricing.plans.${key}.tagline`)}</p>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-mono text-3xl font-extrabold tabular-nums tracking-tight text-ink">
                  {priceIls === 0 ? t('pricing.free') : formatIls(priceIls, { locale })}
                </span>
                {priceIls > 0 ? <span className="text-sm text-muted">{t('pricing.perMonth')}</span> : null}
              </div>

              <Link
                href="/#lead"
                className={
                  'mt-5 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ' +
                  (isHighlight
                    ? 'bg-primary text-on-primary shadow-glow-primary hover:brightness-110 focus-visible:ring-primary'
                    : 'border border-line bg-surface-2 text-ink hover:border-primary/40 hover:text-primary focus-visible:ring-primary/60')
                }
              >
                {plan.key === 'trial' ? t('pricing.ctaTrial') : t('pricing.ctaPaid')}
              </Link>

              <ul className="mt-6 space-y-3 border-t border-line pt-6 text-sm">
                {[
                  t('pricing.core'),
                  limitLabel(plan.limits.invoicesPerMonth, t('pricing.invoiceOne'), t('pricing.invoiceMany')),
                  limitLabel(plan.limits.restaurants, t('pricing.restaurantOne'), t('pricing.restaurantMany')),
                  limitLabel(plan.limits.seatsPerRestaurant, t('pricing.seatOne'), t('pricing.seatMany')),
                  ...plan.features
                    .filter((f) => FEATURE_KEYS.includes(f))
                    .map((f) => t(`pricing.features.${f as FeatureKey}`)),
                ].map((label) => (
                  <li key={label} className="flex items-start gap-2 text-muted">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Wave-1 S15 (`growth`): renders only when GROWTH_PRICING_PUBLIC=1. */}
      <ChainPricingSection plans={plans} />

      <div className="mx-auto mt-12 flex max-w-3xl items-start gap-4 rounded-2xl border border-gold/25 bg-gold/[0.06] p-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
          <Scale className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-bold text-ink">{t('pricing.anchorTitle')}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t('pricing.anchorBody')}</p>
        </div>
      </div>

      <p className="mt-8 text-center text-sm text-muted">
        {t('pricing.footnote')}{' '}
        <Link href="/#lead" className="font-medium text-primary hover:underline">
          {t('pricing.footnoteLink')}
        </Link>
        .
      </p>
    </div>
  );
}
