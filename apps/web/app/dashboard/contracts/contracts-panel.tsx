'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { FileSignature, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LinkButton,
  Select,
  Skeleton,
  displayName,
  friendlyError,
  useToast,
  type BadgeTone,
} from '@/lib/components';
import { UnitText } from '@/lib/components/UnitText';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { originalProps } from '@/lib/i18n/original';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { components } from '@/lib/i18n/messages/components';
import { ContractForm, type SupplierOption } from './contract-form';
import { contractStatus, contractWriteErrorKey, parsePrice } from './logic';

type Row = inferRouterOutputs<AppRouter>['contracts']['list'][number];

const STATUS_TONE: Record<ReturnType<typeof contractStatus>, BadgeTone> = {
  active: 'accent',
  upcoming: 'info',
  expired: 'neutral',
};

/**
 * Contract price list: supplier filter (hidden when `lockedSupplierId`), the
 * add form and the CSV/XLSX import link for owners/managers, and the table with
 * inline edit/delete. Read-only (bookkeeper) when `canManage` is false.
 */
export function ContractsPanel({
  suppliers,
  canManage,
  lockedSupplierId,
}: {
  suppliers: SupplierOption[];
  canManage: boolean;
  lockedSupplierId?: string;
}) {
  const t = useT(contractsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [filter, setFilter] = useState(lockedSupplierId ?? '');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ price: '', unit: '', validFrom: '', validTo: '', note: '' });
  const [rowError, setRowError] = useState<string | null>(null);

  const list = trpc.contracts.list.useQuery(filter ? { supplierId: filter } : {});
  const update = trpc.contracts.update.useMutation();
  const remove = trpc.contracts.delete.useMutation();

  const money = (v: string | number) => formatIls(Number(v), { locale, maximumFractionDigits: 4 });
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
    const value = parsePrice(draft.price);
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
    const product = displayName(r.productName, r.productNameEn, locale).primary;
    if (!window.confirm(t('list.confirmDelete', { product }))) return;
    try {
      await remove.mutateAsync({ id: r.id });
      toast.success(t('list.deleted'));
      refreshAll();
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {lockedSupplierId ? (
          <span />
        ) : (
          <Field label={t('list.filterLabel')} htmlFor="contracts-filter" className="w-full sm:w-72">
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
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton href={importHref} size="sm" variant="secondary">
              <Upload className="h-4 w-4" aria-hidden="true" /> {t('list.import')}
            </LinkButton>
            {!adding ? (
              <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
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
            router.refresh();
          }}
        />
      ) : null}

      {list.isLoading ? (
        <div className="space-y-2" aria-label={t('list.loading')}>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : list.error ? (
        <p role="alert" className="text-sm text-danger">
          {friendlyError(list.error, tc)}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FileSignature className="h-6 w-6" />}
          title={t('list.emptyTitle')}
          description={t('list.emptyBody')}
        />
      ) : (
        <Card elevated padding="none" flow className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">{t('list.caption')}</caption>
            <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wider text-subtle">
              <tr>
                {lockedSupplierId ? null : (
                  <th scope="col" className="p-3 text-start font-semibold">{t('list.colSupplier')}</th>
                )}
                <th scope="col" className="p-3 text-start font-semibold">{t('list.colProduct')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('list.colPrice')}</th>
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
              {rows.map((r) => {
                const isEditing = editing === r.id;
                const status = contractStatus(r.validFrom, r.validTo);
                const supplier = displayName(r.supplierName, r.supplierNameEn, locale);
                const product = displayName(r.productName, r.productNameEn, locale);
                return (
                  <tr key={r.id} className="border-t border-line align-top transition-colors hover:bg-surface-2/60">
                    {lockedSupplierId ? null : (
                      <td className="p-3 text-muted" {...originalProps(supplier.primary)}>
                        {supplier.primary}
                      </td>
                    )}
                    <td className="p-3">
                      <div className="font-medium text-ink" {...originalProps(product.primary)}>
                        {product.primary}
                      </div>
                      {product.secondary ? (
                        <div className="text-xs text-subtle" lang="he">
                          {product.secondary}
                        </div>
                      ) : null}
                      {r.note && !isEditing ? (
                        <div className="mt-0.5 text-xs text-subtle" {...originalProps(r.note)}>
                          {r.note}
                        </div>
                      ) : null}
                      {isEditing ? (
                        <Input
                          aria-label={t('form.note')}
                          className="mt-2"
                          value={draft.note}
                          maxLength={500}
                          placeholder={t('form.note')}
                          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                        />
                      ) : null}
                    </td>
                    <td className="p-3 font-mono tabular-nums text-ink">
                      {isEditing ? (
                        <Input
                          aria-label={t('form.price')}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          dir="ltr"
                          className="w-28"
                          value={draft.price}
                          onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                        />
                      ) : (
                        <bdi dir="ltr">{money(r.contractPrice)}</bdi>
                      )}
                    </td>
                    <td className="p-3 text-muted">
                      {isEditing ? (
                        <Input
                          aria-label={t('form.unit')}
                          className="w-24"
                          value={draft.unit}
                          maxLength={32}
                          placeholder={r.productUnit ?? ''}
                          onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                        />
                      ) : (
                        <UnitText unit={r.unit ?? r.productUnit} />
                      )}
                    </td>
                    <td className="p-3 text-muted">
                      {isEditing ? (
                        <div className="flex flex-col gap-1">
                          <Input
                            aria-label={t('form.validFrom')}
                            type="date"
                            value={draft.validFrom}
                            onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })}
                          />
                          <Input
                            aria-label={t('form.validTo')}
                            type="date"
                            value={draft.validTo}
                            min={draft.validFrom}
                            onChange={(e) => setDraft({ ...draft, validTo: e.target.value })}
                          />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="whitespace-nowrap tabular-nums">
                            {r.validTo
                              ? t('list.validRange', { from: day(r.validFrom), to: day(r.validTo) })
                              : t('list.validOpen', { from: day(r.validFrom) })}
                          </div>
                          <Badge tone={STATUS_TONE[status]}>{t(`list.status.${status}`)}</Badge>
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge tone={r.source === 'import' ? 'info' : 'neutral'}>
                        {t(r.source === 'import' ? 'list.source.import' : 'list.source.manual')}
                      </Badge>
                    </td>
                    {canManage ? (
                      <td className="p-3">
                        {isEditing ? (
                          <div className="flex flex-col items-start gap-1">
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="primary" loading={update.isPending} onClick={() => saveEdit(r)}>
                                {t('list.save')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={t('list.cancel')}
                                onClick={() => setEditing(null)}
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </div>
                            {rowError ? (
                              <p role="alert" className="max-w-[14rem] text-xs text-danger">
                                {rowError}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              title={t('list.edit')}
                              aria-label={t('list.edit')}
                              onClick={() => startEdit(r)}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title={t('list.delete')}
                              aria-label={t('list.delete')}
                              disabled={remove.isPending}
                              onClick={() => del(r)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-line p-3 text-xs text-subtle">
            {t('list.count', { count: formatNumber(rows.length, locale) })}
          </p>
        </Card>
      )}
    </div>
  );
}
