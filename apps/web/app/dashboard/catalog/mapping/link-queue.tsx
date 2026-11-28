'use client';

import { useEffect, useMemo, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Boxes, Check, Plus, Search, Undo2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, EmptyState, Input, friendlyError, useToast } from '@/lib/components';
import { Money } from '@/lib/components/money';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';
import { components } from '@/lib/i18n/messages/components';
import { reduceQueueKey, type QueueState } from '../queue-keys';

type Outputs = inferRouterOutputs<AppRouter>;
type Queue = Outputs['mapping']['queue'];
type Row = Queue['rows'][number];
type ConfirmResult = Outputs['mapping']['confirm'];

/** The link key mapping.confirm takes: (supplier, SKU), or (supplier, name) without a SKU. */
function keyOf(row: Row) {
  return {
    supplierId: row.supplierId,
    ...(row.supplierSku ? { supplierSku: row.supplierSku } : {}),
    rawName: row.nameRaw || row.supplierSku || '',
  };
}

interface LastLink {
  row: Row;
  result: ConfirmResult;
  name: string;
}

/**
 * W3-10 · the one "לקשר" queue: SKU lines, no-SKU lines and price-list rows in
 * one list ranked by the ₪ still unmapped, with a split view (list · detail) and
 * the keys J/K, 1/2/3, 4 and Z (queue-keys.ts). Owner / manager. On a phone the
 * detail opens as a bottom sheet over the 72 px rows.
 */
export function LinkQueue({ initial }: { initial: Queue }) {
  const t = useT(catalogNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();
  const q = trpc.mapping.queue.useQuery({ limit: 50, suggestFor: 10 }, { initialData: initial });
  const rows = q.data?.rows ?? [];
  const summary = q.data?.summary ?? { count: 0, unmappedAgorot: 0 };
  const [index, setIndex] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [last, setLast] = useState<LastLink | null>(null);
  const focused = rows[Math.min(index, rows.length - 1)] ?? null;

  const refresh = () => {
    void utils.mapping.queue.invalidate();
    void utils.mapping.unmapped.invalidate();
    void utils.mapping.questionCount.invalidate();
  };
  const confirm = trpc.mapping.confirm.useMutation({ onError: (e) => toast.error(friendlyError(e, tc)) });

  const link = (row: Row, args: { productId?: string; newProductName?: string }, name: string) => {
    confirm.mutate(
      { ...keyOf(row), ...args },
      {
        onSuccess: (result) => {
          setLast({ row, result, name });
          toast.success(t('linkQueue.linked', { name }));
          refresh();
        },
      },
    );
  };
  const undo = () => {
    if (!last?.result.undo) return;
    confirm.mutate(
      { ...keyOf(last.row), revert: last.result.undo },
      {
        onSuccess: () => {
          setLast(null);
          toast.success(t('linkQueue.undone'));
          refresh();
        },
      },
    );
  };

  // The keyboard: one reducer (queue-keys.ts) shared with the tests.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inEditable = !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
      const state: QueueState = {
        index: rows.length ? Math.min(index, rows.length - 1) : -1,
        rowCount: rows.length,
        candidateCount: focused?.suggestions.length ?? 0,
        history: last ? [{ kind: 'link', rowIndex: Math.min(index, Math.max(0, rows.length - 1)) }] : [],
      };
      const r = reduceQueueKey(state, { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, inEditable });
      if (!r.handled || confirm.isPending) return;
      e.preventDefault();
      if (r.effect.kind === 'none') setIndex(Math.max(0, r.state.index));
      else if (r.effect.kind === 'link' && focused) {
        const s = focused.suggestions[r.effect.candidate];
        if (s) link(focused, { productId: s.productId }, s.canonicalName);
      } else if (r.effect.kind === 'create' && focused) {
        link(focused, { newProductName: focused.nameRaw }, focused.nameRaw);
      } else if (r.effect.kind === 'undo') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Boxes className="h-6 w-6" />}
        title={t('linkQueue.emptyTitle')}
        description={t('linkQueue.emptyBody')}
      />
    );
  }

  return (
    <section aria-labelledby="link-queue-title" className="space-y-3">
      {/* T2: money waiting to be checked — one badge with ₪, the action is on the focused row. */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="link-queue-title" className="text-lg font-semibold text-ink">
          {t('linkQueue.title')}
        </h2>
        <Badge tone="warning-solid">
          {t('linkQueue.summaryCount', { count: formatNumber(summary.count, locale) })} ·{' '}
          <Money agorot={summary.unmappedAgorot} />
        </Badge>
        <p className="w-full text-sm text-muted md:w-auto">{t('linkQueue.summaryHint')}</p>
      </div>
      <p className="hidden text-xs text-subtle md:block">{t('linkQueue.keysHint')}</p>

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ul role="listbox" aria-label={t('linkQueue.listLabel')} className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map((row, i) => {
            const active = focused?.key === row.key;
            return (
              <li
                key={row.key}
                role="option"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  setIndex(i);
                  setSheetOpen(true);
                }}
                className={`flex min-h-[72px] cursor-pointer items-center justify-between gap-3 px-4 py-3 ${active ? 'bg-info-subtle' : 'hover:bg-surface-2'}`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink" lang="he">
                    {row.nameRaw || row.supplierSku}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
                    <span>{row.supplierName}</span>
                    {row.supplierSku && <span>{t('linkQueue.sku', { sku: row.supplierSku })}</span>}
                    <span>{t('linkQueue.lines', { count: formatNumber(row.lineCount, locale) })}</span>
                  </div>
                </div>
                <div className="shrink-0 text-end">
                  {row.unmappedAgorot > 0 ? (
                    <Money agorot={row.unmappedAgorot} className="font-semibold text-ink" />
                  ) : (
                    <span className="text-xs text-subtle">{t('linkQueue.noMoney')}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div
          className={`${sheetOpen ? 'fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto rounded-t-2xl shadow-lg' : 'hidden'} md:static md:block md:max-h-none md:rounded-none md:shadow-none`}
        >
          {focused ? (
            <Detail
              key={focused.key}
              row={focused}
              pending={confirm.isPending}
              onLink={(args, name) => link(focused, args, name)}
              onClose={() => setSheetOpen(false)}
            />
          ) : (
            <Card className="p-4 text-sm text-subtle">{t('linkQueue.detailEmpty')}</Card>
          )}
          {last?.result.undo && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm">
              <span lang="he">{t('linkQueue.linked', { name: last.name })}</span>
              <Button variant="ghost" size="sm" onClick={undo} disabled={confirm.isPending}>
                <Undo2 className="h-4 w-4" aria-hidden="true" /> {t('linkQueue.undo')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Detail({
  row,
  pending,
  onLink,
  onClose,
}: {
  row: Row;
  pending: boolean;
  onLink: (args: { productId?: string; newProductName?: string }, name: string) => void;
  onClose: () => void;
}) {
  const t = useT(catalogNs);
  const locale = useLocale();
  const [raw, setRaw] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(raw.trim()), 250);
    return () => clearTimeout(timer);
  }, [raw]);
  const results = trpc.mapping.searchProducts.useQuery({ q: search, limit: 8 }, { enabled: search.length >= 1 });
  const sources = useMemo(
    () =>
      row.sources.map((s) =>
        s === 'sku_line' ? t('linkQueue.sourceSku') : s === 'no_sku_line' ? t('linkQueue.sourceName') : t('linkQueue.sourceImport'),
      ),
    [row.sources, t],
  );

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-ink" lang="he">
            {row.nameRaw || row.supplierSku}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge>{row.supplierName}</Badge>
            {sources.map((s) => (
              <Badge key={s} tone="neutral">
                {s}
              </Badge>
            ))}
          </div>
          {row.unmappedAgorot > 0 && (
            <p className="mt-2 text-sm text-muted">
              <Money agorot={row.unmappedAgorot} className="font-semibold text-ink" /> {t('linkQueue.unmapped')} ·{' '}
              {t('linkQueue.lines', { count: formatNumber(row.lineCount, locale) })}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" className="md:hidden" onClick={onClose}>
          {t('linkQueue.close')}
        </Button>
      </div>

      {row.suggestions.length > 0 ? (
        <ul className="space-y-2" aria-label={t('linkQueue.suggestionsLabel')}>
          {row.suggestions.map((s, i) => (
            <li key={s.productId}>
              <Button
                variant={i === 0 ? 'primary' : 'secondary'}
                className="w-full justify-between"
                disabled={pending}
                onClick={() => onLink({ productId: s.productId }, s.canonicalName)}
              >
                <span className="inline-flex items-center gap-2">
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span lang="he">{t('linkQueue.suggestion', { key: String(i + 1), name: s.canonicalName })}</span>
                </span>
                <span className="text-xs opacity-80">
                  {t('linkQueue.confidence', { pct: formatNumber(Math.round(s.confidence * 100), locale) })}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-subtle">{t('linkQueue.noSuggestions')}</p>
      )}

      <div className="space-y-2 border-t border-line pt-4">
        <label className="block text-sm font-medium text-ink" htmlFor={`lq-search-${row.key}`}>
          {t('linkQueue.searchLabel')}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <Input
            id={`lq-search-${row.key}`}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t('linkQueue.searchPlaceholder')}
            className="ps-9"
          />
        </div>
        {(results.data ?? []).length > 0 && (
          <ul className="space-y-1">
            {results.data!.map((p) => (
              <li key={p.id}>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => onLink({ productId: p.id }, p.canonicalName)}>
                  <span lang="he">{p.canonicalName}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {row.nameRaw && (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => onLink({ newProductName: row.nameRaw }, row.nameRaw)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> {t('linkQueue.createNew', { name: row.nameRaw })}
          </Button>
        )}
      </div>
    </Card>
  );
}
