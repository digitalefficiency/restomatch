'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { FileSignature, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DeadlineChip,
  EmptyState,
  Field,
  Input,
  LinkButton,
  Money,
  Select,
  Skeleton,
  displayName,
  friendlyError,
  useToast,
  type BadgeTone,
} from '@/lib/components';
import { UnitText } from '@/lib/components/UnitText';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { originalProps } from '@/lib/i18n/original';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { components } from '@/lib/i18n/messages/components';
import { ContractForm, type SupplierOption } from './contract-form';
import { EXPIRY_WARN_DAYS, contractStatus, contractWriteErrorKey, daysUntil, matchesSearch, parseContractPrice, todayIso } from './logic';

type Row = inferRouterOutputs<AppRouter>['contracts']['list'][number];

const STATUS_TONE: Record<ReturnType<typeof contractStatus>, BadgeTone> = {
  active: 'accent',
  upcoming: 'info',
  expired: 'neutral',
};

/**
 * Contract price list: supplier filter (hidden when `lockedSupplierId`), a
 * product search, the add form and the CSV/XLSX import link for
 * owners/managers. W2-12: grouped by supplier with expiry chips (≤30 days), a
 * right-aligned table on desktop and cards on phone (no sideways scroll),
 * inline edit with a ₪ text field, ConfirmDialog for delete. Read-only
 * (bookkeeper) when `canManage` is false.
 */
export function ContractsPanel({
  suppliers,
  canManage,
  lockedSupplierId,
  startAdding = false,
}: {
  suppliers: SupplierOption[];
  canManage: boolean;
  lockedSupplierId?: string;
  /** Open the add form on first render (the queue's empty-state CTA). */
  startAdding?: boolean;
}) {
  const t = useT(contractsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [filter, setFilter] = useState(lockedSupplierId ?? '');
  const [adding, setAdding] = useState(startAdding && canManage);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<Row | null>(null);
  const [draft, setDraft] = useState<{ price: string; unit: string; validFrom: string; validTo: string; note: string }>({
    price: '',
    unit: '',
    validFrom: '',
    validTo: '',
    note: '',
  });
  const [rowError, setRowError] = useState<string | null>(null);

  const list = trpc.contracts.list.useQuery(filter ? { supplierId: filter } : {});
  const update = trpc.contracts.update.useMutation();
  const remove = trpc.contracts.delete.useMutation();

  const day = (d: string) => formatDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const importHref = `/dashboard/contracts/import${filter ? `?supplierId=${encodeURIComponent(filter)}` : ''}`;

  function refreshAll() {
    void utils.contracts.list.invalidate();
    // The over-contract card is server-rendered — refresh it too.
    router.refresh();
  }

  function startEdit(r: Row) {
    setRowError(null);
    setEditing(r.id);
    setDraft({
      price: String(Number(r.contractPrice)),
      unit: r.unit ?? '',
      validFrom: r.validFrom,
      validTo: r.validTo ?? '',
      note: r.note ?? '',
    });
  }

  async function saveEdit(r: Row) {
    setRowError(null);
    const value = parseContractPrice(draft.price);
    if (value === null) return setRowError(t('form.errors.price'));
    if (!draft.validFrom) return setRowError(t('form.errors.required'));
    if (draft.validTo && draft.validTo < draft.validFrom) return setRowError(t('form.errors.range'));
    try {
      await update.mutateAsync({
        id: r.id,
        contractPrice: value,
        unit: draft.unit.trim() || null,
        validFrom: draft.validFrom,
        validTo: draft.validTo || null,
        note: draft.note.trim() || null,
      });
      toast.success(t('list.saved'));
      setEditing(null);
      refreshAll();
    } catch (err) {
      const key = contractWriteErrorKey(err);
      setRowError(key ? t(`form.errors.${key}`) : friendlyError(err, tc));
    }
  }

  async function del(r: Row) {
    try {
      await remove.mutateAsync({ id: r.id });
      setConfirming(null);
      toast.success(t('list.deleted'));
      refreshAll();
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  const rows = list.data ?? [];
  const today = todayIso();
  const shown = rows.filter((r) => matchesSearch(query, r.productName, r.productNameEn));
  const groups = useMemo(() => {
    const m = new Map<string, { supplierId: string; name: string; nameEn: string | null; rows: Row[] }>();
    for (const r of shown) {
      const g = m.get(r.supplierId) ?? { supplierId: r.supplierId, name: r.supplierName, nameEn: r.supplierNameEn, rows: [] };
      g.rows.push(r);
      m.set(r.supplierId, g);
    }
    return [...m.values()];
  }, [shown]);

  function validity(r: Row) {
    const status = contractStatus(r.validFrom, r.validTo, today);
    const left = daysUntil(r.validTo, today);
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="whitespace-nowrap">
          {r.validTo
            ? t('list.validRange', { from: day(r.validFrom), to: day(r.validTo) })
            : t('list.validOpen', { from: day(r.validFrom) })}
        </span>
        {left !== null && left <= EXPIRY_WARN_DAYS ? (
          <DeadlineChip due={r.validTo!} />
        ) : status !== 'active' ? (
          <Badge tone={STATUS_TONE[status]}>{t(`list.status.${status}`)}</Badge>
        ) : null}
      </div>
    );
  }

  function editFields(r: Row) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('form.price')} htmlFor={`edit-price-${r.id}`}>
          <Input
            id={`edit-price-${r.id}`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="text-right"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          />
        </Field>
        <Field label={t('form.unit')} htmlFor={`edit-unit-${r.id}`}>
          <Input
            id={`edit-unit-${r.id}`}
            value={draft.unit}
            maxLength={32}
            placeholder={r.productUnit ?? ''}
            onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
          />
        </Field>
        <Field label={t('form.validFrom')} htmlFor={`edit-from-${r.id}`}>
          <Input id={`edit-from-${r.id}`} type="date" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} />
        </Field>
        <Field label={t('form.validTo')} htmlFor={`edit-to-${r.id}`}>
          <Input
            id={`edit-to-${r.id}`}
            type="date"
            value={draft.validTo}
            min={draft.validFrom}
            onChange={(e) => setDraft({ ...draft, validTo: e.target.value })}
          />
        </Field>
        <Field label={t('form.note')} htmlFor={`edit-note-${r.id}`} className="sm:col-span-2">
          <Input id={`edit-note-${r.id}`} value={draft.note} maxLength={500} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </Field>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button size="md" variant="primary" loading={update.isPending} onClick={() => saveEdit(r)}>
            {t('list.save')}
          </Button>
          <Button size="md" variant="ghost" onClick={() => setEditing(null)}>
            <X className="h-4 w-4" aria-hidden="true" /> {t('list.cancel')}
          </Button>
          {rowError ? (
            <p role="alert" className="text-sm text-danger">
              {rowError}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  function rowButtons(r: Row) {
    if (!canManage) return null;
    return (
      <div className="flex items-center gap-1">
        <Button size="md" variant="ghost" title={t('list.edit')} aria-label={t('list.edit')} onClick={() => startEdit(r)}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          size="md"
          variant="ghost"
          title={t('list.delete')}
          aria-label={t('list.delete')}
          disabled={remove.isPending}
          onClick={() => setConfirming(r)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
          {lockedSupplierId ? null : (
            <Field label={t('list.filterLabel')} htmlFor="contracts-filter" className="w-full sm:w-64">
              <Select id="contracts-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">{t('list.allSuppliers')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {displayName(s.name, s.nameEn, locale).primary}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('list.search')} htmlFor="contracts-search" className="w-full sm:w-64">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <Input id="contracts-search" type="search" className="ps-9" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </Field>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton href={importHref} variant="secondary" icon={<Upload className="h-4 w-4" aria-hidden="true" />}>
              {t('list.import')}
            </LinkButton>
            {!adding ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" /> {t('list.add')}
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-subtle">{t('readOnly')}</p>
        )}
      </div>

      {canManage && adding ? (
        <ContractForm
          suppliers={suppliers}
          fixedSupplierId={lockedSupplierId}
          onDone={() => {
            setAdding(false);
            refreshAll();
          }}
        />
      ) : null}

      {list.isLoading ? (
        <div className="space-y-2" role="status" aria-label={t('list.loading')}>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : list.error ? (
        <EmptyState
          kind="error"
          title={friendlyError(list.error, tc)}
          action={
            <Button variant="secondary" onClick={() => void list.refetch()}>
              {t('queue.retry')}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        canManage ? (
          <EmptyState
            kind="first-use"
            icon={<FileSignature className="h-6 w-6" />}
            title={t('list.emptyTitle')}
            description={t('list.emptyBody')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => setAdding(true)}>
                  {t('queue.addContract')}
                </Button>
                <LinkButton href={importHref} variant="secondary">
                  {t('queue.importList')}
                </LinkButton>
              </div>
            }
          />
        ) : (
          <EmptyState icon={<FileSignature className="h-6 w-6" />} title={t('list.emptyTitle')} description={t('list.emptyBody')} />
        )
      ) : shown.length === 0 ? (
        <EmptyState
          kind="no-results"
          title={t('list.noResults')}
          action={
            <Button variant="secondary" onClick={() => setQuery('')}>
              {t('list.clearSearch')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const supplier = displayName(g.name, g.nameEn, locale);
            return (
              <section key={g.supplierId} aria-labelledby={`grp-${g.supplierId}`}>
                {lockedSupplierId ? null : (
                  <h3 id={`grp-${g.supplierId}`} className="mb-2 flex items-baseline gap-2 text-base font-semibold text-ink">
                    <span {...originalProps(supplier.primary)}>{supplier.primary}</span>
                    <span className="text-xs font-normal text-subtle">{t('list.groupCount', { count: g.rows.length })}</span>
                  </h3>
                )}
                {/* Desktop: a table with right-aligned numbers. */}
                <Card padding="none" className="hidden md:block">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      {t('list.caption')} · {supplier.primary}
                    </caption>
                    <thead className="border-b border-line bg-surface-2 text-xs text-subtle">
                      <tr>
                        <th scope="col" className="p-3 text-start font-semibold">{t('list.colProduct')}</th>
                        <th scope="col" className="p-3 text-right font-semibold">{t('list.colPrice')}</th>
                        <th scope="col" className="p-3 text-start font-semibold">{t('list.colUnit')}</th>
                        <th scope="col" className="p-3 text-start font-semibold">{t('list.colValid')}</th>
                        <th scope="col" className="p-3 text-start font-semibold">{t('list.colSource')}</th>
                        {canManage ? (
                          <th scope="col" className="p-3 text-start font-semibold">
                            <span className="sr-only">{t('list.colActions')}</span>
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => {
                        const product = displayName(r.productName, r.productNameEn, locale);
                        if (editing === r.id) {
                          return (
                            <tr key={r.id} className="border-t border-line">
                              <td colSpan={canManage ? 6 : 5} className="p-3">
                                <p className="mb-2 font-medium text-ink">{product.primary}</p>
                                {editFields(r)}
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={r.id} className="border-t border-line align-top">
                            <td className="p-3">
                              <div className="font-medium text-ink" {...originalProps(product.primary)}>
                                {product.primary}
                              </div>
                              {product.secondary ? (
                                <div className="text-xs text-subtle" lang="he">
                                  {product.secondary}
                                </div>
                              ) : null}
                              {r.note ? (
                                <div className="mt-0.5 text-xs text-subtle" {...originalProps(r.note)}>
                                  {r.note}
                                </div>
                              ) : null}
                            </td>
                            <td className="p-3 text-right font-semibold text-ink">
                              <Money value={Number(r.contractPrice)} context="unit" />
                            </td>
                            <td className="p-3 text-muted">
                              <UnitText unit={r.unit ?? r.productUnit} />
                            </td>
                            <td className="p-3 text-muted">{validity(r)}</td>
                            <td className="p-3">
                              <span className="text-xs text-subtle">
                                {t(r.source === 'import' ? 'list.source.import' : 'list.source.manual')}
                              </span>
                            </td>
                            {canManage ? <td className="p-3">{rowButtons(r)}</td> : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
                {/* Phone: cards, ₪ and actions on screen at 390. */}
                <ul className="space-y-2 md:hidden">
                  {g.rows.map((r) => {
                    const product = displayName(r.productName, r.productNameEn, locale);
                    return (
                      <li key={r.id}>
                        <Card padding="sm">
                          {editing === r.id ? (
                            <>
                              <p className="mb-2 font-medium text-ink">{product.primary}</p>
                              {editFields(r)}
                            </>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 font-medium text-ink" {...originalProps(product.primary)}>
                                  {product.primary}
                                </p>
                                <p className="shrink-0 text-right font-semibold">
                                  <Money value={Number(r.contractPrice)} context="unit" />{' '}
                                  <span className="text-xs font-normal text-muted">
                                    <UnitText unit={r.unit ?? r.productUnit} empty="" />
                                  </span>
                                </p>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                                {validity(r)}
                                {rowButtons(r)}
                              </div>
                            </>
                          )}
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <p className="text-xs text-subtle">{t('list.count', { count: formatNumber(shown.length, locale) })}</p>
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming
            ? t('list.confirmDelete', { product: displayName(confirming.productName, confirming.productNameEn, locale).primary })
            : ''
        }
        body={t('list.confirmDeleteBody')}
        confirmLabel={t('list.delete')}
        cancelLabel={t('list.cancel')}
        loading={remove.isPending}
        onConfirm={() => confirming && void del(confirming)}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
