'use client';

import { useEffect, useState } from 'react';
import { UnitText } from '@/lib/components/UnitText';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Boxes, Check, Languages, Pencil, Plus, Power, Search, Trash2, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  Input,
  LinkButton,
  LoadMore,
  Select,
  Spinner,
  cn,
  displayName,
  friendlyError,
  useToast,
  useSingleFlight,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';
import { components } from '@/lib/i18n/messages/components';
import { formatIls } from '@/lib/money';
import { formatPriceInput, parsePriceInput } from './money-logic';

type Outputs = inferRouterOutputs<AppRouter>;
type CatalogItem = Outputs['catalog']['items'][number];
type Supplier = Outputs['suppliers']['list'][number];

const PAGE = 50;

/** Editable row draft (all strings; converted on save). */
interface Draft {
  supplierNameRaw: string;
  supplierSku: string;
  unit: string;
  listPrice: string;
}

const EMPTY_DRAFT: Draft = { supplierNameRaw: '', supplierSku: '', unit: '', listPrice: '' };

function draftFrom(it: CatalogItem): Draft {
  return {
    supplierNameRaw: it.supplierNameRaw,
    supplierSku: it.supplierSku ?? '',
    unit: it.unit ?? '',
    listPrice: it.listPrice != null ? String(Number(it.listPrice)) : '',
  };
}

const th = 'px-4 py-3 font-medium text-start';

export function CatalogBrowser({
  suppliers,
  initial,
  lockedSupplierId,
  canEdit = false,
}: {
  suppliers: Supplier[];
  initial: CatalogItem[];
  /**
   * When set (supplier-detail "hub" view), the supplier filter is hidden and
   * every query is scoped to this supplier. `initial` should already be that
   * supplier's items so the first paint matches the locked scope.
   */
  lockedSupplierId?: string;
  /** Owner/manager → show inline add / edit / delete / activate controls. */
  canEdit?: boolean;
}) {
  const t = useT(catalogNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const once = useSingleFlight();
  const [supplierId, setSupplierId] = useState<string>('');
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [showInactive, setShowInactive] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CatalogItem | null>(null);

  // Debounce typing → query (one request per pause, not per keystroke).
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(rawSearch.trim());
      setLimit(PAGE);
    }, 250);
    return () => clearTimeout(timer);
  }, [rawSearch]);

  const locked = !!lockedSupplierId;
  const effectiveSupplierId = lockedSupplierId ?? (supplierId || undefined);
  const filtered = !!search || showInactive || (!locked && !!supplierId);

  const q = trpc.catalog.items.useQuery(
    {
      supplierId: effectiveSupplierId,
      search: search || undefined,
      limit,
      includeInactive: showInactive || undefined,
    },
    {
      // `initial` is the active-only first page → only reuse it for that exact view.
      initialData: !search && limit === PAGE && !showInactive && (locked || !supplierId) ? initial : undefined,
      placeholderData: (prev) => prev,
    },
  );

  const refresh = () => void q.refetch();
  const errMsg = (e: unknown) => friendlyError(e, tc, { CONFLICT: t('item.duplicateSku') });

  const update = trpc.catalog.updateItem.useMutation({
    onSuccess: () => {
      setEditingId(null);
      setRowError(null);
      toast.success(t('item.updated'));
      refresh();
    },
    onError: (e) => setRowError(errMsg(e)),
  });
  const create = trpc.catalog.createItem.useMutation({
    onSuccess: () => {
      setCreating(false);
      setNewDraft(EMPTY_DRAFT);
      setRowError(null);
      toast.success(t('item.created'));
      refresh();
    },
    onError: (e) => setRowError(errMsg(e)),
  });
  const remove = trpc.catalog.deleteItem.useMutation({
    onSuccess: () => {
      toast.success(t('item.deleted'));
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const toggle = trpc.catalog.setItemActive.useMutation({
    onSuccess: (_r, vars) => {
      toast.success(vars.active ? t('item.activated') : t('item.deactivated'));
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const items = q.data ?? [];
  const hasMore = items.length >= limit;
  const busy = update.isPending || create.isPending || remove.isPending || toggle.isPending;

  function startEdit(it: CatalogItem) {
    setEditingId(it.id);
    setDraft(draftFrom(it));
    setRowError(null);
  }

  function saveEdit(it: CatalogItem) {
    if (!draft.supplierNameRaw.trim()) return setRowError(t('item.descriptionRequired'));
    const price = parsePriceInput(draft.listPrice);
    if (price === 'invalid') return setRowError(t('item.priceInvalid'));
    update.mutate({
      itemId: it.id,
      patch: {
        supplierNameRaw: draft.supplierNameRaw.trim(),
        supplierSku: draft.supplierSku.trim() || null,
        unit: draft.unit.trim() || null,
        listPrice: price,
      },
    });
  }

  function submitCreate() {
    if (!effectiveSupplierId) return;
    if (!newDraft.supplierNameRaw.trim()) return setRowError(t('item.descriptionRequired'));
    const price = parsePriceInput(newDraft.listPrice);
    if (price === 'invalid') return setRowError(t('item.priceInvalid'));
    const supplierId = effectiveSupplierId;
    once(() =>
      create.mutateAsync({
        supplierId,
        supplierNameRaw: newDraft.supplierNameRaw.trim(),
        ...(newDraft.supplierSku.trim() ? { supplierSku: newDraft.supplierSku.trim() } : {}),
        ...(newDraft.unit.trim() ? { unit: newDraft.unit.trim() } : {}),
        ...(price != null ? { listPrice: price } : {}),
      }),
    );
  }

  const onRowKey = (save: () => void, cancel: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      cancel();
    }
  };

  // Columns: [supplier?] desc, product, english, sku, unit, price, [actions]
  const colCount = (locked ? 0 : 1) + 6 + (canEdit ? 1 : 0);
  const money = (v: string | null) =>
    v != null ? formatIls(Number(v), { locale, maximumFractionDigits: 2 }) : '—';

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={!!pendingDelete}
        title={
          pendingDelete
            ? t('item.confirmDelete', {
                name: pendingDelete.supplierNameRaw,
                supplier: displayName(pendingDelete.supplierName, pendingDelete.supplierNameEn, locale).primary,
              })
            : ''
        }
        body={t('item.confirmDeleteBody')}
        confirmLabel={t('item.delete')}
        cancelLabel={t('item.keep')}
        loading={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) remove.mutate({ itemId: pendingDelete.id });
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
      <div className="flex flex-wrap items-end gap-3">
        {!locked && (
          <div className="w-full sm:w-auto sm:min-w-[12rem]">
            <label className="mb-1.5 block text-sm font-medium text-muted" htmlFor="cat-supplier">
              {t('browser.supplier')}
            </label>
            <Select
              id="cat-supplier"
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setLimit(PAGE);
                setCreating(false);
              }}
            >
              <option value="">{t('browser.allSuppliers')}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {displayName(s.name, s.nameEn, locale).primary}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="relative min-w-[14rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-muted" htmlFor="cat-search">
            {t('browser.search')}
          </label>
          <Search className="pointer-events-none absolute bottom-3 start-3 h-4 w-4 text-subtle" aria-hidden="true" />
          <Input
            id="cat-search"
            type="search"
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder={t('browser.searchPlaceholder')}
            className="ps-9"
            autoComplete="off"
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2.5 text-sm text-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => {
              setShowInactive(e.target.checked);
              setLimit(PAGE);
            }}
            className="h-4 w-4 accent-primary"
          />
          {t('browser.showInactive')}
        </label>
        {canEdit && effectiveSupplierId && (
          <Button
            variant="secondary"
            size="sm"
            className="mb-1"
            onClick={() => {
              setCreating((c) => !c);
              setNewDraft(EMPTY_DRAFT);
              setRowError(null);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> {t('browser.addItem')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-subtle">
        <span className="tabular-nums" aria-live="polite">
          {q.isSuccess
            ? hasMore
              ? t('browser.countMore', { count: formatNumber(items.length, locale) })
              : t('browser.count', { count: formatNumber(items.length, locale) })
            : ''}
        </span>
        {canEdit && !effectiveSupplierId && <span>{t('browser.pickSupplierToAdd')}</span>}
      </div>

      {rowError && (
        <div role="alert" className="rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger">
          {rowError}
        </div>
      )}

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted">
          <Spinner className="h-4 w-4" /> {t('browser.loading')}
        </div>
      ) : q.isError ? (
        <ErrorNotice message={t('browser.error')} />
      ) : items.length === 0 && !creating ? (
        <EmptyState
          icon={<Boxes className="h-6 w-6" />}
          title={filtered ? t('browser.noResultsTitle') : t('browser.emptyTitle')}
          description={filtered ? t('browser.noResultsBody') : t('browser.emptyBody')}
          action={
            !filtered ? (
              canEdit ? (
                <LinkButton
                  href={locked ? `/dashboard/catalog/import?supplierId=${encodeURIComponent(lockedSupplierId ?? '')}` : '/dashboard/catalog/import'}
                >
                  {t('browser.firstImport')}
                </LinkButton>
              ) : undefined
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRawSearch('');
                  setSearch('');
                  setShowInactive(false);
                  if (!locked) setSupplierId('');
                }}
              >
                {t('browser.clearFilters')}
              </Button>
            )
          }
        />
      ) : (
        <>
        <MobileCards
          items={items}
          locked={locked}
          canEdit={canEdit}
          busy={busy}
          creating={creating}
          editingId={editingId}
          draft={draft}
          setDraft={setDraft}
          newDraft={newDraft}
          setNewDraft={setNewDraft}
          savingEdit={update.isPending}
          savingNew={create.isPending}
          onStartEdit={startEdit}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={saveEdit}
          onSubmitCreate={submitCreate}
          onCancelCreate={() => setCreating(false)}
          onToggle={(it) => toggle.mutate({ itemId: it.id, active: !it.active })}
          onDelete={(it) => setPendingDelete(it)}
          onRefresh={refresh}
          money={money}
        />
        <Card elevated padding="none" className={cn('hidden overflow-x-auto transition-opacity md:block', q.isFetching && 'opacity-80')}>
          <table className="w-full min-w-[760px] text-start text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-subtle ltr:uppercase ltr:tracking-wide">
                {!locked && <th scope="col" className={th}>{t('columns.supplier')}</th>}
                <th scope="col" className={th}>{t('columns.supplierDescription')}</th>
                <th scope="col" className={th}>{t('columns.product')}</th>
                <th scope="col" className={th}>{t('columns.nameEn')}</th>
                <th scope="col" className={th}>{t('columns.sku')}</th>
                <th scope="col" className={th}>{t('columns.unit')}</th>
                <th scope="col" className={cn(th, 'text-right')}>{t('columns.listPrice')}</th>
                {canEdit && (
                  <th scope="col" className={th}>
                    <span className="sr-only">{t('columns.actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {creating && (
                <tr className="border-b border-line/60 bg-surface-2/40">
                  {!locked && <td className="px-4 py-2 text-subtle">{t('browser.new')}</td>}
                  <td className="px-4 py-2">
                    <Input
                      value={newDraft.supplierNameRaw}
                      onChange={(e) => setNewDraft({ ...newDraft, supplierNameRaw: e.target.value })}
                      onKeyDown={onRowKey(submitCreate, () => setCreating(false))}
                      placeholder={t('item.descriptionPlaceholder')}
                      aria-label={t('columns.supplierDescription')}
                      maxLength={400}
                      autoFocus
                    />
                  </td>
                  <td className="px-4 py-2 text-subtle">—</td>
                  <td className="px-4 py-2 text-subtle">—</td>
                  <td className="px-4 py-2">
                    <Input
                      value={newDraft.supplierSku}
                      onChange={(e) => setNewDraft({ ...newDraft, supplierSku: e.target.value })}
                      onKeyDown={onRowKey(submitCreate, () => setCreating(false))}
                      placeholder={t('item.skuPlaceholder')}
                      aria-label={t('columns.sku')}
                      maxLength={64}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      value={newDraft.unit}
                      onChange={(e) => setNewDraft({ ...newDraft, unit: e.target.value })}
                      onKeyDown={onRowKey(submitCreate, () => setCreating(false))}
                      placeholder={t('item.unitPlaceholder')}
                      aria-label={t('columns.unit')}
                      maxLength={32}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      autoComplete="off"
                      value={newDraft.listPrice}
                      onChange={(e) => setNewDraft({ ...newDraft, listPrice: e.target.value })}
                      onBlur={(e) => setNewDraft({ ...newDraft, listPrice: formatPriceInput(e.target.value) })}
                      title={t('item.priceHint')}
                      onKeyDown={onRowKey(submitCreate, () => setCreating(false))}
                      placeholder="₪"
                      aria-label={t('columns.listPrice')}
                      className="text-right text-base"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="primary" loading={create.isPending} onClick={submitCreate}>
                        {t('item.save')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCreating(false)}
                        aria-label={t('item.cancel')}
                        title={t('item.cancel')}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )}

              {items.map((it) => {
                const editing = editingId === it.id;
                const cancelEdit = () => setEditingId(null);
                return (
                  <tr key={it.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                    {!locked && (
                      <td className="px-4 py-3 text-muted">
                        {displayName(it.supplierName, it.supplierNameEn, locale).primary}
                      </td>
                    )}
                    <td className="px-4 py-3 text-ink">
                      {editing ? (
                        <Input
                          value={draft.supplierNameRaw}
                          onChange={(e) => setDraft({ ...draft, supplierNameRaw: e.target.value })}
                          onKeyDown={onRowKey(() => saveEdit(it), cancelEdit)}
                          aria-label={t('columns.supplierDescription')}
                          maxLength={400}
                          autoFocus
                        />
                      ) : (
                        <span lang="he">{it.supplierNameRaw}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {it.productId ? (
                        <Link
                          href={`/dashboard/products/${it.productId}`}
                          className="rounded text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                          lang="he"
                        >
                          {it.canonicalName ?? '—'}
                        </Link>
                      ) : (
                        (it.canonicalName ?? '—')
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <EnglishNameCell
                        productId={it.productId}
                        value={it.productNameEn}
                        canEdit={canEdit}
                        onSaved={refresh}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-subtle">
                      {editing ? (
                        <Input
                          value={draft.supplierSku}
                          onChange={(e) => setDraft({ ...draft, supplierSku: e.target.value })}
                          onKeyDown={onRowKey(() => saveEdit(it), cancelEdit)}
                          aria-label={t('columns.sku')}
                          maxLength={64}
                        />
                      ) : (
                        (it.supplierSku ?? '—')
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {editing ? (
                        <Input
                          value={draft.unit}
                          onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                          onKeyDown={onRowKey(() => saveEdit(it), cancelEdit)}
                          aria-label={t('columns.unit')}
                          maxLength={32}
                        />
                      ) : (
                        <UnitText unit={it.unit} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">
                      {editing ? (
                        <Input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          autoComplete="off"
                          value={draft.listPrice}
                          onChange={(e) => setDraft({ ...draft, listPrice: e.target.value })}
                          onBlur={(e) => setDraft({ ...draft, listPrice: formatPriceInput(e.target.value) })}
                          title={t('item.priceHint')}
                          onKeyDown={onRowKey(() => saveEdit(it), cancelEdit)}
                          aria-label={t('columns.listPrice')}
                          className="text-right text-base"
                        />
                      ) : (
                        money(it.listPrice)
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        {editing ? (
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="primary" loading={update.isPending} onClick={() => saveEdit(it)}>
                              {t('item.save')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelEdit}
                              aria-label={t('item.cancel')}
                              title={t('item.cancel')}
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            {!it.active && <Badge tone="neutral">{t('item.inactive')}</Badge>}
                            <Button
                              size="sm"
                              variant="ghost"
                              title={t('item.edit')}
                              aria-label={`${t('item.edit')}: ${it.supplierNameRaw}`}
                              disabled={busy}
                              onClick={() => startEdit(it)}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title={it.active ? t('item.deactivate') : t('item.activate')}
                              aria-label={`${it.active ? t('item.deactivate') : t('item.activate')}: ${it.supplierNameRaw}`}
                              aria-pressed={!it.active}
                              disabled={busy}
                              onClick={() => toggle.mutate({ itemId: it.id, active: !it.active })}
                            >
                              <Power className={`h-4 w-4 ${it.active ? '' : 'text-subtle'}`} aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title={t('item.delete')}
                              aria-label={`${t('item.delete')}: ${it.supplierNameRaw}`}
                              disabled={busy}
                              onClick={() => setPendingDelete(it)}
                            >
                              <Trash2 className="h-4 w-4 text-danger" aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}

              {items.length === 0 && creating && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-3 text-center text-subtle">
                    {t('browser.firstItem')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        </>
      )}

      <LoadMore onClick={() => setLimit((l) => l + PAGE)} loading={q.isFetching} hasMore={hasMore && !q.isLoading} />
    </div>
  );
}

/**
 * Phone layout (< md): one card per catalog item — no sideways scrolling.
 * Shares the browser's draft state, so editing / adding behaves exactly like
 * the desktop table (same validation, same mutations).
 */
function MobileCards({
  items,
  locked,
  canEdit,
  busy,
  creating,
  editingId,
  draft,
  setDraft,
  newDraft,
  setNewDraft,
  savingEdit,
  savingNew,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onSubmitCreate,
  onCancelCreate,
  onToggle,
  onDelete,
  onRefresh,
  money,
}: {
  items: CatalogItem[];
  locked: boolean;
  canEdit: boolean;
  busy: boolean;
  creating: boolean;
  editingId: string | null;
  draft: Draft;
  setDraft: (d: Draft) => void;
  newDraft: Draft;
  setNewDraft: (d: Draft) => void;
  savingEdit: boolean;
  savingNew: boolean;
  onStartEdit: (it: CatalogItem) => void;
  onCancelEdit: () => void;
  onSaveEdit: (it: CatalogItem) => void;
  onSubmitCreate: () => void;
  onCancelCreate: () => void;
  onToggle: (it: CatalogItem) => void;
  onDelete: (it: CatalogItem) => void;
  onRefresh: () => void;
  money: (v: string | null) => string;
}) {
  const t = useT(catalogNs);
  const locale = useLocale();

  const fields = (d: Draft, set: (d: Draft) => void, idPrefix: string) => (
    <div className="grid grid-cols-2 gap-2">
      <label className="col-span-2 text-xs text-subtle">
        {t('columns.supplierDescription')}
        <Input
          value={d.supplierNameRaw}
          onChange={(e) => set({ ...d, supplierNameRaw: e.target.value })}
          placeholder={t('item.descriptionPlaceholder')}
          maxLength={400}
          className="mt-0.5 text-sm"
          id={`${idPrefix}-desc`}
        />
      </label>
      <label className="text-xs text-subtle">
        {t('card.sku')}
        <Input value={d.supplierSku} onChange={(e) => set({ ...d, supplierSku: e.target.value })} maxLength={64} className="mt-0.5 text-sm" />
      </label>
      <label className="text-xs text-subtle">
        {t('card.unit')}
        <Input value={d.unit} onChange={(e) => set({ ...d, unit: e.target.value })} maxLength={32} className="mt-0.5 text-sm" />
      </label>
      <label className="col-span-2 text-xs text-subtle">
        {t('card.price')}
        <Input
          type="text"
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          value={d.listPrice}
          onChange={(e) => set({ ...d, listPrice: e.target.value })}
          onBlur={(e) => set({ ...d, listPrice: formatPriceInput(e.target.value) })}
          placeholder="₪"
          className="mt-0.5 text-right text-base tabular-nums"
        />
      </label>
    </div>
  );

  return (
    <ul className="space-y-2 md:hidden">
      {creating ? (
        <li className="rounded-2xl border border-primary/40 bg-surface p-4">
          {fields(newDraft, setNewDraft, 'new')}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" loading={savingNew} onClick={onSubmitCreate}>
              {t('item.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelCreate}>
              {t('item.cancel')}
            </Button>
          </div>
        </li>
      ) : null}
      {items.map((it) => {
        const editing = editingId === it.id;
        return (
          <li key={it.id} className={cn('rounded-2xl border border-line bg-surface p-4 shadow-card', !it.active && 'opacity-70')}>
            {editing ? (
              <>
                {fields(draft, setDraft, it.id)}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="primary" loading={savingEdit} onClick={() => onSaveEdit(it)}>
                    {t('item.save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                    {t('item.cancel')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink" lang="he">
                      {it.supplierNameRaw}
                    </p>
                    {!locked ? (
                      <p className="text-xs text-muted">{displayName(it.supplierName, it.supplierNameEn, locale).primary}</p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-base font-bold tabular-nums text-ink">{money(it.listPrice)}</p>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-subtle">{t('card.product')}</dt>
                  <dd className="truncate text-end">
                    {it.productId ? (
                      <Link
                        href={`/dashboard/products/${it.productId}`}
                        className="inline-flex min-h-6 max-w-full items-center truncate text-primary hover:underline [@media(pointer:coarse)]:min-h-[44px]"
                        lang="he"
                      >
                        {it.canonicalName ?? '—'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </dd>
                  <dt className="text-subtle">{t('columns.nameEn')}</dt>
                  <dd className="flex justify-end">
                    <EnglishNameCell productId={it.productId} value={it.productNameEn} canEdit={canEdit} onSaved={onRefresh} />
                  </dd>
                  <dt className="text-subtle">{t('card.sku')}</dt>
                  <dd className="text-end font-mono text-muted">{it.supplierSku ?? '—'}</dd>
                  <dt className="text-subtle">{t('card.unit')}</dt>
                  <dd className="text-end text-muted">
                    <UnitText unit={it.unit} />
                  </dd>
                </dl>
                {canEdit ? (
                  <div className="mt-3 flex items-center justify-end gap-1 border-t border-line pt-2">
                    {!it.active && <Badge tone="neutral" className="me-auto">{t('item.inactive')}</Badge>}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStartEdit(it)} aria-label={`${t('item.edit')}: ${it.supplierNameRaw}`}>
                      <Pencil className="h-4 w-4" aria-hidden="true" /> {t('item.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-pressed={!it.active}
                      onClick={() => onToggle(it)}
                      aria-label={`${it.active ? t('item.deactivate') : t('item.activate')}: ${it.supplierNameRaw}`}
                    >
                      <Power className={`h-4 w-4 ${it.active ? '' : 'text-subtle'}`} aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDelete(it)} aria-label={`${t('item.delete')}: ${it.supplierNameRaw}`}>
                      <Trash2 className="h-4 w-4 text-danger" aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Inline editor for the linked product's English name ("Receiver in English").
 * Click (or the + button) → input; Enter saves, Escape cancels. Saves through
 * the tenant-guarded `products.update` (manager+).
 */
function EnglishNameCell({
  productId,
  value,
  canEdit,
  onSaved,
}: {
  productId: string | null;
  value: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const t = useT(catalogNs);
  const tc = useT(components);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const save = trpc.products.update.useMutation({
    onSuccess: (_r, vars) => {
      setEditing(false);
      toast.success(vars.patch.nameEn ? t('nameEn.saved') : t('nameEn.cleared'));
      onSaved();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });

  if (!productId) return <span className="text-xs text-subtle" title={t('nameEn.noProduct')}>—</span>;

  if (!canEdit) {
    return value ? <span dir="ltr" lang="en" className="text-ink">{value}</span> : <span className="text-subtle">—</span>;
  }

  if (!editing) {
    return value ? (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="group inline-flex min-h-6 items-center gap-1.5 rounded text-start text-ink hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 [@media(pointer:coarse)]:min-h-[44px]"
        aria-label={`${t('nameEn.edit')}: ${value}`}
      >
        <span dir="ltr" lang="en">
          {value}
        </span>
        <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
      </button>
    ) : (
      <button
        type="button"
        onClick={() => {
          setDraft('');
          setEditing(true);
        }}
        className="inline-flex min-h-6 items-center gap-1 rounded text-xs text-subtle hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 [@media(pointer:coarse)]:min-h-[44px]"
      >
        <Languages className="h-3.5 w-3.5" aria-hidden="true" /> {t('nameEn.add')}
      </button>
    );
  }

  const commit = () => {
    const next = draft.trim();
    if (next === (value ?? '')) return setEditing(false);
    save.mutate({ productId, patch: { nameEn: next || null } });
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setEditing(false);
          }
        }}
        placeholder={t('nameEn.placeholder')}
        aria-label={t('nameEn.edit')}
        maxLength={200}
        dir="ltr"
        lang="en"
        autoFocus
        className="min-w-[9rem] py-1 text-sm"
      />
      <Button size="sm" variant="primary" loading={save.isPending} onClick={commit} aria-label={t('nameEn.save')} title={t('nameEn.save')}>
        <Check className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)} aria-label={t('nameEn.cancel')} title={t('nameEn.cancel')}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
