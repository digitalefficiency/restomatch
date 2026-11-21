import type { Metadata } from 'next';
import Link from 'next/link';
import { PLAN_SEED } from '@restomatch/db';
import { getT } from '@/lib/i18n/server';
import { marketing } from '@/lib/i18n/messages/marketing';
import { landing } from '@/lib/i18n/messages/landing';
import {
  FactsStrip,
  FeaturesSection,
  ProblemSection,
  RoiSection,
  TrustSection,
} from '../_components/detail-sections';
import { primaryCtaHref } from '../_components/cta';
import { alternatesFor, metadataBase, socialFor } from '../_components/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(marketing);
  return {
    title: t('product.metaTitle'),
    description: t('product.metaDescription'),
    metadataBase,
    alternates: alternatesFor('/product', t.locale),
    ...socialFor(t.locale, { title: t('product.metaTitle'), description: t('product.metaDescription'), path: '/product' }),
  };
}

/**
 * W3-06b · the product page, split from About (mkt-20): what RestoMatch does,
 * in ₪ — the problem, the features, the calculator, trust. About keeps the
 * story, the values and the CTA. Same sections, unchanged in substance.
 */
export default async function ProductPage() {
  const t = await getT(marketing);
  const tl = await getT(landing);
  const proIls = PLAN_SEED.pro.priceAgorotMonthly / 100;
  return (
    <>
      <div className="mx-auto max-w-3xl px-4 pt-16 text-center sm:px-6 sm:pt-20">
        <div className="mx-auto mb-4 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{t('product.title')}</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">{t('product.lead')}</p>
      </div>
      <FactsStrip t={tl} />
      <ProblemSection t={tl} locale={tl.locale} />
      <FeaturesSection t={tl} />
      <RoiSection t={tl} proIls={proIls} />
      <TrustSection t={tl} />
      <div className="mx-auto max-w-3xl px-4 pb-16 text-center sm:px-6 sm:pb-20">
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={primaryCtaHref()}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-on-primary hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {t('about.cta')}
          </Link>
          <Link href="/showcase" className="text-sm font-medium text-primary hover:underline">
            {t('about.demo')}
          </Link>
        </div>
      </div>
    </>
  );
}
