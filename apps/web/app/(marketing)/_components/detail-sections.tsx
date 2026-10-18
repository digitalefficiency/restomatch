import Link from 'next/link';
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronDown,
  CircleSlash,
  Copy,
  FileSpreadsheet,
  FileText,
  Gavel,
  GitCompareArrows,
  KeyRound,
  Languages,
  Lock,
  Moon,
  PackageX,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';
import type { Translator } from '@/lib/i18n/translate';
import type { he as landingHe } from '@/lib/i18n/messages/landing/he';
import { formatIls } from '@/lib/money';
import { cn } from '@/lib/components/cn';
import { RoiCalculator } from './RoiCalculator';

/**
 * The landing page's DETAIL sections (Landing v1). Landing v2 keeps the home
 * page short; these moved — unchanged in substance — to /about (problem in ₪,
 * features, calculator, trust & security) and the FAQ stays on the home page
 * as a collapsed accordion. Server components; pass the `landing` translator.
 */
type T = Translator<typeof landingHe>;

/** "Forward" arrow: points left in RTL, right in LTR. */
export function Forward({ className }: { className?: string }) {
  return <ArrowLeft className={cn('h-4 w-4 ltr:-scale-x-100', className)} aria-hidden="true" />;
}

export function Eyebrow({ children, tone = 'primary' }: { children: React.ReactNode; tone?: 'primary' | 'danger' | 'gold' }) {
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

export function faqItems(t: T) {
  return (['1', '2', '3', '4', '5', '6', '7'] as const).map((n) => ({ q: t(`faq.q${n}`), a: t(`faq.a${n}`) }));
}

/** Honest facts strip — what the product does, no fake logos or customer counts. */
export function FactsStrip({ t }: { t: T }) {
  return (
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
  );
}

export function ProblemSection({ t, locale }: { t: T; locale: Locale }) {
  const ils = (n: number) => formatIls(n, { locale });
  const problems = [
    { icon: TrendingUp, title: t('problem.c1Title'), body: t('problem.c1Body'), amount: t('problem.c1Amount') },
    { icon: PackageX, title: t('problem.c2Title'), body: t('problem.c2Body'), amount: t('problem.c2Amount') },
    { icon: CircleSlash, title: t('problem.c3Title'), body: t('problem.c3Body'), amount: t('problem.c3Amount') },
    { icon: Copy, title: t('problem.c4Title'), body: t('problem.c4Body'), amount: t('problem.c4Amount') },
  ];
  return (
    <section id="problem" className="scroll-mt-24 mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24" aria-labelledby="problem-title">
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
        <p className="mx-auto mt-2 max-w-2xl text-xs leading-relaxed text-muted">{t('problem.mathNote')}</p>
      </div>
    </section>

  );
}

export function FeaturesSection({ t }: { t: T }) {
  return (
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
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted">INVOICE · 4471</p>
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
          <div aria-hidden="true" className="grid grid-cols-[auto_repeat(6,minmax(0,1fr))] items-center gap-1.5 text-[10px] text-muted">
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

  );
}

export function RoiSection({ t, proIls }: { t: T; proIls: number }) {
  return (
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

  );
}

export function TrustSection({ t }: { t: T }) {
  const trust = [
    { icon: Lock, title: t('trust.t1Title'), body: t('trust.t1Body') },
    { icon: KeyRound, title: t('trust.t2Title'), body: t('trust.t2Body') },
    { icon: Gavel, title: t('trust.t3Title'), body: t('trust.t3Body') },
    { icon: ScrollText, title: t('trust.t4Title'), body: t('trust.t4Body') },
  ];
  return (
    <section id="trust" className="scroll-mt-24 border-y border-line bg-surface/30" aria-labelledby="trust-title">
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

  );
}

export function FaqSection({ t }: { t: T }) {
  const faqs = faqItems(t);
  return (
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
                  className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </summary>
              <p className="px-5 pb-5 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>

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
