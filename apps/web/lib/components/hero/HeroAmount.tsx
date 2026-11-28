'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { motion } from '@restomatch/ui-tokens';
import type { Locale } from '@/lib/i18n/config';
import { cnMerge as cn } from '../cn';
import { Money } from '../money/Money';
import { HERO_HOLD_ANIMATION, agorotOf, cubicBezier, msOf, parseCubicBezier } from './model';

/**
 * Whether the entry has played in this document. Module scope: it survives client navigation
 * (Back / Forward restore the page from the router cache, with `data-entry` in the payload), not a
 * reload, so the entry plays on the first view of each load and never again in it (v4 H1).
 */
let entryPlayed = false;
/**
 * The hero card the entry played on: a remount on that same element is the same view — React
 * StrictMode re-runs the effects of a mounted tree in development without touching its DOM (React 19
 * does it when the commit's passive effects flush, not always in the commit's own task). A later
 * view (a Back, however fast) renders a new card, so it never replays and never needs a time window.
 * Weak, so the card of a page left behind is not kept alive.
 */
const entryCards = new WeakSet<Element>();
/** Less hold left than a press lasts (the micro token): a count that short does not read as one. */
const MIN_COUNT_MS = msOf(motion.duration.micro);

const easeEnter = (() => {
  const b = parseCubicBezier(motion.easing.enter);
  return b ? cubicBezier(...b) : (progress: number) => progress;
})();

/** The CSS hold on the final number, while it runs. */
function runningHold(el: Element | null): Animation | null {
  if (!el || typeof el.getAnimations !== 'function') return null;
  return el.getAnimations().find((a) => (a as CSSAnimation).animationName === HERO_HOLD_ANIMATION && a.playState === 'running') ?? null;
}

/** The hero's own entry animations still running (the pace line may stream in after the number). */
function runningEntry(section: Element): Animation[] {
  if (typeof section.getAnimations !== 'function') return [];
  return section
    .getAnimations({ subtree: true })
    .filter((a) => String((a as CSSAnimation).animationName ?? '').startsWith('rm-hero-') && a.playState === 'running');
}

export interface HeroAmountProps {
  /** The leak in ₪, exactly as the procedure returned it (2 dp); shown at 0 dp with the exact value in its title. */
  value: number;
  locale?: Locale;
  /** The drill link: the number itself leads to the list that sums to it (IA rule 7). */
  href?: string;
  /** On the element that holds the final number (the link, or a span without `href`). */
  testId?: string;
  /** G-16: the group whose rows on screen add up to this figure (`data-money-sum-of`). */
  sumOf?: string;
  className?: string;
}

/**
 * The hero's number (SPEC §10.1 "the number counts to its value within 400 ms … once"): the final
 * figure is always in the DOM and is never rewritten — e2e reads, screen readers and the IA meter
 * see the procedure's figure. On the first view the CSS hold (HERO_ENTRY_CSS) keeps it invisible
 * for the long duration; if this island mounts while that hold still runs (and the tab is
 * visible), an aria-hidden, pointer-events-none overlay BESIDE the testid element counts 0 → value
 * in <Money> over the hold's remaining time on the entering curve, then fades out and leaves.
 * A later view in the same document (a new card) and reduced motion remove `data-entry` before paint; after
 * the entry its last part removes it. Without a script the hold simply ends and the number shows.
 */
export function HeroAmount({ value, locale, href, testId = 'leak-hero-amount', sumOf, className }: HeroAmountProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<number | null>(null);

  useLayoutEffect(() => {
    const section = wrapRef.current?.closest('section[data-entry]');
    if (!section) return;
    const endEntry = () => section.removeAttribute('data-entry');
    const first = !entryPlayed;
    const sameView = !first && entryCards.has(section);
    if (first) {
      entryPlayed = true;
      entryCards.add(section);
    }
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || (!first && !sameView)) {
      endEntry();
      return;
    }

    let live = true;
    let raf = 0;
    let fade: Animation | null = null;
    // The entry is over when no part of it runs: the parts start with the hold and none outlasts it,
    // but the pace line streams in its own boundary and may start later — let it finish.
    const settle = () => {
      if (!live) return;
      const rest = runningEntry(section);
      if (rest.length === 0) endEntry();
      else void Promise.allSettled(rest.map((a) => a.finished)).then(() => live && endEntry());
    };
    const hold = runningHold(countRef.current);
    if (!hold) {
      // Mounted after the hold: the number already shows; no count.
      settle();
      return () => {
        live = false;
      };
    }
    hold.finished.then(settle, settle);

    const timing = hold.effect?.getComputedTiming();
    const from = hold.currentTime;
    const left = typeof timing?.endTime === 'number' && typeof from === 'number' ? timing.endTime - from : 0;
    if (left >= MIN_COUNT_MS && typeof from === 'number' && document.visibilityState === 'visible') {
      setShown(0);
      const tick = () => {
        if (!live) return;
        const at = hold.currentTime;
        const progress = hold.playState === 'running' && typeof at === 'number' ? Math.min(1, Math.max(0, (at - from) / left)) : 1;
        if (progress < 1) {
          // Synchronous, so each frame paints the value of that frame's hold time.
          flushSync(() => setShown(Math.round(value * easeEnter(progress))));
          raf = requestAnimationFrame(tick);
          return;
        }
        // The hold ended in this frame: the final number shows under the same figure, then the overlay leaves.
        flushSync(() => setShown(value));
        const overlay = overlayRef.current;
        if (!overlay || typeof overlay.animate !== 'function') {
          setShown(null);
          return;
        }
        fade = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: msOf(motion.duration.short), easing: motion.easing.exit, fill: 'forwards' });
        const unmount = () => {
          if (live) setShown(null);
        };
        fade.finished.then(unmount, unmount);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      fade?.cancel();
    };
  }, [value]);

  const marks = { 'data-testid': testId, 'data-money-agorot': agorotOf(value), 'data-money-sum-of': sumOf };
  // The home's display role (DS3-01 `money-hero`: 84/88 regular, 64/70 on a phone, the raised 0.4 em ₪),
  // for the number and its count alike: the same box and tabular figures (Money's `.num`), so the
  // count lands on the final figure's exact width.
  const figure = (
    <span ref={countRef} data-entry-part="count" className="inline-flex">
      <Money value={value} context="display" state="leak" locale={locale} />
    </span>
  );
  return (
    <span ref={wrapRef} className={cn('relative inline-flex max-w-full', className)}>
      {href ? (
        <Link href={href} {...marks} className="inline-flex rounded-control hover:underline">
          {figure}
        </Link>
      ) : (
        <span {...marks} className="inline-flex">
          {figure}
        </span>
      )}
      {shown !== null ? (
        <span ref={overlayRef} aria-hidden="true" data-hero-count="" className="pointer-events-none absolute start-0 top-0 inline-flex">
          <Money value={shown} context="display" locale={locale} className="text-ink" />
        </span>
      ) : null}
    </span>
  );
}
