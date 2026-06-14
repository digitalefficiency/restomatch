'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { FileText, Package, Search, Truck } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { cn, Spinner } from '@/lib/components';

/**
 * Global search box for the dashboard nav. Debounces input, queries
 * `search.global` (min 2 chars), and shows grouped results (ספקים / מוצרים /
 * חשבוניות) in a dropdown. Closes on outside-click and Escape.
 */
export function DashboardSearch() {
  const [raw, setRaw] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Debounce the raw input into the actual query (300ms).
  useEffect(() => {
    const trimmed = raw.trim();
    const t = setTimeout(() => setQuery(trimmed), 300);
    return () => clearTimeout(t);
  }, [raw]);

  const enabled = query.length >= 2;
  const results = trpc.search.global.useQuery(
    { q: query },
    { enabled, staleTime: 30_000 },
  );

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

  const data = results.data;
  const hasAny =
    !!data && (data.suppliers.length || data.products.length || data.invoices.length);
  const showPanel = open && enabled;

  return (
    <div ref={containerRef} className="relative w-full sm:w-64">
      <div className="relative">
        <Search
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
          aria-hidden="true"
        />
        <input
          type="search"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="חיפוש ספקים, מוצרים, חשבוניות…"
          aria-label="חיפוש כללי"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className="w-full rounded-xl border border-line bg-surface-2 py-2 pr-9 pl-3 text-sm text-ink placeholder-subtle transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {results.isFetching && enabled ? (
          <Spinner className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
        ) : null}
      </div>

      {showPanel ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-40 mt-2 max-h-96 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-card"
        >
          {results.isLoading ? (
            <p className="px-3 py-4 text-center text-sm text-subtle">מחפש…</p>
          ) : !hasAny ? (
            <p className="px-3 py-4 text-center text-sm text-subtle">לא נמצאו תוצאות</p>
          ) : (
            <>
              <Group
                label="ספקים"
                icon={<Truck className="h-3.5 w-3.5" aria-hidden="true" />}
                items={data!.suppliers.map((s) => ({ id: s.id, label: s.name }))}
              />
              <Group
                label="מוצרים"
                icon={<Package className="h-3.5 w-3.5" aria-hidden="true" />}
                items={data!.products.map((p) => ({ id: p.id, label: p.canonicalName }))}
              />
              <Group
                label="חשבוניות"
                icon={<FileText className="h-3.5 w-3.5" aria-hidden="true" />}
                items={data!.invoices.map((i) => ({
                  id: i.id,
                  label: i.invoiceNumber ?? 'ללא מספר',
                }))}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Group({
  label,
  icon,
  items,
}: {
  label: string;
  icon: React.ReactNode;
  items: { id: string; label: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
        {icon}
        {label}
      </div>
      <ul>
        {items.map((it) => (
          <li
            key={it.id}
            role="option"
            aria-selected={false}
            className={cn(
              'truncate rounded-lg px-3 py-1.5 text-sm text-muted',
              'hover:bg-surface-2 hover:text-ink',
            )}
          >
            {it.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
