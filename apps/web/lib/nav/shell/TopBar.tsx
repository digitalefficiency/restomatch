'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, Search, Star } from 'lucide-react';
import { cn } from '@/lib/components/cn';
import { useLocale, useT } from '@/lib/i18n/client';
import { dirOf } from '@/lib/i18n/config';
import { nav } from '@/lib/i18n/messages/nav';
import { navShell } from '@/lib/i18n/messages/nav/shell';
import type { NavViewer } from '../types';
import { matchRoute } from '../registry';
import { crumbsFor } from '../visibility';
import { shellModel } from '../shellModel';
import { useShellUi } from './ShellFrame';
import css from './shell.module.css';

/**
 * Desktop crumbs (sidebar spec §1.5): 14/20 500 muted, the current page 600 ink,
 * separated by a 12 px chevron that points toward the current page (ChevronLeft
 * in Hebrew, ChevronRight in English — never a text "›", which Chromium does not
 * mirror). Crumbs the viewer cannot open are plain text.
 */
export function TopCrumbs({ viewer }: { viewer: NavViewer }) {
  const t = useT(nav) as unknown as (key: string) => string;
  const ts = useT(navShell);
  const locale = useLocale();
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname, viewer);
  if (crumbs.length === 0) return null;
  const Sep = dirOf(locale) === 'rtl' ? ChevronLeft : ChevronRight;
  return (
    <nav aria-label={ts('crumbs')} className="hidden min-w-0 lg:block" data-testid="top-crumbs">
      <ol className="flex min-w-0 items-center gap-1 text-sm leading-5">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.key} className="flex min-w-0 items-center gap-1">
              {last ? (
                <span aria-current="page" className="truncate font-semibold text-ink">
                  {t(`links.${c.key}`)}
                </span>
              ) : c.href ? (
                <Link href={c.href} className="truncate rounded-xs font-medium text-muted hover:text-ink">
                  {t(`links.${c.key}`)}
                </Link>
              ) : (
                <span className="truncate font-medium text-muted">{t(`links.${c.key}`)}</span>
              )}
              {!last ? <Sep aria-hidden="true" strokeWidth={2} className={css.crumbSep} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The star beside the page name (DS3 SPEC §10.4, sidebar spec §4.1: favourites,
 * at most five, per role on this device). Only on a page that is itself a menu
 * entry the viewer has; never for the flat rails of the chef and the receiver.
 */
export function FavouriteStar({ viewer }: { viewer: NavViewer }) {
  const ui = useShellUi();
  const ts = useT(navShell) as unknown as (key: string, vars?: Record<string, string>) => string;
  const t = useT(nav) as unknown as (key: string) => string;
  const pathname = usePathname();
  const navKeys = useMemo(() => {
    const m = shellModel(viewer);
    return new Set([...m.groups, ...m.footer].flatMap((g) => g.items.map((i) => i.key)));
  }, [viewer]);
  const def = matchRoute(pathname);
  if (ui.flat || !def || def.nav !== 'item' || !navKeys.has(def.key)) return null;
  const on = ui.favourites.includes(def.key);
  const action = on ? ts('star.remove') : ts('star.add');
  const page = t(`links.${def.key}`);
  return (
    <button
      type="button"
      className={cn(css.ib, css.star, 'hidden lg:grid')}
      aria-pressed={on}
      aria-label={`${action}, ${ts('star.meaning')}`}
      data-testid="favourite-star"
      data-tip={action}
      data-tip-text={ts('star.meaning')}
      onClick={() => {
        const res = ui.toggleFavourite(def.key);
        ui.announce(res.full ? ts('star.full') : res.added ? ts('star.added', { page }) : ts('star.removed', { page }));
      }}
    >
      <Star aria-hidden="true" strokeWidth={1.75} />
    </button>
  );
}

/** Phone top bar search (44 × 44): opens the command palette (§11 phone header). */
export function PhoneSearchButton() {
  const ui = useShellUi();
  const t = useT(nav);
  return (
    <button
      type="button"
      onClick={() => ui.openPalette()}
      aria-label={t('shell.openSearch')}
      aria-haspopup="dialog"
      data-testid="phone-search"
      className="inline-flex h-11 w-11 items-center justify-center rounded-control text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus lg:hidden"
    >
      <Search aria-hidden="true" width={20} height={20} strokeWidth={1.75} />
    </button>
  );
}

/**
 * The top bar (sidebar spec §1.5): 56 tall, canvas, a hairline under it.
 * Desktop: crumbs · star · (freshness · period chip · divider) · bell; the
 * branch switcher, search and the account live in the side menu. Phone: the
 * branch · search · bell (+ the receiver's language when it must stay one tap away).
 * The two slots stay in the DOM for pages that portal their freshness line and
 * period chip into them; the divider shows only when one of them has content.
 */
export function TopBar({
  viewer,
  phoneBranch,
  bell,
  phoneLanguage,
}: {
  viewer: NavViewer;
  phoneBranch: React.ReactNode;
  bell: React.ReactNode;
  phoneLanguage?: React.ReactNode;
}) {
  return (
    <header className={css.topbar} data-testid="top-bar">
      <div className={css.topRow}>
        <div className="min-w-0 flex-1 lg:hidden">{phoneBranch}</div>
        <TopCrumbs viewer={viewer} />
        <FavouriteStar viewer={viewer} />
        <div aria-hidden="true" className="hidden flex-1 lg:block" />
        <div className={css.slots}>
          <div id="rm-topbar-fresh" className={cn(css.slot, 'text-xs leading-4 text-muted')} />
          <div id="rm-topbar-period" className={css.slot} />
        </div>
        <span aria-hidden="true" className={css.divider} />
        <div className="flex shrink-0 items-center gap-1">
          <PhoneSearchButton />
          {bell}
          {phoneLanguage ? <div className="lg:hidden">{phoneLanguage}</div> : null}
        </div>
      </div>
    </header>
  );
}
