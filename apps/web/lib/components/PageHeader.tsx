'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { nav } from '@/lib/i18n/messages/nav';
import { matchRoute, routeByKey } from '@/lib/nav/registry';
import { crumbsFor } from '@/lib/nav/visibility';
import { useNavViewer } from '@/lib/nav/NavProvider';
import { cn } from './cn';

export interface PageHeaderOverflowItem {
  label: string;
  href: string;
}

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';

/**
 * The page-header contract (lens-ia-nav §9, design-system-18): exactly one
 * `h1` (heading-lg, 24/32 700) that defaults to the route's nav label, a
 * context line (branch · period · freshness), at most one primary and one
 * secondary action plus a "⋯" overflow, and — on the phone, where the top-bar
 * breadcrumb is hidden — one up-link to the parent page. A parent the viewer's
 * role can't open is not linked.
 *
 * Adoption is per area from wave 2; the shell focuses this `h1` after client
 * navigations (it carries `tabIndex={-1}`).
 */
export function PageHeader({
  route,
  title,
  context,
  primary,
  secondary,
  overflow,
  className,
}: {
  /** Registry key; defaults to the route of the current path. */
  route?: string;
  /** The h1; defaults to the nav label of `route`. */
  title?: React.ReactNode;
  /** Period / freshness etc.; the active branch is prepended for multi-branch users. */
  context?: React.ReactNode;
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  overflow?: PageHeaderOverflowItem[];
  className?: string;
}) {
  const t = useT(nav) as unknown as (key: string) => string;
  const viewer = useNavViewer();
  const pathname = usePathname() ?? '';
  const def = route ? routeByKey(route) : matchRoute(pathname);
  const heading = title ?? (def ? t(`links.${def.key}`) : null);

  // Up-link: the nearest ancestor crumb the viewer can open (path-aware for dynamic parents).
  const crumbs = viewer && pathname ? crumbsFor(pathname, viewer.role) : [];
  const up = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined;

  const contextParts = [viewer?.branch ?? null, context ?? null].filter((x) => x !== null && x !== '');

  return (
    <div className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4', className)}>
      <div className="min-w-0">
        {up?.href ? (
          <Link
            href={up.href}
            data-testid="page-up-link"
            className={cn('mb-1 inline-flex min-h-11 items-center gap-1 rounded text-sm text-muted hover:text-ink lg:hidden', focusRing)}
          >
            <ChevronRight className="h-4 w-4 ltr:rotate-180" aria-hidden="true" />
            {t(`links.${up.key}`)}
          </Link>
        ) : null}
        <h1 tabIndex={-1} className="text-2xl font-bold leading-8 text-ink focus:outline-none">
          {heading}
        </h1>
        {contextParts.length > 0 ? (
          <p className="mt-1 text-sm text-muted" data-testid="page-context">
            {contextParts.map((part, i) => (
              <span key={i}>
                {i > 0 ? <span aria-hidden="true"> · </span> : null}
                {part}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      {primary || secondary || overflow?.length ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {secondary}
          {primary}
          {overflow?.length ? <OverflowMenu items={overflow} label={t('menu.more')} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function OverflowMenu({ items, label }: { items: PageHeaderOverflowItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="page-header-overflow"
        aria-label={label}
        className={cn('inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line text-ink hover:bg-surface-2', focusRing)}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      <ul
        id="page-header-overflow"
        hidden={!open}
        className="absolute end-0 top-full z-30 mt-2 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-card"
      >
        {items.map((it) => (
          <li key={it.href}>
            <Link href={it.href} className={cn('flex min-h-11 items-center rounded-lg px-3 text-sm text-ink hover:bg-surface-2', focusRing)}>
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
