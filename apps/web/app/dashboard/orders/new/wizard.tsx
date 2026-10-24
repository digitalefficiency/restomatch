'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { UnitText } from '@/lib/components/UnitText';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LinkButton,
  SectionHeader,
  Select,
  Spinner,
  cn,
  displayName,
  entitlementCauseOf,
  friendlyError,
  useSingleFlight,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { formatIls } from '@/lib/money';
import { OrderDocumentPreview } from '../order-document-preview';
import { addOrMerge, lineTotalIls, linesValid, orderTotalIls } from '../order-logic';
import { OverContractNote, useOrderContractPrices } from './contract-price';

type Outputs = inferRouterOutputs<AppRouter>;
type Channel = 'email' | 'whatsapp' | 'none';
type DeliveryPreview = Outputs['orders']['previewDelivery'];

interface DraftLine {
  key: string;
  productId?: string;
  /** Hebrew source text — what the supplier and the matcher see. */
  rawDescription: string;
  /** English display name, when known (UI only). */
  nameEn?: string | null;
  qty: number;
  unit: string;
  unitPriceExpected?: number;
}

type Step = 'SUPPLIER' | 'BUILD' | 'REVIEW' | 'SENT';
const STEPS: Step[] = ['SUPPLIER', 'BUILD', 'REVIEW', 'SENT'];
const STEP_KEY = { SUPPLIER: 'supplier', BUILD: 'build', REVIEW: 'review', SENT: 'sent' } as const;

const fwd = 'h-4 w-4 rtl:-scale-x-100';

export function NewOrderWizard({ initialSupplierId }: { initialSupplierId: string }) {
  const t = useT(ordersNs);
  const tc = useT(components);
  const locale = useLocale();

  const [step, setStep] = useState<Step>(initialSupplierId ? 'BUILD' : 'SUPPLIER');
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [announce, setAnnounce] = useState('');
  /** The draft created on the first submit — retries only re-send it (no duplicate drafts). */
  const [draftId, setDraftId] = useState<string | null>(null);
  /** Requested delivery, restaurant-local 'YYYY-MM-DD' ('' = not picked yet → the server default). */
  const [deliveryDate, setDeliveryDate] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(rawSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [rawSearch]);

  const suppliers = trpc.suppliers.list.useQuery({});
  const supplier = suppliers.data?.find((s) => s.id === supplierId);
  const supplierLabel = supplier ? displayName(supplier.name, supplier.nameEn, locale).primary : '';

  // An unknown/foreign ?supplierId= falls back to the picker instead of a dead end.
  useEffect(() => {
    if (suppliers.data && supplierId && !supplier) {
      setSupplierId('');
      setStep('SUPPLIER');
    }
  }, [suppliers.data, supplierId, supplier]);

  const catalog = trpc.catalog.items.useQuery(
    { supplierId, search: search || undefined, limit: search ? 20 : 8 },
    { enabled: step === 'BUILD' && !!supplierId, placeholderData: (prev) => prev },
  );
  // Flag `contracts`: contract prices for what's on screen (no-op when off).
  const contractPrice = useOrderContractPrices(supplierId, [...(catalog.data ?? []), ...lines]);

  // Cadence: derive the delivery date for the manager to CONFIRM (never silent).
  const delivery = trpc.orders.previewDelivery.useQuery(
    { supplierId },
    { enabled: !!supplierId, retry: false },
  );
  const deliveryDay = deliveryDate || delivery.data?.defaultDate || '';
  // Flag `orderPricesOut`: placeOrder sends the priced document (previewed on the
  // draft's page), not orders.supplierMessagePreview's text — show it only when off.
  const docSettings = trpc.orders.documentSettings.useQuery(undefined, { retry: false });

  // Default channel follows what the supplier can actually receive.
  const defaultChannel: Channel = supplier?.contactEmail
    ? 'email'
    : supplier?.contactWhatsapp
      ? 'whatsapp'
      : 'none';
  const effectiveChannel = channel ?? defaultChannel;

  const total = useMemo(() => orderTotalIls(lines), [lines]);
  const valid = linesValid(lines);
  const pricedLines = useMemo(
    () =>
      lines
        .filter((l) => l.productId && typeof l.unitPriceExpected === 'number')
        .map((l) => ({ productId: l.productId!, unitPriceExpected: l.unitPriceExpected! })),
    [lines],
  );

  const guardrail = trpc.orders.guardrail.useQuery(
    { supplierId, lines: pricedLines },
    { enabled: step === 'REVIEW' && pricedLines.length > 0, retry: false },
  );
  const guardrailGated = guardrail.error ? !!entitlementCauseOf(guardrail.error) : false;
  const warningsByProduct = new Map((guardrail.data?.warnings ?? []).map((w) => [w.productId, w]));

  const createDraft = trpc.orders.createDraft.useMutation();
  const once = useSingleFlight();
  const placeOrder = trpc.orders.placeOrder.useMutation();

  function addLine(line: Omit<DraftLine, 'key'>) {
    const res = addOrMerge(lines, line, () => crypto.randomUUID());
    setLines(res.lines);
    const name = displayName(line.rawDescription, line.nameEn, locale).primary;
    setAnnounce(res.merged ? t('wizard.alreadyAdded', { name }) : t('wizard.added', { name }));
  }
  function patchLine(key: string, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  function submit() {
    once(send);
  }

  async function send() {
    try {
      let poId = draftId;
      if (!poId) {
        const draft = await createDraft.mutateAsync({
          supplierId,
          // A scheduled supplier's date is re-derived on the server (a cutoff may
          // have passed since the preview) unless the manager picked another one.
          expectedDeliveryDate: deliveryDate || (delivery.data?.derived ? undefined : deliveryDay || undefined),
          lines: lines.map((l) => ({
            productId: l.productId,
            rawDescription: l.rawDescription || undefined,
            qty: l.qty,
            unit: l.unit,
            unitPriceExpected: l.unitPriceExpected,
          })),
        });
        poId = draft.poId;
        setDraftId(poId);
      }
      await placeOrder.mutateAsync({ poId, channel: effectiveChannel });
      setStep('SENT');
    } catch {
      // Surfaced below via createDraft.error / placeOrder.error.
    }
  }

  const placeErr = placeOrder.error;
  const placeErrMsg = placeErr
    ? entitlementCauseOf(placeErr)
      ? t('errors.whatsappGated')
      : friendlyError(placeErr, tc, {
          BAD_REQUEST: t('errors.noContact', {
            channel: t(`detail.channelNames.${effectiveChannel === 'whatsapp' ? 'whatsapp' : 'email'}`),
          }),
        })
    : null;

  const reset = () => {
    setStep('SUPPLIER');
    setSupplierId('');
    setLines([]);
    setChannel(null);
    setRawSearch('');
    setDraftId(null);
    setDeliveryDate('');
    createDraft.reset();
    placeOrder.reset();
  };

  const money = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const fmtDeliveryDate = (iso: string) =>
    formatDate(iso, locale, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeader level={1} title={t('wizard.title')} subtitle={t('wizard.subtitle')} />
      <ol aria-label={t('wizard.stepsLabel')} className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((s, i) => {
          const idx = STEPS.indexOf(step);
          return (
            <li
              key={s}
              aria-current={s === step ? 'step' : undefined}
              className={cn(
                'rounded-full px-3 py-1',
                i <= idx
                  ? 'bg-primary/12 font-semibold text-primary ring-1 ring-primary/25'
                  : 'bg-surface-2 text-subtle',
              )}
            >
              <span className="tabular-nums">{i + 1}.</span> {t(`wizard.steps.${STEP_KEY[s]}`)}
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {step === 'SUPPLIER' && (
        <Card elevated flow>
          {suppliers.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-muted">
              <Spinner className="h-4 w-4" />
            </div>
          ) : (suppliers.data ?? []).length === 0 ? (
            <EmptyState
              title={t('wizard.noSuppliers')}
              action={
                <LinkButton href="/dashboard/suppliers" size="sm">
                  {t('wizard.addSupplier')}
                </LinkButton>
              }
            />
          ) : (
            <>
              <Field label={t('wizard.pickSupplier')} htmlFor="ord-supplier">
                <Select
                  id="ord-supplier"
                  value={supplierId}
                  onChange={(e) => {
                    setSupplierId(e.target.value);
                    setLines([]);
                    setChannel(null);
                    setDraftId(null);
                  }}
                >
                  <option value="">{t('wizard.pickSupplierOption')}</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {displayName(s.name, s.nameEn, locale).primary}
                    </option>
                  ))}
                </Select>
              </Field>
              {supplierId ? (
                <DeliveryPanel
                  d={delivery.data ?? null}
                  loading={delivery.isLoading}
                  fmt={fmtDeliveryDate}
                  value={deliveryDay}
                  onChange={(v) => setDeliveryDate(v)}
                  disabled={!!draftId}
                />
              ) : null}
              <div className="mt-4">
                <Button variant="primary" size="sm" disabled={!supplierId} onClick={() => setStep('BUILD')}>
                  {t('wizard.continue')} <ArrowRight className={fwd} aria-hidden="true" />
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {step === 'BUILD' && (
        <div className="space-y-4">
          <Card elevated>
            <p className="mb-3 text-sm text-muted">
              {t('wizard.supplierLabel')} <span className="font-semibold text-ink">{supplierLabel}</span>
            </p>
            <Field label={t('wizard.addFromCatalog')} htmlFor="ord-search">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
                  aria-hidden="true"
                />
                <Input
                  id="ord-search"
                  type="search"
                  value={rawSearch}
                  onChange={(e) => setRawSearch(e.target.value)}
                  placeholder={t('wizard.searchPlaceholder')}
                  className="ps-9"
                  autoComplete="off"
                />
              </div>
            </Field>
            {!search && (catalog.data ?? []).length > 0 ? (
              <p className="mt-2 text-xs text-subtle">{t('wizard.browseHint')}</p>
            ) : null}
            <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line">
              {catalog.isLoading ? (
                <div className="flex items-center gap-2 p-3 text-sm text-muted">
                  <Spinner className="h-4 w-4" /> {t('wizard.searching')}
                </div>
              ) : (catalog.data ?? []).length === 0 ? (
                search ? (
                  <p className="p-3 text-sm text-subtle">{t('wizard.noCatalogResults')}</p>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-subtle">
                    <span>{t('wizard.catalogEmpty')}</span>
                    <LinkButton href={`/dashboard/catalog/import?supplierId=${supplierId}`} size="sm" variant="secondary">
                      <Upload className="h-4 w-4" aria-hidden="true" /> {t('wizard.importCatalog')}
                    </LinkButton>
                  </div>
                )
              ) : (
                <ul>
                  {(catalog.data ?? []).map((it) => {
                    const name = displayName(it.supplierNameRaw, it.productNameEn, locale);
                    const unit = it.unit ?? (locale === 'en' ? 'unit' : 'יח׳');
                    const listPrice = contractPrice(it.productId, unit) ?? (it.listPrice != null ? Number(it.listPrice) : undefined);
                    return (
                      <li key={it.id} className="border-b border-line/60 last:border-0">
                        <button
                          type="button"
                          data-testid="catalog-item"
                          onClick={() =>
                            addLine({
                              productId: it.productId ?? undefined,
                              rawDescription: it.supplierNameRaw,
                              nameEn: it.productNameEn,
                              qty: 1,
                              unit,
                              unitPriceExpected: listPrice,
                            })
                          }
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-ink">{name.primary}</span>
                            {name.secondary || it.supplierSku ? (
                              <span className="block truncate text-xs text-subtle">
                                {[name.secondary, it.supplierSku].filter(Boolean).join(' · ')}
                              </span>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-muted">
                            {listPrice !== undefined ? money(listPrice) : '—'}
                            {it.unit ? (
                              <span className="font-sans">
                                / <UnitText unit={it.unit} />
                              </span>
                            ) : null}
                            <Plus className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="mt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    { key: crypto.randomUUID(), rawDescription: '', qty: 1, unit: locale === 'en' ? 'unit' : 'יח׳' },
                  ])
                }
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> {t('wizard.addFreeLine')}
              </Button>
            </div>
          </Card>

          <Card elevated>
            {lines.length === 0 ? (
              <EmptyState title={t('wizard.emptyOrderTitle')} description={t('wizard.emptyOrderBody')} />
            ) : (
              <ul className="space-y-3">
                {lines.map((l) => {
                  const name = displayName(l.rawDescription, l.nameEn, locale);
                  return (
                    // Grid, not flex: each field owns a fixed column (Input fills its cell), so a
                    // line stays one row at desktop. Phone: name + delete, then qty/unit/price/total.
                    <li
                      key={l.key}
                      className="grid grid-cols-[4rem_4.5rem_5rem_minmax(0,1fr)_auto] items-end gap-x-2 gap-y-2 border-b border-line/60 pb-3 last:border-0 sm:grid-cols-[minmax(10rem,1fr)_5rem_5rem_6rem_6rem_auto] sm:gap-x-3"
                    >
                      <div className="order-1 col-span-4 min-w-0 sm:order-none sm:col-span-1">
                        {l.productId ? (
                          <>
                            <p className="truncate text-sm text-ink">{name.primary}</p>
                            {name.secondary ? (
                              <p className="truncate text-xs text-subtle" lang="he">
                                {name.secondary}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <Input
                            value={l.rawDescription}
                            onChange={(e) => patchLine(l.key, { rawDescription: e.target.value })}
                            placeholder={t('wizard.freeLinePlaceholder')}
                            aria-label={t('wizard.freeLinePlaceholder')}
                            maxLength={400}
                            aria-invalid={!l.rawDescription.trim() || undefined}
                            className="text-sm"
                          />
                        )}
                        {/* Over-contract note under the name: the grid's fixed columns stay intact. */}
                        <OverContractNote price={l.unitPriceExpected} contract={contractPrice(l.productId, l.unit)} />
                      </div>
                      <label className="order-3 min-w-0 text-xs text-subtle sm:order-none">
                        {t('wizard.qty')}
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={Number.isFinite(l.qty) ? l.qty : ''}
                          onChange={(e) => patchLine(l.key, { qty: e.target.value === '' ? 0 : Number(e.target.value) })}
                          aria-invalid={!(l.qty > 0) || undefined}
                          className="mt-0.5 px-2 text-end text-sm tabular-nums"
                        />
                      </label>
                      <label className="order-3 min-w-0 text-xs text-subtle sm:order-none">
                        {t('wizard.unit')}
                        <Input
                          value={l.unit}
                          onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                          maxLength={32}
                          className="mt-0.5 px-2 text-sm"
                        />
                      </label>
                      <label className="order-3 min-w-0 text-xs text-subtle sm:order-none">
                        {t('wizard.price')}
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={l.unitPriceExpected ?? ''}
                          onChange={(e) =>
                            patchLine(l.key, {
                              unitPriceExpected: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="mt-0.5 px-2 text-end text-sm tabular-nums"
                        />
                      </label>
                      <span className="order-3 pb-2 text-end font-mono text-sm tabular-nums text-ink sm:order-none">
                        {/* No price yet ≠ free: "—", not ₪0.00. */}
                        {l.unitPriceExpected == null
                          ? '—'
                          : money(lineTotalIls(l.qty, l.unitPriceExpected))}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        className="order-2 mb-1.5 justify-self-end rounded p-1 text-subtle hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:order-none"
                        aria-label={t('wizard.remove', {
                          name: name.primary || t('wizard.freeLinePlaceholder'),
                        })}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
                <li className="flex justify-between pt-1 text-sm font-semibold text-ink">
                  <span>{t('wizard.total')}</span>
                  <span className="font-mono tabular-nums">{money(total)}</span>
                </li>
              </ul>
            )}
            {lines.length > 0 && !valid ? (
              <p className="mt-3 text-xs text-warn">{t('wizard.fixLines')}</p>
            ) : null}
            <div className="mt-4 flex items-center gap-2">
              <Button variant="primary" size="sm" disabled={!valid} onClick={() => setStep('REVIEW')}>
                {t('wizard.toReview')} <ArrowRight className={fwd} aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStep('SUPPLIER')}>
                {t('wizard.back')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {step === 'REVIEW' && (
        <Card elevated flow>
          <h2 className="mb-3 text-base font-bold text-ink">{t('wizard.reviewTitle', { supplier: supplierLabel })}</h2>
          <ul className="space-y-2">
            {lines.map((l) => {
              const w = l.productId ? warningsByProduct.get(l.productId) : undefined;
              const name = displayName(l.rawDescription, l.nameEn, locale);
              return (
                <li
                  key={l.key}
                  className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 last:border-0"
                >
                  {/* The price badges sit under the name so they never squeeze it (phone). */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{name.primary}</p>
                    {w && (
                      <Badge
                        tone={w.level === 'high' ? 'danger' : 'warning'}
                        icon={<TriangleAlert className="h-3 w-3" aria-hidden="true" />}
                        className="mt-1"
                      >
                        {w.level === 'high'
                          ? t('wizard.aboveP90')
                          : t('wizard.aboveMedian', {
                              pct: formatPercent(w.pctOverMedian, locale, 0),
                            })}
                      </Badge>
                    )}
                    <OverContractNote price={l.unitPriceExpected} contract={contractPrice(l.productId, l.unit)} />
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted">
                    <bdi>{formatNumber(l.qty, locale, { maximumFractionDigits: 3 })}</bdi>{' '}
                    <UnitText unit={l.unit} />
                    {l.unitPriceExpected !== undefined ? (
                      <>
                        {' × '}
                        <bdi dir="ltr">{money(l.unitPriceExpected)}</bdi>
                      </>
                    ) : null}
                  </span>
                  <span className="w-24 shrink-0 text-end font-mono text-sm tabular-nums text-ink">
                    {l.unitPriceExpected == null
                      ? '—'
                      : money(lineTotalIls(l.qty, l.unitPriceExpected))}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-between text-sm font-semibold text-ink">
            <span>{t('wizard.total')}</span>
            <span className="font-mono tabular-nums">{money(total)}</span>
          </div>

          <DeliveryPanel
                  d={delivery.data ?? null}
                  loading={delivery.isLoading}
                  fmt={fmtDeliveryDate}
                  value={deliveryDay}
                  onChange={(v) => setDeliveryDate(v)}
                  disabled={!!draftId}
                />

          {guardrail.isFetching && (
            <p className="mt-3 flex items-center gap-2 text-xs text-subtle">
              <Spinner className="h-3.5 w-3.5" /> {t('wizard.checkingBaseline')}
            </p>
          )}
          {guardrailGated && <p className="mt-3 text-xs text-subtle">{t('wizard.guardrailGated')}</p>}

          <div className="mt-5 space-y-3 border-t border-line pt-4">
            {/* What the supplier will receive — only when something is actually sent. */}
            {effectiveChannel !== 'none' && supplierId && valid && docSettings.data?.enabled === false && (
              <OrderDocumentPreview
                input={{
                  supplierId,
                  expectedDeliveryDate: deliveryDay || undefined,
                  lines: lines.map((l) => ({
                    productId: l.productId ?? undefined,
                    rawDescription: l.rawDescription || undefined,
                    qty: l.qty,
                    unit: l.unit,
                  })),
                }}
              />
            )}
            {/* Short options (they never clip at 390 px); the destination shows under the field. */}
            <Field
              label={t('wizard.channel')}
              htmlFor="ord-channel"
              hint={
                effectiveChannel === 'email' && supplier?.contactEmail ? (
                  <bdi dir="ltr">{supplier.contactEmail}</bdi>
                ) : effectiveChannel === 'whatsapp' && supplier?.contactWhatsapp ? (
                  <bdi dir="ltr">{supplier.contactWhatsapp}</bdi>
                ) : undefined
              }
            >
              <Select
                id="ord-channel"
                value={effectiveChannel}
                onChange={(e) => setChannel(e.target.value as Channel)}
                disabled={!!draftId && placeOrder.isPending}
              >
                <option value="email" disabled={!supplier?.contactEmail}>
                  {supplier?.contactEmail
                    ? t('wizard.channelEmail')
                    : `${t('wizard.channelEmail')} — ${t('wizard.channelMissing')}`}
                </option>
                <option value="whatsapp" disabled={!supplier?.contactWhatsapp}>
                  {supplier?.contactWhatsapp
                    ? t('wizard.channelWhatsapp')
                    : `${t('wizard.channelWhatsapp')} — ${t('wizard.channelMissing')}`}
                </option>
                <option value="none">{t('wizard.channelNone')}</option>
              </Select>
            </Field>
            {placeErrMsg && (
              <p role="alert" className="text-sm text-danger">
                {placeErrMsg}
              </p>
            )}
            {createDraft.error && (
              <p role="alert" className="text-sm text-danger">
                {friendlyError(createDraft.error, tc)}
              </p>
            )}
            {draftId && placeErr ? (
              <p className="text-xs text-muted">
                {t('wizard.draftSaved')}{' '}
                <Link href={`/dashboard/orders/${draftId}`} className="text-primary underline">
                  {t('wizard.openDraft')}
                </Link>
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                loading={createDraft.isPending || placeOrder.isPending}
                onClick={submit}
              >
                {t('wizard.submit')}
              </Button>
              <Button variant="ghost" size="sm" disabled={!!draftId} onClick={() => setStep('BUILD')}>
                {t('wizard.back')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 'SENT' && (
        <Card elevated flow className="text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
          <p className="mt-3 text-lg font-semibold text-ink" role="status">
            {effectiveChannel === 'none' ? t('wizard.markedTitle') : t('wizard.sentTitle')}
          </p>
          <p className="mt-1 text-sm text-muted">
            {effectiveChannel === 'none' ? t('wizard.markedBody') : t('wizard.sentBody')}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {draftId ? (
              <LinkButton href={`/dashboard/orders/${draftId}`} size="sm">
                {t('wizard.viewOrder')}
              </LinkButton>
            ) : null}
            <LinkButton href="/dashboard/orders" size="sm" variant="secondary">
              {t('wizard.toList')}
            </LinkButton>
            <Button variant="ghost" size="sm" onClick={reset}>
              {t('wizard.another')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * The requested delivery date, which the manager confirms or changes. With an
 * order schedule it starts at the DERIVED date (and says so when today's cutoff
 * has passed instead of silently rolling); without one it starts at tomorrow.
 */
function DeliveryPanel({
  d,
  loading,
  fmt,
  value,
  onChange,
  disabled,
}: {
  d: DeliveryPreview | null;
  loading: boolean;
  fmt: (iso: string) => string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const t = useT(ordersNs);
  if (loading || !d) return null;
  const derived = d.derived;
  // The headline is the date that will be sent; the schedule's date is a hint
  // only when the manager picked another one.
  const pickedIso = value ? `${value}T12:00:00Z` : null; // noon UTC is the same calendar day in IL
  const scheduleDay = derived ? derived.expectedDeliveryAt : null;
  const differs = !!derived && !!value && value !== d.defaultDate;
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm">
      {pickedIso ? (
        <p className="flex items-center gap-2 text-ink" data-testid="order-delivery-headline">
          <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>
            {t('wizard.deliveryExpected')} <span className="font-semibold">{fmt(pickedIso)}</span>
          </span>
        </p>
      ) : null}
      {derived ? (
        <>
          {derived.missedCutoff && !differs && (
            <p className="mt-2 text-xs text-warn">{t('wizard.missedCutoff', { date: fmt(derived.expectedDeliveryAt) })}</p>
          )}
          <p className="mt-1 text-xs text-subtle">
            {differs && scheduleDay
              ? t('wizard.scheduleHint', { date: fmt(scheduleDay) })
              : t('wizard.deliveryHint')}
          </p>
        </>
      ) : (
        <p className="mt-1 flex items-center gap-2 text-xs text-subtle">{t('wizard.noSchedule')}</p>
      )}
      <Field label={t('wizard.deliveryDate')} htmlFor="ord-delivery-date" className="mt-3">
        <Input
          id="ord-delivery-date"
          type="date"
          data-testid="order-delivery-date"
          value={value}
          min={d.today}
          required
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    </div>
  );
}
