import Link from 'next/link';
import {
  ArrowLeft,
  Camera,
  Info,
  MoreHorizontal,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { cn } from '../cn';
import type { DeltaDirection, LeakHeroState } from './model';

export interface LeakHeroLink {
  label: string;
  href: string;
  testId?: string;
}

export interface LeakHeroPart {
  label: string;
  /** Pre-formatted ₪ (formatIls). */
  value: string;
  href?: string;
  hint?: string;
  testId?: string;
}

export interface LeakHeroProps {
  state: LeakHeroState;
  /** "דליפה שזוהתה · 1–25 באוקטובר". */
  eyebrow: string;
  /** "דליפה החודש" — the h2 the section is labelled by. */
  label: string;
  /** The one number, pre-formatted (formatIls, 0 dp). Ignored in the noData state ("—"). */
  amount: string;
  /** Where the ₪ itself leads (the list that sums to it). */
  amountHref?: string;
  /** "1.8% מהקניות שנבדקו"; null on a thin base. */
  pctLine?: string | null;
  /** "מתוך ₪42,263 לפני מע״מ". */
  baseLine?: string | null;
  /** Thin-base note shown instead of the %. */
  thinNote?: string | null;
  /** Aligned comparison; `none` = no comparable span. */
  delta?: { direction: DeltaDirection; word: string; text: string } | { none: string } | null;
  /** The leak's decomposition (the parts add up to `amount`). */
  splitLabel?: string;
  parts?: LeakHeroPart[];
  /** "35 חשבוניות נבדקו · 13 עם פער". */
  completeness?: { text: string; href?: string } | null;
  /** T3 sentence for a clean month. */
  cleanSentence?: string | null;
  /** noData: one CTA. */
  noData?: { title: string; hint: string; cta: LeakHeroLink | null } | null;
  /** One primary action (danger-solid only when money leaked). */
  primary?: LeakHeroLink | null;
  /** One tertiary text link ("איך חישבנו?"). */
  tertiary?: LeakHeroLink | null;
  /** The calculation note, behind an ⓘ disclosure next to the label. */
  calcNote?: string;
  calcLabel?: string;
  /** Secondary actions (report, digest…) in a ⋯ menu at the hero's top end. */
  more?: { label: string; items: LeakHeroLink[] } | null;
  className?: string;
}

const linkFocus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2';

/**
 * The T1 leak hero: one number, one story, one primary action. Pure and
 * presentational (strings in, markup out) so the home, the showcase and the
 * leak check can reuse it. Compact by design: ≤260 px tall on desktop.
 *
 * Money is rendered as a plain <bdi> around the formatIls() string — never
 * dir="ltr", never mono — so the ₪ sits on the correct side in both locales.
 */
export function LeakHero(p: LeakHeroProps) {
  const leaked = p.state === 'leak';
  const noData = p.state === 'noData';
  const hasParts = !noData && !!p.parts?.length;
  return (
    <section
      aria-labelledby="leak-hero-label"
      data-testid="leak-hero"
      data-state={p.state}
      className={cn(
        'relative rounded-2xl border bg-surface p-4 shadow-card sm:p-5',
        leaked ? 'border-danger/35' : 'border-line',
        p.className,
      )}
    >
      {/* T1 only: the 6 px danger rail on the start edge when money leaked. */}
      {leaked ? (
        <div className="absolute inset-y-0 start-0 w-1.5 rounded-s-2xl bg-danger" aria-hidden="true" />
      ) : null}

      <div>
        <p className={cn('text-xs font-semibold text-subtle', p.more?.items.length ? 'pe-10' : '')}>
          {p.eyebrow}
        </p>
        {p.more && p.more.items.length > 0 ? (
          <details className="absolute end-2 top-2 z-10">
            <summary
              className={cn(
                'touch-target inline-flex cursor-pointer list-none items-center justify-center rounded-lg text-muted hover:text-ink [&::-webkit-details-marker]:hidden',
                linkFocus,
              )}
              aria-label={p.more.label}
              title={p.more.label}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            </summary>
            <ul className="absolute end-0 z-10 mt-1 w-64 rounded-xl border border-line bg-surface p-1 shadow-card">
              {p.more.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    data-testid={item.testId}
                    className={cn(
                      'flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-ink hover:bg-surface-2',
                      linkFocus,
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {/* lg: the story on the start side (2 rows), the split + the one action on the end side. */}
      <div className="mt-1 grid gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0 lg:row-span-2">
          {/* The ⓘ note anchors to this row (not the icon), capped to the viewport so a phone never clips it. */}
          <div className="relative flex items-center gap-1.5">
            <h2 id="leak-hero-label" className="text-sm font-semibold text-muted">
              {p.label}
            </h2>
            {p.calcNote ? (
              <details>
                <summary
                  className={cn(
                    'inline-flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded-full text-subtle hover:text-ink [&::-webkit-details-marker]:hidden',
                    linkFocus,
                  )}
                  aria-label={p.calcLabel}
                  title={p.calcLabel}
                >
                  <Info className="h-4 w-4" aria-hidden="true" />
                </summary>
                <p className="absolute start-0 top-full z-10 mt-1 w-[min(18rem,calc(100vw-4rem))] rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-muted shadow-card">
                  {p.calcNote}
                </p>
              </details>
            ) : null}
          </div>

          {noData ? (
            <>
              <p
                data-testid="leak-hero-amount"
                className="mt-1 text-5xl font-extrabold tabular-nums text-muted"
              >
                —
              </p>
              {p.noData ? (
                <>
                  <p className="mt-2 text-base font-semibold text-ink">{p.noData.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{p.noData.hint}</p>
                  {p.noData.cta ? (
                    <Link
                      href={p.noData.cta.href}
                      data-testid={p.noData.cta.testId}
                      className={cn(
                        'mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-on-primary hover:brightness-90',
                        linkFocus,
                      )}
                    >
                      <Camera className="h-5 w-5" aria-hidden="true" />
                      {p.noData.cta.label}
                    </Link>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-0.5 text-[2.5rem] font-extrabold leading-[2.75rem] tabular-nums text-ink sm:text-[3.5rem] sm:leading-[3.75rem]">
                {p.amountHref ? (
                  <Link
                    href={p.amountHref}
                    data-testid="leak-hero-amount"
                    className={cn('inline-flex items-center gap-1 rounded-lg hover:underline', linkFocus)}
                  >
                    <bdi>{p.amount}</bdi>
                    <ArrowLeft className="h-6 w-6 text-muted ltr:-scale-x-100 sm:hidden" aria-hidden="true" />
                  </Link>
                ) : (
                  <bdi data-testid="leak-hero-amount">{p.amount}</bdi>
                )}
              </p>
              <p className="mt-1 text-base font-semibold text-ink" data-testid="leak-hero-pct">
                {p.pctLine ?? null}
                {p.baseLine ? (
                  <span
                    className={cn('text-sm font-normal text-muted', p.pctLine ? 'ms-2' : '')}
                    data-testid="leak-hero-base"
                  >
                    {p.baseLine}
                  </span>
                ) : null}
              </p>
              {p.thinNote ? <p className="mt-0.5 text-xs text-muted">{p.thinNote}</p> : null}
              {p.delta ? <HeroDeltaLine delta={p.delta} /> : null}
              {p.state === 'clean' && p.cleanSentence ? (
                <p
                  className="mt-2 flex items-center gap-2 text-sm font-semibold text-primary"
                  data-testid="leak-hero-clean"
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {p.cleanSentence}
                </p>
              ) : null}
              {p.completeness || p.tertiary ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 max-sm:hidden">
                  {p.completeness ? (
                    p.completeness.href ? (
                      <Link
                        href={p.completeness.href}
                        data-testid="leak-hero-completeness"
                        className={cn(
                          'inline-flex min-h-8 items-center rounded-lg text-sm text-muted hover:text-ink hover:underline',
                          linkFocus,
                        )}
                      >
                        {p.completeness.text}
                      </Link>
                    ) : (
                      <p className="text-sm text-muted" data-testid="leak-hero-completeness">
                        {p.completeness.text}
                      </p>
                    )
                  ) : null}
                  {p.tertiary ? (
                    <Link
                      href={p.tertiary.href}
                      data-testid={p.tertiary.testId}
                      className={cn(
                        'inline-flex min-h-8 items-center rounded-lg text-sm font-semibold text-primary hover:underline',
                        linkFocus,
                      )}
                    >
                      {p.tertiary.label}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        {hasParts ? (
          <div
            className="grid min-w-0 grid-cols-2 gap-2"
            role="group"
            aria-label={p.splitLabel}
          >
            {p.parts!.map((part) => (
              <HeroPart key={part.label} part={part} />
            ))}
          </div>
        ) : null}

        {p.primary ? (
          // Phone: the ₪ itself (and the split tiles) already lead to the same lists — the
          // duplicate full-width button would push "מחכה לך" under the bottom bar.
          <div className={cn('lg:col-start-2 lg:self-end', p.amountHref && 'max-sm:hidden')}>
            <Link
              href={p.primary.href}
              data-testid={p.primary.testId}
              className={cn(
                'inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-colors max-lg:w-full sm:max-lg:w-auto',
                leaked
                  ? 'bg-danger text-on-primary hover:brightness-90'
                  : 'border border-line-strong bg-surface text-ink hover:border-primary/40 hover:text-primary',
                linkFocus,
              )}
            >
              {p.primary.label}
              <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HeroDeltaLine({ delta }: { delta: NonNullable<LeakHeroProps['delta']> }) {
  if ('none' in delta) {
    return (
      <p className="mt-1 text-xs text-muted" data-testid="leak-hero-delta" data-direction="none">
        {delta.none}
      </p>
    );
  }
  // Leak up = bad (danger), down = good (primary); the word is always there, never colour alone.
  const Icon =
    delta.direction === 'up' ? TrendingUp : delta.direction === 'down' ? TrendingDown : null;
  const tone =
    delta.direction === 'up'
      ? 'text-danger'
      : delta.direction === 'down'
        ? 'text-primary'
        : 'text-muted';
  return (
    <p
      className={cn('mt-1 flex flex-wrap items-center gap-1 text-sm font-semibold', tone)}
      data-testid="leak-hero-delta"
      data-direction={delta.direction}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <span>{delta.word}</span>
      <span>{delta.text}</span>
    </p>
  );
}

function HeroPart({ part }: { part: LeakHeroPart }) {
  const body = (
    <>
      <span className="block text-xs font-semibold text-subtle">{part.label}</span>
      <span className="mt-0.5 block text-xl font-bold tabular-nums text-ink">
        <bdi>{part.value}</bdi>
      </span>
      {part.hint ? (
        <span className="mt-0.5 block text-xs leading-snug text-muted">{part.hint}</span>
      ) : null}
    </>
  );
  const box = 'block min-h-12 rounded-xl border border-line bg-surface-2/60 px-3 py-2';
  return part.href ? (
    <Link
      href={part.href}
      data-testid={part.testId}
      className={cn(box, 'hover:border-primary/40', linkFocus)}
    >
      {body}
    </Link>
  ) : (
    <div className={box} data-testid={part.testId}>
      {body}
    </div>
  );
}
