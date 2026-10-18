'use client';

import { useState } from 'react';
import { UnitText } from '@/lib/components/UnitText';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  displayName,
  friendlyError,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { products as productsNs } from '@/lib/i18n/messages/products';
import { formatIls } from '@/lib/money';
import { productPatch, type ProductFormState } from '../product-logic';

type Outputs = inferRouterOutputs<AppRouter>;
type Detail = NonNullable<Outputs['catalog']['productDetail']>;
type Supplier = Outputs['suppliers']['list'][number];

export function ProductEditor({
  detail,
  suppliers,
  canEdit,
}: {
  detail: Detail;
  suppliers: Supplier[];
  canEdit: boolean;
}) {
  const t = useT(productsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const p = detail.product;

  const initial: ProductFormState = {
    canonicalName: p.canonicalName,
    nameEn: p.nameEn ?? '',
    category: p.category ?? '',
    defaultUnit: p.defaultUnit ?? '',
    barcodeEan: p.barcodeEan ?? '',
    supplierId: p.supplierId ?? '',
  };
  const [form, setForm] = useState<ProductFormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ProductFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const update = trpc.products.update.useMutation({
    onSuccess: () => {
      toast.success(t('form.saved'));
      router.refresh();
    },
    onError: (e) => setError(friendlyError(e, tc)),
  });
  const del = trpc.products.delete.useMutation({
    onSuccess: () => {
      toast.success(t('form.deleted'));
      router.push('/dashboard/catalog');
    },
    onError: (e) => setError(friendlyError(e, tc, { CONFLICT: t('form.deleteBlocked') })),
  });

  function save() {
    setError(null);
    if (!form.canonicalName.trim()) return setError(t('form.nameRequired'));
    const patch = productPatch(initial, form);
    if (!patch) return setError(t('form.noChanges'));
    update.mutate({ productId: p.id, patch });
  }

  const supplierName = (id: string, he: string, en?: string | null) =>
    displayName(he, en ?? suppliers.find((s) => s.id === id)?.nameEn, locale).primary;
  const prices = detail.items.map((it) => Number(it.listPrice)).filter((n) => Number.isFinite(n) && n > 0);
  const cheapest = prices.length > 1 ? Math.min(...prices) : null;
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const money = (v: string | number | null) =>
    v != null ? formatIls(Number(v), { locale, maximumFractionDigits: 2 }) : '—';

  return (
    <div className="space-y-6">
      <Card flow elevated padding="lg">
        <h2 className="mb-4 text-base font-bold text-ink">{t('form.title')}</h2>
        {!canEdit ? <p className="mb-4 text-xs text-subtle">{t('form.readOnly')}</p> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          noValidate
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('form.name')} htmlFor="pr-name">
              <Input
                id="pr-name"
                value={form.canonicalName}
                onChange={set('canonicalName')}
                disabled={!canEdit}
                required
                maxLength={200}
                lang="he"
              />
            </Field>
            <Field label={t('form.nameEn')} htmlFor="pr-name-en" hint={t('form.nameEnHint')}>
              <Input
                id="pr-name-en"
                value={form.nameEn}
                onChange={set('nameEn')}
                disabled={!canEdit}
                maxLength={200}
                dir="ltr"
                lang="en"
                placeholder={t('form.nameEnPlaceholder')}
                aria-describedby="pr-name-en-hint"
              />
            </Field>
            <Field label={t('form.category')} htmlFor="pr-cat">
              <Input id="pr-cat" value={form.category} onChange={set('category')} disabled={!canEdit} maxLength={100} />
            </Field>
            <Field label={t('form.unit')} htmlFor="pr-unit">
              <Input
                id="pr-unit"
                value={form.defaultUnit}
                onChange={set('defaultUnit')}
                disabled={!canEdit}
                maxLength={32}
                placeholder={t('form.unitPlaceholder')}
              />
            </Field>
            <Field label={t('form.barcode')} htmlFor="pr-barcode">
              <Input
                id="pr-barcode"
                value={form.barcodeEan}
                onChange={set('barcodeEan')}
                disabled={!canEdit}
                maxLength={32}
                inputMode="numeric"
                dir="ltr"
              />
            </Field>
            <Field label={t('form.supplier')} htmlFor="pr-supplier" hint={t('form.supplierHint')}>
              <Select
                id="pr-supplier"
                value={form.supplierId}
                onChange={set('supplierId')}
                disabled={!canEdit}
                aria-describedby="pr-supplier-hint"
              >
                <option value="">{t('form.noSupplier')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {displayName(s.name, s.nameEn, locale).primary}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}

          {canEdit && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" size="sm" loading={update.isPending}>
                {t('form.save')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={del.isPending}
                onClick={() => {
                  if (confirm(t('form.confirmDelete', { name: p.canonicalName }))) del.mutate({ productId: p.id });
                }}
              >
                <Trash2 className="h-4 w-4 text-danger" aria-hidden="true" /> {t('form.delete')}
              </Button>
            </div>
          )}
        </form>
      </Card>

      <section aria-labelledby="pr-prices">
        <h2 id="pr-prices" className="mb-3 text-base font-bold text-ink">
          {t('prices.title')}
        </h2>
        <Card elevated padding="none" className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-start text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
                <th scope="col" className="px-4 py-3 text-start font-medium">{t('prices.supplier')}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium">{t('prices.sku')}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium">{t('prices.unit')}</th>
                <th scope="col" className="px-4 py-3 text-end font-medium">{t('prices.listPrice')}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium">{t('prices.status')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3 text-ink">
                    <Link
                      href={`/dashboard/suppliers/${it.supplierId}?tab=catalog`}
                      className="rounded hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      {supplierName(it.supplierId, it.supplierName, it.supplierNameEn)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-subtle">{it.supplierSku ?? '—'}</td>
                  <td className="px-4 py-3 text-muted">
                    <UnitText unit={it.unit} />
                  </td>
                  <td className="px-4 py-3 text-end font-mono tabular-nums text-ink">
                    {money(it.listPrice)}
                    {cheapest != null && Number(it.listPrice) === cheapest ? (
                      <Badge tone="accent" className="ms-2">
                        {t('prices.cheapest')}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={it.active ? 'accent' : 'neutral'}>
                      {it.active ? t('prices.active') : t('prices.inactive')}
                    </Badge>
                  </td>
                </tr>
              ))}
              {detail.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-subtle">
                    {t('prices.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>

      <section aria-labelledby="pr-history">
        <h2 id="pr-history" className="mb-3 text-base font-bold text-ink">
          {t('history.title')}
        </h2>
        <Card elevated padding="none" className="overflow-x-auto">
          {detail.history.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-subtle">{t('history.empty')}</p>
          ) : (
            <table className="w-full min-w-[420px] text-start text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('history.date')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('history.supplier')}</th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">{t('history.unitPrice')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.history.map((h, i) => {
                  const s = h.supplierId ? supplierById.get(h.supplierId) : undefined;
                  return (
                    <tr key={i} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2.5 tabular-nums text-muted">
                        {formatDate(h.observedAt, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2.5 text-ink">
                        {s ? displayName(s.name, s.nameEn, locale).primary : t('history.unknownSupplier')}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums text-ink">{money(h.unitPrice)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </section>
    </div>
  );
}
