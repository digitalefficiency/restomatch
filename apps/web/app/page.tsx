import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  BadgeCheck,
  Camera,
  Check,
  ChevronDown,
  Copy,
  FileSpreadsheet,
  FileText,
  GitCompareArrows,
  Gavel,
  KeyRound,
  Languages,
  Moon,
  PackageX,
  PlayCircle,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  TrendingUp,
  CircleSlash,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import { PLAN_SEED } from '@restomatch/db';
import { auth } from '@/auth';
import { getLocale, getT } from '@/lib/i18n/server';
import { landing } from '@/lib/i18n/messages/landing';
import { formatIls } from '@/lib/money';
import { cn } from '@/lib/components/cn';
import { MarketingShell } from './(marketing)/_components/MarketingShell';
import { RoiCalculator } from './(marketing)/_components/RoiCalculator';
import { LeadForm } from './(marketing)/_components/LeadForm';
import { HeroMatch } from './(marketing)/_components/HeroMatch';
import { SITE_URL, alternatesFor, metadataBase } from './(marketing)/_components/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(landing);
  return {
    title: { absolute: t('meta.title') },
    description: t('meta.description'),
    metadataBase,
    // Next's resolver collapses `/?lang=en` to the bare origin on the root
    // route, so the root's hreflang <link>s are rendered in the page (React
    // hoists them into <head>) — canonical stays here.
    alternates: { canonical: alternatesFor('/').canonical },
    openGraph: { title: t('meta.title'), description: t('meta.description'), url: '/' },
    twitter: { title: t('meta.title'), description: t('meta.description') },
  };
}

/** "Forward" arrow: points left in RTL, right in LTR. */
function Forward({ className }: { className?: string }) {
  return <ArrowLeft className={cn('h-4 w-4 ltr:-scale-x-100', className)} aria-hidden="true" />;
}

function Eyebrow({ children, tone = 'primary' }: { children: React.ReactNode; tone?: 'primary' | 'danger' | 'gold' }) {
  return (
    <p
      className={cn(
        'mb-3 text-xs font-semibold uppercase tracking-[0.2em] ltr:font-mono rtl:text-sm rtl:tracking-normal',
        tone === 'primary' && 'text-primary',
        tone === 'danger' && 'text-danger',
        tone === 'gold' && 'text-gold',
      )}
    >
      {children}
    </p>
  );
}

const btnPrimary =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-base font-semibold text-on-primary shadow-glow-primary transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:w-auto';
const btnSecondary =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-6 py-3.5 text-base font-semibold text-ink transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:w-auto';

export default async function Home() {
  const session = await auth();
  // A logged-in member (has an active tenant) belongs in the app, not the
  // marketing site.
  if (session?.user?.restaurantId) {
    redirect('/dashboard');
  }

  const t = await getT(landing);
  const locale = await getLocale();
  const ils = (n: number) => formatIls(n, { locale });
  const basicIls = PLAN_SEED.basic.priceAgorotMonthly / 100;
  const proIls = PLAN_SEED.pro.priceAgorotMonthly / 100;

  const problems = [
    { icon: TrendingUp, title: t('problem.c1Title'), body: t('problem.c1Body'), amount: t('problem.c1Amount') },
    { icon: PackageX, title: t('problem.c2Title'), body: t('problem.c2Body'), amount: t('problem.c2Amount') },
    { icon: CircleSlash, title: t('problem.c3Title'), body: t('problem.c3Body'), amount: t('problem.c3Amount') },
    { icon: Copy, title: t('problem.c4Title'), body: t('problem.c4Body'), amount: t('problem.c4Amount') },
  ];
  const steps = [
    { icon: Camera, title: t('how.s1Title'), body: t('how.s1Body') },
    { icon: GitCompareArrows, title: t('how.s2Title'), body: t('how.s2Body') },
    { icon: ShieldCheck, title: t('how.s3Title'), body: t('how.s3Body') },
  ];
  const trust = [
    { icon: Lock, title: t('trust.t1Title'), body: t('trust.t1Body') },
    { icon: KeyRound, title: t('trust.t2Title'), body: t('trust.t2Body') },
    { icon: Gavel, title: t('trust.t3Title'), body: t('trust.t3Body') },
    { icon: ScrollText, title: t('trust.t4Title'), body: t('trust.t4Body') },
  ];
  const faqs = (['1', '2', '3', '4', '5', '6', '7'] as const).map((n) => ({
    q: t(`faq.q${n}`),
    a: t(`faq.a${n}`),
  }));

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
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];

  return (
    <MarketingShell>
      <link rel="alternate" hrefLang="he" href={`${SITE_URL}/`} />
      <link rel="alternate" hrefLang="en" href={`${SITE_URL}/?lang=en`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}/`} />
      <script
        type="application/ld+json"
        // JSON-LD is data, not script; `<` is escaped so no string can close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="relative overflow-hidden" aria-labelledby="hero-title">
        <div
          aria-hidden="true"
          className="glow-primary-blob pointer-events-none absolute -top-40 start-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full blur-3xl rtl:translate-x-1/2"
        />
        <div
          aria-hidden="true"
          className="glow-gold-blob pointer-events-none absolute -bottom-40 end-0 h-72 w-[30rem] rounded-full blur-3xl"
        />
        <div aria-hidden="true" className="rm-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-24 lg:pt-24">
          <div className="text-center lg:text-start">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase text-primary ltr:font-mono ltr:text-[11px] ltr:tracking-[0.18em]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden="true" />
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
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted lg:mx-0">{t('hero.lead')}</p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Link href="#lead" className={btnPrimary}>
                {t('hero.ctaPrimary')}
                <Forward />
              </Link>
              <Link href="/showcase" className={btnSecondary}>
                <PlayCircle className="h-4 w-4" aria-hidden="true" />
                {t('hero.ctaDemo')}
              </Link>
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
          <HeroMatch />
        </div>
      </section>

      {/* ───────────────────────── FACTS STRIP (honest, no fake logos) ───────────────────────── */}
      <section aria-label={t('facts.label')} className="border-y border-line bg-surface/40">
        <ul className="mx-auto grid max-w-6xl grid-cols-1 gap-x-8 gap-y-4 px-4 py-7 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {[
            { icon: GitCompareArrows, text: t('facts.f1') },
            { icon: ScanSearch, text: t('facts.f2') },
            { icon: ShieldCheck, text: t('facts.f3') },
            { icon: BadgeCheck, text: t('facts.f4') },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm font-medium text-ink">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary ring-1 ring-primary/20">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </section>

      {/* ───────────────────────── PROBLEM IN ₪ ───────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24" aria-labelledby="problem-title">
        <div className="rm-reveal mx-auto mb-12 max-w-2xl text-center">
          <Eyebrow tone="danger">{t('problem.eyebrow')}</Eyebrow>
          <h2 id="problem-title" className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {t('problem.title')}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted">{t('problem.lead')}</p>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {problems.map(({ icon: Icon, title, body, amount }) => (
            <li
              key={title}
              className="rm-reveal group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-card transition-colors hover:border-danger/40"
            >
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-danger/60 to-transparent" />
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/12 text-danger ring-1 ring-danger/25">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-bold text-ink">{title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{body}</p>
              <p className="mt-4 text-lg font-extrabold tabular-nums text-danger">{amount}</p>
            </li>
          ))}
        </ul>
        <div className="rm-reveal mt-8 rounded-2xl border border-line bg-surface-2/60 px-6 py-5 text-center">
          <p className="text-base text-ink sm:text-lg">
            {t('problem.mathA')}{' '}
            <span className="font-mono text-2xl font-extrabold tabular-nums text-danger drop-shadow-glow-danger">
              {ils(150_000 * 0.015)}
            </span>{' '}
            {t('problem.mathB')}
          </p>
          <p className="mx-auto mt-2 max-w-2xl text-xs leading-relaxed text-subtle">{t('problem.mathNote')}</p>
        </div>
      </section>

      {/* ───────────────────────── HOW IT WORKS ───────────────────────── */}
      <section id="how" className="scroll-mt-24 border-y border-line bg-surface/30" aria-labelledby="how-title">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="rm-reveal mx-auto mb-14 max-w-2xl text-center">
            <Eyebrow>{t('how.eyebrow')}</Eyebrow>
            <h2 id="how-title" className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              {t('how.title')}
            </h2>
            <p className="mt-4 text-base text-muted">{t('how.lead')}</p>
          </div>
          <ol className="relative grid grid-cols-1 gap-6 md:grid-cols-3">
            <span
              aria-hidden="true"
              className="absolute inset-x-[16%] top-7 hidden h-px flow-stream md:block"
            />
            {steps.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="rm-reveal relative text-center">
                <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-bg text-primary shadow-glow-primary">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <p className="mt-5 text-xs font-semibold tabular-nums text-subtle">
                  {t('how.step', { n: i + 1 })}
                </p>
                <h3 className="mt-1 text-lg font-bold text-ink">{title}</h3>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ───────────────────────── FEATURES ───────────────────────── */}
      <section id="features" className="scroll-mt-24 mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24" aria-labelledby="features-title">
        <div className="rm-reveal mx-auto mb-12 max-w-2xl text-center">
          <Eyebrow>{t('features.eyebrow')}</Eyebrow>
          <h2 id="features-title" className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {t('features.title')}
          </h2>
        </div>

        {/* Flagship: Receiver in English */}
        <article className="rm-reveal relative overflow-hidden rounded-3xl border border-primary/30 bg-surface shadow-glow-primary">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
          <div aria-hidden="true" className="glow-primary-blob pointer-events-none absolute -top-24 end-0 h-72 w-72 rounded-full blur-3xl" />
          <div className="relative grid gap-10 p-6 sm:p-10 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold text-on-primary">
                <Languages className="h-3.5 w-3.5" aria-hidden="true" />
                {t('features.receiver.badge')}
              </span>
              <h3 className="mt-4 text-balance text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('features.receiver.title')}</h3>
              <p className="mt-4 text-base leading-relaxed text-muted">{t('features.receiver.body')}</p>
              <ul className="mt-6 space-y-2.5">
                {[t('features.receiver.p1'), t('features.receiver.p2'), t('features.receiver.p3')].map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-ink">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
              <Link
                href="/showcase/receiver"
                className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                {t('features.receiver.cta')}
                <Forward />
              </Link>
            </div>
            {/* Mini phone: Hebrew invoice line → English for the receiver */}
            <div aria-hidden="true" className="mx-auto w-full max-w-xs">
              <div className="rounded-[2rem] border border-line bg-bg p-3 shadow-card">
                <div className="mx-auto mb-3 h-1 w-16 rounded-full bg-line" />
                <div className="rounded-2xl border border-line bg-surface p-3" dir="rtl" lang="he">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">INVOICE · 4471</p>
                  <p className="mt-1 text-sm font-semibold text-muted">{'חזה עוף טרי 30 ק״ג'}</p>
                </div>
                <div className="my-2 flex justify-center text-primary">
                  <ChevronDown className="h-5 w-5" />
                </div>
                <div className="rounded-2xl border border-primary/40 bg-primary/[0.07] p-3" dir="ltr" lang="en">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-primary">EN</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{t('features.receiver.demoEn')}</p>
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-xs">
                    <span className="text-muted">{t('features.receiver.demoCheck')}</span>
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                  <div className="mt-2 rounded-xl bg-primary py-2.5 text-center text-sm font-bold text-on-primary">
                    {t('features.receiver.demoCta')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Approvals */}
          <FeatureCard icon={ShieldCheck} title={t('features.approvals.title')} body={t('features.approvals.body')}>
            <ul aria-hidden="true" className="space-y-2 text-xs">
              {(
                [
                  { rule: t('features.approvals.r1'), out: t('features.approvals.o1'), tone: 'text-danger' },
                  { rule: t('features.approvals.r2'), out: t('features.approvals.o2'), tone: 'text-danger' },
                  { rule: t('features.approvals.r3'), out: t('features.approvals.o3'), tone: 'text-warn' },
                  { rule: t('features.approvals.r4'), out: t('features.approvals.o4'), tone: 'text-primary' },
                ] as const
              ).map((r) => (
                <li key={r.rule} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/60 px-3 py-2">
                  <span className="text-muted">{r.rule}</span>
                  <span className={cn('shrink-0 font-semibold', r.tone)}>{r.out}</span>
                </li>
              ))}
            </ul>
          </FeatureCard>
          {/* Leak detective */}
          <FeatureCard icon={ScanSearch} title={t('features.detective.title')} body={t('features.detective.body')}>
            <div aria-hidden="true" className="grid grid-cols-[auto_repeat(6,minmax(0,1fr))] items-center gap-1.5 text-[10px] text-subtle">
              {(
                [
                  [t('features.heat.rowA'), [0, 1, 3, 4, 2, 1]],
                  [t('features.heat.rowB'), [1, 0, 0, 2, 1, 0]],
                  [t('features.heat.rowC'), [0, 2, 1, 0, 0, 3]],
                ] as const
              ).map(([label, cells]) => (
                <HeatRow key={label} label={label} cells={cells} />
              ))}
            </div>
          </FeatureCard>
          {/* Accounting export */}
          <FeatureCard icon={FileSpreadsheet} title={t('features.export.title')} body={t('features.export.body')}>
            <div aria-hidden="true" className="flex flex-wrap gap-2 font-mono text-xs">
              {['restomatch-invoices.csv', 'restomatch-1000.txt'].map((f) => (
                <span key={f} dir="ltr" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg/60 px-2.5 py-1.5 text-muted">
                  <FileText className="h-3.5 w-3.5 text-gold" />
                  {f}
                </span>
              ))}
            </div>
          </FeatureCard>
          {/* Calm */}
          <FeatureCard icon={Moon} title={t('features.calm.title')} body={t('features.calm.body')}>
            <div aria-hidden="true" className="flex items-center gap-2">
              {[1, 1, 1, 0, 1, 1, 1, 1].map((ok, i) => (
                <span
                  key={i}
                  className={cn('h-2 flex-1 rounded-full', ok ? 'bg-primary/50' : 'bg-info/60')}
                />
              ))}
            </div>
          </FeatureCard>
        </div>
      </section>

      {/* ───────────────────────── ROI ───────────────────────── */}
      <section id="roi" className="scroll-mt-24 mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-24" aria-labelledby="roi-title">
        <div className="rm-reveal relative overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
          <div className="relative border-b border-line p-6 sm:p-10">
            <div aria-hidden="true" className="glow-danger-blob pointer-events-none absolute -bottom-16 start-0 h-48 w-48 rounded-full blur-2xl" />
            <div className="relative">
              <Eyebrow tone="gold">{t('roi.eyebrow')}</Eyebrow>
              <h2 id="roi-title" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                {t('roi.title')}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{t('roi.lead')}</p>
            </div>
          </div>
          <div className="p-6 sm:p-10">
            <RoiCalculator proPriceIls={proIls} />
          </div>
        </div>
      </section>

      {/* ───────────────────────── TRUST ───────────────────────── */}
      <section className="border-y border-line bg-surface/30" aria-labelledby="trust-title">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="rm-reveal mx-auto mb-12 max-w-2xl text-center">
            <Eyebrow>{t('trust.eyebrow')}</Eyebrow>
            <h2 id="trust-title" className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              {t('trust.title')}
            </h2>
            <p className="mt-4 text-base text-muted">{t('trust.lead')}</p>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {trust.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rm-reveal rounded-2xl border border-line bg-surface p-6 shadow-card">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-info/12 text-info ring-1 ring-info/25">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-bold text-ink">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-center text-sm text-muted">
            {t('trust.links')}{' '}
            <Link href="/privacy" className="font-medium text-primary underline-offset-4 hover:underline">
              {t('trust.privacy')}
            </Link>
            {' · '}
            <Link href="/terms" className="font-medium text-primary underline-offset-4 hover:underline">
              {t('trust.terms')}
            </Link>
            {' · '}
            <Link href="/cookies" className="font-medium text-primary underline-offset-4 hover:underline">
              {t('trust.cookies')}
            </Link>
          </p>
        </div>
      </section>

      {/* ───────────────────────── PRICING TEASER ───────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24" aria-labelledby="pricing-title">
        <div className="rm-reveal grid items-center gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <Eyebrow tone="gold">{t('pricing.eyebrow')}</Eyebrow>
            <h2 id="pricing-title" className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
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
                <span className="font-mono text-4xl font-extrabold tabular-nums text-ink">{ils(basicIls)}</span>
                <span className="text-sm text-subtle">{t('pricing.perMonth')}</span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">{t('pricing.paidBody')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── FAQ ───────────────────────── */}
      <section className="border-t border-line bg-surface/30" aria-labelledby="faq-title">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="mb-10 text-center">
            <Eyebrow>{t('faq.eyebrow')}</Eyebrow>
            <h2 id="faq-title" className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              {t('faq.title')}
            </h2>
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {faqs.map((f) => (
              <details key={f.q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-start text-base font-semibold text-ink transition-colors hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-subtle transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── LEAD CAPTURE ───────────────────────── */}
      <section id="lead" className="relative scroll-mt-24 overflow-hidden border-t border-line" aria-labelledby="lead-title">
        <div aria-hidden="true" className="glow-primary-blob pointer-events-none absolute -bottom-40 start-1/2 h-96 w-[44rem] -translate-x-1/2 rounded-full blur-3xl rtl:translate-x-1/2" />
        <div className="relative mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto mb-8 max-w-xl text-center">
            <div className="mx-auto mb-4 h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
            <h2 id="lead-title" className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              {t('cta.title')}
            </h2>
            <p className="mt-3 text-base text-muted">{t('cta.lead')}</p>
          </div>
          <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
            <LeadForm />
          </div>
          <p className="mt-6 text-center text-sm text-muted">
            {t('cta.demoPrompt')}{' '}
            <Link href="/showcase" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              {t('cta.demoLink')}
              <Forward className="h-3.5 w-3.5" />
            </Link>
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rm-reveal flex flex-col rounded-3xl border border-line bg-surface p-6 shadow-card transition-colors hover:border-primary/30 sm:p-8">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-lg font-bold text-ink">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{body}</p>
      <div className="mt-6">{children}</div>
    </article>
  );
}

const HEAT = ['bg-primary/20', 'bg-warn/30', 'bg-warn/60', 'bg-danger/60', 'bg-danger/90'] as const;

function HeatRow({ label, cells }: { label: string; cells: readonly number[] }) {
  return (
    <>
      <span className="pe-2 text-xs text-muted">{label}</span>
      {cells.map((c, i) => (
        <span key={i} className={cn('h-6 rounded-md', HEAT[c] ?? HEAT[0])} />
      ))}
    </>
  );
}
