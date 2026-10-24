'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, Field, Input, Select, displayName, friendlyError, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { components } from '@/lib/i18n/messages/components';
import { contractWriteErrorKey, parsePrice, todayIso } from './logic';

export interface SupplierOption {
  id: string;
  name: string;
  nameEn?: string | null;
}

/**
 * "Add contract price" form: supplier → product (own products first, from
 * contracts.productOptions) → price, unit, valid from/to, note. With
 * `fixedSupplierId` (the supplier page) the supplier select is hidden.
 */
export function ContractForm({
  suppliers,
  fixedSupplierId,
  onDone,
}: {
  suppliers: SupplierOption[];
  fixedSupplierId?: string;
  onDone: () => void;
}) {
  const t = useT(contractsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();

  const [supplierId, setSupplierId] = useState(fixedSupplierId ?? '');
  const [productId, setProductId] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('');
  const [validFrom, setValidFrom] = useState(todayIso());
  const [validTo, setValidTo] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const products = trpc.contracts.productOptions.useQuery({ supplierId }, { enabled: !!supplierId });
  const create = trpc.contracts.create.useMutation();

  const own = (products.data ?? []).filter((p) => p.own);
  const other = (products.data ?? []).filter((p) => !p.own);
  const selected = products.data?.find((p) => p.id === productId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = parsePrice(price);
    if (!supplierId || !productId || !validFrom) return setError(t('form.errors.required'));
    if (value === null) return setError(t('form.errors.price'));
    if (validTo && validTo < validFrom) return setError(t('form.errors.range'));
    try {
      await create.mutateAsync({
        supplierId,
        productId,
        contractPrice: value,
        unit: unit.trim() || null,
        validFrom,
        validTo: validTo || null,
        note: note.trim() || null,
      });
      toast.success(t('form.created'));
      void utils.contracts.list.invalidate();
      setProductId('');
      setPrice('');
      setUnit('');
      setNote('');
      onDone();
    } catch (err) {
      const key = contractWriteErrorKey(err);
      setError(key ? t(`form.errors.${key}`) : friendlyError(err, tc));
    }
  }

  const productLabel = (p: { name: string; nameEn: string | null }) => displayName(p.name, p.nameEn, locale).primary;

  return (
    <Card elevated flow>
      <form onSubmit={submit} noValidate>
        <h2 className="mb-4 text-base font-semibold text-ink">{t('form.title')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fixedSupplierId ? null : (
            <Field label={t('form.supplier')} htmlFor="cf-supplier">
              <Select
                id="cf-supplier"
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value);
                  setProductId('');
                }}
              >
                <option value="">{t('form.pickSupplier')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {displayName(s.name, s.nameEn, locale).primary}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('form.product')} htmlFor="cf-product">
            <Select
              id="cf-product"
              value={productId}
              disabled={!supplierId || products.isLoading}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">
                {!supplierId
                  ? t('form.pickSupplierFirst')
                  : products.isLoading
                    ? t('form.loadingProducts')
                    : t('form.pickProduct')}
              </option>
              {own.length > 0 ? (
                <optgroup label={t('form.ownProducts')}>
                  {own.map((p) => (
                    <option key={p.id} value={p.id}>
                      {productLabel(p)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {other.length > 0 ? (
                <optgroup label={t('form.otherProducts')}>
                  {other.map((p) => (
                    <option key={p.id} value={p.id}>
                      {productLabel(p)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>
          <Field label={t('form.price')} htmlFor="cf-price">
            <Input
              id="cf-price"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              dir="ltr"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label={t('form.unit')} htmlFor="cf-unit" hint={t('form.unitHint')}>
            <Input
              id="cf-unit"
              value={unit}
              maxLength={32}
              placeholder={selected?.unit ?? ''}
              onChange={(e) => setUnit(e.target.value)}
            />
          </Field>
          <Field label={t('form.validFrom')} htmlFor="cf-from">
            <Input id="cf-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label={t('form.validTo')} htmlFor="cf-to" hint={t('form.validToHint')}>
            <Input id="cf-to" type="date" value={validTo} min={validFrom} onChange={(e) => setValidTo(e.target.value)} />
          </Field>
          <Field label={t('form.note')} htmlFor="cf-note" className="sm:col-span-2">
            <Input id="cf-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex items-center gap-2">
          <Button type="submit" variant="primary" size="sm" loading={create.isPending}>
            {t('form.submit')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            {t('form.close')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
