import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { UserRole } from '@restomatch/db';
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
import { cn } from '@/lib/components';
import { Money } from '@/lib/components/money';
import { LeakHero, daySpan, heroDelta, leakHeroState, leakSplit, showsPct, type LeakHeroProps } from '@/lib/components/hero';
import { DEFAULT_VIEW, toViewInput, type ViewState } from '@/lib/components/views';
import { othersLine, taskRow } from '@/lib/components/notifications/rows';
import type { Caller } from './caller';
import { loadHeroPair, loadRecoveryFlags } from './data';
import { NeedsYou, type NeedRow } from './needs-you';
import { HomeSection } from './section';
import { CardSkeleton, HeroSkeleton, NeedsSkeleton } from './skeletons';

export type FinanceRole = Extract<UserRole, 'owner' | 'manager' | 'bookkeeper'>;

export interface Translators {
  t: Translator<typeof overviewHe>;
  tv: Translator<typeof viewsHe>;
  tl: Translator<typeof leaksHe>;
  tr: Translator<typeof recoveryHe>;
  tp: Translator<typeof leakProofHe>;
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

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2';

/**
 * The finance homes, ≤5 blocks each (IA-SPEC §5, owner decisions I1–I3, 7.11):
 * - owner: the compact leak hero (T1; "למה?" opens in place) · 3 task rows with
 *   one verb each + "עוד N" · one gold good-news row ("הוחזר החודש");
 * - manager: the shift's tasks first, the leak as a link row under them;
 * - bookkeeper: her tasks, no leak hero (she reads the leak in the monthly report).
 * Everything else has one home elsewhere: activity → the bell, price creep →
 * /leaks#prices, VAT → a task row (owner: only within 30 days of its deadline),
 * dish costs → recipes. Every block streams and fails on its own.
 *
 * `questions` (G-08 "זה אותו מוצר?", a count with no ₪) goes right under the
 * task strip, never above the T1 hero (375×667 fold).
 */
export function FinanceHome({ questions, ...ctx }: Ctx & { questions?: React.ReactNode }) {
  const { role, fail } = ctx;
  if (role === 'owner') {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-home-blocks="owner">
        <HomeSection name="hero" fallback={<HeroSkeleton />} forceFail={fail.has('hero')}>
          <Hero {...ctx} />
        </HomeSection>
        <HomeSection name="needs" fallback={<NeedsSkeleton rows={3} />} forceFail={fail.has('needs')}>
          <Needs {...ctx} max={3} />
        </HomeSection>
        {questions}
        <HomeSection name="returned" fallback={<CardSkeleton className="h-14" />} forceFail={fail.has('returned')}>
          <GoodNews {...ctx} />
        </HomeSection>
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
 * "מחכה לך" from the task spine (`tasks.mine`, W2-08): the same tasks, ₪ and
 * order as the nav badges and the bell. At most 3 rows on the phone ("עוד N"),
 * ranked on the server (block > due today > age > ₪). "הכל טופל" only when the
 * whole restaurant is clear; otherwise the line names who it waits on.
 */
async function Needs(ctx: Ctx & { max: number }) {
  const { role, t, locale } = ctx;
  const { tasks, failed, restaurantClear } = await ctx.caller.tasks.mine();
  const side = (agorot: number) => formatIls(agorot / 100, { locale });
  const rows: NeedRow[] = tasks
    .filter((x) => x.scope === 'mine')
    .map((x) => taskRow(x, t, locale, side))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  // Unknown is never "all handled": a failed source with nothing to show fails the card.
  if (failed.length > 0 && rows.length === 0) throw new Error(`[home] task sources failed: ${failed.join(',')}`);
  const others = othersLine(tasks, t, locale, side);
  const zero = others ?? (restaurantClear ? (role === 'bookkeeper' ? t('needs.zero') : t('needs.zeroCaught')) : t('needs.failed'));
  return (
    <div className={role === 'owner' ? '[&_#needs-you-title]:sr-only' : '[&_#needs-you-title]:lg:sr-only'}>
      <NeedsYou
        title={t('needs.title')}
        rows={rows}
        zero={zero}
        zeroTone={others ? 'neutral' : 'good'}
        moreLabel={(c) => t('needs.more', { count: formatNumber(c, locale) })}
        max={ctx.max}
      />
    </div>
  );
}

/* ─────────────────────────────── T1 hero ─────────────────────────────── */

function spanLabel(t: Ctx['t'], locale: Locale, from: Date, to: Date, withYear = false): string {
  const sameMonth = formatDate(from, locale, { month: 'numeric', year: 'numeric' }) === formatDate(to, locale, { month: 'numeric', year: 'numeric' });
  if (!sameMonth) {
    const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' as const } : {}) };
    return `${formatDate(from, locale, o)}–${formatDate(to, locale, o)}`;
  }
  return t('hero.range', {
    from: formatDate(from, locale, { day: 'numeric' }),
    to: formatDate(to, locale, { day: 'numeric' }),
    // A year-over-year comparison names its year ("1–25 באוקטובר 2025").
    month: formatDate(from, locale, withYear ? { month: 'long', year: 'numeric' } : { month: 'long' }),
  });
}

async function Hero(ctx: Ctx) {
  const { role, t, tr, locale } = ctx;
  const canDrill = canSeeRoute(role, '/dashboard/leaks');
  // The home has no view toolbar any more (IA rule 7): the hero is always this month, owner.leakHero.
  const [{ current, previous }, flags] = await Promise.all([
    loadHeroPair(JSON.stringify(toViewInput(DEFAULT_VIEW)), 'prev', true),
    loadRecoveryFlags(),
  ]);
  const ils = (v: number) => formatIls(v, { locale });
  const n = (v: number) => formatNumber(v, locale);
  const state = leakHeroState(current);
  const split = leakSplit(current);
  const drillHref = '/dashboard/leaks/breakdown';

  const d = heroDelta(current, previous);
  let delta: LeakHeroProps['delta'] = null;
  if (state === 'leak' || state === 'clean') {
    if (!d || !previous) delta = { none: t('hero.delta.none') };
    else {
      const prevSpan = daySpan(previous.monthStart, previous.monthEnd);
      const pctText = d.pct == null ? '' : ` (${formatNumber(d.pct, locale, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' })})`;
      delta = {
        direction: d.direction,
        word: d.direction === 'up' ? t('hero.delta.up') : d.direction === 'down' ? t('hero.delta.down') : t('hero.delta.same'),
        // G11: no typed ▲/▼ (no UI face has U+25B2/25BC); LeakHero draws the trend icon + word.
        text: `${d.direction === 'same' ? '' : ils(d.amountIls)}${pctText} ${t('hero.delta.vs', { range: spanLabel(t, locale, prevSpan.from, prevSpan.to) })}`.replace(/\s+/g, ' ').trim(),
      };
    }
  }

  const canProve = flags.leakProof && canSeeRoute(role, '/dashboard/leaks/proof');
  const moreItems = [
    ...(flags.monthlyReport && canSeeRoute(role, '/dashboard/reports') ? [{ label: tr('report.preview'), href: '/dashboard/reports/monthly', testId: 'hero-report-preview' }] : []),
  ];
  const pct = showsPct(current) ? t('hero.pctOfSpend', { pct: formatPercent(current.leakPct!, locale, 1) }) : null;
  // WHY (closed, opens in place): base · unpaid/paid split · waiting for a PO link · the rule.
  const why =
    state === 'leak' || state === 'pendingOnly'
      ? {
          label: t('needs.why'),
          testId: 'hero-why',
          children: (
            <>
              {current.spendIls > 0 ? <p data-testid="hero-why-base">{t('needs.whyBase', { spend: ils(current.spendIls) })}</p> : null}
              {state === 'leak' ? <p data-testid="hero-why-split">{t('needs.whySplit', { unpaid: ils(split.unpaidIls), paid: ils(split.paidIls) })}</p> : null}
              {current.pendingLinkCount > 0 ? (
                <p data-testid="hero-pending-link">{t('hero.pending', { count: n(current.pendingLinkCount), amount: ils(current.pendingLinkIls) })}</p>
              ) : null}
              {(current.awaitingQuestionCount ?? 0) > 0 ? (
                <p data-testid="hero-awaiting-question">
                  {t('hero.awaitingQuestion', { count: n(current.awaitingQuestionCount!), amount: ils(current.awaitingQuestionIls ?? 0) })}
                  {/* G-08: the mapper only for a role that may answer (never the bookkeeper). */}
                  {canSeeRoute(role, '/dashboard/catalog/mapping') ? (
                    <>
                      {' '}
                      <Link href="/dashboard/catalog/mapping" className={cn('font-semibold text-primary hover:underline', focus)}>
                        {t('hero.awaitingQuestionCta')}
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
              {(current.awaitingCountCount ?? 0) > 0 ? (
                <p data-testid="hero-awaiting-count">{t('hero.awaitingCount', { count: n(current.awaitingCountCount!), amount: ils(current.awaitingCountIls ?? 0) })}</p>
              ) : null}
              <p>{t('hero.calc')}</p>
              {canProve || canDrill ? (
                <Link href={canProve ? '/dashboard/leaks/proof' : drillHref} data-testid="hero-proof" className={cn('inline-flex min-h-8 items-center font-semibold text-primary hover:underline', focus)}>
                  {t('needs.whyProof')}
                </Link>
              ) : null}
            </>
          ),
        }
      : null;

  return (
    <LeakHero
      state={state}
      // No date eyebrow (IA density budget): the Δ line already names the compared span.
      eyebrow=""
      label={t('hero.leakedLabel')}
      amount={ils(current.leakIls)}
      // The number itself is the link (IA rule 7: no "לחשבוניות שמאחורי ₪760" button).
      amountHref={canDrill ? drillHref : undefined}
      pctLine={pct}
      thinNote={!pct && current.matchedInvoiceCount > 0 ? t('hero.thinBase', { count: n(current.matchedInvoiceCount) }) : null}
      delta={delta}
      completeness={
        current.matchedInvoiceCount > 0
          ? { text: t('hero.invoicesLine', { total: n(current.matchedInvoiceCount), withLeak: n(current.invoicesWithLeak) }), href: canDrill ? drillHref : undefined }
          : null
      }
      cleanSentence={t('hero.clean', { count: n(current.matchedInvoiceCount) })}
      noData={{
        title: t('hero.noData.title', { month: formatDate(current.monthStart, locale, { month: 'long' }) }),
        hint: t('hero.noData.hint'),
        cta: canSeeRoute(role, '/dashboard/receiving') ? { label: t('hero.noData.cta'), href: '/dashboard/receiving', testId: 'hero-nodata-cta' } : null,
      }}
      why={why}
      more={moreItems.length ? { label: t('hero.more'), items: moreItems } : null}
    />
  );
}

/** T3, one calm row: "הוחזר החודש ₪1,267" → the recovery tracker. Hidden when the flag is off. */
async function GoodNews({ caller, role, t, locale }: Ctx) {
  const flags = await loadRecoveryFlags();
  if (!flags.recovery) return null;
  const returned = await caller.recovery.returnedThisMonth();
  if (returned.returnedAgorot <= 0) return null;
  const body = (
    <>
      <span className="min-w-0 truncate text-sm font-semibold text-ink">{t('hero.returned')}</span>
      <span className="flex shrink-0 items-center gap-2 text-lg font-bold tabular-nums">
        <Money agorot={returned.returnedAgorot} context="inline" state="returned" locale={locale} />
        <ArrowLeft className="h-4 w-4 text-muted ltr:-scale-x-100" aria-hidden="true" />
      </span>
    </>
  );
  const box = 'flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-2';
  return canSeeRoute(role, '/dashboard/recovery') ? (
    <Link href="/dashboard/recovery" data-testid="hero-returned" className={cn(box, 'hover:border-primary/40', focus)}>
      {body}
    </Link>
  ) : (
    <div data-testid="hero-returned" className={box}>
      {body}
    </div>
  );
}

/** Manager: the leak is one link row under the shift's tasks (decision I2), same figure as the hero. */
async function LeakLinkRow({ t, locale }: Ctx) {
  const { current } = await loadHeroPair(JSON.stringify(toViewInput(DEFAULT_VIEW)), 'prev', true);
  return (
    <Link
      href="/dashboard/leaks"
      data-testid="home-leak-link"
      className={cn('flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-2 hover:border-primary/40', focus)}
    >
      <span className="text-sm font-semibold text-ink">{t('needs.leakLink')}</span>
      <span className="flex shrink-0 items-center gap-2 text-base font-bold tabular-nums text-ink">
        <Money value={current.leakIls} context="inline" locale={locale} />
        <ArrowLeft className="h-4 w-4 text-muted ltr:-scale-x-100" aria-hidden="true" />
      </span>
    </Link>
  );
}
