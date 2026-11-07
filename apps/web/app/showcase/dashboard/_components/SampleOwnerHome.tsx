'use client';

import { Sparkles } from 'lucide-react';
import { LeakHero } from '@/lib/components/hero';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { showcase } from '@/lib/i18n/messages/showcase';
import { formatIls } from '@/lib/money';
import { NeedsYou, type NeedRow } from '../../../dashboard/home/needs-you';
import {
  SAMPLE_AWAITING_CREDIT_ILS,
  SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS,
  SAMPLE_GOOD_NEWS_ILS,
  SAMPLE_INVOICES_CHECKED,
  SAMPLE_INVOICES_WITH_GAP,
  SAMPLE_LEAK_ILS,
  SAMPLE_LEAK_PCT,
  SAMPLE_MONTH_DAYS,
  SAMPLE_NEEDS,
  SAMPLE_PURCHASING_ILS,
} from '../../../(marketing)/_components/sampleMonth';

/** Where each sample Needs-you row leads inside the showcase. */
const NEED_HREF: Record<(typeof SAMPLE_NEEDS)[number]['key'], string> = {
  approve: '/showcase/approvals',
  credit: '/showcase/dashboard/invoices',
  pending: '/showcase/dashboard/invoices',
};

/**
 * W3-06 (design-system-23): the showcase owner home IS the product's owner
 * home — the real `LeakHero` (T1) and `NeedsYou` (T2) components, fed from the
 * one static sample month, plus one calm T3 good-news line. Labelled "דוגמה".
 */
export function SampleOwnerHome() {
  const t = useT(showcase);
  const locale = useLocale();
  const ils = (n: number) => formatIls(n, { locale });
  const num = (n: number) => formatNumber(n, locale);

  const rows: NeedRow[] = SAMPLE_NEEDS.map((n) => ({
    key: n.key,
    tone: n.tone,
    label: t(`dashboard.needs.${n.key}.label`),
    value: n.amountIls === null ? num(n.count) : ils(n.amountIls),
    sub: t(`dashboard.needs.${n.key}.sub`, { count: num(n.count) }),
    verb: t(`dashboard.needs.${n.key}.verb`),
    href: NEED_HREF[n.key],
  }));

  return (
    <div className="space-y-4" data-testid="sample-owner-home">
      <p
        className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-ink ring-1 ring-line"
        data-testid="sample-badge"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {t('dashboard.sample')}
      </p>
      <LeakHero
        state="leak"
        eyebrow={t('dashboard.hero.eyebrow', {
          from: num(SAMPLE_MONTH_DAYS.from),
          to: num(SAMPLE_MONTH_DAYS.to),
        })}
        label={t('dashboard.hero.label')}
        amount={ils(SAMPLE_LEAK_ILS)}
        amountHref="/showcase/dashboard/invoices"
        pctLine={t('dashboard.hero.pct', {
          pct: `${formatNumber(SAMPLE_LEAK_PCT, locale, { maximumFractionDigits: 1 })}%`,
        })}
        baseLine={t('dashboard.hero.base', { amount: ils(SAMPLE_PURCHASING_ILS) })}
        splitLabel={t('dashboard.hero.split')}
        parts={[
          {
            label: t('dashboard.hero.caught'),
            value: ils(SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS),
            href: '/showcase/approvals',
            testId: 'sample-part-caught',
          },
          {
            label: t('dashboard.hero.awaiting'),
            value: ils(SAMPLE_AWAITING_CREDIT_ILS),
            hint: t('dashboard.hero.awaitingHint'),
            href: '/showcase/dashboard/invoices',
            testId: 'sample-part-awaiting',
          },
        ]}
        completeness={{
          text: t('dashboard.hero.completeness', {
            checked: num(SAMPLE_INVOICES_CHECKED),
            withGap: num(SAMPLE_INVOICES_WITH_GAP),
          }),
          href: '/showcase/dashboard/invoices',
        }}
        primary={{ label: t('dashboard.hero.primary'), href: '/showcase/approvals', testId: 'sample-hero-primary' }}
      />
      <NeedsYou
        title={t('dashboard.needs.title')}
        rows={rows}
        zero={t('dashboard.needs.zero')}
        moreLabel={(count) => t('dashboard.needs.more', { count: num(count) })}
      />
      <p
        className="flex min-h-12 items-center gap-2 rounded-2xl border border-gold/40 bg-surface px-4 text-sm font-semibold text-ink"
        data-testid="sample-good-news"
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-gold" />
        {t('dashboard.goodNews', { amount: ils(SAMPLE_GOOD_NEWS_ILS) })}
      </p>
    </div>
  );
}
