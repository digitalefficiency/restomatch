'use client';

import { Sparkles } from 'lucide-react';
import { LeakHero } from '@/lib/components/hero';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { overview } from '@/lib/i18n/messages/overview';
import { showcase } from '@/lib/i18n/messages/showcase';
import { formatIls } from '@/lib/money';
import { NeedsYou, type NeedRow } from '../../../dashboard/home/needs-you';
import { PRODUCT_LABEL_KEYS } from './productLabels';
import {
  SAMPLE_GOOD_NEWS_ILS,
  SAMPLE_INVOICES_CHECKED,
  SAMPLE_INVOICES_IN_CHECK,
  SAMPLE_INVOICES_WITH_GAP,
  SAMPLE_LEAK_ILS,
  SAMPLE_LEAK_PCT,
  SAMPLE_NEEDS,
  SAMPLE_PAID_ILS,
  SAMPLE_PURCHASING_ILS,
  SAMPLE_UNPAID_ILS,
} from '../../../(marketing)/_components/sampleMonth';

/**
 * W3-06 (design-system-23): the showcase owner home IS the product's owner
 * home — the real `LeakHero` (T1) and `NeedsYou` (T2) components with the
 * product's own labels, fed from the one static sample month, plus a neutral
 * T4 "still being checked" note and one calm T3 line that quotes only decided
 * money. Labelled "דוגמה".
 */
export function SampleOwnerHome() {
  const t = useT(showcase);
  const o = useT(overview);
  const locale = useLocale();
  const ils = (n: number) => formatIls(n, { locale });
  const num = (n: number) => formatNumber(n, locale);
  const K = PRODUCT_LABEL_KEYS;

  const rows: NeedRow[] = SAMPLE_NEEDS.map((n) =>
    n.key === 'decide'
      ? {
          key: n.key,
          tone: n.tone,
          label: o(K.decideLabel),
          value: ils(n.amountIls),
          sub: o(K.decideSub, { count: num(n.count) }),
          verb: o(K.decideVerb),
          href: '/showcase/approvals',
        }
      : {
          key: n.key,
          tone: n.tone,
          label: t('dashboard.needs.credit.label'),
          value: ils(n.amountIls),
          sub: t('dashboard.needs.credit.sub', { count: num(n.count) }),
          verb: t('dashboard.needs.credit.verb'),
          href: '/showcase/dashboard/invoices',
        },
  );

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
        eyebrow={t('dashboard.hero.eyebrow')}
        label={t('dashboard.hero.label')}
        amount={ils(SAMPLE_LEAK_ILS)}
        amountHref="/showcase/dashboard/invoices"
        pctLine={t('dashboard.hero.pct', {
          pct: `${formatNumber(SAMPLE_LEAK_PCT, locale, { maximumFractionDigits: 1 })}%`,
        })}
        baseLine={t('dashboard.hero.base', { amount: ils(SAMPLE_PURCHASING_ILS) })}
        splitLabel={o(K.split)}
        parts={[
          { label: o(K.unpaid), value: ils(SAMPLE_UNPAID_ILS), href: '/showcase/approvals', testId: 'sample-part-unpaid' },
          { label: o(K.paid), value: ils(SAMPLE_PAID_ILS), href: '/showcase/dashboard/invoices', testId: 'sample-part-paid' },
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
      {/* T4: still being checked — neutral, never a task. */}
      <p className="text-sm text-muted" data-testid="sample-in-check">
        {t('dashboard.hero.inCheck', { count: num(SAMPLE_INVOICES_IN_CHECK) })}
      </p>
      <NeedsYou
        title={o(K.needsTitle)}
        rows={rows}
        zero={t('dashboard.needs.zero')}
        moreLabel={(count) => o(K.needsMore, { count: num(count) })}
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
