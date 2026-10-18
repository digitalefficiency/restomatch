'use client';

import { useEffect, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Boxes, Check, Plus, Search } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Spinner,
  displayName,
  friendlyError,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';
import { components } from '@/lib/i18n/messages/components';

type Outputs = inferRouterOutputs<AppRouter>;
type UnmappedSku = Outputs['mapping']['unmapped'][number];

export function SkuMapper({ initial }: { initial: UnmappedSku[] }) {
  const t = useT(catalogNs);
  const locale = useLocale();
  const utils = trpc.useUtils();
  const q = trpc.mapping.unmapped.useQuery(undefined, { initialData: initial });
  const rows = q.data ?? [];

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted">
        <Spinner className="h-4 w-4" /> {t('mapping.loading')}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Boxes className="h-6 w-6" />}
        title={t('mapping.emptyTitle')}
        description={t('mapping.emptyBody')}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t('mapping.pending', { count: formatNumber(rows.length, locale) })}</p>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={`${row.supplierId}::${row.supplierSku}`}>
            <MapRow row={row} onDone={() => utils.mapping.unmapped.invalidate()} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MapRow({ row, onDone }: { row: UnmappedSku; onDone: () => void }) {
  const t = useT(catalogNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(raw.trim()), 250);
    return () => clearTimeout(timer);
  }, [raw]);

  const results = trpc.mapping.searchProducts.useQuery(
    { q: search, limit: 8 },
    { enabled: open && search.length >= 1 },
  );

  const confirm = trpc.mapping.confirm.useMutation({
    onSuccess: (r) => {
      setOpen(false);
      toast.success(
        t('mapping.linked', {
          sku: row.supplierSku,
          count: formatNumber(r.poLinesUpdated + r.invoiceLinesUpdated, locale),
        }),
      );
      onDone();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });

  const link = (args: { productId?: string; newProductName?: string }) => {
    confirm.mutate({
      supplierId: row.supplierId,
      supplierSku: row.supplierSku,
      rawName: row.sampleDescription || row.supplierSku,
      ...args,
    });
  };
  const panelId = `map-${row.supplierId}-${row.supplierSku}`;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{row.supplierName}</Badge>
            <span className="font-mono text-sm text-subtle">{t('mapping.sku', { sku: row.supplierSku })}</span>
            {row.occurrences > 1 && (
              <span className="text-xs text-subtle">
                · {t('mapping.occurrences', { count: formatNumber(row.occurrences, locale) })}
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-ink" lang="he">
            {row.sampleDescription || '—'}
          </div>
        </div>
        <Button
          variant={open ? 'secondary' : 'primary'}
          size="sm"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('mapping.close') : t('mapping.map')}
        </Button>
      </div>

      {open && (
        <div id={panelId} className="mt-4 border-t border-line pt-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t('mapping.searchPlaceholder')}
              aria-label={t('mapping.searchLabel')}
              className="ps-9"
              autoFocus
            />
          </div>

          <div className="mt-3 space-y-1.5" aria-live="polite">
            {results.isFetching && (
              <div className="flex items-center gap-2 py-2 text-sm text-muted">
                <Spinner className="h-3.5 w-3.5" /> {t('mapping.searching')}
              </div>
            )}
            {(results.data ?? []).map((p) => {
              const name = displayName(p.canonicalName, p.nameEn, locale);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={confirm.isPending}
                  onClick={() => link({ productId: p.id })}
                  aria-label={t('mapping.linkTo', { name: name.primary })}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-start text-ink transition hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">
                    {name.primary}
                    {name.secondary ? <span className="ms-2 text-xs text-subtle">{name.secondary}</span> : null}
                  </span>
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                </button>
              );
            })}
            {search.length >= 1 && !results.isFetching && (results.data?.length ?? 0) === 0 && (
              <p className="py-1 text-sm text-subtle">{t('mapping.noMatches')}</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-sm text-muted">{t('mapping.notInCatalog')}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={confirm.isPending || !row.sampleDescription}
              onClick={() => link({ newProductName: row.sampleDescription })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />{' '}
              {t('mapping.createNew', { name: row.sampleDescription || '—' })}
            </Button>
          </div>

          {confirm.isPending && (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-3.5 w-3.5" /> {t('mapping.linking')}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
