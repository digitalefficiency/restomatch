import Link from 'next/link';
import { Check } from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { vatBasisOf } from '@restomatch/api';
import { LEAK_EXCLUDED_TYPES } from '@restomatch/charts';
import { canSeeRoute } from '@/lib/roles';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { Translator } from '@/lib/i18n/translate';
import type { he as overviewHe } from '@/lib/i18n/messages/overview/he';
import type { he as viewsHe } from '@/lib/i18n/messages/views/he';
import type { he as leaksHe } from '@/lib/i18n/messages/leaks/he';
import type { he as recoveryHe } from '@/lib/i18n/messages/recovery/he';
import type { he as leakProofHe } from '@/lib/i18n/messages/leakProof/he';
import { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import { cn } from '@/lib/components/cn';
import { PaceLine } from '@/lib/components/data-viz';
import { DirIcon, Icon } from '@/lib/components/icon';
import { Money } from '@/lib/components/money';
import {
  HeroNote,
  LeakHero,
  PacePlaceholder,
  THIN_BASE_INVOICES,
  agorotOf,
  heroDelta,
  heroMonthKey,
  leakHeroState,
  leakSplit,
  paceSeries,
  showsPct,
  todayDayIndex,
  type DeltaDirection,
  type LeakHeroPart,
  type LeakHeroProps,
} from '@/lib/components/hero';
import { HERO_LINK } from '@/lib/components/hero/classes';
import { DEFAULT_VIEW, toViewInput, type ViewState } from '@/lib/components/views';
import { othersLine } from '@/lib/components/notifications/rows';
import { discrepancyLabel } from '../approvals/vocab';
import type { Caller } from './caller';
import { CalcRows, type CalcBasis } from './calc-rows';
import { loadHeroPair, loadRecoveryFlags, loadTrend } from './data';
import { needRowsOf, type BasisWords } from './need-rows';
import { NeedsYou } from './needs-you';
import { HomeSection, Suspense } from './section';
import { CardSkeleton, GoodSkeleton, HeroSkeleton, NeedsSkeleton } from './skeletons';

export type FinanceRole = Extract<UserRole, 'owner' | 'manager' | 'bookkeeper'>;

export interface Translators {
  t: Translator<typeof overviewHe>;
  tv: Translator<typeof viewsHe>;
  tl: Translator<typeof leaksHe>;
  tr: Translator<typeof recoveryHe>;
  tp: Translator<typeof leakProofHe>;
  /** The discrepancy vocabulary (the calculation's kinds of gap), read only. */
  ta: Translator<typeof approvalsHe>;
}

interface Ctx extends Translators {
  caller: Caller;
  role: FinanceRole;
  restaurantId: string;
  restaurantName: string;
  locale: Locale;
  view: ViewState;
  fail: Set<string>;
}

/** The hero's month view (the home has no view toolbar, IA rule 7): this month, owner.leakHero. */
const THIS_MONTH = JSON.stringify(toViewInput(DEFAULT_VIEW));

/**
 * The VAT basis of every kind of gap the product names (the approvals vocabulary's types), as the
 * server measures them (vatBasisOf): the calculation's rows say it when they mix bases.
 */
const BASIS_BY_TYPE: Record<string, CalcBasis> = Object.fromEntries(Object.keys(approvalsHe.types).map((type) => [type, vatBasisOf(type)]));

/** The three VAT bases in the product's own words (the claim letters'), for every amount the home shows. */
const basisWordsOf = (tl: Ctx['tl']): BasisWords => ({ excl: tl('claims.basis.excl'), incl: tl('claims.basis.incl'), vat: tl('claims.basis.vat') });

/**
 * The finance homes, ≤5 blocks each (IA-SPEC §5, owner decisions I1–I3, 7.11; DS3 SPEC §10.1):
 * - owner: the leak card alone in the start column (one number, its pace, its split, and how it
 *   adds up, opened in place); "מחכה לך" with one filled verb, the question line and "הוחזר החודש"
 *   in the end column; one column on a phone, in that order;
 * - manager: the shift's tasks first, the leak as a link row under them;
 * - bookkeeper: her tasks, no leak hero (she reads the leak in the monthly report).
 * Everything else has one home elsewhere: activity → the bell, price creep → /leaks#prices, VAT →
 * a task row (owner: only within 30 days of its deadline), dish costs → recipes. Every block
 * streams and fails on its own.
 *
 * `questions` (G-08 "זה אותו מוצר?", a count with no ₪) goes right under the task card, never above
 * the T1 hero.
 */
export function FinanceHome({ questions, ...ctx }: Ctx & { questions?: React.ReactNode }) {
  const { role, fail } = ctx;
  if (role === 'owner') {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-12 lg:items-start lg:gap-6" data-home-blocks="owner">
        <div className="lg:col-span-7">
          <HomeSection name="hero" fallback={<HeroSkeleton />} forceFail={fail.has('hero')}>
            <Hero {...ctx} />
          </HomeSection>
        </div>
        <div className="flex flex-col gap-4 lg:col-span-5">
          <HomeSection name="needs" fallback={<NeedsSkeleton rows={3} />} forceFail={fail.has('needs')}>
            <Needs {...ctx} max={3} />
          </HomeSection>
          {questions}
          <HomeSection name="returned" fallback={<GoodSkeleton />} forceFail={fail.has('returned')}>
            <GoodNews {...ctx} />
          </HomeSection>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-home-blocks={role}>
      <HomeSection name="needs" fallback={<NeedsSkeleton rows={4} />} forceFail={fail.has('needs')}>
        <Needs {...ctx} max={5} />
      </HomeSection>
      {questions}
      {role === 'manager' ? (
        <HomeSection name="leakLink" fallback={<CardSkeleton className="h-12" />} forceFail={fail.has('leakLink')}>
          <LeakLinkRow {...ctx} />
        </HomeSection>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── מחכה לך ─────────────────────────────── */

/**
 * "מחכה לך" from the task spine (`tasks.mine`, W2-08): the same tasks, ₪ and order as the nav
 * badges and the bell. At most `max` rows ("עוד" folds the rest in place), ranked on the server
 * (block > due today > age > ₪); row 0's verb is the one filled primary. "הכול מטופל" only when the
 * whole restaurant is clear; otherwise the line names who it waits on.
 */
async function Needs(ctx: Ctx & { max: number }) {
  const { role, t, tl, locale } = ctx;
  const { tasks, failed, restaurantClear } = await ctx.caller.tasks.mine();
  const side = (agorot: number) => formatIls(agorot / 100, { locale });
  const { rows, chip } = needRowsOf(tasks, { t, locale, sideMoney: side, basis: basisWordsOf(tl), chipAllowed: role === 'owner' });
  // Unknown is never "all handled": a failed source with nothing to show fails the card.
  if (failed.length > 0 && rows.length === 0) throw new Error(`[home] task sources failed: ${failed.join(',')}`);
  const others = othersLine(tasks, t, locale, side);
  const zero = others ?? (restaurantClear ? (role === 'bookkeeper' ? t('needs.zero') : t('needs.zeroCaught')) : t('needs.failed'));
  return (
    // The owner's title shows (DS3: "מחכה לך" with the VAT basis beside it). The manager's and the
    // bookkeeper's list IS their page: the title shows on the phone and is for screen readers at lg.
    <div className={role === 'owner' ? undefined : '[&_[data-needs-head]]:lg:sr-only'}>
      <NeedsYou
        title={t('needs.title')}
        rows={rows}
        zero={zero}
        // Green only for "all handled"; a line about others, or about tasks that did not load, is neutral.
        zeroTone={!others && restaurantClear ? 'good' : 'neutral'}
        moreLabel={(count) => t('needs.moreTasks', { count })}
        max={ctx.max}
        primaryFirst
        basisChip={chip}
      />
    </div>
  );
}

/* ─────────────────────────────── T1 hero ─────────────────────────────── */

async function Hero(ctx: Ctx) {
  const { role, t, tl, tr, ta, locale } = ctx;
  // Every leak link is gated by the leaks area itself (canSeeRoute is an exact lookup: never a
  // sub-path, a '#' or a '?').
  const canDrill = canSeeRoute(role, '/dashboard/leaks');
  const [{ current, previous }, flags] = await Promise.all([loadHeroPair(THIS_MONTH, 'prev', true), loadRecoveryFlags()]);
  const ils = (v: number) => formatIls(v, { locale });
  const monthOf = (iso: string) => formatDate(iso, locale, { month: 'long' });
  const state = leakHeroState(current);
  const leaked = state === 'leak';
  const told = leaked || state === 'clean';
  const drillHref = '/dashboard/leaks/breakdown';
  const d = heroDelta(current, previous);
  // The pace line can only come for a leak month from its 2nd day (paceSeries): only then is its
  // place held, so no empty slot stands beside the number on the 1st or in another state.
  const today = todayDayIndex(Date.now(), current.monthStart);
  const paceCanCome = leaked && today >= 2;

  // The change against the same days last month, in words (heroDelta: exact agorot of the two
  // procedure figures, unchanged); the % unsigned, in parentheses. No comparable days — none at all,
  // or none with a checked invoice (its ₪0 is not a figure to compare with) → a caption.
  let delta: LeakHeroProps['delta'] = null;
  if (told) {
    if (!d || !previous || previous.matchedInvoiceCount <= 0) delta = { none: t('hero.delta.none') };
    else {
      const pct = d.pct == null ? '' : ` (${formatNumber(Math.abs(d.pct), locale, { style: 'percent', maximumFractionDigits: 0 })})`;
      const word =
        d.direction === 'up'
          ? `${t('hero.delta.upBy', { amount: ils(d.amountIls) })}${pct}`
          : d.direction === 'down'
            ? `${t('hero.delta.downBy', { amount: ils(d.amountIls) })}${pct}`
            : t('hero.delta.same');
      delta = { direction: d.direction, word, text: t('hero.delta.vsSameDays', { month: monthOf(previous.monthStart) }) };
    }
  }

  // The scale sentence: "1.9% מהרכש שנבדק, מתוך ₪41,526 לפני מע״מ"; on a thin base the base alone.
  const pct = showsPct(current) && current.leakPct != null ? formatPercent(current.leakPct, locale, 1) : null;
  const base = told && current.spendIls > 0 ? t(pct ? 'hero.pctBase' : 'hero.spendBase', { spend: ils(current.spendIls) }) : null;
  const thin = told && !pct && current.matchedInvoiceCount > 0 && current.matchedInvoiceCount < THIN_BASE_INVOICES;

  // The split by payment status (leakSplit: the parts add up to the hero, to the agora).
  const split = leakSplit(current);
  const parts: LeakHeroPart[] | undefined = leaked
    ? [
        {
          label: t('hero.unpaid'),
          value: ils(split.unpaidIls),
          agorot: agorotOf(split.unpaidIls),
          href: canDrill ? `${drillHref}#group-unpaid` : undefined,
          linkLabel: t('hero.unpaidLink'),
          testId: 'hero-unpaid',
          linkTestId: 'hero-unpaid-link',
          // Nothing in the product marks an invoice paid yet: the one-line form says "not marked as paid".
          whole: { text: t('hero.allUnpaid'), linkLabel: t('hero.allUnpaidLink'), linkTestId: 'hero-unpaid-link' },
        },
        {
          label: t('hero.paid'),
          value: ils(split.paidIls),
          agorot: agorotOf(split.paidIls),
          href: canDrill ? '/dashboard/leaks/claims' : undefined,
          linkLabel: t('hero.paidLink'),
          testId: 'hero-paid',
          linkTestId: 'hero-paid-link',
          whole: { text: t('hero.allPaid'), linkLabel: t('hero.paidLink'), linkTestId: 'hero-paid-link' },
        },
      ]
    : undefined;

  // T4 (grey, a clock; never a warning): what waits and is in neither the leak nor the spend yet.
  // In the calculation for a leak month; under "—" while only waiting invoices are known.
  const notes = [
    current.pendingLinkCount > 0 ? (
      <HeroNote key="pending" testId="hero-pending-link">
        {t('hero.pending', { count: current.pendingLinkCount, amount: ils(current.pendingLinkIls) })}
      </HeroNote>
    ) : null,
    current.awaitingQuestionCount > 0 ? (
      <HeroNote key="question" testId="hero-awaiting-question">
        {t('hero.awaitingQuestion', { count: current.awaitingQuestionCount, amount: ils(current.awaitingQuestionIls) })}
        {/* G-08: the mapper only for a role that may answer (never the bookkeeper). */}
        {canSeeRoute(role, '/dashboard/catalog/mapping') ? (
          <>
            {' '}
            <Link href="/dashboard/catalog/mapping" className={HERO_LINK}>
              {t('hero.awaitingQuestionCta')}
            </Link>
          </>
        ) : null}
      </HeroNote>
    ) : null,
    current.awaitingCountCount > 0 ? (
      <HeroNote key="count" testId="hero-awaiting-count">
        {t('hero.awaitingCount', { count: current.awaitingCountCount, amount: ils(current.awaitingCountIls) })}
      </HeroNote>
    ) : null,
  ].filter((note) => note !== null);

  const canProve = flags.leakProof && canSeeRoute(role, '/dashboard/leaks/proof');
  const proofHref = canProve ? '/dashboard/leaks/proof' : canDrill ? drillHref : null;
  // What is not counted: the ONE exclusion list behind the leak (LEAK_EXCLUDED_TYPES) in the
  // product's names for the kinds of gap, and a duplicate the team marked "not a duplicate".
  const notCounted = [...LEAK_EXCLUDED_TYPES.map((type) => discrepancyLabel(ta, type)), t('hero.calcNotDuplicate')];

  // "איך הגענו לסכום?" — the calculation, opened in place (leak month only): the rows load on the
  // first open (CalcRows); the rule, what waits and the full breakdown are rendered here.
  const why: LeakHeroProps['why'] = leaked
    ? {
        label: t('needs.why'),
        panelLabel: t('hero.calcAria'),
        testId: 'hero-why',
        toggleTestId: 'hero-why-toggle',
        children: (
          <>
            <CalcRows
              month={heroMonthKey(current.monthStart, current.monthEnd)}
              heroMonthStart={current.monthStart}
              heroAgorot={agorotOf(current.leakIls)}
              basisByType={BASIS_BY_TYPE}
              basisWords={{ ...basisWordsOf(tl), mixed: tl('claims.mixedBasis') }}
              locale={locale}
            />
            <div className="mt-3 text-body-sm text-fg-secondary" data-testid="hero-calc-rule">
              <p>{t('hero.calcCounted')}</p>
              <p className="mt-1">{t('hero.calcNotCounted')}</p>
              <ul className="list-disc ps-5 marker:text-fg-tertiary" data-testid="hero-calc-excluded">
                {notCounted.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </div>
            {notes.length > 0 ? <div className="mt-3 space-y-1.5">{notes}</div> : null}
            {proofHref ? (
              <p className="mt-3">
                <Link href={proofHref} data-testid="hero-proof" className={HERO_LINK}>
                  {t('hero.calcLink')}
                </Link>
              </p>
            ) : null}
          </>
        ),
      }
    : null;

  const moreItems = [
    ...(flags.monthlyReport && canSeeRoute(role, '/dashboard/reports') ? [{ label: tr('report.preview'), href: '/dashboard/reports/monthly', testId: 'hero-report-preview' }] : []),
  ];

  return (
    <LeakHero
      state={state}
      eyebrow=""
      label={t('hero.leakedLabel')}
      // The exact figure (2 dp) goes to <Money> in the counting island; this string is its fallback only.
      amount={ils(current.leakIls)}
      amountIls={current.leakIls}
      locale={locale}
      // The number itself is the link (IA rule 7: no "לחשבוניות שמאחורי ₪760" button).
      amountHref={canDrill ? drillHref : undefined}
      period={state === 'noData' ? null : t('hero.period', { month: monthOf(current.monthStart) })}
      pct={told ? pct : null}
      pctLine={told && pct ? t('hero.pctOfChecked') : null}
      baseLine={base}
      thinNote={thin ? t('hero.thinBase', { count: current.matchedInvoiceCount }) : null}
      delta={delta}
      pace={
        paceCanCome ? (
          // Its own boundary: the T1 number never waits for the trend, and nothing moves when it lands.
          <Suspense fallback={<PacePlaceholder />}>
            <HeroPace current={current} previous={previous} direction={d?.direction ?? null} today={today} t={t} locale={locale} />
          </Suspense>
        ) : undefined
      }
      splitLabel={t('hero.split')}
      splitAria={t('hero.splitAria')}
      parts={parts}
      completeness={leaked ? { text: t('hero.checkedLine', { total: current.matchedInvoiceCount, withLeak: current.invoicesWithLeak }) } : null}
      cleanSentence={t('hero.clean', { count: current.matchedInvoiceCount })}
      pending={state === 'pendingOnly' && notes.length > 0 ? notes : undefined}
      noData={{
        title: t('hero.noData.title', { month: monthOf(current.monthStart) }),
        hint: t('hero.noData.hint'),
        cta: canSeeRoute(role, '/dashboard/receiving') ? { label: t('hero.noData.cta'), href: '/dashboard/receiving', testId: 'hero-nodata-cta' } : null,
      }}
      why={why}
      more={moreItems.length ? { label: t('hero.more'), items: moreItems } : null}
      // The entry motion plays for the owner (LeakHero draws it only for a leak month with the exact figure).
      entry={role === 'owner'}
    />
  );
}

/**
 * The pace line beside the number (SPEC §10.1): this month's leak building up day by day against
 * the same days last month, from owner.leakTrend — drawn only when it ends on the hero to the agora
 * (paceSeries), and named in words, never with a total. A failed read leaves no chart and no gap.
 */
async function HeroPace({
  current,
  previous,
  direction,
  today,
  t,
  locale,
}: {
  current: { monthStart: string; leakIls: number };
  previous: { monthStart: string; leakIls: number; matchedInvoiceCount: number } | null;
  direction: DeltaDirection | null;
  /** The hero's local day of the month (todayDayIndex), as the caller decided the slot with it. */
  today: number;
  t: Ctx['t'];
  locale: Locale;
}) {
  const trend = await loadTrend(JSON.stringify({ period: 'this_month' }), 'prev').catch((error: unknown) => {
    // A missing chart is not a missing ₪: the number, the sentence and the split carry every figure.
    console.warn('[home] pace line', error);
    return null;
  });
  if (!trend) return null;
  const series = paceSeries({
    bucket: trend.bucket,
    points: trend.points,
    current: { monthStart: current.monthStart, leakIls: current.leakIls },
    today,
    previous: previous
      ? { monthStart: previous.monthStart, leakIls: previous.leakIls, matchedInvoiceCount: previous.matchedInvoiceCount, points: trend.previous }
      : null,
  });
  if (!series) return null;
  const month = formatDate(current.monthStart, locale, { month: 'long' });
  let prevLabel: string | null = null;
  let label = t('hero.pace.ariaCurOnly', { month });
  if (series.prev && previous && direction) {
    const prevMonth = formatDate(previous.monthStart, locale, { month: 'long' });
    prevLabel = t('hero.pace.prev', { month: prevMonth });
    label = t('hero.pace.aria', { month, prevMonth, trend: t(`hero.pace.trend.${direction}`, { prevMonth }) });
  }
  return <PaceLine series={series} curLabel={month} prevLabel={prevLabel} label={label} testId="leak-hero-pace" />;
}

/**
 * T3 (SPEC §10.1 "a calm green card"): "הוחזר החודש" — credits recovered this month, whatever month
 * their gap was in, before VAT — with the round green tick and the amount in the recovered role.
 * No card while the recovery feature is off, the figure is unknown or nothing came back yet.
 */
async function GoodNews({ caller, role, t, tl, locale }: Ctx) {
  const flags = await loadRecoveryFlags();
  if (!flags.recovery) return null;
  const { returnedAgorot } = await caller.recovery.returnedThisMonth();
  // Unknown or nothing back is no card, never "₪0" (also when the figure becomes nullable, #258).
  if (returnedAgorot == null || returnedAgorot <= 0) return null;
  const body = (
    <>
      <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-pill bg-ok-dot text-on-bold">
        <Icon as={Check} size="body-sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-medium text-fg">{t('hero.returned')}</span>
        <span className="block text-row-sub text-fg-secondary max-sm:hidden">{t('hero.returnedHint')}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-xl font-medium">
          <Money agorot={returnedAgorot} context="inline" state="returned" split locale={locale} />
        </span>
        <span className="block text-caption text-fg-tertiary">{tl('claims.basis.excl')}</span>
      </span>
    </>
  );
  const box = 'flex items-center gap-3 rounded-card border border-line-rule bg-surface px-5 py-3.5 shadow-e1 max-sm:px-4';
  return canSeeRoute(role, '/dashboard/recovery') ? (
    <Link href="/dashboard/recovery" data-testid="hero-returned" className={cn(box, 'transition-colors duration-micro ease-standard hover:bg-surface-hover')}>
      {body}
    </Link>
  ) : (
    <div data-testid="hero-returned" className={box}>
      {body}
    </div>
  );
}

/** Manager: the leak is one link row under the shift's tasks (decision I2), the same figure as the hero. */
async function LeakLinkRow({ t, locale }: Ctx) {
  const { current } = await loadHeroPair(THIS_MONTH, 'prev', true);
  return (
    <Link
      href="/dashboard/leaks"
      data-testid="home-leak-link"
      className="flex min-h-12 items-center justify-between gap-3 rounded-card border border-line-rule bg-surface px-5 py-3 shadow-e1 transition-colors duration-micro ease-standard hover:bg-surface-hover max-sm:px-4"
    >
      <span className="text-body-sm font-medium text-fg">{t('needs.leakLink')}</span>
      <span className="flex shrink-0 items-center gap-2 text-lg font-medium text-fg">
        <span data-money-agorot={agorotOf(current.leakIls)}>
          <Money value={current.leakIls} context="inline" split locale={locale} />
        </span>
        <DirIcon kind="forward" className="text-fg-tertiary" />
      </span>
    </Link>
  );
}
