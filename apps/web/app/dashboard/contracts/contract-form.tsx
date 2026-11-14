'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Money,
  Select,
  displayName,
  friendlyError,
    useToast,
} from '@/lib/components';
import { formatDate } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { components } from '@/lib/i18n/messages/components';
import { contractWriteErrorKey, matchesSearch, parseContractPrice, todayIso } from './logic';

export interface SupplierOption {
  id: string;
  name: string;
  nameEn?: string | null;
}

/**
 * "Add contract price" form: supplier → product (own products first, from
 * contracts.productOptions, with a search box) → price (text +
 * inputMode=decimal), unit, valid from/to, note. W2-12: "what you pay today"
 * (contracts.priceContext) under the price, and "lock current prices as
 * contract" for the chosen supplier. With `fixedSupplierId` (the supplier
 * page) the supplier select is hidden.
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
  const [productQuery, setProductQuery] = useState('');
  const [lockPreview, setLockPreview] = useState<{ count: number; monthlyAgorot: number; today: string } | null>(null);
  const [unit, setUnit] = useState('');
  const [validFrom, setValidFrom] = useState(todayIso());
  const [validTo, setValidTo] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const products = trpc.contracts.productOptions.useQuery({ supplierId }, { enabled: !!supplierId });
  const create = trpc.contracts.create.useMutation();
  const lock = trpc.contracts.lockCurrentPrices.useMutation();
  const context = trpc.contracts.priceContext.useQuery({ supplierId, productId }, { enabled: !!supplierId && !!productId });

  const matching = (products.data ?? []).filter((p) => p.id === productId || matchesSearch(productQuery, p.name, p.nameEn));
  const own = matching.filter((p) => p.own);
  const other = matching.filter((p) => !p.own);
  const selected = products.data?.find((p) => p.id === productId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = parseContractPrice(price);
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

  async function previewLock() {
    setError(null);
    try {
      const res = await lock.mutateAsync({ supplierId, dryRun: true });
      if (res.count === 0) {
        toast.info(t('form.lockNone'));
        return;
      }
      setLockPreview({ count: res.count, monthlyAgorot: res.monthlyAgorot, today: res.today });
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  async function confirmLock() {
    try {
      const res = await lock.mutateAsync({ supplierId });
      setLockPreview(null);
      toast.success(t('form.lockDone', { count: res.created }));
      void utils.contracts.list.invalidate();
      void utils.contracts.queue.invalidate();
      onDone();
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  return (
    <Card elevated flow>
      <form onSubmit={submit} noValidate>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{t('form.title')}</h2>
          {supplierId ? (
            <Button type="button" variant="secondary" onClick={() => void previewLock()} loading={lock.isPending && !lockPreview}>
              <Lock className="h-4 w-4" aria-hidden="true" /> {t('form.lock')}
            </Button>
          ) : null}
        </div>
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
          <Field label={t('form.searchProduct')} htmlFor="cf-product-search">
            <Input
              id="cf-product-search"
              type="search"
              value={productQuery}
              disabled={!supplierId}
              onChange={(e) => setProductQuery(e.target.value)}
            />
          </Field>
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
                    : matching.length === 0
                      ? t('form.noMatches')
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
            {/* Text + inputMode=decimal (never type=number); 4 dp kept for per-gram prices. */}
            <Input
              id="cf-price"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className="text-right"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-describedby="cf-price-context"
            />
            <p id="cf-price-context" className="mt-1 text-xs text-muted" data-testid="price-context">
              {!productId || !context.data ? null : context.data.lastPrice == null ? (
                t('form.noHistory')
              ) : (
                <>
                  {t('form.lastPrice')} <Money value={context.data.lastPrice} context="unit" />{' '}
                  {context.data.lastAt ? `(${formatDate(context.data.lastAt, locale, { day: '2-digit', month: '2-digit' })})` : null}
                  {context.data.median90 != null ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      {t('form.median')} <Money value={context.data.median90} context="unit" />
                    </>
                  ) : null}
                </>
              )}
            </p>
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
          <Button type="submit" variant="primary" loading={create.isPending}>
            {t('form.submit')}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            {t('form.close')}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={lockPreview !== null}
        danger={false}
        title={lockPreview ? t('form.lockTitle', { count: lockPreview.count }) : ''}
        body={
          lockPreview ? (
            <p>
              {t('form.lockBody', { date: formatDate(lockPreview.today, locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) })}{' '}
              <Money agorot={lockPreview.monthlyAgorot} context="line" /> {t('form.lockMonthly')}
            </p>
          ) : null
        }
        confirmLabel={lockPreview ? t('form.lockConfirm', { count: lockPreview.count }) : ''}
        cancelLabel={t('form.close')}
        loading={lock.isPending}
        onConfirm={() => void confirmLock()}
        onClose={() => setLockPreview(null)}
      />
    </Card>
  );
}
