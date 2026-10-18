'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { originalProps } from '@/lib/i18n/original';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ExternalLink, Search } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Button,
  Card,
  EmptyState,
  Input,
  LoadMore,
  Spinner,
  cn,
  displayName,
  friendlyError,
  useSingleFlight,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { products as productsNs } from '@/lib/i18n/messages/products';
import { chunk, pendingNames, type NameEdit } from './product-logic';

type ListOutput = inferRouterOutputs<AppRouter>['products']['list'];

const PAGE = 100;
/** products.setNamesEn accepts at most this many items per call. */
const MAX_BATCH = 200;

/**
 * Spreadsheet-like editor for `products.name_en`. Each English cell is an
 * input; Enter / ↓ jump to the next row, ↑ to the previous, Ctrl/⌘+S saves.
 * Edits are kept locally (dirty cells highlighted) and saved in one
 * all-or-nothing `products.setNamesEn` batch. Leaving with unsaved edits warns.
 */
export function NamesGrid({ initial, canEdit }: { initial: ListOutput; canEdit: boolean }) {
  const t = useT(productsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [edits, setEdits] = useState<Record<string, NameEdit>>({});
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(rawSearch.trim());
      setLimit(PAGE);
    }, 250);
    return () => clearTimeout(timer);
  }, [rawSearch]);

  const q = trpc.products.list.useQuery(
    { search: search || undefined, missingOnly: missingOnly || undefined, limit },
    {
      initialData: !search && !missingOnly && limit === PAGE ? initial : undefined,
      placeholderData: (prev) => prev,
    },
  );
  // Overall progress is always computed over all products (unfiltered).
  const totals = trpc.products.list.useQuery({ limit: 1 }, { staleTime: 0 });
  const missing = trpc.products.list.useQuery({ limit: 1, missingOnly: true }, { staleTime: 0 });

  const rows = q.data?.rows ?? [];
  const batch = useMemo(() => pendingNames(edits), [edits]);
  const dirty = batch.length;

  const utils = trpc.useUtils();
  const save = trpc.products.setNamesEn.useMutation();
  const once = useSingleFlight();

  const doSave = () => {
    if (dirty === 0) return;
    once(async () => {
      let updated = 0;
      const saved = new Set<string>();
      try {
        for (const items of chunk(batch, MAX_BATCH)) {
          const r = await save.mutateAsync({ items });
          updated += r.updated;
          for (const it of items) saved.add(it.productId);
        }
        toast.success(t('names.saved', { count: formatNumber(updated, locale) }));
      } catch (e) {
        toast.error(friendlyError(e, tc));
      } finally {
        // Keep whatever didn't make it, so nothing typed is lost.
        if (saved.size > 0) {
          setEdits((m) => Object.fromEntries(Object.entries(m).filter(([id]) => !saved.has(id))));
          await utils.products.list.invalidate();
        }
      }
    });
  };

  // Ctrl/⌘+S saves; warn before leaving with unsaved edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        doSave();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty > 0) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  });

  const focusRow = (i: number) => {
    const el = inputs.current[i];
    if (el) {
      el.focus();
      el.select();
    }
  };

  const totalAll = totals.data?.total ?? 0;
  const done = totalAll - (missing.data?.total ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <label htmlFor="names-search" className="mb-1.5 block text-sm font-medium text-muted">
            {t('names.search')}
          </label>
          <Search className="pointer-events-none absolute bottom-3 start-3 h-4 w-4 text-subtle" aria-hidden="true" />
          <Input
            id="names-search"
            type="search"
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder={t('names.searchPlaceholder')}
            className="ps-9"
            autoComplete="off"
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2.5 text-sm text-muted">
          <input
            type="checkbox"
            checked={missingOnly}
            onChange={(e) => {
              setMissingOnly(e.target.checked);
              setLimit(PAGE);
            }}
            className="h-4 w-4 accent-primary"
          />
          {t('names.missingOnly')}
        </label>
      </div>

      {totals.isSuccess && totalAll > 0 ? (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-subtle">
            <span className="tabular-nums">
              {t('names.progress', { done: formatNumber(done, locale), total: formatNumber(totalAll, locale) })}
            </span>
            {canEdit ? <span className="hidden sm:inline">{t('names.keyboardHint')}</span> : null}
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={totalAll}
            aria-valuenow={done}
            aria-label={t('names.progress', { done: String(done), total: String(totalAll) })}
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / totalAll) * 100}%` }} />
          </div>
        </div>
      ) : null}

      {!canEdit ? <p className="text-xs text-subtle">{t('names.readOnly')}</p> : null}

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted">
          <Spinner className="h-4 w-4" /> {t('names.loading')}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={missingOnly && !search ? t('names.allDone') : t('names.empty')} />
      ) : (
        <Card elevated padding="none" className={cn('overflow-hidden transition-opacity', q.isFetching && 'opacity-80')}>
          <ul role="list" className="divide-y divide-line/60">
            <li className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-3 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-subtle md:grid">
              <span>{t('names.hebrew')}</span>
              <span>{t('names.english')}</span>
              <span>{t('names.supplier')}</span>
            </li>
            {rows.map((r, i) => {
              const edit = edits[r.id];
              const value = edit ? edit.value : (r.nameEn ?? '');
              const changed = !!edit && value.trim() !== (edit.original ?? '').trim();
              const supplier = r.supplierName ? displayName(r.supplierName, r.supplierNameEn, locale).primary : '—';
              const inputId = `name-en-${r.id}`;
              return (
                <li
                  key={r.id}
                  className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)] md:items-center md:gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <label htmlFor={inputId} className="truncate font-medium text-ink" lang="he">
                      {r.canonicalName}
                    </label>
                    <Link
                      href={`/dashboard/products/${r.id}`}
                      className="shrink-0 rounded text-subtle hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                      aria-label={`${t('names.openProduct')}: ${r.canonicalName}`}
                      tabIndex={-1}
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                  <Input
                    id={inputId}
                    ref={(el: HTMLInputElement | null) => {
                      inputs.current[i] = el;
                    }}
                    value={value}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const next = e.target.value;
                      setEdits((m) => ({
                        ...m,
                        [r.id]: { value: next, original: m[r.id]?.original ?? r.nameEn },
                      }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        focusRow(i + 1);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        focusRow(i - 1);
                      } else if (e.key === 'Escape' && r.id in edits) {
                        setEdits((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== r.id)));
                      }
                    }}
                    placeholder={t('names.placeholder')}
                    maxLength={200}
                    dir="ltr"
                    lang="en"
                    autoComplete="off"
                    className={cn('py-1.5 text-sm', changed && 'border-primary/60 bg-primary/5')}
                  />
                  <span className="truncate text-xs text-muted md:text-sm">
                    <span className="md:hidden">{t('names.supplier')}: </span>
                    {supplier}
                    {r.category ? (
                      <span className="text-subtle">
                        {' · '}
                        <span {...originalProps(r.category)}>{r.category}</span>
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <LoadMore
        onClick={() => setLimit((l) => l + PAGE)}
        loading={q.isFetching}
        hasMore={rows.length < (q.data?.total ?? 0) && !q.isLoading}
        label={t('names.loadMore')}
      />

      {canEdit ? (
        <div className="sticky bottom-20 z-30 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-surface/95 p-3 shadow-card backdrop-blur lg:bottom-4">
          <span className="me-auto text-sm text-muted" aria-live="polite">
            {dirty > 0 ? t('names.unsaved', { count: formatNumber(dirty, locale) }) : ''}
          </span>
          <Button variant="ghost" size="sm" disabled={dirty === 0 || save.isPending} onClick={() => setEdits({})}>
            {t('names.discard')}
          </Button>
          <Button variant="primary" size="sm" disabled={dirty === 0} loading={save.isPending} onClick={doSave}>
            {dirty > 0 ? t('names.save', { count: formatNumber(dirty, locale) }) : t('names.saveNone')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
