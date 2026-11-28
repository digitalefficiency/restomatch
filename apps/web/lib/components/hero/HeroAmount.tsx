'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef } from 'react';
import { motion } from '@restomatch/ui-tokens';
import type { Locale } from '@/lib/i18n/config';
import { cnMerge as cn } from '../cn';
import { Money } from '../money/Money';
import { agorotOf, msOf } from './model';

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
  /** On the element that holds the number (the link, or a span without `href`). */
  testId?: string;
  /** G-16: the group whose rows on screen add up to this figure (`data-money-sum-of`). */
  sumOf?: string;
  className?: string;
}

/**
 * The hero's number in the home's display role (DS3-01 `money-hero`: 84/88 regular, 64/70 on a phone,
 * the raised 0.4 em ₪). It is final from the first frame and is never held, hidden or counted (owner
 * decision 28.11: a money figure only ever shows its true value). The island exists for the entry's
 * "once": the pace line draws and the split bar grows on the first view of a page load (HERO_ENTRY_CSS
 * under `[data-entry]`); a later view in the same document (a new card, e.g. a client Back) and reduced
 * motion remove `data-entry` before paint, and after the first view's parts finish it is removed too.
 */
export function HeroAmount({ value, locale, href, testId = 'leak-hero-amount', sumOf, className }: HeroAmountProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);

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
    // The parts run for the long duration; the pace line streams in its own boundary and may start a
    // little later — after that duration, let whatever still runs finish, then end the entry.
    const timer = window.setTimeout(() => {
      if (!live) return;
      const rest = runningEntry(section);
      if (rest.length === 0) endEntry();
      else void Promise.allSettled(rest.map((a) => a.finished)).then(() => live && endEntry());
    }, msOf(motion.duration.long));
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, []);

  const marks = { 'data-testid': testId, 'data-money-agorot': agorotOf(value), 'data-money-sum-of': sumOf };
  const figure = <Money value={value} context="display" state="leak" locale={locale} />;
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
    </span>
  );
}
