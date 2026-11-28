import Link from 'next/link';
import { Camera, Check, Clock, Info, Minus, MoreHorizontal, TrendingDown, TrendingUp } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';
import { LinkButton } from '../Button';
import { cnMerge as cn } from '../cn';
import { SplitBar } from '../data-viz';
import { StatusDot } from '../feedback/StatusChip';
import { DirIcon, Icon } from '../icon';
import { Money } from '../money/Money';
import { HERO_FOOT_LINE, HERO_FOOT_ROW, HERO_LINK } from './classes';
import { HeroAmount } from './HeroAmount';
import { HeroFold } from './HeroFold';
import { HERO_ENTRY_CSS, heroCtaVariant, heroSplitForm } from './model';
import type { DeltaDirection, LeakHeroState } from './model';

export interface LeakHeroLink {
  label: string;
  href: string;
  testId?: string;
}

export interface LeakHeroPart {
  /** What the part is ("על חשבוניות שעוד לא שולמו"). */
  label: string;
  /** Pre-formatted ₪ (formatIls): shown when `agorot` is absent (the showcase). */
  value: string;
  /** Where the part leads: with `linkLabel` a link under the figure, without it the figure itself. */
  href?: string;
  hint?: string;
  /** On the legend item. */
  testId?: string;
  /**
   * Exact integer agorot (from the procedure, e.g. leakSplit × 100): the figure goes through
   * <Money>, carries the G-16 row marker, and the two-part bar can be drawn. Without it: no bar.
   */
  agorot?: number;
  /** The words of the link under the figure ("לחשבוניות שלא שולמו"); rendered only with `href`. */
  linkLabel?: string;
  linkTestId?: string;
  /**
   * The one-line form, when this part carries all of the leak (the other part is exactly ₪0): the
   * sentence ("כל הסכום על חשבוניות ששולמו") and the words of its link to `href`.
   */
  whole?: { text: string; linkLabel?: string; linkTestId?: string } | null;
}

export interface LeakHeroProps {
  state: LeakHeroState;
  /** A small line above the label; empty → none. */
  eyebrow: string;
  /** "דליפה החודש" — the h2 the section is labelled by. */
  label: string;
  /** The one number, pre-formatted (formatIls, 0 dp); used when `amountIls` is absent. Ignored while unknown ("—"). */
  amount: string;
  /** Where the ₪ itself leads (the list that sums to it; IA rule 7). */
  amountHref?: string;
  /** The words of the scale sentence ("מהרכש שנבדק"), or the whole sentence when `pct` is absent; null on a thin base. */
  pctLine?: React.ReactNode;
  /** The base after it ("מתוך ₪41,526 לפני מע״מ"), in `leak-hero-base`. */
  baseLine?: React.ReactNode;
  /** Thin-base note shown instead of the %. */
  thinNote?: React.ReactNode;
  /** Aligned comparison; `none` = no comparable span. */
  delta?: { direction: DeltaDirection; word: React.ReactNode; text: React.ReactNode } | { none: React.ReactNode } | null;
  /** Fallback accessible name of the split's legend (`splitAria` wins). */
  splitLabel?: string;
  /** The leak's decomposition (the parts add up to the hero). */
  parts?: LeakHeroPart[];
  /** "35 חשבוניות נבדקו, ב־13 מהן נמצא פער" — the foot line (a link only with `href`). */
  completeness?: { text: string; href?: string } | null;
  /** T3 sentence for a clean month. */
  cleanSentence?: string | null;
  /** noData: one CTA (the secondary button, D9). */
  noData?: { title: string; hint: string; cta: LeakHeroLink | null } | null;
  /** One primary action — always the secondary button, never red (D9). */
  primary?: LeakHeroLink | null;
  /** One tertiary text link, in the foot. */
  tertiary?: LeakHeroLink | null;
  /** A calculation note behind an ⓘ next to the label (legacy; the fold below is the DS3 way). */
  calcNote?: string;
  calcLabel?: string;
  /** Secondary actions (report, digest…) in a quiet ⋯ menu at the end of the top row. */
  more?: { label: string; items: LeakHeroLink[] } | null;
  /**
   * "איך הגענו לסכום?": the toggle at the end of the foot row and the calculation that opens in
   * place under it (HeroFold). `children` is the panel's content, rendered by the caller (a client
   * part inside it reads `useHeroFoldOpened()`); `panelLabel` names the opened region.
   */
  why?: { label: string; children: React.ReactNode; testId?: string; panelLabel?: string; toggleTestId?: string } | null;
  className?: string;

  /* ── DS3 (all optional; the showcase passes none of them) ── */

  /**
   * The exact leak in ₪ as the procedure returned it (2 dp): the number goes through
   * <Money context="display"> in the HeroAmount island (the count-up on entry) and carries the G-16
   * markers. Without it `amount` is shown as given.
   */
  amountIls?: number;
  /** The page's locale, for the server-rendered figures (Money falls back to the client's). */
  locale?: Locale;
  /** "מתחילת נובמבר" — beside the label, outside the h2. */
  period?: string | null;
  /** The formatted % ("1.9%"), bold, before `pctLine`; null on a thin base. */
  pct?: string | null;
  /** The pace line (the shared PaceLine, in the caller's Suspense): beside the number, leak state only. */
  pace?: React.ReactNode;
  /** Accessible name of the split's legend group ("הדליפה מתחלקת לשניים"). */
  splitAria?: string;
  /** Lines shown in place under "—" while only invoices that wait are known (pendingOnly; HeroNote rows). */
  pending?: React.ReactNode;
  /** Play the entry motion once (owner home, leak state with `amountIls`): `data-entry` + one hero-scoped <style>. */
  entry?: boolean;
}

/**
 * The T1 leak card of the clean finish (DS3 SPEC §10.1): the label with its red dot and the
 * period, the one number with the pace line beside it, the scale sentence, the change in words,
 * the two-part split with a figure and a link under each, and "איך הגענו לסכום?" opening the
 * calculation in place. A card like every card — no rail, no danger frame in any state: the leak
 * is the 8 px dot (SPEC §2 T1). A presentational, hook-free shell (strings and nodes in, markup
 * out) so the home, the showcase and the leak check reuse it; the number and the fold are the
 * client islands. Every link renders only with an href (the showcase has none).
 */
export function LeakHero(p: LeakHeroProps) {
  const leaked = p.state === 'leak';
  // Unknown is never ₪0 (IA rule 8): nothing checked yet → "—".
  const unknown = p.state === 'noData' || p.state === 'pendingOnly';
  // A checked month tells its figure, its scale and its change.
  const told = p.state === 'leak' || p.state === 'clean';
  const split = leaked ? heroSplitForm(p.parts) : ({ kind: 'none' } as const);
  // G-16: the number is the sum of the legend only while the legend shows both exact values.
  const splitSum = split.kind === 'bar' || split.kind === 'values';
  const exact = typeof p.amountIls === 'number' && Number.isFinite(p.amountIls);
  const entry = Boolean(p.entry) && leaked && exact;
  const fold = p.why && p.state !== 'noData' ? p.why : null;
  const footLine = <HeroFootLine completeness={p.completeness} tertiary={p.tertiary} />;
  const hasFootLine = Boolean(p.completeness || p.tertiary);
  const hasFoot = Boolean(fold) || hasFootLine;

  return (
    <section
      aria-labelledby="leak-hero-label"
      data-testid="leak-hero"
      data-state={p.state}
      data-entry={entry ? '' : undefined}
      className={cn(
        'relative overflow-hidden rounded-card border border-line-rule bg-surface px-4 pt-4 shadow-e1 sm:px-7 sm:pt-5',
        !hasFoot && 'pb-4 sm:pb-5',
        p.className,
      )}
    >
      {entry ? <style>{HERO_ENTRY_CSS}</style> : null}
      {p.eyebrow ? <p className="mb-1 text-caption text-fg-tertiary">{p.eyebrow}</p> : null}

      {/* The ⓘ note anchors to this row, capped to its width so a phone never clips it. The label and
          the period each keep one line; when both do not fit, the period moves under the label whole,
          and the ⋯ menu stays at the end of the first line. */}
      <div className="relative flex items-center gap-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {leaked ? <StatusDot tone="leak" /> : null}
          <h2 id="leak-hero-label" className="whitespace-nowrap text-body font-medium text-fg">
            {p.label}
          </h2>
          {p.period ? (
            <span className="whitespace-nowrap text-body-sm text-fg-tertiary" data-testid="leak-hero-period">
              {p.period}
            </span>
          ) : null}
        </div>
        {p.calcNote ? <CalcNote note={p.calcNote} label={p.calcLabel} /> : null}
        {p.more && p.more.items.length > 0 ? <MoreMenu more={p.more} /> : null}
      </div>

      {/* The number, and the pace line at its inline end (desk) or under it (phone). */}
      <div className="mt-2.5 flex flex-wrap items-end gap-x-6 gap-y-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-y-1.5">
        <div className="min-w-0 shrink-0">
          {unknown ? (
            <p data-testid="leak-hero-amount" className="text-metric-hero text-fg-tertiary">
              —
            </p>
          ) : exact ? (
            <HeroAmount value={p.amountIls!} locale={p.locale} href={p.amountHref} sumOf={splitSum ? 'hero-split' : undefined} />
          ) : (
            <p className="text-metric-hero tabular-nums text-fg">
              {p.amountHref ? (
                <Link href={p.amountHref} data-testid="leak-hero-amount" className="rounded-control hover:underline">
                  <bdi>{p.amount}</bdi>
                </Link>
              ) : (
                <bdi data-testid="leak-hero-amount">{p.amount}</bdi>
              )}
            </p>
          )}
        </div>
        {leaked && p.pace ? <div className="mb-3 min-w-0 max-sm:max-w-md sm:ms-auto sm:max-w-64 sm:grow sm:basis-40">{p.pace}</div> : null}
      </div>

      {told && (p.pct || p.pctLine || p.baseLine) ? (
        <p data-testid="leak-hero-pct" className="mt-1 text-body tabular-nums text-fg-secondary">
          {p.pct ? <b className="font-semibold text-fg">{p.pct}</b> : null}
          {p.pct && p.pctLine ? ' ' : null}
          {p.pctLine}
          {p.baseLine ? (
            <>
              {/* A base that brings its own punctuation (", מתוך …", the reference's sentence) takes no space before it. */}
              {(p.pct || p.pctLine) && !(typeof p.baseLine === 'string' && /^[,،;:.]/.test(p.baseLine)) ? ' ' : null}
              <span data-testid="leak-hero-base">{p.baseLine}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {told && p.thinNote ? <p className="mt-0.5 text-caption text-fg-tertiary">{p.thinNote}</p> : null}
      {told && p.delta ? <HeroDeltaLine delta={p.delta} /> : null}

      {p.state === 'clean' && p.cleanSentence ? (
        <p className="mt-3 flex items-center gap-2 text-body-sm font-medium text-ok" data-testid="leak-hero-clean">
          {/* T3: the round green tick (SPEC §2), the words carry the meaning. */}
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-pill bg-ok-dot text-on-bold" aria-hidden="true">
            <Icon as={Check} size="caption" />
          </span>
          {p.cleanSentence}
        </p>
      ) : null}

      {p.pending && p.state !== 'noData' ? (
        <div className="mt-3 space-y-1.5" data-testid="leak-hero-pending">
          {p.pending}
        </div>
      ) : null}

      {p.state === 'noData' && p.noData ? (
        <div className="mt-2">
          <p className="text-body font-medium text-fg">{p.noData.title}</p>
          <p className="mt-0.5 text-body-sm text-fg-secondary">{p.noData.hint}</p>
          {p.noData.cta ? (
            <LinkButton
              href={p.noData.cta.href}
              variant={heroCtaVariant(p.state)}
              data-testid={p.noData.cta.testId}
              icon={<Icon as={Camera} size="body-sm" />}
              className="mt-3"
            >
              {p.noData.cta.label}
            </LinkButton>
          ) : null}
        </div>
      ) : null}

      {split.kind === 'bar' ? (
        <HeroSplit parts={p.parts!} bar={split} marked label={p.splitAria ?? p.splitLabel} locale={p.locale} />
      ) : split.kind === 'values' ? (
        // A part under ₪0.50 would round to "₪0": both values to the agora, no bar.
        <HeroSplit parts={p.parts!} bar={null} marked decimals={2} label={p.splitAria ?? p.splitLabel} locale={p.locale} />
      ) : split.kind === 'legend' ? (
        <HeroSplit parts={p.parts!} bar={null} label={p.splitAria ?? p.splitLabel} locale={p.locale} />
      ) : split.kind === 'single' ? (
        <HeroSplitSingle part={p.parts![split.index]!} />
      ) : null}

      {p.primary ? (
        // Phone: the ₪ itself already leads to the same list (IA rule 7).
        <div className={cn('mt-4', p.amountHref && 'max-sm:hidden')}>
          <LinkButton
            href={p.primary.href}
            variant={heroCtaVariant(p.state)}
            data-testid={p.primary.testId}
            iconEnd={<DirIcon kind="forward" />}
          >
            {p.primary.label}
          </LinkButton>
        </div>
      ) : null}

      {fold ? (
        <HeroFold
          className="mt-5"
          line={hasFootLine ? footLine : null}
          label={fold.label}
          panelLabel={fold.panelLabel ?? fold.label}
          testId={fold.testId ?? 'hero-why'}
          toggleTestId={fold.toggleTestId ?? 'hero-why-toggle'}
          // The calculation bleeds to the card's edges on the sunken surface (SPEC §10.1, the bill).
          regionClassName="-mx-4 sm:-mx-7"
          panelClassName="border-t border-line-rule bg-surface-sunken px-4 pb-4 pt-3.5 sm:px-7 sm:pb-5 sm:pt-4"
        >
          {fold.children}
        </HeroFold>
      ) : hasFootLine ? (
        <div className={cn(HERO_FOOT_ROW, 'mt-5')}>
          <div className={HERO_FOOT_LINE}>{footLine}</div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * A T4 line (SPEC §2: grey with a clock, never a warning colour): what waits and why it is not in
 * the figure yet. For the pendingOnly state (`pending`) and inside the calculation panel.
 */
export function HeroNote({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <p className="flex items-start gap-1.5 text-body-sm text-fg-secondary" data-testid={testId}>
      <Icon as={Clock} size="body-sm" className="mt-0.5 text-fg-tertiary" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function HeroFootLine({ completeness, tertiary }: { completeness?: LeakHeroProps['completeness']; tertiary?: LeakHeroLink | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
      {completeness ? (
        completeness.href ? (
          <Link
            href={completeness.href}
            data-testid="leak-hero-completeness"
            className="inline-flex min-h-6 items-center underline decoration-1 underline-offset-2 hover:text-fg"
          >
            {completeness.text}
          </Link>
        ) : (
          <span data-testid="leak-hero-completeness">{completeness.text}</span>
        )
      ) : null}
      {tertiary ? (
        <Link href={tertiary.href} data-testid={tertiary.testId} className={HERO_LINK}>
          {tertiary.label}
        </Link>
      ) : null}
    </span>
  );
}

/**
 * The change against the same days of last month, in words (SPEC §9 kit "שינוי"; v3 G5 colours as
 * DS3-01's Delta draws them): down is good (brand green), up keeps its words and amount in ink and
 * only its arrow takes the leak indicator (a money figure is never red), the same is grey.
 */
function HeroDeltaLine({ delta }: { delta: NonNullable<LeakHeroProps['delta']> }) {
  if ('none' in delta) {
    return (
      <p className="mt-1.5 text-caption tabular-nums text-fg-tertiary" data-testid="leak-hero-delta" data-direction="none">
        {delta.none}
      </p>
    );
  }
  const up = delta.direction === 'up';
  const down = delta.direction === 'down';
  return (
    // One row that never wraps: the arrow stays at the start of the words' first line on a phone.
    <p
      className={cn(
        'mt-1.5 flex items-start gap-x-1.5 text-body-sm tabular-nums',
        down ? 'font-medium text-primary' : up ? 'font-medium text-fg' : 'font-normal text-fg-secondary',
      )}
      data-testid="leak-hero-delta"
      data-direction={delta.direction}
    >
      <Icon as={up ? TrendingUp : down ? TrendingDown : Minus} size="body-sm" className={cn('mt-0.5', up && 'stroke-danger-dot')} />
      <span className="min-w-0 flex-1">
        {delta.word}
        {delta.word && delta.text ? ' ' : null}
        {delta.text}
      </span>
    </p>
  );
}

/**
 * The split (SPEC §10.1): the shared two-part bar (unpaid solid, paid hatched; decorative) and the
 * legend under it — a figure, what it is, and a link — each column under its segment at the desk,
 * two equal columns on a phone. Without exact agorot (the showcase) the legend stands alone.
 * `marked`: the legend's values are the rows the hero sums (G-16), drawn with or without the bar.
 */
function HeroSplit({
  parts,
  bar,
  marked = false,
  decimals,
  label,
  locale,
}: {
  parts: LeakHeroPart[];
  bar: { first: number; second: number } | null;
  marked?: boolean;
  /** The values' decimals (2 when a part is under ₪0.50, which would round to "₪0"). */
  decimals?: 0 | 2;
  label?: string;
  locale?: Locale;
}) {
  return (
    <div role="group" aria-label={label} className="mt-5">
      {/* The bar grows from its start edge on entry (HERO_ENTRY_CSS animates its root). */}
      {bar ? <SplitBar first={bar.first} second={bar.second} className="origin-left rtl:origin-right" /> : null}
      <div
        className={cn('grid grid-cols-2 gap-3', bar && 'mt-2.5 sm:gap-0.5 sm:[grid-template-columns:var(--split-cols)]')}
        style={bar ? ({ '--split-cols': `${bar.first}fr ${bar.second}fr` } as React.CSSProperties) : undefined}
      >
        {parts.map((part, i) => (
          <HeroPart key={part.testId ?? i} part={part} locale={locale} decimals={decimals} rowOf={marked ? 'hero-split' : undefined} />
        ))}
      </div>
    </div>
  );
}

function HeroPart({ part, locale, decimals, rowOf }: { part: LeakHeroPart; locale?: Locale; decimals?: 0 | 2; rowOf?: string }) {
  const exact = typeof part.agorot === 'number' && Number.isFinite(part.agorot);
  const figure = exact ? <Money agorot={part.agorot} context="inline" decimals={decimals} split locale={locale} /> : <bdi>{part.value}</bdi>;
  // An older caller's part without link words: the figure itself leads (IA rule 7).
  const figureLink = part.href && !part.linkLabel ? part.href : null;
  return (
    <div className="min-w-0 pe-2 sm:pe-3" data-testid={part.testId}>
      <div
        className={cn('text-lg font-medium text-fg', !exact && 'tabular-nums')}
        data-money-row-of={exact && rowOf ? rowOf : undefined}
        data-money-agorot={exact ? part.agorot : undefined}
      >
        {figureLink ? (
          <Link href={figureLink} className="rounded-control hover:underline">
            {figure}
          </Link>
        ) : (
          figure
        )}
      </div>
      <div className="text-body-sm text-fg-secondary">{part.label}</div>
      {part.hint ? <div className="mt-0.5 text-caption text-fg-tertiary">{part.hint}</div> : null}
      {part.href && part.linkLabel ? (
        <Link href={part.href} data-testid={part.linkTestId} className={cn(HERO_LINK, 'mt-1')}>
          {part.linkLabel}
        </Link>
      ) : null}
    </div>
  );
}

/** The whole leak on one side (the other part is ₪0): one sentence and its link, no bar (v2 C2; v4 H7). */
function HeroSplitSingle({ part }: { part: LeakHeroPart }) {
  if (!part.whole) return null;
  return (
    <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-fg-secondary" data-testid="hero-split-single">
      <span>{part.whole.text}</span>
      {part.href && part.whole.linkLabel ? (
        <Link href={part.href} data-testid={part.whole.linkTestId} className={HERO_LINK}>
          {part.whole.linkLabel}
        </Link>
      ) : null}
    </p>
  );
}

function CalcNote({ note, label }: { note: string; label?: string }) {
  return (
    <details>
      <summary
        className="inline-flex size-6 cursor-pointer list-none items-center justify-center rounded-pill text-fg-tertiary hover:text-fg [&::-webkit-details-marker]:hidden"
        aria-label={label}
        title={label}
      >
        <Icon as={Info} size="body-sm" />
      </summary>
      <p className="absolute start-0 top-full z-10 mt-1 w-72 max-w-full rounded-card border border-line-rule bg-surface p-3 text-caption text-fg-secondary shadow-e2">
        {note}
      </p>
    </details>
  );
}

function MoreMenu({ more }: { more: { label: string; items: LeakHeroLink[] } }) {
  return (
    <details className="relative ms-auto">
      <summary
        className="inline-flex size-8 cursor-pointer list-none items-center justify-center rounded-control text-fg-secondary hover:bg-surface-hover hover:text-fg [&::-webkit-details-marker]:hidden"
        aria-label={more.label}
        title={more.label}
      >
        <Icon as={MoreHorizontal} size="body" />
      </summary>
      <ul className="absolute end-0 top-full z-10 mt-1 w-64 rounded-card border border-line-rule bg-surface p-1 shadow-e2">
        {more.items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              data-testid={item.testId}
              className="flex min-h-8 items-center rounded-control px-3 text-body-sm font-medium text-fg hover:bg-surface-hover"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
