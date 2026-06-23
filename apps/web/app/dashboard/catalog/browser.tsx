'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Boxes, Pencil, Plus, Power, Search, Trash2, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, EmptyState, Input, Spinner } from '@/lib/components';
import { formatIls } from '@/lib/money';

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
    listPrice: it.listPrice != null ? String(it.listPrice) : '',
  };
}

function priceToNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

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
  const [supplierId, setSupplierId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [showInactive, setShowInactive] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const locked = !!lockedSupplierId;
  const effectiveSupplierId = lockedSupplierId ?? (supplierId || undefined);

  const q = trpc.catalog.items.useQuery(
    {
      supplierId: effectiveSupplierId,
      search: search.trim() || undefined,
      limit,
      includeInactive: showInactive || undefined,
    },
    {
      // `initial` is the active-only first page → only reuse it for that exact view.
      initialData:
        !search.trim() && limit === PAGE && !showInactive && (locked || !supplierId)
          ? initial
          : undefined,
    },
  );

  const refresh = () => void q.refetch();
  const onError = (e: { message: string }) => setError(e.message || 'הפעולה נכשלה.');

  const update = trpc.catalog.updateItem.useMutation({
    onSuccess: () => {
      setEditingId(null);
      setError(null);
      refresh();
    },
    onError,
  });
  const create = trpc.catalog.createItem.useMutation({
    onSuccess: () => {
      setCreating(false);
      setNewDraft(EMPTY_DRAFT);
      setError(null);
      refresh();
    },
    onError,
  });
  const remove = trpc.catalog.deleteItem.useMutation({ onSuccess: refresh, onError });
  const toggle = trpc.catalog.setItemActive.useMutation({ onSuccess: refresh, onError });

  const items = q.data ?? [];
  const hasMore = items.length >= limit;
  const busy = update.isPending || create.isPending || remove.isPending || toggle.isPending;

  function startEdit(it: CatalogItem) {
    setEditingId(it.id);
    setDraft(draftFrom(it));
    setError(null);
  }

  function saveEdit(it: CatalogItem) {
    update.mutate({
      itemId: it.id,
      patch: {
        supplierNameRaw: draft.supplierNameRaw.trim(),
        supplierSku: draft.supplierSku.trim() || null,
        unit: draft.unit.trim() || null,
        listPrice: priceToNumber(draft.listPrice),
      },
    });
  }

  function submitCreate() {
    if (!effectiveSupplierId) return;
    const price = priceToNumber(newDraft.listPrice);
    create.mutate({
      supplierId: effectiveSupplierId,
      supplierNameRaw: newDraft.supplierNameRaw.trim(),
      ...(newDraft.supplierSku.trim() ? { supplierSku: newDraft.supplierSku.trim() } : {}),
      ...(newDraft.unit.trim() ? { unit: newDraft.unit.trim() } : {}),
      ...(price != null ? { listPrice: price } : {}),
    });
  }

  // Columns: [supplier?] desc, product, sku, unit, price, actions
  const colCount = (locked ? 0 : 1) + 5 + (canEdit ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {!locked && (
          <div className="min-w-[12rem]">
            <label className="mb-1.5 block text-sm font-medium text-muted" htmlFor="cat-supplier">
              ספק
            </label>
            <select
              id="cat-supplier"
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setLimit(PAGE);
                setCreating(false);
              }}
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink focus:border-primary/50 focus:outline-none"
            >
              <option value="">כל הספקים</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="relative min-w-[16rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-muted" htmlFor="cat-search">
            חיפוש
          </label>
          <Search
            className="pointer-events-none absolute bottom-2.5 right-3 h-4 w-4 text-subtle"
            aria-hidden
          />
          <Input
            id="cat-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="שם מוצר / מק״ט"
            className="pr-9"
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => {
              setShowInactive(e.target.checked);
              setLimit(PAGE);
            }}
          />
          הצג לא פעילים
        </label>
        {canEdit && effectiveSupplierId && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCreating((c) => !c);
              setNewDraft(EMPTY_DRAFT);
              setError(null);
            }}
          >
            <Plus className="h-4 w-4" /> הוסף פריט
          </Button>
        )}
      </div>

      {canEdit && !effectiveSupplierId && (
        <p className="text-xs text-subtle">בחרו ספק כדי להוסיף פריט קטלוג חדש.</p>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      )}

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted">
          <Spinner className="h-4 w-4" /> טוען קטלוג…
        </div>
      ) : items.length === 0 && !creating ? (
        <EmptyState
          icon={<Boxes className="h-6 w-6" />}
          title="הקטלוג ריק"
          description="ייבאו מחירון ספק מקובץ Excel/CSV, או הוסיפו פריט ידנית."
        />
      ) : (
        <Card elevated padding="none" className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
                {!locked && <th className="px-4 py-3 font-medium">ספק</th>}
                <th className="px-4 py-3 font-medium">תיאור הספק</th>
                <th className="px-4 py-3 font-medium">מוצר</th>
                <th className="px-4 py-3 font-medium">מק״ט</th>
                <th className="px-4 py-3 font-medium">יחידה</th>
                <th className="px-4 py-3 font-medium">מחיר מחירון</th>
                {canEdit && <th className="px-4 py-3 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {creating && (
                <tr className="border-b border-line/60 bg-surface-2/40">
                  {!locked && <td className="px-4 py-2 text-subtle">חדש</td>}
                  <td className="px-4 py-2">
                    <Input
                      value={newDraft.supplierNameRaw}
                      onChange={(e) => setNewDraft({ ...newDraft, supplierNameRaw: e.target.value })}
                      placeholder="תיאור הספק *"
                    />
                  </td>
                  <td className="px-4 py-2 text-subtle">—</td>
                  <td className="px-4 py-2">
                    <Input
                      value={newDraft.supplierSku}
                      onChange={(e) => setNewDraft({ ...newDraft, supplierSku: e.target.value })}
                      placeholder="מק״ט"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      value={newDraft.unit}
                      onChange={(e) => setNewDraft({ ...newDraft, unit: e.target.value })}
                      placeholder="יח׳"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      value={newDraft.listPrice}
                      onChange={(e) => setNewDraft({ ...newDraft, listPrice: e.target.value })}
                      placeholder="₪"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="primary"
                        loading={create.isPending}
                        disabled={!newDraft.supplierNameRaw.trim()}
                        onClick={submitCreate}
                      >
                        שמור
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )}

              {items.map((it) => {
                const editing = editingId === it.id;
                return (
                  <tr
                    key={it.id}
                    className="border-b border-line/60 last:border-0 hover:bg-surface-2/60"
                  >
                    {!locked && <td className="px-4 py-3 text-muted">{it.supplierName}</td>}
                    <td className="px-4 py-3 text-ink">
                      {editing ? (
                        <Input
                          value={draft.supplierNameRaw}
                          onChange={(e) => setDraft({ ...draft, supplierNameRaw: e.target.value })}
                        />
                      ) : (
                        it.supplierNameRaw
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {it.productId ? (
                        <Link
                          href={`/dashboard/products/${it.productId}`}
                          className="text-primary hover:underline"
                        >
                          {it.canonicalName ?? '—'}
                        </Link>
                      ) : (
                        (it.canonicalName ?? '—')
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-subtle">
                      {editing ? (
                        <Input
                          value={draft.supplierSku}
                          onChange={(e) => setDraft({ ...draft, supplierSku: e.target.value })}
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
                        />
                      ) : (
                        (it.unit ?? '—')
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-ink">
                      {editing ? (
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          value={draft.listPrice}
                          onChange={(e) => setDraft({ ...draft, listPrice: e.target.value })}
                        />
                      ) : it.listPrice != null ? (
                        formatIls(Number(it.listPrice), { maximumFractionDigits: 2 })
                      ) : (
                        '—'
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        {editing ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="primary"
                              loading={update.isPending}
                              disabled={!draft.supplierNameRaw.trim()}
                              onClick={() => saveEdit(it)}
                            >
                              שמור
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            {!it.active && <Badge tone="neutral">לא פעיל</Badge>}
                            <Button
                              size="sm"
                              variant="ghost"
                              title="ערוך"
                              disabled={busy}
                              onClick={() => startEdit(it)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title={it.active ? 'השבת' : 'הפעל'}
                              disabled={busy}
                              onClick={() => toggle.mutate({ itemId: it.id, active: !it.active })}
                            >
                              <Power className={`h-4 w-4 ${it.active ? '' : 'text-subtle'}`} />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="מחק"
                              disabled={busy}
                              onClick={() => {
                                if (confirm(`למחוק את "${it.supplierNameRaw}" מהקטלוג?`)) {
                                  remove.mutate({ itemId: it.id });
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-danger" />
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
                    מוסיפים את הפריט הראשון…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            loading={q.isFetching}
            onClick={() => setLimit((l) => l + PAGE)}
          >
            טען עוד
          </Button>
        </div>
      )}
    </div>
  );
}
