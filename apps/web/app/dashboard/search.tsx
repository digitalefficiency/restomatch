'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, LayoutGrid, Package, Search, Truck } from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { trpc } from '@/lib/trpc/client';
import { cn, Spinner } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { nav } from '@/lib/i18n/messages/nav';
import { canSeeRoute } from '@/lib/roles';
import { navGroups } from '@/lib/nav';
import { useNavViewer } from '@/lib/nav/NavProvider';
import { buildScreenOptions, buildSearchOptions, type SearchOption, type SearchScreen } from './searchOptions';
import { startRouteProgress } from '@/lib/components/routeProgressState';

/** What the role can actually find (ia-nav-04): the placeholder never promises more. */
function placeholderKey(role: UserRole) {
  if (role === 'receiver') return 'search.placeholderReceiver' as const;
  if (role === 'chef') return 'search.placeholderChef' as const;
  return 'search.placeholder' as const;
}

/**
 * Global search box. Screens ("מסכים", from the nav registry, filtered by role
 * and flags) match locally from the first character; records debounce into
 * `search.global` (min 2 chars). Grouped results (screens / suppliers /
 * products / invoices) form a WAI-ARIA combobox: ↑/↓ move, Enter opens, Esc
 * closes, click opens. Groups the role can't open (e.g. a receiver and the
 * suppliers page) are hidden. In English the product/supplier English name is
 * shown when it exists.
 */
export function DashboardSearch({
  role,
  className,
  variant = 'header',
  onNavigate,
}: {
  role: UserRole;
  className?: string;
  /** Where it renders: the desktop header or the phone search sheet (one of each per page). */
  variant?: 'header' | 'drawer';
  /** Called after a result is opened (the phone sheet closes itself). */
  onNavigate?: () => void;
}) {
  const t = useT(nav);
  const tl = t as unknown as (key: string) => string;
  const locale = useLocale();
  const router = useRouter();
  const viewer = useNavViewer();
  const [raw, setRaw] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // A fixed id, not useId(): useId encodes the tree position, and Next's
  // dev-only segment-explorer wrappers above the app have intermittently given
  // server and client different shapes there (aria-controls hydration mismatch,
  // the #418 family). One search per variant per page keeps it unique.
  const listboxId = `dashboard-search-${variant}-list`;
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  // Debounce the raw input into the actual query (250ms).
  useEffect(() => {
    const trimmed = raw.trim();
    const timer = setTimeout(() => setQuery(trimmed), 250);
    return () => clearTimeout(timer);
  }, [raw]);

  const enabled = query.length >= 2;
  const results = trpc.search.global.useQuery({ q: query }, { enabled, staleTime: 30_000 });

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Every registry screen this viewer may open, localized (label + aliases).
  const screens: SearchScreen[] = useMemo(() => {
    if (!viewer) return [];
    return navGroups(viewer).flatMap((g) =>
      g.items.map((d) => ({ key: d.key, href: d.path, label: tl(`links.${d.key}`), aliases: d.aliases ?? [] })),
    );
  }, [viewer, tl]);

  const screenOptions = useMemo(() => buildScreenOptions(raw, screens), [raw, screens]);

  const options: SearchOption[] = useMemo(
    () => [
      ...screenOptions,
      ...(results.data && enabled
        ? buildSearchOptions(results.data, {
            locale,
            canSee: (href) => canSeeRoute(role, href),
            noInvoiceNumber: t('search.noInvoiceNumber'),
          })
        : []),
    ],
    [screenOptions, results.data, enabled, locale, role, t],
  );

  // When the result set changes (e.g. records arrive after the screens), keep
  // the highlighted row on the same result; reset to the first only when it is gone.
  const activeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = activeKeyRef.current;
    const kept = key ? options.findIndex((o) => `${o.kind}:${o.id}` === key) : -1;
    setActiveIdx(kept >= 0 ? kept : options.length > 0 ? 0 : -1);
  }, [options]);
  useEffect(() => {
    const o = activeIdx >= 0 ? options[activeIdx] : undefined;
    activeKeyRef.current = o ? `${o.kind}:${o.id}` : null;
  }, [activeIdx, options]);

  const showPanel = open && raw.trim().length > 0;

  function go(opt: SearchOption) {
    setOpen(false);
    setRaw('');
    setQuery('');
    inputRef.current?.blur();
    startRouteProgress(opt.href);
    router.push(opt.href);
    onNavigate?.();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!options.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0 && options[activeIdx]) {
      e.preventDefault();
      go(options[activeIdx]!);
    }
  }

  const groups: Array<{ kind: SearchOption['kind']; icon: React.ReactNode }> = [
    { kind: 'screen', icon: <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" /> },
    { kind: 'supplier', icon: <Truck className="h-3.5 w-3.5" aria-hidden="true" /> },
    { kind: 'product', icon: <Package className="h-3.5 w-3.5" aria-hidden="true" /> },
    { kind: 'invoice', icon: <FileText className="h-3.5 w-3.5" aria-hidden="true" /> },
  ];
  const groupLabel = {
    screen: t('search.groups.screens'),
    supplier: t('search.groups.suppliers'),
    product: t('search.groups.products'),
    invoice: t('search.groups.invoices'),
  } as const;

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t(placeholderKey(role))}
          aria-label={t('search.label')}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && activeIdx >= 0 ? optionId(activeIdx) : undefined}
          autoComplete="off"
          className="w-full rounded-xl border border-line-strong bg-surface py-2 pe-9 ps-9 text-sm text-ink placeholder-subtle transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {results.isFetching && enabled ? (
          <Spinner className="absolute end-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
        ) : null}
      </div>

      {showPanel ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('search.label')}
          className="absolute z-50 mt-2 max-h-96 w-full min-w-[18rem] overflow-auto rounded-xl border border-line bg-surface p-1 shadow-card"
        >
          {options.length === 0 && !enabled ? (
            <p className="px-3 py-4 text-center text-sm text-subtle">{t('search.minChars')}</p>
          ) : options.length === 0 && results.isError ? (
            <p className="px-3 py-4 text-center text-sm text-danger">{t('search.error')}</p>
          ) : options.length === 0 && results.isLoading ? (
            <p className="px-3 py-4 text-center text-sm text-subtle">{t('search.searching')}</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-subtle">{t('search.noResults')}</p>
          ) : (
            <>
              {groups.map(({ kind, icon }) => {
                const groupOpts = options
                  .map((o, i) => ({ o, i }))
                  .filter(({ o }) => o.kind === kind);
                if (groupOpts.length === 0) return null;
                return (
                  <div key={kind} role="group" aria-label={groupLabel[kind]} className="py-1">
                    <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-xs font-semibold text-subtle">
                      {icon}
                      {groupLabel[kind]}
                    </div>
                    {groupOpts.map(({ o, i }) => (
                      <div
                        key={`${o.kind}-${o.id}`}
                        id={optionId(i)}
                        role="option"
                        aria-selected={i === activeIdx}
                        onMouseEnter={() => setActiveIdx(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => go(o)}
                        className={cn(
                          'flex cursor-pointer items-baseline justify-between gap-2 rounded-lg px-3 py-1.5 text-sm',
                          i === activeIdx ? 'bg-surface-2 text-ink' : 'text-muted',
                        )}
                      >
                        <span className="truncate">{o.label}</span>
                        {o.secondary ? (
                          <span className="shrink-0 truncate text-xs text-subtle" dir="auto">
                            {o.secondary}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                );
              })}
              <p className="hidden border-t border-line px-3 pb-1 pt-2 text-[11px] text-subtle sm:block">
                {t('search.hint')}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
