import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { preload } from 'react-dom';
import { Camera, Check, GitCompareArrows, Languages, PlayCircle, ShieldCheck } from 'lucide-react';
import { PLAN_SEED } from '@restomatch/db';
import { auth } from '@/auth';
import { getLocale, getT } from '@/lib/i18n/server';
import { landing } from '@/lib/i18n/messages/landing';
import { formatNumber } from '@/lib/i18n/format';
import { heroMedia, promoVideoFor } from '@/lib/heroMedia';
import { formatIls } from '@/lib/money';
import { landingFlag } from '@/lib/landingFlags';
import { cn } from '@/lib/components/cn';
import { MarketingShell } from './(marketing)/_components/MarketingShell';
import { HeroMatch } from './(marketing)/_components/HeroMatch';
import { HeroVideo } from './(marketing)/_components/HeroVideo';
import { LazyLeadForm } from './(marketing)/_components/LazyLeadForm';
import { PromoVideoButton } from './(marketing)/_components/PromoVideoButton';
import { Eyebrow, FaqSection, Forward, faqItems } from './(marketing)/_components/detail-sections';
import { OrdersStory } from './(marketing)/_components/OrdersStory';
import { LandingCompare } from '@/lib/growth/LandingCompare';
import { SITE_URL, metadataBase, socialFor } from './(marketing)/_components/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(landing);
  return {
    title: { absolute: t('meta.title') },
    description: t('meta.description'),
    metadataBase,
    // Next's resolver collapses `/?lang=en` to the bare origin on the root
    // route, so the root's canonical + hreflang <link>s are rendered in the
    // page instead (React hoists them into <head>).
    ...socialFor(t.locale, { title: t('meta.title'), description: t('meta.description') }),
  };
}

const btnPrimary =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-base font-semibold text-on-primary shadow-glow-primary transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:w-auto';
const btnSecondary =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-6 py-3.5 text-base font-semibold text-ink transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:w-auto';

/** The example invoice lines the "Receiver in English" morph cycles through. */
const MORPH_LINES = [
  { he: 'עגבניות שרי 20 ק״ג', en: 'Cherry tomatoes · 20 kg' },
  { he: 'חזה עוף טרי 30 ק״ג', en: 'Fresh chicken breast · 30 kg' },
  { he: 'שמן זית 5 ל׳ × 6', en: 'Olive oil 5 L × 6' },
  { he: 'מוצרלה 3 ק״ג', en: 'Mozzarella · 3 kg' },
] as const;

/** Worked example used by the proof block (same figures as the calculator default). */
const EXAMPLE_PURCHASING_ILS = 150_000;
const PILOT_TARGET = 0.015;

/**
 * Landing v2 — short and visual (owner: "efficient, not overloaded, invest in
 * animation"). Hero → 3 steps → Receiver in English → the honest math →
 * pricing → FAQ (collapsed) → lead form. The detail sections of v1 (problem
 * in ₪, all features, calculator, trust) live on /about, unchanged in substance.
 */
export default async function Home() {
  const session = await auth();
  // A logged-in member (has an active tenant) belongs in the app, not the
  // marketing site.
  if (session?.user?.restaurantId) {
    redirect('/dashboard');
  }

  const t = await getT(landing);
  const locale = await getLocale();
  // The hero poster is the LCP: fetch it first, ahead of scripts and fonts.
  if (heroMedia.available) {
    preload(heroMedia.poster, {
      as: 'image',
      fetchPriority: 'high',
      imageSrcSet: heroMedia.posterSrcSet,
      imageSizes: heroMedia.posterSizes,
    });
  }
  const promoSrc = promoVideoFor(locale);
  const ils = (n: number) => formatIls(n, { locale });
  const basicIls = PLAN_SEED.basic.priceAgorotMonthly / 100;
  const proIls = PLAN_SEED.pro.priceAgorotMonthly / 100;
  const breakevenPct = (proIls / EXAMPLE_PURCHASING_ILS) * 100;

  const steps = [
    { icon: Camera, title: t('v2.how.s1Title'), body: t('v2.how.s1Body') },
    { icon: GitCompareArrows, title: t('v2.how.s2Title'), body: t('v2.how.s2Body') },
    { icon: ShieldCheck, title: t('v2.how.s3Title'), body: t('v2.how.s3Body') },
  ];
  const proof = [
    {
      value: t('v2.proof.leakValue', { amount: ils(EXAMPLE_PURCHASING_ILS * PILOT_TARGET) }),
      label: t('v2.proof.leakLabel', { purchasing: ils(EXAMPLE_PURCHASING_ILS) }),
      tone: 'text-danger',
    },
    {
      value: t('v2.proof.breakevenValue', {
        pct: `${formatNumber(breakevenPct, locale, { maximumFractionDigits: 2 })}%`,
      }),
      label: t('v2.proof.breakevenLabel', { price: ils(proIls) }),
      tone: 'text-gold',
    },
    { value: t('v2.proof.checksValue'), label: t('v2.proof.checksLabel'), tone: 'text-primary' },
  ];

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'RestoMatch',
      url: SITE_URL,
      logo: `${SITE_URL}/icon.svg`,
      areaServed: 'IL',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'RestoMatch',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      description: t('meta.description'),
      inLanguage: ['he', 'en'],
      url: SITE_URL,
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'ILS',
        lowPrice: 0,
        highPrice: PLAN_SEED.chain.priceAgorotMonthly / 100,
        offerCount: 4,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqItems(t).map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];

  return (
    <MarketingShell>
      <link rel="canonical" href={locale === 'en' ? `${SITE_URL}/?lang=en` : `${SITE_URL}/`} />
      <link rel="alternate" hrefLang="he" href={`${SITE_URL}/`} />
      <link rel="alternate" hrefLang="en" href={`${SITE_URL}/?lang=en`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}/`} />
      {/* og:url for the same reason (React hoists <meta> into <head>). */}
      <meta property="og:url" content={locale === 'en' ? `${SITE_URL}/?lang=en` : `${SITE_URL}/`} />
      <script
        type="application/ld+json"
        // JSON-LD is data, not script; `<` is escaped so no string can close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      {/* ───────────── 1 · HERO ───────────── */}
      <section className="relative overflow-hidden" aria-labelledby="hero-title">
        <div
          aria-hidden="true"
          className="glow-primary-blob pointer-events-none absolute -top-40 start-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full blur-3xl rtl:translate-x-1/2"
        />
        <div aria-hidden="true" className="rm-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-24 lg:pt-24">
          <div className="text-center lg:text-start">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase text-primary ltr:text-[11px] ltr:tracking-[0.18em]">
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
                aria-hidden="true"
              />
              {t('hero.eyebrow')}
            </p>
            <h1
              id="hero-title"
              className="text-balance text-[2.6rem] font-extrabold leading-[1.05] tracking-tight text-ink sm:text-6xl lg:text-[4.1rem] ltr:lg:text-[3.6rem]"
            >
              {t('hero.titleA')}{' '}
              <span className="block bg-gradient-to-l from-gold via-primary to-primary bg-clip-text pb-1 text-transparent ltr:bg-gradient-to-r">
                {t('hero.titleB')}
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-muted lg:mx-0">
              {t('hero.lead')}
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              {/* data-keep-clear: the cookie banner never covers this CTA */}
              <Link href="#lead" className={btnPrimary} data-keep-clear>
                {t('hero.ctaPrimary')}
                <Forward />
              </Link>
              {promoSrc ? (
                <PromoVideoButton
                  src={promoSrc.src}
                  poster={promoSrc.poster}
                  label={t('hero.ctaWatch')}
                  title={t('hero.watchTitle')}
                  closeLabel={t('hero.watchClose')}
                  className={btnSecondary}
                />
              ) : (
                <Link href="/showcase" className={btnSecondary}>
                  <PlayCircle className="h-4 w-4" aria-hidden="true" />
                  {t('hero.ctaDemo')}
                </Link>
              )}
            </div>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted lg:justify-start">
              {[t('hero.note1'), t('hero.note2'), t('hero.note3')].map((n) => (
                <li key={n} className="inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                  {n}
                </li>
              ))}
            </ul>
          </div>
          {heroMedia.available ? (
            <HeroVideo
              webm={heroMedia.loop.webm}
              mp4={heroMedia.loop.mp4}
              poster={heroMedia.poster}
              posterSrcSet={heroMedia.posterSrcSet}
              posterSizes={heroMedia.posterSizes}
              label={t('hero.watchTitle')}
              pauseLabel={t('v2.video.pause')}
              playLabel={t('v2.video.play')}
            />
          ) : (
            <HeroMatch />
          )}
        </div>
      </section>

      {/* ───────────── 2 · HOW IT WORKS (scroll-driven reveal) ───────────── */}
      <section
        id="how"
        className="rm-defer scroll-mt-24 border-y border-line bg-surface/30"
        aria-labelledby="how-title"
      >
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <Eyebrow>{t('how.eyebrow')}</Eyebrow>
            <h2
              id="how-title"
              className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              {t('how.title')}
            </h2>
            <p className="mt-3 text-base text-muted">{t('how.lead')}</p>
          </div>
          <div className="relative">
            <span
              aria-hidden="true"
              className="rm-draw absolute inset-x-[16%] top-7 hidden h-px flow-stream md:block"
            />
            <ol className="relative grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-6">
              {steps.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="rm-step relative text-center">
                  <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-bg text-primary shadow-glow-primary">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                    <span className="absolute -end-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold tabular-nums text-on-primary">
                      {i + 1}
                    </span>
                  </span>
                  <h3 className="mt-5 text-lg font-bold text-ink">{title}</h3>
                  <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ───────────── 3 · RECEIVER IN ENGLISH (Hebrew → English morph) ───────────── */}
      <section
        id="features"
        className="rm-defer scroll-mt-24 mx-auto max-w-6xl px-4 py-20 sm:px-6"
        aria-labelledby="receiver-title"
      >
        <div className="rm-reveal relative overflow-hidden rounded-3xl border border-primary/30 bg-surface shadow-glow-primary">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
          <div className="relative grid gap-10 p-6 sm:p-10 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold text-on-primary">
                <Languages className="h-3.5 w-3.5" aria-hidden="true" />
                {t('v2.receiver.eyebrow')}
              </span>
              <h2
                id="receiver-title"
                className="mt-4 text-balance text-2xl font-bold tracking-tight text-ink sm:text-3xl"
              >
                {t('v2.receiver.title')}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted">{t('v2.receiver.body')}</p>
              <Link
                href="/showcase/receiver"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                {t('v2.receiver.cta')}
                <Forward />
              </Link>
            </div>
            <div className="mx-auto w-full max-w-sm rounded-[2rem] border border-line bg-bg p-3 shadow-card">
              <div className="mx-auto mb-3 h-1 w-16 rounded-full bg-line" aria-hidden="true" />
              <div className="mb-2 flex justify-between px-2 text-[11px] font-semibold text-muted">
                <span>{t('v2.receiver.original')}</span>
                <span className="text-primary">{t('v2.receiver.english')}</span>
              </div>
              <ul className="space-y-2">
                {MORPH_LINES.map((l, i) => (
                  <li
                    key={l.en}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-3"
                    style={{ '--i': i } as React.CSSProperties}
                  >
                    {/* Read once as a pair; the animated copies are visual only. */}
                    <span className="sr-only">
                      <span lang="he" dir="rtl">
                        {l.he}
                      </span>{' '}
                      → <span lang="en">{l.en}</span>
                    </span>
                    <span aria-hidden="true" className="rm-morph min-w-0 text-sm font-semibold">
                      <span className="rm-morph-he text-muted" lang="he" dir="rtl">
                        {l.he}
                      </span>
                      <span className="rm-morph-en text-ink" lang="en" dir="ltr">
                        {l.en}
                      </span>
                    </span>
                    <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────── 3b · ORDER → DOCK → ₪ (flag landingOrdersStory; off = no section) ───────────── */}
      {landingFlag('landingOrdersStory') && <OrdersStory t={t} locale={locale} />}
      {/* 3c · ordering system vs RestoMatch (S15, flag landingCompare; off = no section) */}
      {landingFlag('landingCompare') && <LandingCompare />}

      {/* ───────────── 4 · PROOF — the honest math (PLAN_SEED + formatIls) ───────────── */}
      <section className="rm-defer border-y border-line bg-surface/30" aria-labelledby="proof-title">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <Eyebrow tone="gold">{t('v2.proof.eyebrow')}</Eyebrow>
            <h2
              id="proof-title"
              className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              {t('v2.proof.title')}
            </h2>
          </div>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {proof.map((p) => (
              <li
                key={p.label}
                className="rm-reveal rounded-2xl border border-line bg-surface p-6 text-center shadow-card"
              >
                <p
                  className={cn(
                    'font-mono text-3xl font-extrabold tabular-nums tracking-tight sm:text-4xl',
                    p.tone,
                  )}
                >
                  {p.value}
                </p>
                <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-muted">
                  {p.label}
                </p>
              </li>
            ))}
          </ul>
          <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-relaxed text-muted">
            {t('v2.proof.note')}
          </p>
          <p className="mt-4 text-center">
            <Link
              href="/about#roi"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              {t('v2.proof.more')}
              <Forward className="h-3.5 w-3.5" />
            </Link>
          </p>
        </div>
      </section>

      {/* ───────────── 5 · PRICING TEASER ───────────── */}
      <section className="rm-defer mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="pricing-title">
        <div className="rm-reveal grid items-center gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <Eyebrow tone="gold">{t('pricing.eyebrow')}</Eyebrow>
            <h2
              id="pricing-title"
              className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              {t('pricing.title')}
            </h2>
            <p className="mt-4 text-base text-muted">{t('pricing.lead')}</p>
            <Link href="/pricing" className={cn(btnSecondary, 'mt-7')}>
              {t('pricing.cta')}
              <Forward />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
              <p className="text-sm font-semibold text-muted">{t('pricing.trialName')}</p>
              <p className="mt-2 text-4xl font-extrabold text-ink">{t('pricing.trialPrice')}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">{t('pricing.trialBody')}</p>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-gold/30 bg-surface p-6 shadow-glow-gold">
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
              <p className="text-sm font-semibold text-gold">{t('pricing.fromLabel').trim()}</p>
              <p className="mt-2 flex items-baseline gap-1.5">
                <span className="font-mono text-4xl font-extrabold tabular-nums text-ink">
                  {ils(basicIls)}
                </span>
                <span className="text-sm text-muted">{t('pricing.perMonth')}</span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">{t('pricing.paidBody')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────── FAQ (collapsed accordion) ───────────── */}
      <FaqSection t={t} />

      {/* ───────────── 6 · FINAL CTA — lead form (lazy) ───────────── */}
      <section
        id="lead"
        className="relative scroll-mt-24 overflow-hidden border-t border-line"
        aria-labelledby="lead-title"
      >
        <div
          aria-hidden="true"
          className="glow-primary-blob pointer-events-none absolute -bottom-40 start-1/2 h-96 w-[44rem] -translate-x-1/2 rounded-full blur-3xl rtl:translate-x-1/2"
        />
        <div className="relative mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <div className="mx-auto mb-8 max-w-xl text-center">
            <div className="mx-auto mb-4 h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
            <h2
              id="lead-title"
              className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              {t('cta.title')}
            </h2>
            <p className="mt-3 text-base text-muted">{t('cta.lead')}</p>
          </div>
          <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
            <LazyLeadForm loadingLabel={t('v2.cta.loading')} noscriptLabel={t('v2.cta.noscript')} />
          </div>
          <p className="mt-6 text-center text-sm text-muted">
            <ShieldCheck className="me-1.5 inline h-4 w-4 text-info" aria-hidden="true" />
            {t('v2.cta.trust')} ·{' '}
            <Link href="/about#trust" className="font-semibold text-primary hover:underline">
              {t('v2.cta.trustLink')}
            </Link>
          </p>
          <p className="mt-3 text-center text-sm text-muted">
            {t('cta.demoPrompt')}{' '}
            <Link
              href="/showcase"
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              {t('cta.demoLink')}
              <Forward className="h-3.5 w-3.5" />
            </Link>
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
