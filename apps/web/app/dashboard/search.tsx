'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Package, Search, Truck } from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { trpc } from '@/lib/trpc/client';
import { cn, Spinner } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { nav } from '@/lib/i18n/messages/nav';
import { canSeeRoute } from '@/lib/roles';
import { buildSearchOptions, type SearchOption } from './searchOptions';
import { startRouteProgress } from '@/lib/components/routeProgressState';

/**
 * Global search box. Debounces input, queries `search.global` (min 2 chars),
 * and shows grouped results (suppliers / products / invoices) as a WAI-ARIA
 * combobox: ↑/↓ move, Enter opens, Esc closes, click opens. Groups the role
 * can't open (e.g. a receiver and the suppliers page) are hidden. In English
 * the product/supplier English name is shown when it exists.
 */
export function DashboardSearch({ role, className }: { role: UserRole; className?: string }) {
  const t = useT(nav);
  const locale = useLocale();
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
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

  const options: SearchOption[] = useMemo(
    () =>
      results.data
        ? buildSearchOptions(results.data, {
            locale,
            canSee: (href) => canSeeRoute(role, href),
            noInvoiceNumber: t('search.noInvoiceNumber'),
          })
        : [],
    [results.data, locale, role, t],
  );

  // Reset the highlighted row whenever the result set changes.
  useEffect(() => {
    setActiveIdx(options.length > 0 ? 0 : -1);
  }, [options]);

  const showPanel = open && raw.trim().length > 0;

  function go(opt: SearchOption) {
    setOpen(false);
    setRaw('');
    setQuery('');
    inputRef.current?.blur();
    startRouteProgress(opt.href);
    router.push(opt.href);
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
    { kind: 'supplier', icon: <Truck className="h-3.5 w-3.5" aria-hidden="true" /> },
    { kind: 'product', icon: <Package className="h-3.5 w-3.5" aria-hidden="true" /> },
    { kind: 'invoice', icon: <FileText className="h-3.5 w-3.5" aria-hidden="true" /> },
  ];
  const groupLabel = {
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
          placeholder={t('search.placeholder')}
          aria-label={t('search.label')}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && activeIdx >= 0 ? optionId(activeIdx) : undefined}
          autoComplete="off"
          className="w-full rounded-xl border border-line bg-surface-2 py-2 pe-9 ps-9 text-sm text-ink placeholder-subtle transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
          {!enabled ? (
            <p className="px-3 py-4 text-center text-sm text-subtle">{t('search.minChars')}</p>
          ) : results.isError ? (
            <p className="px-3 py-4 text-center text-sm text-danger">{t('search.error')}</p>
          ) : results.isLoading ? (
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
                    <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
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
